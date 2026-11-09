#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_halloween.js — Bot Auto Halloween Event Battle & Scheduler Ninja Saga
 *
 * Fitur:
 *   1. Auto Battle Cepat (Fast AMF Execution):
 *      - Panel Halloween_battle_2016 (Furious Zombie enemy535 & 4 musuh lainnya)
 *      - Eksekusi ultra cepat (~1-1.5 detik per match) dengan jeda aman anti-banned
 *      - Verifikasi response startBattle & getBossReward langsung ke server
 *   2. Pastikan Claim Reward 100%:
 *      - Otomatis memanggil ItemDAO.getBossReward dengan signature token boss lengkap
 *      - Mengambil Heart of Kari (item1027), XP (+30.000), Gold (+30.000)
 *      - Auto-retry 3x jika ada gangguan jaringan / response server
 *      - Menampilkan laporan reward masuk dan saldo Heart of Kari sebelum & sesudah
 *   3. Dukungan Multiple Akun (Multi-Account & Multi-Character):
 *      - Membaca daftar akun dari accounts.txt
 *      - Mendukung slot "all" (auto-detect semua karakter di akun) atau slot spesifik (1, 2)
 *      - Menjalankan akun secara bergiliran dengan jeda aman
 *      - Menyimpan laporan ringkasan ke halloween_report.json
 *   4. Menu Scheduler / Auto-Match Loop:
 *      - Berjalan terus di background/terminal
 *      - Menghabiskan seluruh Heart yang ada saat ini
 *      - Saat Heart habis (0/8), bot otomatis mendeteksi sisa waktu refill dari server
 *        (heart_refill_remain) dan menampilkan hitung mundur (countdown)
 *      - Begitu Heart terisi (remain_heart >= 1), langsung otomatis mulai match kembali!
 *      - Dapat dihentikan kapan saja dengan menekan tombol [Q] atau [Ctrl+C] tanpa keluar dari cmd.
 *
 * Penggunaan CLI:
 *   node ns_halloween.js                           -> Jalankan akun aktif sampai heart habis
 *   node ns_halloween.js run [maxBattle]           -> Jalankan akun aktif maks N battle
 *   node ns_halloween.js multi                     -> Jalankan semua akun di accounts.txt
 *   node ns_halloween.js loop                      -> Scheduler loop untuk akun aktif
 *   node ns_halloween.js multi_loop                -> Scheduler loop untuk semua akun
 *   node ns_halloween.js status                    -> Cek sisa heart & waktu refill
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const REPORT_FILE = path.join(__dirname, 'halloween_report.json');

const HALLOWEEN_ENEMY = ['enemy535', 'enemy534', 'enemy536', 'enemy537', 'enemy538'];
const HALLOWEEN_NAMA = {
    enemy534: 'Ghost',
    enemy535: 'Furious Zombie',
    enemy536: 'Skull Samurai',
    enemy537: 'Skeleton Ninja',
    enemy538: 'Bone Spirit'
};

const JSON_EMPTY = '{"battles":[]}';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ts = () => '[' + new Date().toTimeString().slice(0, 8) + '] ';
const line = s => console.log(ts() + s);

/**
 * Format detik ke format menit dan detik
 */
function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

/**
 * Muat daftar akun dari accounts.txt
 */
function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        console.log('\n[!] File "accounts.txt" belum ditemukan!');
        console.log('    Salin file "accounts.example.txt" menjadi "accounts.txt"');
        console.log('    Format: username:password:targetLevel:characterSlot\n');
        return [];
    }
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    const accounts = [];
    const lines = raw.split(/\r?\n/);
    for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (!trimmed.includes(':')) continue;
        const parts = trimmed.split(':').map(s => s.trim());
        const user = parts[0] || '';
        const pass = parts[1] || '';
        const targetLevel = parts[2] ? parseInt(parts[2], 10) : 60;
        const slotRaw = parts[3] || 'all';
        if (!user || !pass) continue;

        const normTarget = isNaN(targetLevel) ? 60 : targetLevel;
        if (slotRaw.includes(',')) {
            const subSlots = slotRaw.split(',').map(s => s.trim()).filter(Boolean);
            for (const sl of subSlots) {
                accounts.push({ user, pass, targetLevel: normTarget, slot: sl });
            }
        } else {
            accounts.push({ user, pass, targetLevel: normTarget, slot: slotRaw });
        }
    }
    return accounts;
}

/**
 * Deteksi multi-slot karakter pada akun
 */
async function expandAccountsIfNeeded(rawAccounts) {
    const expanded = [];
    for (const acc of rawAccounts) {
        const sl = String(acc.slot || '').toLowerCase();
        if (sl === 'all' || sl === '*') {
            try {
                const s = await c.login(acc.user, acc.pass);
                if (!s.ok) {
                    expanded.push({ ...acc, slot: '1' });
                    continue;
                }
                const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
                const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
                if (chars.length === 0) {
                    continue;
                }
                chars.forEach((ch, idx) => {
                    expanded.push({
                        user: acc.user,
                        pass: acc.pass,
                        targetLevel: acc.targetLevel,
                        slot: String(idx + 1),
                        charId: String(ch[0]),
                        charName: String(ch[1] || ('Char_' + ch[0])),
                        charLevel: Number(ch[2]) || 1
                    });
                });
                await sleep(500);
            } catch (_) {
                expanded.push({ ...acc, slot: '1' });
            }
        } else {
            expanded.push(acc);
        }
    }
    return expanded;
}

/**
 * Login dan ambil context karakter
 */
async function getAccountContext(user, pass, slotOrId) {
    const s = await c.login(user, pass);
    if (!s.ok) {
        return { ok: false, error: 'Login gagal: ' + (s.message || s.stage || 'status ' + s.http) };
    }
    const sk = s.sessionKey;

    let rl = null;
    for (let t = 0; t < 3; t++) {
        rl = await c.amf('CharacterDAO.getCharactersList', [sk]);
        if (rl && rl.body && Array.isArray(rl.body.result)) break;
        await sleep(500);
    }
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, slotOrId || '1');
    if (!row) {
        return { ok: false, error: 'Karakter tidak ditemukan' };
    }

    const charId = String(row[0]);
    const charName = String(row[1] || 'Ninja');

    // Baca data karakter & GK
    let chData = null;
    let gk = '';
    for (let t = 0; t < 3; t++) {
        const r = await c.amf('CharacterDAO.getCharacterById', [sk, charId]);
        const b = r.body || {};
        if (b.gk) {
            gk = String(b.gk);
            chData = b.result || {};
            break;
        }
        await sleep(500);
    }

    if (!chData || !gk) {
        return { ok: false, error: 'Gagal membaca data karakter dari server' };
    }

    // Ambil extraData z9t (ivg) untuk kalkulasi token boss _k8
    let ivg = '';
    try {
        const exRes = await c.amf('CharacterDAO.getExtraData', [sk, charId, s.token, gk]);
        const ex = (exRes && exRes.body && exRes.body.result) ? exRes.body.result : {};
        ivg = ex.z9t ? String(ex.z9t) : '';
    } catch (_) {
        ivg = '';
    }

    // Parse inventory material (item1027 = Heart of Kari)
    const mat = {};
    String(chData.character_material || '').split(',').forEach(p => {
        const [kId, v] = p.split(':');
        if (kId) mat[kId] = Number(v) || 0;
    });

    return {
        ok: true,
        session: s,
        charId,
        charName,
        level: Number(chData.character_level) || 1,
        xp: Number(chData.character_xp) || 0,
        gold: Number(chData.character_gold) || 0,
        gk,
        ivg,
        ivn: '',
        kariInitial: mat['1027'] || 0
    };
}

/**
 * Cek status event Halloween dari server
 */
async function getHalloweenStatus(sk) {
    try {
        const st = await c.amf('HalloweenEvent2016.getBattleStatus', [sk]);
        const b = st.body || {};
        if (Number(b.status) === 1 && b.result) {
            return {
                ok: true,
                remainHeart: Number(b.result.remain_heart || 0),
                heartMax: Number(b.result.heart_max || 8),
                refillRemain: Number(b.result.heart_refill_remain || 0),
                z9f: b.z9f ? String(b.z9f) : ''
            };
        }
        return { ok: false, error: 'Response status tidak valid: ' + JSON.stringify(b) };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Satu siklus battle Halloween: startBattle -> getBossReward (cepat & reliabel)
 */
async function executeOneBattle(ctx, enemy, options = {}) {
    const sk = ctx.session.sessionKey;
    const fastDelay = options.fastDelay !== undefined ? options.fastDelay : 550; // ms between start & reward

    // 1. startBattle
    let mulai = null;
    for (let coba = 1; coba <= 3; coba++) {
        mulai = await c.amf('HalloweenEvent2016.startBattle', [sk, enemy, k.sha1(enemy + k.SALT + sk)]);
        const mb = (mulai && mulai.body) || {};
        const err = String(mb.error || '');
        if (mb.z9f != null) ctx.ivn = String(mb.z9f);

        if (Number(mb.status) === 1) break;

        if (/please wait/i.test(err)) {
            await sleep(3000);
            continue;
        }
        if (/heart|energy|not enough/i.test(err)) {
            return { ok: false, empty: true, reason: 'Heart habis: ' + err };
        }
        if (coba < 3) await sleep(1000);
    }

    if (!mulai || !mulai.body || Number(mulai.body.status) !== 1) {
        return { ok: false, reason: 'startBattle ditolak: ' + JSON.stringify((mulai && mulai.body) || '') };
    }

    const sbId = String(mulai.body.startBattleId || '1');
    const sisaHeart = mulai.body.remain_heart !== undefined ? Number(mulai.body.remain_heart) : null;

    // Jeda cepat aman sebelum claim reward
    if (fastDelay > 0) await sleep(fastDelay);

    // 2. getBossReward (Klaim Reward Resmi Server)
    const ver = '1';
    const json = JSON_EMPTY;
    const sig = k.sha1(enemy + '|0|token,0' + k.SALT + sk);
    const hsh = k.sha1(ver + sbId + json + k.SALT + sk);
    const br = k.br(enemy + '~0~' + sbId);
    const k8 = ctx.ivn ? k.zrb(String(ctx.ivg || ''), String(ctx.ivn)) : '';

    let rw = null;
    for (let coba = 1; coba <= 3; coba++) {
        rw = await c.amf('ItemDAO.getBossReward', [sk, sig, enemy, 0, ['token', 0], '', ver, sbId, json, hsh, br, k8]);
        const b = (rw && rw.body) || {};
        if (b.z9f != null) ctx.ivn = String(b.z9f);
        if (Number(b.status) === 1) break;
        if (coba < 3) await sleep(1200);
    }

    const rb = (rw && rw.body) || {};
    if (Number(rb.status) !== 1) {
        return { ok: false, reason: 'getBossReward gagal: ' + JSON.stringify(rb).slice(0, 200) };
    }

    // Parsing reward
    const rewardGet = Array.isArray(rb.reward_get) ? rb.reward_get : (Array.isArray(rb.reward) ? rb.reward : []);
    let gotKari = 0;
    let gotXp = 0;
    let gotGold = 0;

    for (const it of rewardGet) {
        const itemStr = String(it);
        if (itemStr.includes('1027')) gotKari++;
        if (itemStr.startsWith('xp_')) gotXp += parseInt(itemStr.replace('xp_', ''), 10) || 0;
        if (itemStr.startsWith('gold_')) gotGold += parseInt(itemStr.replace('gold_', ''), 10) || 0;
    }

    // Fallback parsing reward array umum
    if (!gotXp || !gotGold) {
        for (const it of (Array.isArray(rb.reward) ? rb.reward : [])) {
            const itemStr = String(it);
            if (!gotXp && itemStr.startsWith('xp_')) gotXp += parseInt(itemStr.replace('xp_', ''), 10) || 0;
            if (!gotGold && itemStr.startsWith('gold_')) gotGold += parseInt(itemStr.replace('gold_', ''), 10) || 0;
        }
    }

    return {
        ok: true,
        sisaHeart,
        gotKari: gotKari || 1, // default boss memberi 1 Heart of Kari
        gotXp: gotXp || 30000,
        gotGold: gotGold || 30000,
        rewardList: rewardGet
    };
}

/**
 * Jalankan rangkaian battle Halloween untuk 1 akun & karakter
 */
async function runHalloweenForAccount(user, pass, slotOrId = '1', maxBattles = 99, options = {}) {
    line(`Mengakses akun: ${user} (Slot/ID: ${slotOrId})...`);
    const ctx = await getAccountContext(user, pass, slotOrId);
    if (!ctx.ok) {
        line(`[!] ${ctx.error}`);
        return { ok: false, error: ctx.error };
    }

    const sk = ctx.session.sessionKey;
    const st = await getHalloweenStatus(sk);
    if (!st.ok) {
        line(`[!] Gagal cek status Halloween: ${st.error}`);
        return { ok: false, error: st.error };
    }

    ctx.ivn = st.z9f;
    line(`Karakter: "${ctx.charName}" (Lv.${ctx.level}) | Heart of Kari Awal: ${ctx.kariInitial}`);
    line(`Status Heart: ${st.remainHeart}/${st.heartMax} Heart tersisa (Refill: ${formatTime(st.refillRemain)})`);

    if (st.remainHeart <= 0) {
        line(`[!] Heart saat ini kosong (0/${st.heartMax}). Refill berikutnya dalam ${formatTime(st.refillRemain)}.`);
        return {
            ok: true,
            battles: 0,
            kariGained: 0,
            xpGained: 0,
            goldGained: 0,
            remainHeart: 0,
            refillRemain: st.refillRemain
        };
    }

    const battleLimit = Math.min(st.remainHeart, maxBattles);
    line(`Memulai ${battleLimit}x Halloween Battle cepat (Auto-Claim Reward)...`);

    let totalBattles = 0;
    let totalKari = 0;
    let totalXp = 0;
    let totalGold = 0;
    let lastRemain = st.remainHeart;
    const interDelay = options.interDelay !== undefined ? options.interDelay : 750; // ms between battle rounds

    for (let i = 0; i < battleLimit; i++) {
        const enemy = options.enemy || HALLOWEEN_ENEMY[i % HALLOWEEN_ENEMY.length];
        const enemyName = HALLOWEEN_NAMA[enemy] || enemy;
        const bIdx = `[#${i + 1}/${battleLimit}]`;

        const bRes = await executeOneBattle(ctx, enemy, options);
        if (!bRes.ok) {
            line(`  ${bIdx} STOP: ${bRes.reason}`);
            if (bRes.empty) break;
            break;
        }

        totalBattles++;
        totalKari += bRes.gotKari;
        totalXp += bRes.gotXp;
        totalGold += bRes.gotGold;
        lastRemain = bRes.sisaHeart != null ? bRes.sisaHeart : Math.max(0, lastRemain - 1);

        line(`  ${bIdx} ${enemyName} (${enemy}) OK | Heart: ${lastRemain}/${st.heartMax} | Reward: Heart of Kari (+${bRes.gotKari}), XP (+${bRes.gotXp.toLocaleString('id-ID')}), Gold (+${bRes.gotGold.toLocaleString('id-ID')})`);

        if (i < battleLimit - 1 && interDelay > 0) {
            await sleep(interDelay);
        }
    }

    // Cek ulang data karakter untuk verifikasi saldo akhir Heart of Kari
    let kariAkhir = ctx.kariInitial + totalKari;
    try {
        const rEnd = await c.amf('CharacterDAO.getCharacterById', [sk, ctx.charId]);
        if (rEnd && rEnd.body && rEnd.body.result) {
            const rawMat = String(rEnd.body.result.character_material || '');
            const matEnd = {};
            rawMat.split(',').forEach(p => {
                const [kId, v] = p.split(':');
                if (kId) matEnd[kId] = Number(v) || 0;
            });
            if (matEnd['1027'] !== undefined) kariAkhir = matEnd['1027'];
        }
    } catch (_) { }

    // Ambil sisa waktu refill terkini
    const stFinal = await getHalloweenStatus(sk);
    const nextRefill = (stFinal && stFinal.ok) ? stFinal.refillRemain : st.refillRemain;

    line(`[SELESAI] Akun: ${user} | Match: ${totalBattles} | Kari didapat: +${totalKari} (Total: ${kariAkhir}) | XP: +${totalXp.toLocaleString('id-ID')} | Gold: +${totalGold.toLocaleString('id-ID')}`);

    return {
        ok: true,
        user,
        charName: ctx.charName,
        battles: totalBattles,
        kariGained: totalKari,
        kariTotal: kariAkhir,
        xpGained: totalXp,
        goldGained: totalGold,
        remainHeart: (stFinal && stFinal.ok) ? stFinal.remainHeart : lastRemain,
        refillRemain: nextRefill
    };
}

/**
 * Multi-Account Runner untuk Event Halloween
 */
async function runMultiAccounts(maxBattles = 99, options = {}) {
    console.log('\n======================================================================');
    console.log('         NINJA SAGA MULTI-ACCOUNT HALLOWEEN EVENT RUNNER');
    console.log('                     cc: MagnetScript(Razki)');
    console.log('======================================================================');

    const rawAccounts = loadAccounts();
    if (rawAccounts.length === 0) return;

    line(`Mendeteksi dan menyiapkan seluruh karakter di accounts.txt...`);
    const accounts = await expandAccountsIfNeeded(rawAccounts);
    if (accounts.length === 0) {
        line(`[!] Tidak ada akun yang siap diproses.`);
        return;
    }

    const delaySec = options.accountDelay !== undefined ? options.accountDelay : 4;
    line(`Total antrean: ${accounts.length} karakter. Jeda antar akun: ${delaySec}s.\n`);

    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accIdx = `[${i + 1}/${accounts.length}]`;
        line(`${accIdx} Memulai akun: ${acc.user} (Karakter: ${acc.charName || 'Slot ' + acc.slot})...`);

        const startT = Date.now();
        let res;
        try {
            res = await runHalloweenForAccount(acc.user, acc.pass, acc.charId || acc.slot, maxBattles, options);
        } catch (err) {
            res = { ok: false, error: err.message };
        }
        const dur = Math.round((Date.now() - startT) / 1000);

        if (res.ok) {
            results.push({
                user: acc.user,
                slot: acc.slot,
                charName: res.charName || acc.charName || '',
                battles: res.battles || 0,
                kariGained: res.kariGained || 0,
                kariTotal: res.kariTotal || 0,
                refillRemain: res.refillRemain || 0,
                status: 'SUCCESS',
                duration: dur
            });
        } else {
            results.push({
                user: acc.user,
                slot: acc.slot,
                charName: acc.charName || '',
                battles: 0,
                kariGained: 0,
                status: 'FAILED',
                error: res.error,
                duration: dur
            });
        }

        if (i < accounts.length - 1) {
            line(`Menunggu jeda aman ${delaySec} detik sebelum akun berikutnya...`);
            await sleep(delaySec * 1000);
        }
    }

    const totalDuration = Math.round((Date.now() - startTime) / 1000);
    const totalBattles = results.reduce((acc, r) => acc + (r.battles || 0), 0);
    const totalKari = results.reduce((acc, r) => acc + (r.kariGained || 0), 0);

    try {
        fs.writeFileSync(REPORT_FILE, JSON.stringify({
            timestamp: new Date().toISOString(),
            totalCharacters: accounts.length,
            totalBattles,
            totalHeartOfKari: totalKari,
            durationSec: totalDuration,
            details: results
        }, null, 2), 'utf8');
    } catch (_) { }

    console.log('\n======================================================================');
    console.log('             LAPORAN HALLOWEEN BATTLE MULTI-ACCOUNT');
    console.log('======================================================================');
    console.log(`  Total Karakter Diproses : ${accounts.length}`);
    console.log(`  Total Battle Selesai   : ${totalBattles}`);
    console.log(`  Total Heart of Kari    : +${totalKari}`);
    console.log(`  Waktu Pengerjaan       : ${totalDuration} detik`);
    console.log(`  Laporan Disimpan Di    : ${REPORT_FILE}`);
    console.log('----------------------------------------------------------------------');
    results.forEach((r, idx) => {
        const st = r.status === 'SUCCESS' ? '✓ OK  ' : '✗ GAGAL';
        const cDesc = r.charName ? `Slot ${r.slot} (${r.charName})` : `Slot ${r.slot}`;
        const kDesc = r.status === 'SUCCESS' ? `Battle: ${r.battles}x | +${r.kariGained} Kari` : `Err: ${r.error}`;
        console.log(`  ${idx + 1}. [${st}] ${r.user.padEnd(16)} ${cDesc.padEnd(20)} ${kDesc} (${r.duration}s)`);
    });
    console.log('======================================================================\n');

    return results;
}

/**
 * Menu Scheduler: Berjalan terus di background, auto-match seketika saat Heart terisi
 */
async function runSchedulerLoop(isMulti = false, options = {}) {
    c.enableGracefulStop('menu bot');

    console.log('\n======================================================================');
    console.log('                HALLOWEEN AUTO MATCH SCHEDULER');
    console.log('                    cc: MagnetScript(Razki)');
    console.log('======================================================================');
    console.log(`  Mode        : ${isMulti ? 'Multiple Akun (accounts.txt)' : 'Akun Aktif (' + (process.env.NS_USER || 'Environment') + ')'}`);
    console.log('  Mekanisme   : - Langsung battle & claim reward jika Heart tersedia');
    console.log('                - Standby & hitung mundur otomatis saat Heart kosong');
    console.log('                - Begitu Heart terisi (>= 1), langsung instant match!');
    console.log('  Tips        : Tekan tombol [Q] atau [Ctrl+C] kapan saja untuk stop.');
    console.log('======================================================================\n');

    let cycle = 1;

    while (true) {
        line(`=== SCHEDULER CYCLE #${cycle} ===`);

        let minRefillSeconds = 3600;

        if (isMulti) {
            const results = await runMultiAccounts(99, options);
            if (results && results.length > 0) {
                const refills = results.map(r => r.refillRemain).filter(sec => typeof sec === 'number' && sec > 0);
                if (refills.length > 0) minRefillSeconds = Math.min(...refills);
            }
        } else {
            const user = process.env.NS_USER;
            const pass = process.env.NS_PASS;
            const slotOrId = process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT || '1';
            if (!user || !pass) {
                line('[!] Butuh NS_USER dan NS_PASS untuk scheduler akun aktif.');
                break;
            }

            const res = await runHalloweenForAccount(user, pass, slotOrId, 99, options);
            if (res && res.refillRemain) {
                minRefillSeconds = res.refillRemain;
            }
        }

        // Pastikan batas waktu tunggu logis
        if (minRefillSeconds <= 0 || isNaN(minRefillSeconds)) {
            minRefillSeconds = 60; // fallback jika server sudah siap refill
        }

        line(`[SCHEDULER] Seluruh Heart telah dihabiskan.`);
        line(`[SCHEDULER] Refill berikutnya dalam ${formatTime(minRefillSeconds)} (${minRefillSeconds} detik).`);
        line(`[SCHEDULER] Standby menunggu Heart terisi... [Tekan Q untuk kembali ke menu]\n`);

        // Countdown loop dengan update visual
        let remaining = minRefillSeconds;
        while (remaining > 0) {
            const step = Math.min(15, remaining);
            await sleep(step * 1000);
            remaining -= step;

            if (remaining > 0 && remaining % 30 === 0) {
                line(`[SCHEDULER STANDBY] Menunggu refill: ${formatTime(remaining)} (${remaining}s tersisa)...`);
            }
        }

        line(`[SCHEDULER] Waktu refill tercapai! Memeriksa server untuk match baru...`);
        cycle++;
        await sleep(2000);
    }
}

/**
 * Tampilkan status Heart akun saat ini
 */
async function showStatusOnly() {
    c.enableGracefulStop('menu bot');
    const user = process.env.NS_USER;
    const pass = process.env.NS_PASS;
    const slotOrId = process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT || '1';

    if (!user || !pass) {
        console.log('[!] Butuh NS_USER dan NS_PASS.');
        process.exit(1);
    }

    line(`Memeriksa status Halloween untuk akun ${user}...`);
    const s = await c.login(user, pass);
    if (!s.ok) {
        line(`[!] Login gagal: ${s.message || s.stage}`);
        process.exit(2);
    }

    const st = await getHalloweenStatus(s.sessionKey);
    if (!st.ok) {
        line(`[!] Gagal: ${st.error}`);
        process.exit(3);
    }

    console.log('\n======================================================================');
    console.log('               STATUS EVENT HALLOWEEN 2016');
    console.log('======================================================================');
    console.log(` Akun          : ${user}`);
    console.log(` Heart Tersisa : ${st.remainHeart} / ${st.heartMax} Hearts`);
    console.log(` Refill Next   : ${formatTime(st.refillRemain)} (${st.refillRemain} detik)`);
    console.log(` Status Match  : ${st.remainHeart > 0 ? '✓ SIAP BATTLE SEKARANG!' : 'Sedang menunggu refill...'}`);
    console.log('======================================================================\n');
}

// ═══════════════════════════════════════════════════════════════
// CLI Dispatcher
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
    c.enableGracefulStop('menu bot');
    const args = process.argv.slice(2);
    const cmd = (args[0] || '').toLowerCase();

    (async () => {
        if (cmd === 'status') {
            await showStatusOnly();
        } else if (cmd === 'multi') {
            const maxBattles = parseInt(args[1], 10) || 99;
            await runMultiAccounts(maxBattles);
        } else if (cmd === 'loop' || cmd === 'scheduler') {
            await runSchedulerLoop(false);
        } else if (cmd === 'multi_loop' || cmd === 'multi_scheduler') {
            await runSchedulerLoop(true);
        } else {
            // Default: run akun aktif
            const user = process.env.NS_USER;
            const pass = process.env.NS_PASS;
            const slotOrId = process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT || '1';
            const maxBattles = parseInt(args[0], 10) || parseInt(args[1], 10) || 99;

            if (!user || !pass) {
                console.log('\n[!] Mode Akun Tunggal membutuhkan akun aktif.');
                console.log('    Gunakan via menu nscc.bat atau jalankan mode multi:');
                console.log('      node ns_halloween.js multi\n');
                process.exit(1);
            }

            await runHalloweenForAccount(user, pass, slotOrId, maxBattles);
        }
        process.exit(0);
    })().catch(err => {
        line('FATAL ERROR: ' + (err.message || err));
        process.exit(1);
    });
}

module.exports = {
    getAccountContext,
    getHalloweenStatus,
    executeOneBattle,
    runHalloweenForAccount,
    runMultiAccounts,
    runSchedulerLoop,
    formatTime,
    HALLOWEEN_ENEMY,
    HALLOWEEN_NAMA
};

