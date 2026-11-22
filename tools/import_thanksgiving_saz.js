#!/usr/bin/env node
/**
 * tools/import_thanksgiving_saz.js
 * Importer & decoder untuk capture Fiddler Classic (.saz), HAR (.har),
 * raw request/response, atau JSONL proxy capture AMF Ninja Saga.
 *
 * Penggunaan:
 *   node tools/import_thanksgiving_saz.js <path.saz | path.har | path.jsonl | raw_dir>
 *   node tools/import_thanksgiving_saz.js --raw-pair <req_file> <res_file>
 *   node tools/import_thanksgiving_saz.js --hex <hex_amf_packet>
 *   node tools/import_thanksgiving_saz.js --base64 <base64_amf_packet>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { decodeAmfPacket, parseHttpMessage } = require('../lib/amf_decoder.js');
const { readSazFile, readRawSessionDir } = require('../lib/saz_reader.js');
const { SALT, sha1, ucDecode } = require('../nscrypt.js');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const DEFAULT_DECODED_OUT = path.join(LOGS_DIR, 'thanksgiving_amf_decoded.json');

const BOILERPLATE_SERVICES = new Set([
    'SystemService.requireLogin',
    'SystemService.snsLogin',
    'SystemService.getServerTime',
    'CharacterDAO.getCharactersList',
    'CharacterDAO.getCharacterById',
    'CharacterDAO.getExtraData'
]);

function looksLikeAmfPacket(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 7) return false;
    const version = buf.readUInt16BE(0);
    return version === 0 || version === 3;
}

function isAmfHttpTransaction(reqMsg, resMsg) {
    const url = String((reqMsg && reqMsg.url) || '');
    const host = String((reqMsg && reqMsg.headers && reqMsg.headers.host) || '');
    const reqCt = String((reqMsg && reqMsg.headers && reqMsg.headers['content-type']) || '');
    const resCt = String((resMsg && resMsg.headers && resMsg.headers['content-type']) || '');
    if (/amf\.ninjasaga\.cc/i.test(url) || /amf\.ninjasaga\.cc/i.test(host)) return true;
    if (/application\/x-amf/i.test(reqCt) || /application\/x-amf/i.test(resCt)) return true;
    return false;
}

function safeDecodeAmf(buf) {
    if (!buf || !buf.length) return { ok: false, error: 'Body kosong' };
    try {
        const packet = decodeAmfPacket(buf);
        return { ok: true, packet };
    } catch (err) {
        return { ok: false, error: err.message, hexPrefix: buf.subarray(0, 64).toString('hex') };
    }
}

function isStrictPrintableAscii(str) {
    return typeof str === 'string' && str.length > 0 && /^[\x20-\x7E\t\r\n]+$/.test(str);
}

function inspectCryptoParam(param, index, allParams, sessionKey) {
    if (typeof param !== 'string') return null;
    if (/^[0-9a-f]{40}$/i.test(param)) {
        const lower = param.toLowerCase();
        const findings = [];
        if (sessionKey) {
            const candidates = [];
            for (let i = 0; i < allParams.length; i++) {
                if (i === index) continue;
                const val = allParams[i];
                if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
                    candidates.push({ label: `param[${i}]`, raw: String(val) });
                }
            }
            const before = allParams.slice(0, index).filter(v => v !== null && v !== undefined && typeof v !== 'object');
            if (before.length > 1) {
                candidates.push({ label: `join(',') of 0..${index - 1}`, raw: before.map(String).join(',') });
                candidates.push({ label: `join('|') of 0..${index - 1}`, raw: before.map(String).join('|') });
                candidates.push({ label: `join('') of 0..${index - 1}`, raw: before.map(String).join('') });
                const withoutSk = before.filter(v => String(v) !== sessionKey);
                if (withoutSk.length > 0 && withoutSk.length < before.length) {
                    candidates.push({ label: `join(',') w/o sessionKey`, raw: withoutSk.map(String).join(',') });
                    candidates.push({ label: `join('|') w/o sessionKey`, raw: withoutSk.map(String).join('|') });
                    candidates.push({ label: `join('') w/o sessionKey`, raw: withoutSk.map(String).join('') });
                }
            }
            for (const cand of candidates) {
                if (sha1(cand.raw + SALT + sessionKey) === lower) {
                    findings.push(`sha1(${cand.label} + SALT + sessionKey)`);
                }
                if (sha1(cand.raw + SALT) === lower) {
                    findings.push(`sha1(${cand.label} + SALT)`);
                }
            }
            for (let seq = 1; seq <= 200; seq++) {
                if (sha1(String(seq) + SALT + sessionKey) === lower) {
                    findings.push(`updateSequence(seq=${seq})`);
                    break;
                }
            }
        }
        if (findings.length === 0) {
            try {
                const decoded = ucDecode(param);
                if (isStrictPrintableAscii(decoded)) {
                    return { paramIndex: index, type: 'ucEncode_hex', decoded };
                }
            } catch (_) { }
        }
        return {
            paramIndex: index,
            type: 'sha1_hex_40',
            matchedFormulas: findings
        };
    }
    if (/^[0-9a-f]{26,}$/i.test(param) && param.length % 2 === 0) {
        try {
            const decoded = ucDecode(param);
            if (isStrictPrintableAscii(decoded)) {
                return {
                    paramIndex: index,
                    type: 'ucEncode_hex',
                    decoded
                };
            }
        } catch (_) { }
        return {
            paramIndex: index,
            type: 'obfuscated_hex',
            byteLength: param.length / 2
        };
    }
    return null;
}

function collectInterestingFields(value, prefix = '', out = []) {
    if (!value || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 20); i++) {
            collectInterestingFields(value[i], `${prefix}[${i}]`, out);
        }
        return out;
    }
    for (const [key, val] of Object.entries(value)) {
        const pathKey = prefix ? `${prefix}.${key}` : key;
        if (/(heart|ammo|werewolf|quota|remain|reward|enemy|boss|turkey|pumpkin|cranberry|yam|corn|thanksgiving|status|error|z9f|z9t)/i.test(key)) {
            out.push({ field: pathKey, value: val });
        }
        if (val && typeof val === 'object') {
            collectInterestingFields(val, pathKey, out);
        }
    }
    return out;
}

function normalizeTransaction(rawTx) {
    const reqDecoded = rawTx.reqBody ? safeDecodeAmf(rawTx.reqBody) : { ok: false, error: 'Tidak ada request body' };
    const resDecoded = rawTx.resBody ? safeDecodeAmf(rawTx.resBody) : { ok: false, error: 'Tidak ada response body' };

    const reqMsg = reqDecoded.ok && reqDecoded.packet.messages.length ? reqDecoded.packet.messages[0] : null;
    const resMsg = resDecoded.ok && resDecoded.packet.messages.length ? resDecoded.packet.messages[0] : null;

    const service = reqMsg ? reqMsg.targetUri : (rawTx.serviceHint || '');
    const params = reqMsg ? (Array.isArray(reqMsg.body) ? reqMsg.body : [reqMsg.body]) : [];
    const responseBody = resMsg ? resMsg.body : null;

    return {
        id: rawTx.id || '',
        at: rawTx.at || '',
        url: rawTx.url || '',
        httpStatus: rawTx.httpStatus || null,
        service,
        params,
        responseTarget: resMsg ? resMsg.targetUri : '',
        responseBody,
        reqWarnings: reqDecoded.ok ? reqDecoded.packet.warnings : [reqDecoded.error],
        resWarnings: resDecoded.ok ? resDecoded.packet.warnings : [resDecoded.error]
    };
}

function analyzeAmfTransactions(rawTransactions) {
    const normalized = rawTransactions.map(normalizeTransaction);
    let detectedSessionKey = '';

    for (const tx of normalized) {
        if (tx.service === 'SystemService.snsLogin' && tx.responseBody && Array.isArray(tx.responseBody.result)) {
            const sk = tx.responseBody.result[3];
            if (typeof sk === 'string' && sk.startsWith('gs_')) detectedSessionKey = sk;
        }
        if (!detectedSessionKey) {
            const skParam = tx.params.find(p => typeof p === 'string' && /^gs_[a-zA-Z0-9]+$/.test(p));
            if (skParam) detectedSessionKey = skParam;
        }
    }

    const calls = normalized.map((tx, idx) => {
        const cryptoHints = [];
        for (let i = 0; i < tx.params.length; i++) {
            const hint = inspectCryptoParam(tx.params[i], i, tx.params, detectedSessionKey);
            if (hint) cryptoHints.push(hint);
        }
        const interestingFields = collectInterestingFields(tx.responseBody);
        const isBoilerplate = BOILERPLATE_SERVICES.has(tx.service);
        return {
            index: idx + 1,
            ...tx,
            isBoilerplate,
            cryptoHints,
            interestingFields
        };
    });

    const eventCalls = calls.filter(c => !c.isBoilerplate && c.service);
    const services = Array.from(new Set(eventCalls.map(c => c.service)));

    return {
        decodedAt: new Date().toISOString(),
        totalAmfCalls: calls.length,
        eventCallCount: eventCalls.length,
        detectedSessionKey: detectedSessionKey ? `${detectedSessionKey.slice(0, 6)}...` : '',
        services,
        calls
    };
}

function transactionsFromHttpSessions(sessions) {
    const amfTxs = [];
    for (const session of sessions) {
        const reqMsg = session.clientRaw ? parseHttpMessage(session.clientRaw) : null;
        const resMsg = session.serverRaw ? parseHttpMessage(session.serverRaw) : null;
        if (!reqMsg && !resMsg) continue;
        const amfMatch = isAmfHttpTransaction(reqMsg, resMsg) ||
            (reqMsg && looksLikeAmfPacket(reqMsg.body)) ||
            (resMsg && looksLikeAmfPacket(resMsg.body));
        if (!amfMatch) continue;
        amfTxs.push({
            id: session.id,
            url: reqMsg ? reqMsg.url : '',
            httpStatus: resMsg ? resMsg.statusCode : null,
            reqBody: reqMsg ? reqMsg.body : null,
            resBody: resMsg ? resMsg.body : null
        });
    }
    return amfTxs;
}

function decodeSazFile(filePath) {
    const sessions = readSazFile(filePath);
    return analyzeAmfTransactions(transactionsFromHttpSessions(sessions));
}

function decodeRawDir(dirPath) {
    const sessions = readRawSessionDir(dirPath);
    return analyzeAmfTransactions(transactionsFromHttpSessions(sessions));
}

function decodeJsonlCapture(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    const byId = new Map();
    const order = [];
    for (const line of lines) {
        let row;
        try { row = JSON.parse(line); } catch (_) { continue; }
        const id = String(row.requestId || row.id || order.length + 1);
        if (!byId.has(id)) {
            byId.set(id, { id, at: row.at || '', url: row.url || '', httpStatus: null, reqBody: null, resBody: null });
            order.push(id);
        }
        const entry = byId.get(id);
        if (row.kind === 'request') {
            entry.url = row.url || entry.url;
            entry.at = row.at || entry.at;
            if (row.bodyBase64) entry.reqBody = Buffer.from(row.bodyBase64, 'base64');
            else if (row.postDataBase64) entry.reqBody = Buffer.from(row.postDataBase64, 'base64');
            else if (row.postData) entry.reqBody = Buffer.from(row.postData, row.base64Encoded ? 'base64' : 'latin1');
        } else if (row.kind === 'response') {
            entry.httpStatus = row.status || row.statusCode || entry.httpStatus;
            if (row.bodyBase64) entry.resBody = Buffer.from(row.bodyBase64, 'base64');
            else if (row.body) entry.resBody = Buffer.from(row.body, row.base64Encoded ? 'base64' : 'latin1');
        }
    }
    const txs = order.map(id => byId.get(id)).filter(t => t.reqBody || t.resBody);
    return analyzeAmfTransactions(txs);
}

function decodeHarFile(filePath) {
    const har = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const entries = (har && har.log && Array.isArray(har.log.entries)) ? har.log.entries : [];
    const txs = [];
    entries.forEach((entry, idx) => {
        const req = entry.request || {};
        const res = entry.response || {};
        const url = String(req.url || '');
        const reqMime = String((req.postData && req.postData.mimeType) || '');
        const resMime = String((res.content && res.content.mimeType) || '');
        if (!/amf\.ninjasaga\.cc/i.test(url) && !/x-amf/i.test(reqMime) && !/x-amf/i.test(resMime)) return;
        let reqBody = null;
        if (req.postData && req.postData.text) {
            reqBody = Buffer.from(req.postData.text, req.postData.encoding === 'base64' ? 'base64' : 'latin1');
        }
        let resBody = null;
        if (res.content && res.content.text) {
            resBody = Buffer.from(res.content.text, res.content.encoding === 'base64' ? 'base64' : 'latin1');
        }
        txs.push({
            id: String(idx + 1),
            at: entry.startedDateTime || '',
            url,
            httpStatus: res.status || null,
            reqBody,
            resBody
        });
    });
    return analyzeAmfTransactions(txs);
}

function extractBodyFromFileOrRaw(filePath) {
    const buf = fs.readFileSync(filePath);
    const parsed = parseHttpMessage(buf);
    if (parsed && (parsed.kind === 'request' || parsed.kind === 'response')) {
        return {
            url: parsed.url || '',
            httpStatus: parsed.statusCode || null,
            body: parsed.body
        };
    }
    return { url: '', httpStatus: null, body: buf };
}

function decodeRawPair(reqFile, resFile) {
    const reqInfo = reqFile ? extractBodyFromFileOrRaw(reqFile) : null;
    const resInfo = resFile ? extractBodyFromFileOrRaw(resFile) : null;
    return analyzeAmfTransactions([{
        id: 'raw-pair',
        url: reqInfo ? reqInfo.url : '',
        httpStatus: resInfo ? resInfo.httpStatus : null,
        reqBody: reqInfo ? reqInfo.body : null,
        resBody: resInfo ? resInfo.body : null
    }]);
}

function importCapture(inputPath, outPath = DEFAULT_DECODED_OUT) {
    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`File atau folder capture tidak ditemukan: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    let report;
    if (stat.isDirectory()) {
        report = decodeRawDir(resolved);
    } else if (/\.saz$/i.test(resolved)) {
        report = decodeSazFile(resolved);
    } else if (/\.har$/i.test(resolved)) {
        report = decodeHarFile(resolved);
    } else if (/\.jsonl$/i.test(resolved)) {
        report = decodeJsonlCapture(resolved);
    } else {
        throw new Error(`Format file tidak didukung: ${path.basename(resolved)}. Gunakan .saz, .har, .jsonl, atau folder raw Fiddler.`);
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    return { report, outPath };
}

function printSummary(report, outPath) {
    console.log('======================================================================');
    console.log('               DECODER AMF THANKSGIVING - HASIL ANALISIS');
    console.log('======================================================================');
    console.log(`Total AMF call    : ${report.totalAmfCalls}`);
    console.log(`Non-boilerplate   : ${report.eventCallCount}`);
    console.log(`Service terdeteksi: ${report.services.length ? report.services.join(', ') : '(tidak ada)'}`);
    if (outPath) console.log(`File hasil decode : ${outPath}`);
    console.log('----------------------------------------------------------------------');

    for (const call of report.calls) {
        if (call.isBoilerplate) continue;
        console.log(`\n[#${call.index}${call.id ? ' | Sesi ' + call.id : ''}] ${call.service || '(unknown service)'} (HTTP ${call.httpStatus || '?'})`);
        console.log('  Params  : ' + JSON.stringify(call.params));
        if (call.cryptoHints.length) {
            console.log('  Crypto  : ' + JSON.stringify(call.cryptoHints));
        }
        if (call.interestingFields.length) {
            console.log('  Fields  : ' + JSON.stringify(call.interestingFields.slice(0, 12)));
        }
        if (call.responseBody !== null && call.responseBody !== undefined) {
            const preview = JSON.stringify(call.responseBody);
            console.log('  Response: ' + (preview.length > 400 ? preview.slice(0, 400) + '...' : preview));
        }
    }
    console.log('\n======================================================================');
}

function main() {
    const args = process.argv.slice(2);
    if (!args.length || args.includes('--help') || args.includes('-h')) {
        console.log('Pakai:');
        console.log('  node tools/import_thanksgiving_saz.js <capture.saz|capture.har|capture.jsonl|raw_dir>');
        console.log('  node tools/import_thanksgiving_saz.js --raw-pair <req_file> <res_file>');
        console.log('  node tools/import_thanksgiving_saz.js --hex <hex>');
        console.log('  node tools/import_thanksgiving_saz.js --base64 <base64>');
        return;
    }

    if (args[0] === '--hex' || args[0] === '--base64') {
        const enc = args[0] === '--hex' ? 'hex' : 'base64';
        const raw = Buffer.from(args[1] || '', enc);
        const decoded = decodeAmfPacket(raw);
        console.log(JSON.stringify(decoded, null, 2));
        return;
    }

    if (args[0] === '--raw-pair') {
        const reqFile = args[1];
        const resFile = args[2];
        const report = decodeRawPair(reqFile, resFile);
        fs.mkdirSync(LOGS_DIR, { recursive: true });
        fs.writeFileSync(DEFAULT_DECODED_OUT, JSON.stringify(report, null, 2));
        printSummary(report, DEFAULT_DECODED_OUT);
        return;
    }

    const { report, outPath } = importCapture(args[0]);
    printSummary(report, outPath);
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error('ERROR:', err.message);
        process.exitCode = 1;
    }
}

module.exports = {
    analyzeAmfTransactions,
    decodeSazFile,
    decodeRawDir,
    decodeJsonlCapture,
    decodeHarFile,
    decodeRawPair,
    importCapture,
    inspectCryptoParam,
    transactionsFromHttpSessions
};
