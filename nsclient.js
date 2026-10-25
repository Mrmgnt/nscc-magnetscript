#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * nsclient.js — modul login + AMF NinjaSaga (hasil reverse client live).
 * Dipakai oleh ns_state.js dan bot misi. Tanpa dependency eksternal.
 *
 * Login: POST https://api.ninjasaga.cc/login {username,password,type:'web'}
 *   butuh header Origin/Referer site, kalau tidak → selalu 401 Invalid credentials.
 *   balasan: player_id, token, signature, hash_time
 * AMF:   SystemService.requireLogin [unix, hash_time, player_id]
 *        SystemService.snsLogin [player_id,'web','latest',result,hash,signature,token,'en']
 *        -> response.result[3] = session key (prefix "gs_"), dipakai semua DAO/Service.
 */
'use strict';

const https = require('https');
const { spawnSync } = require('child_process');
const { SALT, CODEC, sha1, getHash, getArrayHash, getLoginHash, ucEncode } = require('./nscrypt.js');

const AMF_HOST = 'amf.ninjasaga.cc';
const API_HOST = 'api.ninjasaga.cc';
const BUILD_NO = 'latest';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SITE = 'https://ninjasaga.cc/';
const ORIGIN = 'https://ninjasaga.cc';

const u16 = v => { const b = Buffer.allocUnsafe(2); b.writeUInt16BE(v, 0); return b; };
const u32 = v => { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(v, 0); return b; };
function enc(val) {
    if (val === null || val === undefined) return Buffer.from([0x05]);
    if (typeof val === 'boolean') return Buffer.from([0x01, val ? 1 : 0]);
    if (typeof val === 'number') { const b = Buffer.allocUnsafe(9); b[0] = 0; b.writeDoubleBE(val, 1); return b; }
    if (typeof val === 'string') { const s = Buffer.from(val, 'utf8'); return Buffer.concat([Buffer.from([0x02]), u16(s.length), s]); }
    if (Array.isArray(val)) { const p = [Buffer.from([0x0a]), u32(val.length)]; for (const v of val) p.push(enc(v)); return Buffer.concat(p); }
    if (typeof val === 'object') {
        const p = [Buffer.from([0x03])];
        for (const [k, v] of Object.entries(val)) { const kb = Buffer.from(k, 'utf8'); p.push(u16(kb.length), kb, enc(v)); }
        p.push(u16(0), Buffer.from([0x09]));
        return Buffer.concat(p);
    }
    return Buffer.from([0x05]);
}
function packet(service, params) {
    const svc = Buffer.from(service, 'utf8'), resp = Buffer.from('/1', 'utf8');
    const bp = [Buffer.from([0x0a]), u32(params.length)];
    for (const p of params) bp.push(enc(p));
    return Buffer.concat([u16(0), u16(0), u16(1), u16(svc.length), svc, u16(resp.length), resp, Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]), Buffer.concat(bp)]);
}
function parse(buf) {
    let pos = 0;
    const r16 = () => { const v = buf.readUInt16BE(pos); pos += 2; return v; };
    const r32 = () => { const v = buf.readUInt32BE(pos); pos += 4; return v; };
    function rv() {
        const t = buf[pos++];
        switch (t) {
            case 0x00: { const v = buf.readDoubleBE(pos); pos += 8; return v; }
            case 0x01: return buf[pos++] !== 0;
            case 0x02: { const l = r16(); const s = buf.toString('utf8', pos, pos + l); pos += l; return s; }
            case 0x03: return ro();
            case 0x05: case 0x06: case 0x0d: return null;
            case 0x08: { r32(); return ro(); }
            case 0x09: return null;
            case 0x0a: { const l = r32(); const a = []; for (let i = 0; i < l; i++) a.push(rv()); return a; }
            case 0x0b: { const ms = buf.readDoubleBE(pos); pos += 8; r16(); return new Date(ms).toISOString(); }
            case 0x0c: case 0x0f: { const l = r32(); const s = buf.toString('utf8', pos, pos + l); pos += l; return s; }
            case 0x10: { const l = r16(); pos += l; return ro(); }
            default: return '<marker 0x' + t.toString(16) + '>';
        }
    }
    function ro() {
        const o = {};
        while (pos + 2 < buf.length) {
            const l = buf.readUInt16BE(pos);
            if (l === 0 && buf[pos + 2] === 0x09) { pos += 3; break; }
            pos += 2;
            const k = buf.toString('utf8', pos, pos + l); pos += l;
            if (!k) break;
            o[k] = rv();
        }
        return o;
    }
    r16();
    const hc = r16();
    for (let i = 0; i < hc; i++) { rv(); pos += 1; r32(); rv(); }
    const mc = r16();
    const out = [];
    for (let i = 0; i < mc; i++) {
        const tl = r16(); const target = buf.toString('utf8', pos, pos + tl); pos += tl;
        const rl = r16(); const response = buf.toString('utf8', pos, pos + rl); pos += rl;
        pos += 4;
        out.push({ target, response, body: rv() });
    }
    return out;
}

function httpJson(host, path, payload) {
    if (process.platform === 'win32') {
        const url = `https://${host}${path}`;
        const data = Buffer.from(JSON.stringify(payload), 'utf8');
        const args = [
            '-s', '-S',
            '-X', 'POST',
            url,
            '-H', 'Content-Type: application/json',
            '-H', 'Origin: ' + ORIGIN,
            '-H', 'Referer: ' + SITE,
            '-H', 'User-Agent: ' + UA,
            '-H', 'Accept: application/json',
            '--data-binary', '@-',
            '-w', '\n%{http_code}'
        ];
        try {
            const r = spawnSync('curl.exe', args, { input: data, encoding: 'utf8', timeout: 25000, windowsHide: true });
            if (!r.error && r.stdout) {
                const stdout = r.stdout;
                const lastNewline = stdout.lastIndexOf('\n');
                if (lastNewline !== -1) {
                    const body = stdout.slice(0, lastNewline);
                    const status = parseInt(stdout.slice(lastNewline + 1).trim(), 10) || 0;
                    return Promise.resolve({ status, body });
                }
            }
        } catch (_) { }
    }

    const data = Buffer.from(JSON.stringify(payload));
    return new Promise(res => {
        const req = https.request({
            hostname: host, port: 443, path, method: 'POST',
            headers: {
                'Content-Type': 'application/json', 'Content-Length': data.length,
                'Origin': ORIGIN, 'Referer': SITE, 'User-Agent': UA, 'Accept': 'application/json',
            },
            rejectUnauthorized: false, timeout: 25000,
        }, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString('utf8') })); });
        req.on('error', e => res({ status: 0, body: 'ERROR ' + e.message }));
        req.on('timeout', () => { req.destroy(); res({ status: 0, body: 'ERROR timeout' }); });
        req.write(data); req.end();
    });
}

function amf(service, params) {
    const p = packet(service, params);
    if (process.platform === 'win32') {
        const args = [
            '-s', '-S',
            '-X', 'POST',
            'https://' + AMF_HOST + '/',
            '-H', 'Content-Type: application/x-amf',
            '-H', 'Origin: ' + ORIGIN,
            '-H', 'Referer: ' + SITE,
            '-H', 'User-Agent: ' + UA,
            '-H', 'x-flash-version: 33,1,1,346',
            '-H', 'Accept: application/x-amf',
            '-H', 'Accept-Encoding: identity',
            '--data-binary', '@-'
        ];
        try {
            const r = spawnSync('curl.exe', args, { input: p, maxBuffer: 32 * 1024 * 1024, timeout: 25000, windowsHide: true });
            if (!r.error && r.stdout && r.stdout.length > 0) {
                const raw = r.stdout;
                try {
                    const m = parse(raw);
                    const body = m.length ? m[0].body : null;
                    return Promise.resolve({ body, target: m.length ? m[0].target : '', fault: !!(body && (body.faultCode !== undefined || body.faultString !== undefined)), bytes: raw.length });
                } catch (e) {
                    return Promise.resolve({ body: null, parseError: e.message, hex: raw.slice(0, 160).toString('hex') });
                }
            }
        } catch (_) { }
    }

    return new Promise(res => {
        const req = https.request({
            hostname: AMF_HOST, port: 443, path: '/', method: 'POST',
            headers: {
                'Content-Type': 'application/x-amf', 'Content-Length': p.length,
                'Origin': ORIGIN, 'Referer': SITE, 'User-Agent': UA,
                'x-flash-version': '33,1,1,346', 'Accept': 'application/x-amf', 'Accept-Encoding': 'identity',
            },
            rejectUnauthorized: false, timeout: 25000,
        }, r => {
            const c = []; r.on('data', d => c.push(d));
            r.on('end', () => {
                const raw = Buffer.concat(c);
                try {
                    const m = parse(raw);
                    const body = m.length ? m[0].body : null;
                    res({ body, target: m.length ? m[0].target : '', fault: !!(body && (body.faultCode !== undefined || body.faultString !== undefined)), bytes: raw.length });
                } catch (e) { res({ body: null, parseError: e.message, hex: raw.slice(0, 160).toString('hex') }); }
            });
        });
        req.on('error', e => res({ body: null, netError: e.message }));
        req.on('timeout', () => { req.destroy(); res({ body: null, netError: 'timeout' }); });
        req.write(p); req.end();
    });
}

async function login(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    const r = await httpJson(API_HOST, '/login', { username, password, type: 'web' });
    let j = null; try { j = JSON.parse(r.body); } catch (_) { }
    if (!j || j.success !== true) {
        const errMsg = (j && (j.message || j.error)) || r.body.slice(0, 300) || ('HTTP ' + r.status);
        return { ok: false, stage: 'web-login', http: r.status, message: errMsg, body: r.body.slice(0, 400) };
    }
    const pid = j.player_id, token = j.token, signature = j.signature, hashTime = j.hash_time;
    const ts = Math.floor(Date.now() / 1000);
    const r2 = await amf('SystemService.requireLogin', [ts, hashTime, pid]);
    if (!r2.body || Number(r2.body.status) !== 1) {
        const msg = r2.netError || (r2.body && (r2.body.result || r2.body.message)) || 'Status != 1';
        return { ok: false, stage: 'requireLogin', body: r2, message: msg };
    }
    const result = String(r2.body.result === undefined ? '' : r2.body.result);
    const str = result + pid + 'web' + BUILD_NO + CODEC;
    const loginHash = getLoginHash(result, str);
    const r3 = await amf('SystemService.snsLogin', [pid, 'web', BUILD_NO, result, loginHash, signature, token, 'en']);
    const b = r3.body || {};
    if (r3.fault || Number(b.status) !== 1) {
        const msg = (b && (b.result || b.message)) || 'Login failed in snsLogin';
        return { ok: false, stage: 'snsLogin', body: b, fault: r3.fault, message: msg };
    }
    const arr = Array.isArray(b.result) ? b.result : [];
    return {
        ok: true,
        playerId: pid,
        username: j.username,
        token,
        signature,
        hashTime,
        accountType: arr[1],
        tokens: arr[2] !== undefined ? Number(arr[2]) : 0,
        accountFlag: arr[2],
        sessionKey: arr[3],           // "gs_..." — dipakai semua service
        accountSignature: b.signature,
        raw: b,
    };
}

function getSelectedChar(charList, target) {
    if (!charList || !charList.length) return null;
    if (!target) return charList[0];
    const tStr = String(target).trim().toLowerCase();
    // 1. Match by charId (column 0)
    const byId = charList.find(c => String(c[0]) === tStr);
    if (byId) return byId;
    // 2. Match by charName (column 1)
    const byExactName = charList.find(c => String(c[1]).toLowerCase() === tStr);
    if (byExactName) return byExactName;
    const bySubName = charList.find(c => String(c[1]).toLowerCase().includes(tStr));
    if (bySubName) return bySubName;
    // 3. Match by slot number (1-based: 1, 2, ...)
    const num = parseInt(tStr, 10);
    if (!isNaN(num) && num >= 1 && num <= charList.length) {
        return charList[num - 1];
    }
    return charList[0];
}

function enableGracefulStop(label = 'menu') {
    let stopping = false;
    const handleStop = (trigger) => {
        if (stopping) process.exit(0);
        stopping = true;
        console.log(`\n\n[i] Proses dihentikan (${trigger}). Kembali ke ${label}...`);
        process.exit(0);
    };

    process.on('SIGINT', () => handleStop('Ctrl+C'));
    process.on('SIGTERM', () => handleStop('SIGTERM'));

    if (process.stdin.isTTY && process.stdin.setRawMode) {
        try {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', chunk => {
                const s = String(chunk);
                if (s === 'q' || s === 'Q' || s === '\u001b') {
                    handleStop('Tombol Q');
                } else if (s === '\u0003') {
                    handleStop('Ctrl+C');
                }
            });
        } catch (_) {}
    }
}

module.exports = { login, amf, httpJson, getSelectedChar, enableGracefulStop, AMF_HOST, API_HOST, BUILD_NO, SALT, CODEC, sha1, getHash, getArrayHash, getLoginHash, ucEncode };
