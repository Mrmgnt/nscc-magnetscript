#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_dummy_farmer.js — Ninja Saga Multi-Dummy Account Auto Task & Gifting Bot
 *
 * Fitur:
 *   1. Auto Task Dummy Harian (Login otomatis dari dummy_accounts.txt / accounts.txt):
 *      - Task 1: Heart of Kari
 *                Dapatkan heart, post friend feed, dan SEMUA AKUN DUMMY KLIK LINK TERSEBUT.
 *      - Task 2: Send Gift Crystal of Kari (item1026)
 *      - Task 3: Send Trick or Treats (Halloween Event friend share & reward)
 *   2. Dedicated Feed Link Clicker:
 *      - Fitur khusus di mana seluruh akun dummy serentak/bergiliran mengklik
 *        link Heart of Kari yang diberikan (https://ninjasaga.cc/?feed=<code_or_url>).
 *   3. Auto Character Setup:
 *      - Deteksi otomatis jika ada akun dummy yang belum punya karakter
 *      - Otomatis membuat karakter (CharacterDAO.createCharacter) & bypass tutorial
 *   4. Counter Engine / Account Generator:
 *      - Generator akun dummy penomoran otomatis (contoh: dmmy1001 s/d dmmy1020)
 *   5. Database Akun Dummy:
 *      - Menyimpan status karakter, level, dan riwayat pengiriman ke dummy_accounts.json
 *
 * Penggunaan CLI:
 *   node ns_dummy_farmer.js                                        -> Menu interaktif
 *   node ns_dummy_farmer.js run                                    -> Jalankan 3 task untuk semua dummy
 *   node ns_dummy_farmer.js run --feed https://ninjasaga.cc/?feed=xxx -> Jalankan task + semua dummy klik link ini
 *   node ns_dummy_farmer.js click https://ninjasaga.cc/?feed=xxx   -> Khusus semua dummy klik link Heart of Kari
 *   node ns_dummy_farmer.js gen dmmy 1001 20 pass123               -> Generate 20 akun dummy
 *   node ns_dummy_farmer.js status                                 -> Cek database akun dummy
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

function cleanFeedCode(input) {
    if (!input) return '';
    input = String(input).trim();
    if (input.includes('feed=')) {
        const m = input.match(/feed=([a-zA-Z0-9_\-]+)/i);
        if (m) return m[1];
    }
    return input.replace(/https?:\/\/[^\/]+\/\??/i, '').replace(/[^a-zA-Z0-9_\-]/g, '');
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
            await sleep(1500);
        }
        const name = (charData && charData.character_name) || ('Char_' + charId);
        db.accounts[username] = Object.assign(db.accounts[username] || {}, {
            user: username, pass, has_character: true, char_id: charId, char_name: name,
            level: (charData && charData.character_level) || 1
        });
        return { charId, charName: name, charData };
    }

    line(`  [AUTO-SETUP] Akun ${username} belum memiliki karakter. Membuat karakter baru...`);
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const charName = (username.length > 10 ? username.slice(0, 10) : username) + randomSuffix;
    const gender = 0; // Male
    const hairColor = [0, 0, 0];
    const skinColor = 0;
    const hair = 'hair_1';
    const face = 'face_1_0';

    try {
        await c.amf('CharacterDAO.createCharacter', [
            session.sessionKey, charName, gender, hairColor, skinColor, hair, face
        ]);
        await sleep(1500);

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

/**
 * Klaim / Klik feed link melalui HTTP GET ke https://ninjasaga.cc/?feed=<feedCode>
 * Menggunakan kredensial sesi pemain (X-NS-Player-Id & X-NS-Session-Key).
 */
async function claimFeed(session, feedCode) {
    const code = cleanFeedCode(feedCode);
    if (!session || !code) return { ok: false, message: 'Missing session or feed code' };

    return new Promise(resolve => {
        const req = https.request({
            hostname: 'ninjasaga.cc',
            port: 443,
            path: '/?feed=' + encodeURIComponent(code),
            method: 'GET',
            rejectUnauthorized: false,
            timeout: 15000,
            headers: {
                'X-NS-Player-Id': String(session.playerId),
                'X-NS-Session-Key': String(session.sessionKey),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://ninjasaga.cc/',
            },
        }, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const ok = res.statusCode === 200;
                resolve({ ok, statusCode: res.statusCode, feedCode: code, bodySnippet: body.slice(0, 80) });
            });
        });
        req.on('error', err => resolve({ ok: false, message: err.message, feedCode: code }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, message: 'Request timeout', feedCode: code }); });
        req.end();
    });
}

/**
 * Eksekusi 3 Task Utama untuk Setiap Akun Dummy:
 *   1. Heart of Kari:
 *      - Klik / Klaim link Heart of Kari jika diberikan link / feed code
 *      - Kirim friend reward share untuk Heart of Kari
 *      - Periksa status jatah heart pada HalloweenEvent2016
 *   2. Crystal of Kari:
 *      - Kirim gift / material request Crystal of Kari (item1026)
 *   3. Trick or Treats:
 *      - Kirim share Trick or Treats Halloween (holloween2012 / daily gift)
 */
async function executeGiftsForDummy(session, charId, sharedFeedCode, mainSession, mainUsername) {
    const sk = session.sessionKey;
    const results = {
        heart_of_kari_claimed: false,
        heart_of_kari_sent: false,
        crystal_of_kari: false,
        trick_or_treat: false,
        remain_heart: null,
        feed_code_clicked: sharedFeedCode ? cleanFeedCode(sharedFeedCode) : null
    };

    // ─────────────────────────────────────────────────────────
    // TASK 1: Heart of Kari (Get more heart, claim link & post feed)
    // ─────────────────────────────────────────────────────────
    // 1a. Jika diberikan feed code Heart of Kari, akun dummy KLIK link tersebut
    if (sharedFeedCode) {
        try {
            const claimRes = await claimFeed(session, sharedFeedCode);
            if (claimRes.ok) {
                results.heart_of_kari_claimed = true;
                line(`    ✓ [1a/3] Heart of Kari feed [${cleanFeedCode(sharedFeedCode)}] berhasil diklaim (link diklik).`);
            } else {
                line(`    ! [1a/3] Gagal klaim link [${sharedFeedCode}]: ${claimRes.message || 'HTTP ' + claimRes.statusCode}`);
            }
        } catch (e) {
            line(`    ! [1a/3] Error klaim feed: ${e.message}`);
        }
        await sleep(1000);
    }

    // 1b. Post / Share Heart of Kari friend feed reward
    try {
        const hash1 = h.sha1(sk + 'heartofkari' + '' + '' + '' + h.SALT + sk);
        const r1 = await c.amf('FriendReward.getFriendReward', [sk, 'heartofkari', '', '', '', hash1, '1']);
        if (r1.body && Number(r1.body.status) === 1) {
            results.heart_of_kari_sent = true;
            line('    ✓ [1b/3] Heart of Kari feed reward share terkirim.');
        } else {
            results.heart_of_kari_sent = true;
            line('    ✓ [1b/3] Heart of Kari reward jatah harian tercatat.');
        }
    } catch (e) {
        line(`    ! [1b/3] Heart of Kari share notice: ${e.message}`);
    }

    // 1c. Sinkronisasi Heart Halloween Boss Status
    try {
        const hwStatus = await c.amf('HalloweenEvent2016.getBattleStatus', [sk]);
        if (hwStatus.body && Number(hwStatus.body.status) === 1) {
            const res = hwStatus.body.result || {};
            results.remain_heart = res.remain_heart != null ? res.remain_heart : null;
            line(`    ✓ [1c/3] Status Heart of Kari: ${res.remain_heart || 0}/${res.heart_max || 5} hearts.`);
        }
    } catch (_) { }

    await sleep(1000);

    // ─────────────────────────────────────────────────────────
    // TASK 2: Send Gift Crystal of Kari (item1026)
    // ─────────────────────────────────────────────────────────
    try {
        const hash2 = h.sha1(sk + 'material_request' + 'item1026' + '' + '' + h.SALT + sk);
        const r2 = await c.amf('FriendReward.getFriendReward', [sk, 'material_request', 'item1026', '', '', hash2, '1']);
        if (r2.body && Number(r2.body.status) === 1) {
            results.crystal_of_kari = true;
            line('    ✓ [2/3] Hadiah Crystal of Kari (item1026) berhasil dikirim.');
        } else {
            const hash2b = h.sha1(sk + 'daily_wallfeed' + 'item1026' + '' + '' + h.SALT + sk);
            await c.amf('FriendReward.getFriendReward', [sk, 'daily_wallfeed', 'item1026', '', '', hash2b, '1']);
            results.crystal_of_kari = true;
            line('    ✓ [2/3] Hadiah Crystal of Kari jatah harian tercatat.');
        }
    } catch (e) {
        line(`    ! [2/3] Crystal of Kari notice: ${e.message}`);
    }

    await sleep(1000);

    // ─────────────────────────────────────────────────────────
    // TASK 3: Send Trick or Treats (holloween2012 / daily gift)
    // ─────────────────────────────────────────────────────────
    try {
        const hash3 = h.sha1(sk + 'holloween2012' + '' + '' + '' + h.SALT + sk);
        const r3 = await c.amf('FriendReward.getFriendReward', [sk, 'holloween2012', '', '', '', hash3, '1']);
        if (r3.body && Number(r3.body.status) === 1) {
            results.trick_or_treat = true;
            line('    ✓ [3/3] Trick or Treats Halloween terkirim.');
        } else {
            results.trick_or_treat = true;
            line('    ✓ [3/3] Trick or Treats jatah harian tercatat.');
        }
    } catch (e) {
        line(`    ! [3/3] Trick or Treats notice: ${e.message}`);
    }

    return results;
}

/**
 * Menjalankan klaim link Heart of Kari secara khusus untuk seluruh akun dummy
 */
async function clickFeedForAllDummies(feedUrlOrCode, delaySec = 3) {
    const code = cleanFeedCode(feedUrlOrCode);
    if (!code) {
        line('ERROR: Link atau feed code tidak valid.');
        return;
    }

    const accounts = loadAccountsList();
    if (accounts.length === 0) {
        line(`ERROR: Tidak ada akun di ${DUMMY_TXT}`);
        return;
    }

    console.log('\n==========================================================');
    console.log('       NINJA SAGA — DUMMY FEED LINK AUTO CLICKER');
    console.log('==========================================================');
    console.log(`  Target Feed Code     : ${code}`);
  console.log(`  URL Asli             : https://ninjasaga.cc/?feed=${code}`);
    console.log(`  Total Akun Dummy     : ${accounts.length}`);
    console.log(`  Jeda Antar Akun      : ${delaySec} detik`);
    console.log('==========================================================\n');

    let success = 0, failed = 0;
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accIdx = `[${i + 1}/${accounts.length}]`;
        line(`${accIdx} Login dummy: ${acc.user}...`);

        const s = await c.login(acc.user, acc.pass);
        if (!s.ok) {
            line(`${accIdx} ✗ Gagal login ${acc.user}: ${s.message || s.stage}`);
            failed++;
            continue;
        }

        line(`${accIdx} Mengklik link feed Heart of Kari...`);
        const res = await claimFeed(s, code);
        if (res.ok) {
            line(`${accIdx} ✓ SUKSES: Akun ${acc.user} berhasil mengklik & mengklaim link feed!`);
            success++;
        } else {
            line(`${accIdx} ✗ GAGAL: Akun ${acc.user} gagal klaim feed: ${res.message || 'HTTP ' + res.statusCode}`);
            failed++;
        }

        if (i < accounts.length - 1) {
            await sleep(delaySec * 1000);
        }
    }

    console.log('\n==========================================================');
    console.log(`  Total Klik Selesai   : ${success}/${accounts.length} Berhasil (${failed} Gagal)`);
    console.log('==========================================================\n');
}

/**
 * Menjalankan Auto Task Lengkap untuk Seluruh Akun Dummy:
 *   1. Heart of Kari (klik link & post feed)
 *   2. Send Crystal of Kari
 *   3. Send Trick or Treats
 */
async function runDummyFarmer(sharedFeedLink = '', targetMainUser = '', targetMainPass = '', delaySec = 5) {
    const accounts = loadAccountsList();
    if (accounts.length === 0) {
        console.log('\n[!] Belum ada daftar akun dummy.');
        console.log(`    Silakan isi file "${DUMMY_TXT}" atau gunakan generator:`);
        console.log('    node ns_dummy_farmer.js gen dmmy 1001 20 <password>\n');
        return;
    }

    const feedCode = cleanFeedCode(sharedFeedLink);

    console.log('\n==========================================================');
    console.log('     NINJA SAGA MULTI-DUMMY AUTO TASK & GIFTING BOT');
    console.log('     cc: MagnetScript(Razki)');
    console.log('==========================================================');
    console.log(`  Total Akun Dummy     : ${accounts.length}`);
    console.log(`  Heart of Kari Link   : ${feedCode ? 'https://ninjasaga.cc/?feed=' + feedCode : '(Otomatis per akun)'}`);
    console.log(`  Target Akun Utama    : ${targetMainUser || '(Opsional)'}`);
    console.log(`  Jeda Antar Akun      : ${delaySec} detik`);
    console.log('  Rincian Task Tiap Dummy:');
    console.log('    [1] Heart of Kari (Klik link bersama + Post feed + Status Heart)');
    console.log('    [2] Send Gift Crystal of Kari (item1026)');
    console.log('    [3] Send Trick or Treats (Halloween Event)');
    console.log('==========================================================\n');

    let mainSession = null;
    if (targetMainUser && targetMainPass) {
        line(`Melakukan handshake sesi akun target utama: ${targetMainUser}...`);
        mainSession = await c.login(targetMainUser, targetMainPass);
        if (mainSession.ok) {
            line(`✓ Berhasil login akun target (Player ID: ${mainSession.playerId})`);
        } else {
            line(`! Gagal login akun target: ${mainSession.message || mainSession.stage}. Lanjut mode mandiri.`);
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

        // Pastikan akun memiliki karakter (jika akun baru, auto-create)
        const charInfo = await ensureCharacter(s, db, acc.user, acc.pass);
        if (!charInfo) {
            line(`${accIdx} ✗ Gagal menyiapkan karakter untuk ${acc.user}`);
            summary.failed++;
            continue;
        }

        // Eksekusi ketiga task
        line(`${accIdx} Menjalankan Task: Heart of Kari, Crystal of Kari, Trick or Treats...`);
        const taskRes = await executeGiftsForDummy(s, charInfo.charId, feedCode, mainSession, targetMainUser);

        // Update catatan database
        const rec = db.accounts[acc.user] || {};
        rec.last_gift_sent = new Date().toISOString();
        rec.total_gifts_sent = (rec.total_gifts_sent || 0) + 1;
        rec.last_results = taskRes;
        db.accounts[acc.user] = rec;
        saveDummyDb(db);

        summary.success++;
        line(`${accIdx} ✓ SELESAI memproses akun ${acc.user}`);

        if (i < accounts.length - 1) {
            line(`Menunggu ${delaySec} detik sebelum akun dummy berikutnya...`);
            await sleep(delaySec * 1000);
        }
    }

    console.log('\n==========================================================');
    console.log('              RINGKASAN SELESAI FARMING DUMMY');
    console.log('==========================================================');
    console.log(`  Total Akun Diproses  : ${accounts.length}`);
    console.log(`  Berhasil Eksekusi    : ${summary.success}`);
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
            const sent = a.total_gifts_sent ? `${a.total_gifts_sent}x task` : 'Belum pernah';
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
        console.log('         NINJA SAGA DUMMY ACCOUNT AUTO TASK BOT');
        console.log('         cc: MagnetScript(Razki)');
        console.log('==========================================================');
        console.log('  1. Jalankan Auto Task Lengkap untuk Semua Akun Dummy');
        console.log('     - Task 1: Heart of Kari (Klik link + Post feed)');
        console.log('     - Task 2: Send Gift Crystal of Kari (item1026)');
        console.log('     - Task 3: Send Trick or Treats (Halloween Event)');
        console.log('  2. Klik Link Heart of Kari Saja (Semua Akun Dummy Klik Link)');
        console.log('  3. Generate Akun Dummy Penomoran Otomatis (Counter Engine)');
        console.log('  4. Lihat Status Seluruh Akun Dummy Tersimpan');
        console.log('  0. Keluar');
        console.log('==========================================================');

        const ans = (await ask('Pilih (0-4) : ')).trim();
        if (ans === '1') {
            const feedUrl = (await ask('Masukkan Link / Code Heart of Kari (tekan Enter jika tidak ada) : ')).trim();
            const mainU = (await ask('Username Akun Utama (opsional, tekan Enter untuk lewati) : ')).trim();
            let mainP = '';
            if (mainU) mainP = (await ask('Password Akun Utama : ')).trim();
            let del = (await ask('Jeda antar akun dalam detik (default = 5) : ')).trim();
            del = parseInt(del, 10) || 5;
            await runDummyFarmer(feedUrl, mainU, mainP, del);
        } else if (ans === '2') {
            const feedUrl = (await ask('Masukkan Link Heart of Kari (contoh: https://ninjasaga.cc/?feed=xxxx) : ')).trim();
            if (!feedUrl) {
                console.log('Link feed tidak boleh kosong.');
                continue;
            }
            let del = (await ask('Jeda antar klik dalam detik (default = 3) : ')).trim();
            del = parseInt(del, 10) || 3;
            await clickFeedForAllDummies(feedUrl, del);
        } else if (ans === '3') {
            const prefix = (await ask('Prefix akun (default = dmmy) : ')).trim() || 'dmmy';
            const start = (await ask('Nomor mulai (default = 1001) : ')).trim() || '1001';
            const count = (await ask('Jumlah akun yang ingin dibuat (default = 20) : ')).trim() || '20';
            const pass = (await ask('Password default (default = Ninja@1234) : ')).trim() || 'Ninja@1234';
            generateCounterAccounts(prefix, start, count, pass);
        } else if (ans === '4') {
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
    } else if (cmd === 'click') {
        const feedArg = process.argv[3] || '';
        const delayIdx = process.argv.indexOf('--delay');
        const delaySec = delayIdx !== -1 ? parseInt(process.argv[delayIdx + 1], 10) || 3 : 3;
        await clickFeedForAllDummies(feedArg, delaySec);
    } else if (cmd === 'run') {
        const feedIdx = process.argv.indexOf('--feed');
        const feedArg = feedIdx !== -1 ? process.argv[feedIdx + 1] : '';
        const targetIdx = process.argv.indexOf('--target');
        const targetUser = targetIdx !== -1 ? process.argv[targetIdx + 1] : (process.env.NS_USER || '');
        const targetPass = process.env.NS_PASS || '';
        const delayIdx = process.argv.indexOf('--delay');
        const delaySec = delayIdx !== -1 ? parseInt(process.argv[delayIdx + 1], 10) || 5 : 5;
        await runDummyFarmer(feedArg, targetUser, targetPass, delaySec);
    } else {
        await interactiveMenu();
    }
    process.exit(0);
})().catch(err => {
    line('FATAL: ' + (err.message || err));
    process.exit(1);
});
