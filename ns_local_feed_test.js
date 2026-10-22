#!/usr/bin/env node
'use strict';

const https = require('https');
const c = require('./nsclient.js');

const HOST = 'ninjasaga.cc';
const PORT = 443;
const DELAY_MS = 100;
const CONCURRENCY = 100;
const HEX = '0123456789abcdef';

if (!process.env.NS_USER || !process.env.NS_PASS) {
    console.log('Butuh NS_USER dan NS_PASS. Kembali ke menu lalu login ulang.');
    process.exit(1);
}

function feedCode() {
    let code = '';
    for (let i = 0; i < 8; i++) code += HEX[Math.floor(Math.random() * HEX.length)];
    return code;
}

function rewardClaimed(body) {
    const message = 'Reward claimed successfully! The item has been added to your gift box.';
    try {
        const json = JSON.parse(body);
        if (json.success === true && json.message === message) return true;
    } catch (_) { }
    return /<div\b[^>]*class=["'][^"']*\bnotification\b[^"']*\bsuccess\b[^"']*["'][^>]*>/i.test(body)
        && body.includes(message);
}

function requestLocal(feed, session) {
    return new Promise(resolve => {
        const started = Date.now();
        const req = https.request({
            hostname: HOST,
            port: PORT,
            path: '/?feed=' + feed,
            method: 'GET',
            rejectUnauthorized: false,
            // lookup: (_hostname, options, callback) => {
            //     const address = { address: '127.0.0.1', family: 4 };
            //     if (options && options.all) callback(null, [address]);
            //     else callback(null, address.address, address.family);
            // },
            timeout: 25000,
            headers: {
                'X-NS-Player-Id': String(session.playerId),
                'X-NS-Session-Key': String(session.sessionKey),
                'User-Agent': 'NinjaSaga-NSCC-LocalTest',
            },
        }, res => {
            let bytes = 0;
            const chunks = [];
            res.on('data', chunk => { bytes += chunk.length; chunks.push(chunk); });
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                resolve({ status: res.statusCode, bytes, success: rewardClaimed(body), ms: Date.now() - started });
            });
        });
        req.on('error', error => resolve({ error: error.message, ms: Date.now() - started }));
        req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - started }); });
        req.end();
    });
}

(async () => {
    console.log('Login akun: ' + process.env.NS_USER + '...');
    const session = await c.login(process.env.NS_USER, process.env.NS_PASS);
    if (!session.ok) {
        console.log('LOGIN GAGAL: ' + session.stage);
        process.exit(2);
    }

    console.log('LOGIN BERHASIL: ' + (session.username || process.env.NS_USER));
    console.log('Request background: https://' + HOST + '/?feed=XXXXXXXX');
    console.log('Paralel: ' + CONCURRENCY + ' request per batch. Jeda batch: 3 detik. Tekan Ctrl+C untuk berhenti.');

    let prizeCatch = 0;
    for (; ;) {
        const feeds = Array.from({ length: CONCURRENCY }, feedCode);
        const results = await Promise.all(feeds.map(async feed => ({ feed, result: await requestLocal(feed, session) })));
        for (const { feed, result } of results) {
            if (result.error) {
                console.log('[' + feed + '] ERROR ' + result.error + ' (' + result.ms + ' ms)');
            } else {
                console.log('[' + feed + '] HTTP ' + result.status + ' | ' + result.bytes + ' bytes | ' + result.ms + ' ms');
                if (result.success) {
                    prizeCatch += 1;
                    console.log('PRIZE CATCH (+1) | total: ' + prizeCatch + ' | https://' + HOST + '/?feed=' + feed);
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
})().catch(error => {
    console.log('FATAL ' + error.message);
    process.exit(1);
});
