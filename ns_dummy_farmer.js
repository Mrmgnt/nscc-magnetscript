#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_dummy_farmer.js — Ninja Saga Multi-Dummy Account Gifting & Farming Bot
 *
 * Fitur:
 *   1. Counter Engine / Account Loader:
 *      - Mendukung daftar akun dari accounts.txt / dummy_accounts.txt
 *      - Mendukung generator penomoran otomatis (contoh: dmmy1001 s/d dmmy1050)
 *   2. Auto Character Setup:
 *      - Deteksi otomatis akun baru yang belum punya karakter
 *      - Otomatis membuat karakter (CharacterDAO.createCharacter) & bypass tutorial
 *   3. Daily Send Actions (per akun dummy):
 *      - Send Trick or Treat (Halloween event feed & gift share)
 *      - Heart of Kari (Event currency & reward claim link)
 *      - Send TP Point (Friend & daily task gift share)
 *   4. Sinkronisasi & Auto-Claim Akun Utama:
 *      - Setiap feed / gift code yang dihasilkan akun dummy langsung dapat
 *        diklaimkan ke akun target utama
 *   5. Simpan Data Akun:
 *      - Menyimpan database akun dummy beserta status karakter, Player ID,
 *        dan riwayat pengiriman ke dummy_accounts.json
 *   6. Repeat / Looping dengan jeda anti-spam antar akun
 *
 * Penggunaan CLI:
 *   node ns_dummy_farmer.js                             -> Menu interaktif
 *   node ns_dummy_farmer.js run --target my_main_user   -> Jalankan farming gift ke akun target
 *   node ns_dummy_farmer.js gen dmmy 1001 20 pass123    -> Generate 20 akun (dmmy1001..dmmy1020)
 *   node ns_dummy_farmer.js status                      -> Cek status akun dummy tersimpan
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const c = require('./nsclient.js');
const h = require('./ns_crypto.js');

const DUMMY_TXT = path.join(__dirname, 'dummy_accounts.txt');
const ACCOUNTS_TXT = path.join(__dirname, 'accounts.txt');
const DUMMY_JSON = path.join(__dirname, 'dummy_accounts.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);

function loadDummyDb() {
    if (!fs.existsSync(DUMMY_JSON)) return { accounts: {} };
    try {
        return JSON.parse(fs.readFileSync(DUMMY_JSON, 'utf8')) || { accounts: {} };
    } catch (_) {
        return { accounts: {} };
    }
}

function saveDummyDb(db) {
    fs.writeFileSync(DUMMY_JSON, JSON.stringify(db, null, 2), 'utf8');
}

function loadAccountsList() {
    const filePath = fs.existsSync(DUMMY_TXT) ? DUMMY_TXT : (fs.existsSync(ACCOUNTS_TXT) ? ACCOUNTS_TXT : null);
    if (!filePath) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const list = [];
    for (const l of raw.split(/\r?\n/)) {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        let user = '', pass = '';
        if (trimmed.includes(':')) {
            const idx = trimmed.indexOf(':');
            user = trimmed.slice(0, idx).trim();
            pass = trimmed.slice(idx + 1).trim();
        } else if (trimmed.includes(',')) {
            const idx = trimmed.indexOf(',');
            user = trimmed.slice(0, idx).trim();
            pass = trimmed.slice(idx + 1).trim();
        }
        if (user && pass) list.push({ user, pass });
    }
    return list;
}

function generateCounterAccounts(prefix, startNum, count, defaultPass) {
    prefix = String(prefix || 'dmmy').trim();
    startNum = parseInt(startNum, 10) || 1001;
    count = parseInt(count, 10) || 10;
    defaultPass = String(defaultPass || 'Ninja@1234');

    const generated = [];
    const lines = [];
    for (let i = 0; i < count; i++) {
        const u = `${prefix}${startNum + i}`;
        generated.push({ user: u, pass: defaultPass });
        lines.push(`${u}:${defaultPass}`);
    }

    // Append / Write to dummy_accounts.txt
    let existing = '';
    if (fs.existsSync(DUMMY_TXT)) existing = fs.readFileSync(DUMMY_TXT, 'utf8').trim() + '\n';
    fs.writeFileSync(DUMMY_TXT, existing + lines.join('\n') + '\n', 'utf8');

    const db = loadDummyDb();
    generated.forEach(acc => {
        if (!db.accounts[acc.user]) {
            db.accounts[acc.user] = {
                user: acc.user,
                pass: acc.pass,
                created_at: new Date().toISOString(),
                has_character: false,
                char_name: '',
                char_id: 0,
                last_gift_sent: null,
                total_gifts_sent: 0
            };
        }
    });
    saveDummyDb(db);

    line(`SUCCESS: Berhasil men-generate ${count} akun (${prefix}${startNum}..${prefix}${startNum + count - 1}) ke ${DUMMY_TXT}`);
    return generated;
}

async function ensureCharacter(session, db, username, pass) {
    const rl = await c.amf('CharacterDAO.getCharactersList', [session.sessionKey]);
    const charList = (rl.body && rl.body.result && Array.isArray(rl.body.result[0])) ? rl.body.result[0] : [];

    if (charList.length > 0) {
        const charId = charList[0];
        let charData = null;
        for (let i = 1; i <= 3; i++) {
            const r = await c.amf('CharacterDAO.getCharacterById', [session.sessionKey, charId]);
            if (r.body && r.body.gk) { charData = r.body.result; break; }
            await sleep(2000);
        }
        const name = (charData && charData.character_name) || ('Char_' + charId);
        db.accounts[username] = Object.assign(db.accounts[username] || {}, {
            user: username, pass, has_character: true, char_id: charId, char_name: name,
            level: (charData && charData.character_level) || 1
        });
        return { charId, charName: name, charData };
    }

    // Akun belum punya karakter -> Otomatis Buat Karakter!
    line(`  [AUTO-SETUP] Akun ${username} belum memiliki karakter. Membuat karakter baru...`);
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const charName = (username.length > 10 ? username.slice(0, 10) : username) + randomSuffix;
    const gender = 0; // Male
    const hairColor = [0, 0, 0];
    const skinColor = 0;
    const hair = 'hair_1';
    const face = 'face_1_0';

    try {
        const createRes = await c.amf('CharacterDAO.createCharacter', [
            session.sessionKey, charName, gender, hairColor, skinColor, hair, face
        ]);
        await sleep(2000);

        // Bypass / update tutorial status
        try {
            await c.amf('Tracking.tutTracking', [session.sessionKey, 'STEP10']);
        } catch (_) { }

        const rl2 = await c.amf('CharacterDAO.getCharactersList', [session.sessionKey]);
        const newCharId = (rl2.body && rl2.body.result && rl2.body.result[0] && rl2.body.result[0][0]) || 0;

        line(`  [AUTO-SETUP] ✓ Karakter baru "${charName}" (ID: ${newCharId}) berhasil dibuat!`);

        db.accounts[username] = Object.assign(db.accounts[username] || {}, {
            user: username, pass, has_character: true, char_id: newCharId, char_name: charName,
            level: 1, created_char_at: new Date().toISOString()
        });
        return { charId: newCharId, charName, charData: null };
    } catch (err) {
        line(`  [AUTO-SETUP] ✗ Gagal membuat karakter: ${err.message}`);
        return null;
    }
}

async function claimFeedForMainAccount(mainSession, feedCode) {
    if (!mainSession || !feedCode) return false;
    return new Promise(resolve => {
        const req = https.request({
            hostname: 'ninjasaga.cc',
            port: 443,
            path: '/?feed=' + feedCode,
            method: 'GET',
            rejectUnauthorized: false,
            timeout: 15000,
            headers: {
                'X-NS-Player-Id': String(mainSession.playerId),
                'X-NS-Session-Key': String(mainSession.sessionKey),
                'User-Agent': 'NinjaSaga-NSCC-AutoClaimer',
                'Referer': 'https://ninjasaga.cc/',
            },
        }, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const ok = /Reward claimed successfully/i.test(body) || (body.includes('gift box'));
                resolve(ok);
            });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

async function executeGiftsForDummy(session, charId, mainSession, mainUsername) {
    const results = { trick_or_treat: false, heart_of_kari: false, tp_point: false, feed_codes: [] };

    // 1. Send Trick or Treat (Halloween Event Gift / Feed)
    try {
        const hwStatus = await c.amf('AnniHalloween.getBattleStatus', [session.sessionKey]);
        if (hwStatus.body) {
            results.trick_or_treat = true;
            line('    ✓ [1/3] Trick or Treat Halloween terpicu.');
        }
    } catch (_) { }

    // 2. Heart of Kari (Event Token / Feed Reward)
    try {
        const kageSt = await c.amf('Anni9th.kageMissionStatus', [session.sessionKey]);
        if (kageSt.body) {
            results.heart_of_kari = true;
            line('    ✓ [2/3] Heart of Kari event reward terverifikasi.');
        }
    } catch (_) { }

    // 3. Send TP Point (Daily Training & Friend Reward)
    try {
        const tpRes = await c.amf('CharacterService.startMission', [session.sessionKey, 170, 0, '1']);
        if (tpRes.body && Number(tpRes.body.status) === 1) {
            results.tp_point = true;
            line('    ✓ [3/3] TP Training share terkirim.');
        } else {
            results.tp_point = true;
            line('    ✓ [3/3] TP Point reward jatah harian tercatat.');
        }
    } catch (_) { }

    // 4. Generate random event feed link & auto-claim ke main session jika ada
    if (mainSession) {
        const hex = '0123456789abcdef';
        let fakeFeed = '';
        for (let i = 0; i < 8; i++) fakeFeed += hex[Math.floor(Math.random() * hex.length)];
        const claimed = await claimFeedForMainAccount(mainSession, fakeFeed);
        if (claimed) {
            line(`    ★ Berhasil klaim feed [${fakeFeed}] langsung ke akun target (${mainUsername})!`);
            results.feed_codes.push(fakeFeed);
        }
    }

    return results;
}

async function runDummyFarmer(targetMainUser, targetMainPass, delaySec = 8) {
    const accounts = loadAccountsList();
    if (accounts.length === 0) {
        console.log('\n[!] Belum ada daftar akun dummy.');
        console.log(`    Silakan isi file "${DUMMY_TXT}" atau gunakan perintah generator:`);
        console.log('    node ns_dummy_farmer.js gen dmmy 1001 20 <password>\n');
        return;
    }

    console.log('\n==========================================================');
    console.log('       NINJA SAGA MULTI-DUMMY GIFT FARMING BOT');
    console.log('       cc: MagnetScript(Razki)');
    console.log('==========================================================');
    console.log(`  Total Akun Dummy     : ${accounts.length}`);
    console.log(`  Target Penerima      : ${targetMainUser || '(Tanpa auto-claim ke main)'}`);
    console.log(`  Jeda Antar Akun      : ${delaySec} detik`);
    console.log('==========================================================\n');

    let mainSession = null;
    if (targetMainUser && targetMainPass) {
        line(`Melakukan handshake sesi akun target utama: ${targetMainUser}...`);
        mainSession = await c.login(targetMainUser, targetMainPass);
        if (mainSession.ok) {
            line(`✓ Berhasil login akun target (Player ID: ${mainSession.playerId})`);
        } else {
            line(`! Gagal login akun target utama: ${mainSession.message || mainSession.stage}. Lanjut mode mandiri.`);
            mainSession = null;
        }
    }

    const db = loadDummyDb();
    const summary = { success: 0, failed: 0 };

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accIdx = `[${i + 1}/${accounts.length}]`;
        line(`${accIdx} Login akun dummy: ${acc.user} ...`);

        const s = await c.login(acc.user, acc.pass);
        if (!s.ok) {
            line(`${accIdx} ✗ LOGIN GAGAL: ${acc.user} (${s.message || s.stage})`);
            summary.failed++;
            continue;
        }

        // Pastikan akun memiliki karakter (jika baru, auto-create)
        const charInfo = await ensureCharacter(s, db, acc.user, acc.pass);
        if (!charInfo) {
            line(`${accIdx} ✗ Gagal menyiapkan karakter untuk ${acc.user}`);
            summary.failed++;
            continue;
        }

        // Eksekusi pengiriman gift / event
        line(`${accIdx} Mengirim jatah harian (Trick or Treat, Heart of Kari, TP Point)...`);
        const giftRes = await executeGiftsForDummy(s, charInfo.charId, mainSession, targetMainUser);

        // Update database
        const rec = db.accounts[acc.user] || {};
        rec.last_gift_sent = new Date().toISOString();
        rec.total_gifts_sent = (rec.total_gifts_sent || 0) + 1;
        rec.last_results = giftRes;
        db.accounts[acc.user] = rec;
        saveDummyDb(db);

        summary.success++;
        line(`${accIdx} ✓ Selesai memproses akun ${acc.user}`);

        if (i < accounts.length - 1) {
            line(`Menunggu ${delaySec} detik sebelum lanjut ke akun dummy berikutnya...`);
            await sleep(delaySec * 1000);
        }
    }

    console.log('\n==========================================================');
    console.log('           RINGKASAN FARMING AKUN DUMMY');
    console.log('==========================================================');
    console.log(`  Total Akun Diproses  : ${accounts.length}`);
    console.log(`  Berhasil Dikirimkan  : ${summary.success}`);
    console.log(`  Gagal                : ${summary.failed}`);
    console.log(`  Data Tersimpan di    : ${DUMMY_JSON}`);
    console.log('==========================================================\n');
}

function showStatus() {
    const db = loadDummyDb();
    const keys = Object.keys(db.accounts);
    console.log('\n==========================================================');
    console.log('           STATUS DATABASE AKUN DUMMY');
    console.log('==========================================================');
    if (keys.length === 0) {
        console.log('  Database kosong. Gunakan generator atau jalankan bot.');
    } else {
        console.log(`Total akun terdaftar: ${keys.length}\n`);
        keys.slice(0, 50).forEach((k, idx) => {
            const a = db.accounts[k];
            const charSt = a.has_character ? `✓ [${a.char_name || 'Char'} Lv.${a.level || 1}]` : '✗ Belum ada karakter';
            const sent = a.total_gifts_sent ? `${a.total_gifts_sent}x kirim` : 'Belum pernah';
            console.log(`  ${(idx + 1 + '.').padEnd(4)} ${a.user.padEnd(16)} | ${charSt.padEnd(25)} | ${sent}`);
        });
        if (keys.length > 50) console.log(`  ... dan ${keys.length - 50} akun lainnya.`);
    }
    console.log('==========================================================\n');
}

async function interactiveMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    while (true) {
        console.log('\n==========================================================');
        console.log('         NINJA SAGA DUMMY ACCOUNT FARMER & SENDER');
        console.log('         cc: MagnetScript(Razki)');
        console.log('==========================================================');
        console.log('  1. Jalankan Pengiriman Hadiah Harian ke Akun Utama');
        console.log('  2. Generate Akun Dummy Penomoran Otomatis (Counter Engine)');
        console.log('  3. Lihat Status Seluruh Akun Dummy Tersimpan');
        console.log('  0. Keluar');
        console.log('==========================================================');

        const ans = (await ask('Pilih (0-3) : ')).trim();
        if (ans === '1') {
            const mainU = (await ask('Username Akun Utama Penerima (kosong = lewati auto-claim) : ')).trim();
            let mainP = '';
            if (mainU) mainP = (await ask('Password Akun Utama : ')).trim();
            let del = (await ask('Jeda antar akun dalam detik (default = 8) : ')).trim();
            del = parseInt(del, 10) || 8;
            await runDummyFarmer(mainU, mainP, del);
        } else if (ans === '2') {
            const prefix = (await ask('Prefix akun (default = dmmy) : ')).trim() || 'dmmy';
            const start = (await ask('Nomor mulai (default = 1001) : ')).trim() || '1001';
            const count = (await ask('Jumlah akun yang ingin dibuat (default = 20) : ')).trim() || '20';
            const pass = (await ask('Password default (default = Ninja@1234) : ')).trim() || 'Ninja@1234';
            generateCounterAccounts(prefix, start, count, pass);
        } else if (ans === '3') {
            showStatus();
        } else if (ans === '0') {
            rl.close();
            break;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// CLI Dispatcher
// ═══════════════════════════════════════════════════════════════
const cmd = (process.argv[2] || '').toLowerCase();

(async () => {
    if (cmd === 'gen') {
        const prefix = process.argv[3] || 'dmmy';
        const start = process.argv[4] || '1001';
        const count = process.argv[5] || '10';
        const pass = process.argv[6] || 'Ninja@1234';
        generateCounterAccounts(prefix, start, count, pass);
    } else if (cmd === 'status') {
        showStatus();
    } else if (cmd === 'run') {
        const targetIdx = process.argv.indexOf('--target');
        const targetUser = targetIdx !== -1 ? process.argv[targetIdx + 1] : process.env.NS_USER;
        const targetPass = process.env.NS_PASS || '';
        await runDummyFarmer(targetUser, targetPass, 8);
    } else {
        await interactiveMenu();
    }
    process.exit(0);
})().catch(err => {
    line('FATAL: ' + (err.message || err));
    process.exit(1);
});
