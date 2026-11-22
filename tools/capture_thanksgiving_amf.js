#!/usr/bin/env node
/**
 * tools/capture_thanksgiving_amf.js
 * Capture traffic AMF Ninja Saga untuk runtime Adobe AIR (ninja_saga.exe)
 * melalui local HTTPS proxy khusus host amf.ninjasaga.cc, serta mendukung
 * import langsung capture Fiddler Classic (.saz) via --import.
 *
 * Penggunaan:
 *   node tools/capture_thanksgiving_amf.js
 *   node tools/capture_thanksgiving_amf.js --port 8888 --duration 300
 *   node tools/capture_thanksgiving_amf.js --no-system-proxy
 *   node tools/capture_thanksgiving_amf.js --import path\ke\capture.saz
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { decodeAmfPacket } = require('../lib/amf_decoder.js');
const { importCapture, decodeJsonlCapture } = require('./import_thanksgiving_saz.js');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const CERT_DIR = path.join(LOGS_DIR, 'cert');
const OUT_JSONL = path.join(LOGS_DIR, 'thanksgiving_amf_capture.jsonl');
const OUT_META = path.join(LOGS_DIR, 'thanksgiving_amf_capture_meta.json');
const OUT_DECODED = path.join(LOGS_DIR, 'thanksgiving_amf_decoded.json');
const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const TARGET_AMF_HOST = 'amf.ninjasaga.cc';
const PFX_PASS = 'nscc-capture-local';

function parseArgs(argv) {
    const opts = {
        port: 8888,
        durationSec: 300,
        useSystemProxy: true,
        importPath: ''
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--import' && argv[i + 1]) opts.importPath = argv[++i];
        else if (a === '--port' && argv[i + 1]) opts.port = Math.max(1024, parseInt(argv[++i], 10) || 8888);
        else if (a === '--duration' && argv[i + 1]) opts.durationSec = Math.max(10, parseInt(argv[++i], 10) || 300);
        else if (a === '--no-system-proxy') opts.useSystemProxy = false;
    }
    return opts;
}

function queryRegValue(name) {
    const res = spawnSync('reg.exe', ['query', REG_PATH, '/v', name], { encoding: 'utf8', windowsHide: true });
    if (res.status !== 0) return { exists: false, value: '' };
    const line = String(res.stdout || '').split(/\r?\n/).find(l => l.includes(name));
    if (!line) return { exists: false, value: '' };
    const m = line.match(/REG_(?:DWORD|SZ)\s+(.*)$/);
    return { exists: true, value: m ? m[1].trim() : '' };
}

function readWindowsProxyBackup() {
    const enable = queryRegValue('ProxyEnable');
    const server = queryRegValue('ProxyServer');
    return {
        enableExists: enable.exists,
        enableValue: enable.exists ? parseInt(enable.value, 16) : 0,
        serverExists: server.exists,
        serverValue: server.value
    };
}

function refreshWinInet() {
    const ps = [
        '$sig = \'[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);\';',
        '$t = Add-Type -MemberDefinition $sig -Name WinInetUtil -Namespace NSCC -PassThru;',
        '$null = $t::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0);',
        '$null = $t::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0);'
    ].join(' ');
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
}

function setWindowsProxy(proxyServer) {
    spawnSync('reg.exe', ['add', REG_PATH, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true });
    spawnSync('reg.exe', ['add', REG_PATH, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', proxyServer, '/f'], { windowsHide: true });
    refreshWinInet();
}

function restoreWindowsProxy(backup) {
    if (!backup) return;
    spawnSync('reg.exe', ['add', REG_PATH, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', String(backup.enableValue ? 1 : 0), '/f'], { windowsHide: true });
    if (backup.serverExists && backup.serverValue) {
        spawnSync('reg.exe', ['add', REG_PATH, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', backup.serverValue, '/f'], { windowsHide: true });
    } else {
        spawnSync('reg.exe', ['delete', REG_PATH, '/v', 'ProxyServer', '/f'], { windowsHide: true });
    }
    refreshWinInet();
}

function ensureLocalCertificates() {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const caCer = path.join(CERT_DIR, 'nscc_capture_ca.cer');
    const leafPfx = path.join(CERT_DIR, 'amf_ninjasaga_cc.pfx');
    const thumbFile = path.join(CERT_DIR, 'ca_thumbprint.txt');

    if (!fs.existsSync(caCer) || !fs.existsSync(leafPfx) || !fs.existsSync(thumbFile)) {
        console.log('[1/3] Membuat sertifikat lokal untuk intercept ' + TARGET_AMF_HOST + '...');
        const psScript = [
            '$ErrorActionPreference = "Stop";',
            '$ca = New-SelfSignedCertificate -Subject "CN=NSCC Thanksgiving Capture CA" -CertStoreLocation "Cert:\\CurrentUser\\My" -KeyUsage CertSign,CRLSign,DigitalSignature -TextExtension @("2.5.29.19={critical}{text}ca=true") -NotAfter (Get-Date).AddYears(3);',
            `Export-Certificate -Cert $ca -FilePath "${caCer.replace(/\\/g, '\\\\')}" -Force | Out-Null;`,
            '$leaf = New-SelfSignedCertificate -DnsName "' + TARGET_AMF_HOST + '" -Signer $ca -CertStoreLocation "Cert:\\CurrentUser\\My" -NotAfter (Get-Date).AddYears(1);',
            '$pw = ConvertTo-SecureString -String "' + PFX_PASS + '" -Force -AsPlainText;',
            `Export-PfxCertificate -Cert $leaf -FilePath "${leafPfx.replace(/\\/g, '\\\\')}" -Password $pw -Force | Out-Null;`,
            `Set-Content -Path "${thumbFile.replace(/\\/g, '\\\\')}" -Value $ca.Thumbprint -NoNewline;`
        ].join(' ');
        const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { encoding: 'utf8', windowsHide: true });
        if (r.status !== 0) {
            throw new Error('Gagal membuat sertifikat lokal: ' + (r.stderr || r.stdout || 'PowerShell error'));
        }
    }

    const thumbprint = fs.readFileSync(thumbFile, 'utf8').trim();
    const checkTrusted = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `if (Test-Path "Cert:\\CurrentUser\\Root\\${thumbprint}") { "TRUSTED" } else { "UNTRUSTED" }`
    ], { encoding: 'utf8', windowsHide: true });

    if (!String(checkTrusted.stdout || '').includes('TRUSTED')) {
        console.log('[2/3] Memasang Root CA lokal ke Windows CurrentUser\\Root (klik Yes jika muncul dialog konfirmasi)...');
        const addRes = spawnSync('certutil.exe', ['-user', '-addstore', 'Root', caCer], { encoding: 'utf8' });
        if (addRes.status !== 0) {
            throw new Error(
                'Root CA lokal belum dipercaya Windows. Jika tidak ingin memasang sertifikat lokal, ' +
                'gunakan Fiddler Classic -> Save All Sessions (.saz), lalu jalankan:\n' +
                '  node tools/import_thanksgiving_saz.js <file.saz>'
            );
        }
    }

    return tls.createSecureContext({
        pfx: fs.readFileSync(leafPfx),
        passphrase: PFX_PASS
    });
}

function appendCaptureLine(stream, entry) {
    stream.write(JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function summarizeAmfSafely(buf) {
    try {
        const pkt = decodeAmfPacket(buf);
        const msg = pkt.messages && pkt.messages[0];
        return msg ? { service: msg.targetUri, body: msg.body } : null;
    } catch (_) {
        return null;
    }
}

function startProxyCapture(opts) {
    if (process.platform !== 'win32') {
        throw new Error('Mode live proxy Windows ini membutuhkan OS Windows. Untuk OS lain gunakan --import <file.saz>.');
    }

    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const secureContext = ensureLocalCertificates();
    const stream = fs.createWriteStream(OUT_JSONL, { flags: 'w' });
    const upstreamAgent = new https.Agent({ keepAlive: true });
    let capturedCount = 0;
    let proxyBackup = null;
    let cleanedUp = false;

    const mitmServer = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', d => chunks.push(d));
        req.on('end', () => {
            const reqBody = Buffer.concat(chunks);
            const requestId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
            const fullUrl = 'https://' + TARGET_AMF_HOST + (req.url || '/');
            const reqAmf = summarizeAmfSafely(reqBody);

            appendCaptureLine(stream, {
                kind: 'request',
                requestId,
                url: fullUrl,
                method: req.method,
                headers: req.headers,
                bodyBase64: reqBody.toString('base64')
            });

            const headers = { ...req.headers };
            delete headers['proxy-connection'];
            headers.host = TARGET_AMF_HOST;
            headers['content-length'] = String(reqBody.length);
            headers['accept-encoding'] = 'identity';

            const upReq = https.request({
                hostname: TARGET_AMF_HOST,
                port: 443,
                path: req.url || '/',
                method: req.method || 'POST',
                headers,
                agent: upstreamAgent
            }, upRes => {
                const resChunks = [];
                upRes.on('data', d => resChunks.push(d));
                upRes.on('end', () => {
                    const resBody = Buffer.concat(resChunks);
                    const outHeaders = { ...upRes.headers };
                    delete outHeaders['transfer-encoding'];
                    outHeaders['content-length'] = String(resBody.length);
                    res.writeHead(upRes.statusCode || 200, outHeaders);
                    res.end(resBody);

                    appendCaptureLine(stream, {
                        kind: 'response',
                        requestId,
                        url: fullUrl,
                        status: upRes.statusCode || 200,
                        headers: upRes.headers,
                        bodyBase64: resBody.toString('base64')
                    });

                    capturedCount++;
                    const svc = reqAmf ? reqAmf.service : (req.method + ' ' + req.url);
                    console.log(`[AMF #${capturedCount}] ${svc} (HTTP ${upRes.statusCode})`);
                    if (reqAmf && Array.isArray(reqAmf.body)) {
                        console.log('   Params: ' + JSON.stringify(reqAmf.body));
                    }
                });
            });
            upReq.on('error', err => {
                appendCaptureLine(stream, { kind: 'response-error', requestId, url: fullUrl, error: err.message });
                if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('Upstream error: ' + err.message);
            });
            upReq.end(reqBody);
        });
    });

    const proxyServer = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', d => chunks.push(d));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            let targetUrl;
            try {
                targetUrl = new URL(req.url);
            } catch (_) {
                res.writeHead(400);
                res.end('Bad proxy URL');
                return;
            }
            const upReq = http.request({
                hostname: targetUrl.hostname,
                port: targetUrl.port || 80,
                path: targetUrl.pathname + targetUrl.search,
                method: req.method,
                headers: req.headers
            }, upRes => {
                res.writeHead(upRes.statusCode || 200, upRes.headers);
                upRes.pipe(res);
            });
            upReq.on('error', err => {
                if (!res.headersSent) res.writeHead(502);
                res.end(err.message);
            });
            upReq.end(body);
        });
    });

    proxyServer.on('connect', (req, clientSocket, head) => {
        const [rawHost, rawPort] = String(req.url || '').split(':');
        const host = (rawHost || '').trim().toLowerCase();
        const port = parseInt(rawPort || '443', 10) || 443;

        if (host === TARGET_AMF_HOST && port === 443) {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            const tlsSocket = new tls.TLSSocket(clientSocket, {
                isServer: true,
                secureContext
            });
            if (head && head.length) tlsSocket.unshift(head);
            tlsSocket.on('error', () => { });
            mitmServer.emit('connection', tlsSocket);
            return;
        }

        const remoteSocket = net.connect(port, host, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) remoteSocket.write(head);
            remoteSocket.pipe(clientSocket);
            clientSocket.pipe(remoteSocket);
        });
        remoteSocket.on('error', () => {
            try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (_) { }
        });
        clientSocket.on('error', () => {
            try { remoteSocket.destroy(); } catch (_) { }
        });
    });

    function cleanupAndFinish(reason) {
        if (cleanedUp) return;
        cleanedUp = true;
        if (proxyBackup) {
            restoreWindowsProxy(proxyBackup);
            console.log('\n[i] Pengaturan proxy Windows telah dikembalikan ke kondisi semula.');
        }
        stream.end(() => {
            let decodedCount = 0;
            try {
                const decoded = decodeJsonlCapture(OUT_JSONL);
                fs.writeFileSync(OUT_DECODED, JSON.stringify(decoded, null, 2));
                decodedCount = decoded.totalAmfCalls;
            } catch (_) { }
            fs.writeFileSync(OUT_META, JSON.stringify({
                status: 'finished',
                reason,
                finishedAt: new Date().toISOString(),
                capturedCount,
                decodedCount,
                out: OUT_JSONL,
                decodedOut: OUT_DECODED
            }, null, 2));
            console.log(`[i] Capture selesai (${reason}). Total request terekam: ${capturedCount}, terdecode: ${decodedCount}`);
            console.log(`    Raw JSONL : ${OUT_JSONL}`);
            console.log(`    Decoded   : ${OUT_DECODED}`);
            try { proxyServer.close(); } catch (_) { }
            try { mitmServer.close(); } catch (_) { }
            process.exit(0);
        });
    }

    proxyServer.listen(opts.port, '127.0.0.1', () => {
        if (opts.useSystemProxy) {
            proxyBackup = readWindowsProxyBackup();
            setWindowsProxy(`127.0.0.1:${opts.port}`);
        }
        fs.writeFileSync(OUT_META, JSON.stringify({
            status: 'recording',
            mode: 'air-https-proxy',
            proxy: `127.0.0.1:${opts.port}`,
            targetHost: TARGET_AMF_HOST,
            startedAt: new Date().toISOString(),
            out: OUT_JSONL
        }, null, 2));

        console.log('======================================================================');
        console.log('          CAPTURE AMF RUNTIME AIR (PROXY LOKAL WINDOWS)');
        console.log('======================================================================');
        console.log(`Proxy aktif   : 127.0.0.1:${opts.port}`);
        console.log(`Target intercept: https://${TARGET_AMF_HOST}/ (host lain bypass langsung)`);
        console.log(`Output raw    : ${OUT_JSONL}`);
        console.log(`Durasi maks   : ${opts.durationSec} detik`);
        console.log('');
        console.log('Langkah:');
        console.log('  1. Buka / restart ninja_saga.exe sekarang.');
        console.log('  2. Masuk Event Thanksgiving -> cek status -> lawan 5 musuh -> mini-game -> werewolf.');
        console.log('  3. Tekan [Q] atau [Ctrl+C] jika sudah selesai untuk decode & restore proxy.');
        console.log('  Alternatif: jika game menolak sertifikat lokal, rekam via Fiddler Classic (.saz)');
        console.log('  lalu jalankan: node tools/import_thanksgiving_saz.js <file.saz>');
        console.log('======================================================================\n');

        const timer = setTimeout(() => cleanupAndFinish('timeout'), opts.durationSec * 1000);
        timer.unref();

        if (process.stdin.isTTY && process.stdin.setRawMode) {
            try {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');
                process.stdin.on('data', chunk => {
                    const s = String(chunk);
                    if (s === 'q' || s === 'Q' || s === '\r' || s === '\n' || s === '\u0003') {
                        cleanupAndFinish('user-stop');
                    }
                });
            } catch (_) { }
        }
    });

    process.on('SIGINT', () => cleanupAndFinish('SIGINT'));
    process.on('SIGTERM', () => cleanupAndFinish('SIGTERM'));
    process.on('uncaughtException', err => {
        console.error('Capture error:', err.message);
        cleanupAndFinish('error');
    });
}

if (require.main === module) {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.importPath) {
        const { report, outPath } = importCapture(opts.importPath);
        console.log(`Import selesai: ${report.totalAmfCalls} AMF call (${report.eventCallCount} non-boilerplate) -> ${outPath}`);
    } else {
        try {
            startProxyCapture(opts);
        } catch (err) {
            console.error('ERROR:', err.message);
            process.exitCode = 1;
        }
    }
}

module.exports = { parseArgs };
