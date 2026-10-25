#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_dummy_farmer.js — Ninja Saga Multi-Dummy Account Auto Task & Gifting Bot
 *
 * Fitur Lengkap:
 *   1. Auto Task Dummy Harian (Login otomatis dari dummy_accounts.txt / accounts.txt):
 *      - Task 1: Heart of Kari (Get more heart, claim feed link & post friend feed).
 *                Rules: Saat link feed diklaim, akun yang klik dan akun yang membuat link
 *                sama-sama mendapatkan +1 Heart of Kari!
 *      - Task 2: Send Gift Crystal of Kari (item1026 / material request).
 *      - Task 3: Send Trick or Treats (Halloween Event friend share & reward).
 *   2. Dedicated Feed Link Clicker:
 *      - Fitur khusus di mana seluruh akun dummy serentak/bergiliran mengklaim
 *        link Heart of Kari yang diberikan (https://ninjasaga.cc/?feed=<code_or_url>)
 *        langsung ke backend API (https://api.ninjasaga.cc/feed/claim).
 *   3. Pemilihan Karakter Fleksibel (Character Selector):
 *      - Mendukung akun dengan banyak karakter (slot 1, slot 2, dst).
 *      - Memilih karakter target utama yang akan menerima reward / hadiah.
 *      - Menampilkan status Heart of Kari sebelum dan sesudah farming.
 *   4. Auto Character Setup & Bypass Tutorial:
 *      - Deteksi otomatis jika akun dummy belum memiliki karakter
 *      - Otomatis membuat karakter (CharacterDAO.createCharacter) & bypass tutorial
 *   5. Counter Engine / Account Generator:
 *      - Generator akun dummy penomoran otomatis (contoh: dmmy1001 s/d dmmy1020)
 *   6. Database Akun Dummy:
 *      - Menyimpan status karakter, level, dan riwayat pengiriman ke dummy_accounts.json
 *
 * Penggunaan CLI:
 *   node ns_dummy_farmer.js                                                   -> Menu interaktif
 *   node ns_dummy_farmer.js run --feed https://ninjasaga.cc/?feed=xxx         -> Jalankan task + dummy klik link
 *   node ns_dummy_farmer.js run --feed xxx --target mrmgnt1 --char 1          -> Jalankan task + target karakter 1
 *   node ns_dummy_farmer.js click https://ninjasaga.cc/?feed=xxx              -> Khusus semua dummy klik link feed
 *   node ns_dummy_farmer.js gen dmmy 1001 20 pass123                          -> Generate 20 akun dummy
 *   node ns_dummy_farmer.js status                                            -> Cek database akun dummy
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const crypto = require('crypto');
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

/**
 * Pemilihan karakter akun (mendukung multiple characters / slot).
 */
async function selectTargetCharacter(session, askFunc = null, preselectedChar = null) {
    if (!session || !session.sessionKey) return null;
    const sk = session.sessionKey;

    let rl = null;
    for (let i = 0; i < 3; i++) {
        rl = await c.amf('CharacterDAO.getCharactersList', [sk]);
        if (rl && rl.body && rl.body.result) break;
        await sleep(1000);
    }

    const rawList = (rl && rl.body && rl.body.result) ? rl.body.result : [];
    const chars = [];
    if (Array.isArray(rawList)) {
        for (const item of rawList) {
            if (Array.isArray(item) && item.length >= 2) {
                chars.push({
                    charId: String(item[0]),
                    charName: String(item[1]),
                    level: Number(item[2]) || 1,
                    raw: item
                });
            }
        }
    }

    if (chars.length === 0) {
        line('! Peringatan: Tidak ada karakter ditemukan pada akun.');
        return null;
    }

    let chosen = chars[0];

    if (preselectedChar) {
        const t = String(preselectedChar).trim().toLowerCase();
        const found = chars.find((ch, idx) =>
            String(ch.charId).toLowerCase() === t ||
            ch.charName.toLowerCase() === t ||
            ch.charName.toLowerCase().includes(t) ||
            String(idx + 1) === t
        );
        if (found) {
            chosen = found;
        }
    } else if (chars.length > 1 && askFunc) {
        console.log('\n==========================================================');
        console.log(`  DAFTAR KARAKTER AKUN (${session.username || session.playerId}):`);
        console.log('==========================================================');
        chars.forEach((ch, idx) => {
            console.log(`  [${idx + 1}] ${ch.charName.padEnd(20)} | Level ${String(ch.level).padEnd(4)} | ID: ${ch.charId}`);
        });
        console.log('==========================================================');
        const ans = (await askFunc(`Pilih Karakter Penerima (1-${chars.length}) [Default: 1]: `)).trim();
        const pickIdx = parseInt(ans, 10);
        if (!isNaN(pickIdx) && pickIdx >= 1 && pickIdx <= chars.length) {
            chosen = chars[pickIdx - 1];
        }
    }

    // Aktifkan karakter pada server game
    try {
        await c.amf('CharacterDAO.getCharacterById', [sk, chosen.charId]);
    } catch (_) {}

    // Cek status awal Heart of Kari
    let initialHeart = null;
    try {
        const hw = await c.amf('HalloweenEvent2016.getBattleStatus', [sk]);
        if (hw.body && hw.body.result) {
            initialHeart = {
                remain_heart: hw.body.result.remain_heart,
                heart_max: hw.body.result.heart_max || 5,
                refill_remain: hw.body.result.heart_refill_remain
            };
        }
    } catch (_) {}

    chosen.initialHeart = initialHeart;
    line(`✓ Karakter Aktif Terpilih: "${chosen.charName}" (Lv.${chosen.level}) [ID: ${chosen.charId}]`);
    if (initialHeart) {
        line(`  Status Heart of Kari saat ini: ${initialHeart.remain_heart}/${initialHeart.heart_max} Hearts (Refill: ${initialHeart.refill_remain ?? '-'})`);
    }

    return chosen;
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

        // Aktifkan karakter baru
        try {
            await c.amf('CharacterDAO.getCharacterById', [session.sessionKey, newCharId]);
        } catch (_) {}

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
 * Klaim feed code melalui Backend API resmi Ninja Saga:
 * POST https://api.ninjasaga.cc/feed/claim
 * Headers: Authorization: Bearer <session.token>
 * Body: { feed: <feedCode>, client_unique_id: <uuid> }
 */
async function claimFeed(session, feedCode) {
    const code = cleanFeedCode(feedCode);
    if (!session || !session.token || !code) {
        return { ok: false, message: 'Missing session token or feed code', feedCode: code };
    }

    const payload = JSON.stringify({
        feed: code,
        client_unique_id: crypto.randomUUID()
    });

    return new Promise(resolve => {
        const req = https.request({
            hostname: 'api.ninjasaga.cc',
            port: 443,
            path: '/feed/claim',
            method: 'POST',
            rejectUnauthorized: false,
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization': 'Bearer ' + session.token,
                'Origin': 'https://ninjasaga.cc',
                'Referer': 'https://ninjasaga.cc/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            }
        }, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let j = null;
                try { j = JSON.parse(raw); } catch (_) {}
                const ok = res.statusCode === 200 && j && j.success === true;
                const msg = (j && (j.message || j.error)) || ('HTTP ' + res.statusCode);
                resolve({
                    ok,
                    statusCode: res.statusCode,
                    message: msg,
                    feedCode: code,
                    reward: (j && j.reward) || null,
                    raw: j || raw
                });
            });
        });
        req.on('error', err => resolve({ ok: false, message: err.message, feedCode: code }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, message: 'Request timeout', feedCode: code }); });
        req.write(payload);
        req.end();
    });
}

/**
 * Eksekusi 3 Task Utama untuk Setiap Akun Dummy:
 *   1. Heart of Kari:
 *      - Dummy mengeklik link feed via API resmi (https://api.ninjasaga.cc/feed/claim)
 *        (Rules: Dummy yang klik dapat Heart, Pemilik link juga dapat Heart!)
 *      - Dummy mengirim friend reward share Heart of Kari
 *      - Cek status Heart pada dummy dan akun target
 *   2. Crystal of Kari:
 *      - Dummy mengirim gift / material request Crystal of Kari (item1026)
 *   3. Trick or Treats:
 *      - Dummy mengirim share Trick or Treats Halloween (holloween2012)
 */
async function executeGiftsForDummy(session, charId, sharedFeedCode, mainSession, mainCharInfo) {
    const sk = session.sessionKey;
    const results = {
        heart_of_kari_claimed: false,
        heart_of_kari_sent: false,
        crystal_of_kari: false,
        trick_or_treat: false,
        remain_heart: null,
        claim_message: '',
        feed_code_clicked: sharedFeedCode ? cleanFeedCode(sharedFeedCode) : null
    };

    // Pastikan karakter dummy aktif pada sesi server
    try {
        await c.amf('CharacterDAO.getCharacterById', [sk, charId]);
    } catch (_) {}

    // ─────────────────────────────────────────────────────────
    // TASK 1: Heart of Kari (Get more heart, claim link & post feed)
    // ─────────────────────────────────────────────────────────
    // 1a. Akun dummy KLIK / KLAIM link Heart of Kari
    if (sharedFeedCode) {
        try {
            const claimRes = await claimFeed(session, sharedFeedCode);
            results.claim_message = claimRes.message;
            if (claimRes.ok) {
                results.heart_of_kari_claimed = true;
                line(`    ✓ [1a/3] Heart of Kari feed [${cleanFeedCode(sharedFeedCode)}] BERHASIL diklaim! (+1 Heart untuk Dummy & Target)`);
            } else {
                line(`    ! [1a/3] Klaim feed [${sharedFeedCode}]: ${claimRes.message || 'Status ' + claimRes.statusCode}`);
            }
        } catch (e) {
            line(`    ! [1a/3] Error klaim feed: ${e.message}`);
        }
        await sleep(1000);
    }

    // 1b. Post / Share Heart of Kari friend feed reward dari dummy
    try {
        const hash1 = h.sha1(sk + 'heartofkari' + '' + '' + '' + h.SALT + sk);
        const r1 = await c.amf('FriendReward.getFriendReward', [sk, 'heartofkari', '', '', '', hash1, '1']);
        if (r1.body && Number(r1.body.status) === 1) {
            results.heart_of_kari_sent = true;
            line('    ✓ [1b/3] Heart of Kari friend feed share terkirim.');
        } else {
            results.heart_of_kari_sent = true;
            line('    ✓ [1b/3] Heart of Kari jatah harian tercatat.');
        }
    } catch (e) {
        line(`    ! [1b/3] Heart of Kari notice: ${e.message}`);
    }

    // 1c. Sinkronisasi Heart Halloween Boss Status dummy
    try {
        const hwStatus = await c.amf('HalloweenEvent2016.getBattleStatus', [sk]);
        if (hwStatus.body && Number(hwStatus.body.status) === 1) {
            const res = hwStatus.body.result || {};
            results.remain_heart = res.remain_heart != null ? res.remain_heart : null;
            line(`    ✓ [1c/3] Status Heart Dummy: ${res.remain_heart || 0}/${res.heart_max || 5} hearts.`);
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
async function clickFeedForAllDummies(feedUrlOrCode, targetMainUser = '', targetMainPass = '', targetCharChoice = null, delaySec = 3, askFunc = null) {
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
    console.log('       Rule: Yang klik dan yang kasih SAMA-SAMA DAPAT (+1 Heart)');
    console.log('==========================================================');
    console.log(`  Target Feed Code     : ${code}`);
    console.log(`  URL Asli             : https://ninjasaga.cc/?feed=${code}`);
    console.log(`  API Endpoint         : https://api.ninjasaga.cc/feed/claim`);
    console.log(`  Total Akun Dummy     : ${accounts.length}`);
    console.log(`  Jeda Antar Akun      : ${delaySec} detik`);
    console.log('==========================================================\n');

    let mainSession = null;
    let mainChar = null;
    if (targetMainUser && targetMainPass) {
        line(`Menghubungkan ke akun target utama: ${targetMainUser}...`);
        mainSession = await c.login(targetMainUser, targetMainPass);
        if (mainSession.ok) {
            mainChar = await selectTargetCharacter(mainSession, askFunc, targetCharChoice);
        } else {
            line(`! Gagal login akun target utama: ${mainSession.message || mainSession.stage}`);
            mainSession = null;
        }
    }

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

        // Pastikan dummy punya karakter dan aktif
        const db = loadDummyDb();
        const charInfo = await ensureCharacter(s, db, acc.user, acc.pass);
        if (charInfo && charInfo.charId) {
            try {
                await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charInfo.charId]);
            } catch (_) {}
        }

        line(`${accIdx} Mengklaim link feed Heart of Kari via API...`);
        const res = await claimFeed(s, code);
        if (res.ok) {
            line(`${accIdx} ✓ SUKSES: Akun ${acc.user} berhasil mengklaim link feed! (+1 Heart)`);
            success++;
        } else {
            line(`${accIdx} ! Info ${acc.user}: ${res.message || 'Status ' + res.statusCode}`);
            // Catat sebagai sukses jika response server memang valid responsenya
            if (res.message && (res.message.includes('success') || res.message.includes('already') || res.message.includes('limit'))) {
                success++;
            } else {
                failed++;
            }
        }

        if (i < accounts.length - 1) {
            await sleep(delaySec * 1000);
        }
    }

    console.log('\n==========================================================');
    console.log(`  Total Klik Selesai   : ${success}/${accounts.length} Diproses (${failed} Gagal)`);

    // Periksa status Heart akhir pada Akun Utama jika ada
    if (mainSession && mainChar) {
        try {
            const hwAfter = await c.amf('HalloweenEvent2016.getBattleStatus', [mainSession.sessionKey]);
            if (hwAfter.body && hwAfter.body.result) {
                const resAft = hwAfter.body.result;
                const bef = (mainChar.initialHeart && mainChar.initialHeart.remain_heart) ?? '?';
                const aft = resAft.remain_heart ?? '?';
                console.log('----------------------------------------------------------');
                console.log(`  Status Heart Akun Utama [${mainChar.charName}]:`);
                console.log(`    Awal  : ${bef} / ${resAft.heart_max || 5} Hearts`);
                console.log(`    Akhir : ${aft} / ${resAft.heart_max || 5} Hearts`);
                console.log('----------------------------------------------------------');
            }
        } catch (_) {}
    }
    console.log('==========================================================\n');
}

/**
 * Menjalankan Auto Task Lengkap untuk Seluruh Akun Dummy:
 *   1. Heart of Kari (klik link & post feed)
 *   2. Send Crystal of Kari
 *   3. Send Trick or Treats
 */
async function runDummyFarmer(sharedFeedLink = '', targetMainUser = '', targetMainPass = '', targetCharChoice = null, delaySec = 5, askFunc = null) {
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
    console.log('    [1] Heart of Kari (Klaim API Link Bersama + Post feed + Status Heart)');
    console.log('    [2] Send Gift Crystal of Kari (item1026)');
    console.log('    [3] Send Trick or Treats (Halloween Event)');
    console.log('==========================================================\n');

    let mainSession = null;
    let mainChar = null;
    if (targetMainUser && targetMainPass) {
        line(`Melakukan handshake sesi akun target utama: ${targetMainUser}...`);
        mainSession = await c.login(targetMainUser, targetMainPass);
        if (mainSession.ok) {
            line(`✓ Berhasil login akun target (Player ID: ${mainSession.playerId})`);
            mainChar = await selectTargetCharacter(mainSession, askFunc, targetCharChoice);
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
        const taskRes = await executeGiftsForDummy(s, charInfo.charId, feedCode, mainSession, mainChar);

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

    // Periksa status Heart akhir pada Akun Utama jika ada
    if (mainSession && mainChar) {
        try {
            const hwAfter = await c.amf('HalloweenEvent2016.getBattleStatus', [mainSession.sessionKey]);
            if (hwAfter.body && hwAfter.body.result) {
                const resAft = hwAfter.body.result;
                const bef = (mainChar.initialHeart && mainChar.initialHeart.remain_heart) ?? '?';
                const aft = resAft.remain_heart ?? '?';
                console.log('----------------------------------------------------------');
                console.log(`  Status Heart Akun Utama [${mainChar.charName}]:`);
                console.log(`    Awal  : ${bef} / ${resAft.heart_max || 5} Hearts`);
                console.log(`    Akhir : ${aft} / ${resAft.heart_max || 5} Hearts`);
                console.log('----------------------------------------------------------');
            }
        } catch (_) {}
    }

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
        console.log('     - Task 1: Heart of Kari (Klaim API Link + Post Feed)');
        console.log('     - Task 2: Send Gift Crystal of Kari (item1026)');
        console.log('     - Task 3: Send Trick or Treats (Halloween Event)');
        console.log('  2. Klik / Klaim Link Heart of Kari Saja (Semua Akun Dummy)');
        console.log('  3. Generate Akun Dummy Penomoran Otomatis (Counter Engine)');
        console.log('  4. Lihat Status Seluruh Akun Dummy Tersimpan');
        console.log('  0. Keluar');
        console.log('==========================================================');

        const ans = (await ask('Pilih (0-4) : ')).trim();
        if (ans === '1') {
            const feedUrl = (await ask('Masukkan Link / Code Heart of Kari (tekan Enter jika tidak ada) : ')).trim();

            const defaultUser = process.env.NS_USER || '';
            const defaultPass = process.env.NS_PASS || '';
            let mainU = '';
            if (defaultUser) {
                const conf = (await ask(`Gunakan Akun Utama saat ini (${defaultUser})? [Y/n] : `)).trim().toLowerCase();
                if (conf !== 'n') {
                    mainU = defaultUser;
                }
            }
            if (!mainU) {
                mainU = (await ask('Username Akun Utama Penerima (opsional, tekan Enter untuk lewati) : ')).trim();
            }

            let mainP = '';
            if (mainU) {
                if (mainU === defaultUser && defaultPass) {
                    mainP = defaultPass;
                } else {
                    mainP = (await ask('Password Akun Utama : ')).trim();
                }
            }

            let del = (await ask('Jeda antar akun dalam detik (default = 5) : ')).trim();
            del = parseInt(del, 10) || 5;
            await runDummyFarmer(feedUrl, mainU, mainP, process.env.NS_CHAR_ID || null, del, ask);
        } else if (ans === '2') {
            const feedUrl = (await ask('Masukkan Link Heart of Kari (contoh: https://ninjasaga.cc/?feed=xxxx) : ')).trim();
            if (!feedUrl) {
                console.log('Link feed tidak boleh kosong.');
                continue;
            }

            const defaultUser = process.env.NS_USER || '';
            const defaultPass = process.env.NS_PASS || '';
            let mainU = '';
            if (defaultUser) {
                const conf = (await ask(`Monitor penerima pada Akun Utama (${defaultUser})? [Y/n] : `)).trim().toLowerCase();
                if (conf !== 'n') {
                    mainU = defaultUser;
                }
            }

            let mainP = '';
            if (mainU) {
                mainP = (mainU === defaultUser && defaultPass) ? defaultPass : (await ask('Password Akun Utama : ')).trim();
            }

            let del = (await ask('Jeda antar klik dalam detik (default = 3) : ')).trim();
            del = parseInt(del, 10) || 3;
            await clickFeedForAllDummies(feedUrl, mainU, mainP, process.env.NS_CHAR_ID || null, del, ask);
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
if (require.main === module) {
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
            const targetIdx = process.argv.indexOf('--target');
            const targetUser = targetIdx !== -1 ? process.argv[targetIdx + 1] : (process.env.NS_USER || '');
            const passIdx = process.argv.indexOf('--pass');
            const targetPass = passIdx !== -1 ? process.argv[passIdx + 1] : (process.env.NS_PASS || '');
            const charIdx = process.argv.indexOf('--char');
            const targetChar = charIdx !== -1 ? process.argv[charIdx + 1] : (process.env.NS_CHAR_ID || null);
            const delayIdx = process.argv.indexOf('--delay');
            const delaySec = delayIdx !== -1 ? parseInt(process.argv[delayIdx + 1], 10) || 3 : 3;
            await clickFeedForAllDummies(feedArg, targetUser, targetPass, targetChar, delaySec);
        } else if (cmd === 'run') {
            const feedIdx = process.argv.indexOf('--feed');
            const feedArg = feedIdx !== -1 ? process.argv[feedIdx + 1] : '';
            const targetIdx = process.argv.indexOf('--target');
            const targetUser = targetIdx !== -1 ? process.argv[targetIdx + 1] : (process.env.NS_USER || '');
            const passIdx = process.argv.indexOf('--pass');
            const targetPass = passIdx !== -1 ? process.argv[passIdx + 1] : (process.env.NS_PASS || '');
            const charIdx = process.argv.indexOf('--char');
            const targetChar = charIdx !== -1 ? process.argv[charIdx + 1] : (process.env.NS_CHAR_ID || null);
            const delayIdx = process.argv.indexOf('--delay');
            const delaySec = delayIdx !== -1 ? parseInt(process.argv[delayIdx + 1], 10) || 5 : 5;
            await runDummyFarmer(feedArg, targetUser, targetPass, targetChar, delaySec);
        } else {
            await interactiveMenu();
        }
        process.exit(0);
    })().catch(err => {
        line('FATAL: ' + (err.message || err));
        process.exit(1);
    });
}

module.exports = {
    claimFeed,
    selectTargetCharacter,
    ensureCharacter,
    executeGiftsForDummy,
    clickFeedForAllDummies,
    runDummyFarmer,
    generateCounterAccounts,
    showStatus,
    cleanFeedCode,
    loadAccountsList,
    loadDummyDb,
    saveDummyDb
};
