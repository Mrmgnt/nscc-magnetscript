#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_multi_manager.js — Ninja Saga Multi-Account & Multi-Character Runner
 *
 * Fitur:
 *   - Membaca daftar akun dari accounts.txt dengan format:
 *       username:password:targetLevel:characterSlot
 *     Contoh skenario 3 akun (Akun 1 Emblem >1 karakter, Akun 2 & 3 Non-Emblem 1 karakter):
 *       akun1:pass1:80:all   (Otomatis mendeteksi & menjalankan SEMUA karakter di Akun 1)
 *       -- atau tulis per slot:
 *       akun1:pass1:80:1     (Akun 1, karakter slot 1)
 *       akun1:pass1:60:2     (Akun 1, karakter slot 2)
 *       akun2:pass2:80:1     (Akun 2, karakter slot 1)
 *       akun3:pass3:100:1    (Akun 3, karakter slot 1)
 *   - Mendukung slot "all" / "*" (auto-detect semua karakter di akun) atau "1,2" (multi-slot).
 *   - Menjalankan seluruh rutinitas otomatis secara sekuensial (bergantian):
 *       1. Jatah Harian Full (TP + SS + Eudemon Dragon 3x Emblem/1x Free + Claim Hunting House Tanpa Battle)
 *       2. Jatah Harian Full + Battle Hunting House
 *       3. Jatah Harian Full + Auto Leveling / Grade S
 *       4. Eudemon Dragon Saja / Hunting House Saja / Claim HH Saja / TP & SS / Leveling
 *   - Setiap akun & karakter dijalankan satu demi satu dengan jeda aman,
 *     menghindari tabrakan sesi server ("Session validation failed").
 *   - Laporan ringkasan di akhir eksekusi (Success / Failed / Skipped)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const c = require('./nsclient.js');

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const REPORT_FILE = path.join(__dirname, 'multi_manager_report.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);

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
        const slotRaw = parts[3] || 'all'; // jika dikosongkan, otomatis cek semua karakter di akun
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
 * Deteksi & resolusi karakter per akun (mendukung slot "all"/"*", "1,2", atau slot spesifik).
 * Login & getCharactersList di-cache per akun agar akun Emblem >1 karakter efisien.
 */
async function expandAccountsIfNeeded(rawAccounts) {
    const expanded = [];
    const seenKeys = new Set();
    const accountCache = new Map();

    // Hitung berapa baris per akun agar bisa memberi info jika akun Emblem >1 char hanya dijadwalkan 1 slot
    const userRowCount = new Map();
    for (const acc of rawAccounts) {
        const uk = acc.user.toLowerCase();
        userRowCount.set(uk, (userRowCount.get(uk) || 0) + 1);
    }

    async function fetchAccountChars(user, pass) {
        const key = `${user.toLowerCase()}:${pass}`;
        if (accountCache.has(key)) return accountCache.get(key);

        line(`Mendeteksi daftar karakter pada akun "${user}"...`);
        const s = await c.login(user, pass);
        if (!s.ok) {
            const errInfo = { ok: false, error: s.message || s.stage };
            accountCache.set(key, errInfo);
            return errInfo;
        }

        let chars = [];
        for (let t = 1; t <= 3; t++) {
            const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
            if (rl && rl.body && Array.isArray(rl.body.result)) {
                chars = rl.body.result;
                break;
            }
            if (t < 3) await sleep(1000);
        }

        const isEmblem = Boolean(s.isEmblem || Number(s.accountType) === 2);
        const entry = { ok: true, isEmblem, chars };
        accountCache.set(key, entry);

        if (chars.length > 0) {
            line(`  -> Ditemukan ${chars.length} karakter di akun ${user}${isEmblem ? ' [EMBLEM]' : ' [FREE]'}:`);
            chars.forEach((ch, idx) => {
                const cName = ch[1] || ('Char_' + ch[0]);
                const cLv = ch[2] || 1;
                line(`     Slot ${idx + 1}: ${cName} (Lv ${cLv}, ID: ${ch[0]})`);
            });
        }
        await sleep(150);
        return entry;
    }

    for (const acc of rawAccounts) {
        const sl = String(acc.slot || '').toLowerCase();
        const isAll = (sl === 'all' || sl === '*');

        try {
            const info = await fetchAccountChars(acc.user, acc.pass);
            if (!info.ok) {
                line(`  [!] Login gagal untuk ${acc.user}: ${info.error}. Tetap dijadwalkan slot ${isAll ? '1' : acc.slot}.`);
                const fallbackSlot = isAll ? '1' : String(acc.slot || '1');
                const dedup = `${acc.user.toLowerCase()}:slot:${fallbackSlot}`;
                if (!seenKeys.has(dedup)) {
                    seenKeys.add(dedup);
                    expanded.push({ ...acc, slot: fallbackSlot });
                }
                continue;
            }

            if (info.chars.length === 0) {
                line(`  [!] Tidak ada karakter ditemukan di ${acc.user}.`);
                continue;
            }

            if (isAll) {
                info.chars.forEach((ch, idx) => {
                    const cId = String(ch[0]);
                    const dedup = `${acc.user.toLowerCase()}:${cId}`;
                    if (seenKeys.has(dedup)) return;
                    seenKeys.add(dedup);
                    expanded.push({
                        user: acc.user,
                        pass: acc.pass,
                        targetLevel: acc.targetLevel,
                        isEmblem: info.isEmblem,
                        slot: String(idx + 1),
                        charId: cId,
                        charName: String(ch[1] || ('Char_' + cId)),
                        charLevel: Number(ch[2]) || 1
                    });
                });
            } else {
                const picked = c.getSelectedChar(info.chars, acc.slot);
                if (!picked) {
                    line(`  [SKIP] Akun ${acc.user}: slot/karakter "${acc.slot}" tidak tersedia (total karakter: ${info.chars.length}).`);
                    continue;
                }
                const slotIdx = info.chars.indexOf(picked) + 1;
                const cId = String(picked[0]);
                const dedup = `${acc.user.toLowerCase()}:${cId}`;
                if (seenKeys.has(dedup)) continue;
                seenKeys.add(dedup);

                if (info.isEmblem && info.chars.length > 1 && userRowCount.get(acc.user.toLowerCase()) === 1) {
                    line(`  [i] Akun ${acc.user} [EMBLEM] punya ${info.chars.length} karakter; konfigurasi slot=${acc.slot} hanya menjalankan Slot ${slotIdx} (gunakan "all" di accounts.txt untuk semua karakter).`);
                }

                expanded.push({
                    user: acc.user,
                    pass: acc.pass,
                    targetLevel: acc.targetLevel,
                    isEmblem: info.isEmblem,
                    slot: String(slotIdx),
                    charId: cId,
                    charName: String(picked[1] || ('Char_' + cId)),
                    charLevel: Number(picked[2]) || 1
                });
            }
        } catch (err) {
            line(`  [!] Gagal cek karakter ${acc.user}: ${err.message}. Fallback ke slot ${isAll ? '1' : acc.slot}.`);
            expanded.push({ ...acc, slot: isAll ? '1' : acc.slot });
        }
    }
    return expanded;
}

function runScriptForAccount(scriptName, args, acc) {
    return new Promise(resolve => {
        const childEnv = Object.assign({}, process.env);
        // Bersihkan sisa variabel karakter dari .char_env.bat agar tidak bocor ke akun lain
        delete childEnv.NS_CHAR_ID;
        delete childEnv.NS_CHAR_NAME;
        delete childEnv.NS_CHAR_LEVEL;
        delete childEnv.NS_CHAR_GENDER;
        delete childEnv.NS_CHAR_SLOT;

        childEnv.NS_USER = acc.user;
        childEnv.NS_PASS = acc.pass;
        childEnv.NS_CHAR_SLOT = String(acc.slot || '1');
        childEnv.NS_TARGET_LEVEL = String(acc.targetLevel || 60);
        if (acc.charId) childEnv.NS_CHAR_ID = String(acc.charId);
        if (acc.charName) childEnv.NS_CHAR_NAME = String(acc.charName);
        if (acc.charLevel) childEnv.NS_CHAR_LEVEL = String(acc.charLevel);

        const scriptPath = path.join(__dirname, scriptName);
        const child = spawn(process.execPath, [scriptPath, ...args], {
            cwd: __dirname,
            env: childEnv,
            stdio: 'inherit',
            windowsHide: true
        });

        child.on('close', code => {
            resolve({ ok: code === 0, code });
        });

        child.on('error', err => {
            resolve({ ok: false, error: err.message });
        });
    });
}

/**
 * Susun antrean secara bergiliran per akun (round-robin) agar akun Emblem
 * yang memiliki >1 karakter diselingi akun lain, sehingga cooldown 20s server
 * per akun terlewati secara alami tanpa menunggu idle.
 */
function interleaveAccounts(list) {
    const groups = new Map();
    for (const acc of list) {
        const key = String(acc.user || '').toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(acc);
    }
    const queues = Array.from(groups.values());
    const ordered = [];
    let added = true;
    while (added) {
        added = false;
        for (const q of queues) {
            if (q.length > 0) {
                ordered.push(q.shift());
                added = true;
            }
        }
    }
    return ordered;
}

async function runBulk(action, extraArgs = [], delaySec = 3) {
    const rawAccounts = loadAccounts();
    if (rawAccounts.length === 0) return;

    const expanded = await expandAccountsIfNeeded(rawAccounts);
    if (expanded.length === 0) return;
    const accounts = interleaveAccounts(expanded);

    let targetScript = 'ns_daily.js';
    let actionLabel = action.toUpperCase();

    switch (action) {
        case 'daily':
        case 'daily_pure':
            targetScript = 'ns_daily.js';
            actionLabel = 'JATAH HARIAN FULL (TP + SS + EUDEMON DRAGON + CLAIM HH TANPA BATTLE)';
            break;
        case 'daily_hh':
            targetScript = 'ns_daily.js';
            actionLabel = 'JATAH HARIAN FULL + BATTLE BOSS HUNTING HOUSE';
            break;
        case 'daily_level':
        case 'full':
            targetScript = 'ns_daily.js';
            actionLabel = 'JATAH HARIAN LENGKAP + AUTO LEVELING / GRADE S';
            break;
        case 'eudemon':
        case 'dragon':
            targetScript = 'ns_hunt.js';
            actionLabel = 'EUDEMON DRAGON SAJA (AUTO 3X EMBLEM / 1X FREE)';
            break;
        case 'house':
        case 'hunting':
            targetScript = 'ns_hunt.js';
            actionLabel = 'HUNTING HOUSE SAJA (AUTO CLAIM + BATTLE BOSS)';
            break;
        case 'claim':
            targetScript = 'ns_hunt.js';
            actionLabel = 'CLAIM DAILY HUNTING HOUSE PASSPORT SAJA (TANPA BATTLE)';
            break;
        case 'hunt_daily':
            targetScript = 'ns_hunt.js';
            actionLabel = 'EUDEMON DRAGON + CLAIM HUNTING HOUSE (TANPA BATTLE HH)';
            break;
        case 'hunt':
        case 'both':
            targetScript = 'ns_hunt.js';
            actionLabel = 'HUNTING HOUSE + EUDEMON DRAGON (BATTLE SEMUA)';
            break;
        case 'train':
            targetScript = 'ns_train.js';
            actionLabel = 'TRAINING TP & SS SAJA';
            break;
        case 'grades':
            targetScript = 'ns_grade_s.js';
            actionLabel = 'MISI GRADE S (AUTO STAMINA RUNNER)';
            break;
        case 'level':
            targetScript = 'ns_level.js';
            actionLabel = 'AUTO GRINDING LEVEL + UJIAN HARD';
            break;
        case 'thanksgiving_battle':
            targetScript = 'ns_thanksgiving.js';
            actionLabel = 'THANKSGIVING BATTLE (HABISKAN HEART)';
            break;
        case 'thanksgiving_minigame':
            targetScript = 'ns_thanksgiving.js';
            actionLabel = 'THANKSGIVING MINI-GAME (HABISKAN AMMO + WEREWOLF)';
            break;
        case 'thanksgiving_full':
            targetScript = 'ns_thanksgiving.js';
            actionLabel = 'THANKSGIVING FULL EVENT (BATTLE + MINI-GAME)';
            break;
        default:
            targetScript = 'ns_daily.js';
            actionLabel = 'JATAH HARIAN FULL (TP + SS + EUDEMON DRAGON + CLAIM HH TANPA BATTLE)';
            break;
    }

    console.log('\n==========================================================');
    console.log('      NINJA SAGA MULTI-ACCOUNT & MULTI-CHAR RUNNER');
    console.log('                cc: MagnetScript(Razki)');
    console.log('==========================================================');
    console.log(`  Total Karakter Antrean: ${accounts.length}`);
    console.log(`  Mode Farming          : ${actionLabel}`);
    console.log(`  Script Target         : ${targetScript}`);
    console.log(`  Jeda Antar Karakter   : ${delaySec} detik`);
    console.log('==========================================================\n');

    const results = [];
    const startTime = Date.now();
    const lastCooldownAnchor = new Map();
    const ACCOUNT_COOLDOWN_MS = 21000;
    const endAnchorActions = new Set(['level', 'daily_level', 'full']);

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accIdx = `[${i + 1}/${accounts.length}]`;
        const userKey = acc.user.toLowerCase();

        // Pastikan cooldown 20s per akun sudah lewat sebelum memulai karakter baru di akun sama
        const prevAnchor = lastCooldownAnchor.get(userKey);
        if (prevAnchor) {
            const elapsed = Date.now() - prevAnchor;
            if (elapsed < ACCOUNT_COOLDOWN_MS) {
                const needWaitMs = ACCOUNT_COOLDOWN_MS - elapsed;
                line(`${accIdx} [Cooldown] Menunggu sisa ${(needWaitMs / 1000).toFixed(1)}s untuk akun ${acc.user}...`);
                await sleep(needWaitMs);
            }
        }

        let scriptArgs = [];
        if (action === 'daily' || action === 'daily_pure') {
            scriptArgs = ['--pure'];
        } else if (action === 'daily_hh') {
            scriptArgs = ['--pure', '--with-hh-battle'];
        } else if (action === 'daily_level' || action === 'full') {
            scriptArgs = acc.targetLevel ? ['--level', String(acc.targetLevel)] : [];
        } else if (action === 'eudemon' || action === 'dragon') {
            scriptArgs = ['eudemon', '10', '10.5'];
        } else if (action === 'house' || action === 'hunting') {
            scriptArgs = ['house', '10', '10.5'];
        } else if (action === 'claim') {
            scriptArgs = ['claim'];
        } else if (action === 'hunt_daily') {
            scriptArgs = ['daily', '10', '10.5'];
        } else if (action === 'hunt' || action === 'both') {
            scriptArgs = ['both', '10', '10.5'];
        } else if (action === 'train') {
            scriptArgs = ['all', '5', '11'];
        } else if (action === 'grades') {
            scriptArgs = ['1-4', '8'];
        } else if (action === 'level') {
            scriptArgs = [String(acc.targetLevel || 60), '8'];
        } else if (action === 'thanksgiving_battle') {
            scriptArgs = ['battle'];
        } else if (action === 'thanksgiving_minigame') {
            scriptArgs = ['minigame'];
        } else if (action === 'thanksgiving_full') {
            scriptArgs = ['full'];
        } else {
            scriptArgs = ['--pure'];
        }

        if (extraArgs.length > 0) scriptArgs = extraArgs;

        const charDesc = acc.charName ? `${acc.charName} (Lv ${acc.charLevel}, Slot ${acc.slot})` : `Slot ${acc.slot}`;
        line(`${accIdx} Memulai: ${acc.user} | Karakter: ${charDesc} | Target: Lv ${acc.targetLevel} ...`);

        const accStart = Date.now();
        let res;
        try {
            res = await runScriptForAccount(targetScript, scriptArgs, acc);
        } catch (e) {
            res = { ok: false, error: e.message };
        }
        // Retry 1x jika gagal (misal timeout jaringan / sesi terputus / cooldown antar karakter)
        if (!res.ok) {
            const retryWaitSec = 21;
            line(`${accIdx} [RETRY] ${acc.user} (${charDesc}) gagal (exit: ${res.code || res.error}). Mencoba ulang setelah ${retryWaitSec}s...`);
            await sleep(retryWaitSec * 1000);
            try {
                res = await runScriptForAccount(targetScript, scriptArgs, acc);
            } catch (e) {
                res = { ok: false, error: e.message };
            }
        }
        const accEnd = Date.now();
        const accDuration = Math.round((accEnd - accStart) / 1000);
        // Catat waktu getCharacterById terakhir agar karakter berikutnya di akun sama hanya menunggu sisa cooldown jika perlu
        const anchorMs = endAnchorActions.has(action) ? accEnd : Math.min(accEnd, accStart + 3500);
        lastCooldownAnchor.set(userKey, anchorMs);

        if (res.ok) {
            line(`${accIdx} SELESAI: ${acc.user} (${charDesc}) (durasi: ${accDuration}s)`);
            results.push({ user: acc.user, slot: acc.slot, charName: acc.charName || '', targetLevel: acc.targetLevel, status: 'SUCCESS', duration: accDuration });
        } else {
            line(`${accIdx} GAGAL: ${acc.user} (${charDesc}) (exit: ${res.code || res.error})`);
            results.push({ user: acc.user, slot: acc.slot, charName: acc.charName || '', targetLevel: acc.targetLevel, status: 'FAILED', code: res.code, error: res.error, duration: accDuration });
        }

        if (i < accounts.length - 1 && delaySec > 0) {
            const nextAcc = accounts[i + 1];
            const nextKey = nextAcc.user.toLowerCase();
            const nextPrevAnchor = lastCooldownAnchor.get(nextKey);
            const nextNeedMs = nextPrevAnchor ? Math.max(0, ACCOUNT_COOLDOWN_MS - (Date.now() - nextPrevAnchor)) : 0;
            // Jika perlu tunggu cooldown untuk akun berikutnya, biarkan cek di awal iterasi menanganinya tanpa dobel tidur
            if (nextNeedMs === 0) {
                line(`Menunggu jeda aman ${delaySec} detik sebelum karakter berikutnya...`);
                await sleep(delaySec * 1000);
            }
        }
    }

    const totalDuration = Math.round((Date.now() - startTime) / 1000);
    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    const failCount = results.filter(r => r.status === 'FAILED').length;

    try {
        fs.writeFileSync(REPORT_FILE, JSON.stringify({
            action,
            actionLabel,
            timestamp: new Date().toISOString(),
            total: accounts.length,
            success: successCount,
            failed: failCount,
            total_duration_sec: totalDuration,
            details: results
        }, null, 2), 'utf8');
    } catch (_) { }

    console.log('\n==========================================================');
    console.log('           LAPORAN RINGKASAN MULTI-ACCOUNT');
    console.log('==========================================================');
    console.log(`  Total Karakter Dikerjakan : ${accounts.length}`);
    console.log(`  Sukses                     : ${successCount}`);
    console.log(`  Gagal                      : ${failCount}`);
    console.log(`  Total Waktu                : ${totalDuration} detik`);
    console.log(`  Log Tersimpan Di           : ${REPORT_FILE}`);
    console.log('----------------------------------------------------------');
    results.forEach((r, idx) => {
        const st = r.status === 'SUCCESS' ? '✓ OK  ' : '✗ GAGAL';
        const cLabel = r.charName ? `Slot ${r.slot} (${r.charName})` : `Slot ${r.slot}`;
        console.log(`  ${idx + 1}. [${st}] ${r.user.padEnd(16)} ${cLabel.padEnd(22)} (${r.duration}s)`);
    });
    console.log('==========================================================\n');
}

async function interactiveMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    const accounts = loadAccounts();
    console.log('\n======================================================================');
    console.log('        NINJA SAGA MULTI-ACCOUNT & MULTI-CHARACTER RUNNER');
    console.log('                    cc: MagnetScript(Razki)');
    console.log('======================================================================');
    console.log(`  File Akun: ${ACCOUNTS_FILE} (${accounts.length} baris konfigurasi terdeteksi)`);
    console.log('  Tips Slot: Gunakan "all" di kolom slot untuk jalankan semua karakter');
    console.log('             pada akun Emblem/Multi-Char, atau "1,2" / baris terpisah.');
    console.log('----------------------------------------------------------------------');
    console.log('  [ PAKET JATAH HARIAN MULTI-AKUN ]');
    console.log('  1. Jatah Harian Full (TP + SS + Eudemon Dragon + Claim HH Tanpa Battle)');
    console.log('  2. Jatah Harian Full + Battle Boss Hunting House');
    console.log('  3. Jatah Harian Lengkap + Auto Leveling / Grade S (Sesuai accounts.txt)');
    console.log('');
    console.log('  [ FARMING SPESIFIK MULTI-AKUN ]');
    console.log('  4. Eudemon Dragon Saja (Auto 3x Emblem / 1x Free per Room)');
    console.log('  5. Hunting House Saja (Auto Claim Daily Passport + Battle Boss)');
    console.log('  6. Claim Daily Hunting House Saja (Tanpa Battle - Ambil 5/10 Tiket)');
    console.log('  7. Training TP & SS Saja');
    console.log('  [ EVENT KHUSUS (THANKSGIVING 2026) ]');
    console.log('  8. Farming Battle Thanksgiving (Sampai Heart Habis)');
    console.log('  9. Farming Mini-game Thanksgiving (Ammo + Werewolf)');
    console.log(' 10. Full Thanksgiving Event (Battle + Mini-game)');
    console.log('');
    console.log('  [ MISI & LEVELING MULTI-AKUN ]');
    console.log(' 11. Misi Grade S Saja (Auto Stamina Runner - Stage 1-4)');
    console.log(' 12. Auto Grinding Level + Ujian Saja (Target level di accounts.txt)');
    console.log('  0. Kembali ke Menu Utama');
    console.log('======================================================================');

    const choice = (await ask('Pilih menu [0-12, Enter = 1] : ')).trim() || '1';
    if (choice === '0') {
        rl.close();
        return;
    }

    const rawDelay = (await ask('Jeda antar karakter dalam detik (default = 3) : ')).trim();
    const parsedDelay = parseInt(rawDelay, 10);
    const delay = Number.isNaN(parsedDelay) ? 3 : Math.max(0, parsedDelay);

    rl.close();
    c.enableGracefulStop('menu multi-account');

    switch (choice) {
        case '1':
            await runBulk('daily_pure', [], delay);
            break;
        case '2':
            await runBulk('daily_hh', [], delay);
            break;
        case '3':
            await runBulk('daily_level', [], delay);
            break;
        case '4':
            await runBulk('eudemon', [], delay);
            break;
        case '5':
            await runBulk('house', [], delay);
            break;
        case '6':
            await runBulk('claim', [], delay);
            break;
        case '7':
            await runBulk('train', [], delay);
            break;
        case '8':
            await runBulk('thanksgiving_battle', [], delay);
            break;
        case '9':
            await runBulk('thanksgiving_minigame', [], delay);
            break;
        case '10':
            await runBulk('thanksgiving_full', [], delay);
            break;
        case '11':
            await runBulk('grades', [], delay);
            break;
        case '12':
            await runBulk('level', [], delay);
            break;
        default:
            console.log('Pilihan tidak valid.');
            break;
    }
}

// ═══════════════════════════════════════════════════════════════
// CLI Dispatcher
// ═══════════════════════════════════════════════════════════════
const args = process.argv.slice(2);
let action = '';
let delaySec = 3;
const cleanArgs = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--delay' && args[i + 1] !== undefined) {
        const parsed = parseInt(args[i + 1], 10);
        delaySec = Number.isNaN(parsed) ? 3 : Math.max(0, parsed);
        i++;
    } else if (!action) {
        action = args[i].toLowerCase();
    } else {
        cleanArgs.push(args[i]);
    }
}

if (require.main === module) {
    (async () => {
        if (action) {
            c.enableGracefulStop('menu multi-account');
            await runBulk(action, cleanArgs, delaySec);
        } else {
            await interactiveMenu();
        }
        process.exit(0);
    })().catch(err => {
        line('FATAL ERROR: ' + (err.message || err));
        process.exit(1);
    });
}

module.exports = { loadAccounts, expandAccountsIfNeeded, interleaveAccounts, runBulk };
