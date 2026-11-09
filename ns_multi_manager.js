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
 * Jika slot berisi 'all' atau '*', login sebentar untuk mengambil jumlah karakter
 * yang ada di akun tersebut agar semua karakter otomatis dijalankan berurutan.
 */
async function expandAccountsIfNeeded(rawAccounts) {
    const expanded = [];
    for (const acc of rawAccounts) {
        const sl = String(acc.slot || '').toLowerCase();
        if (sl === 'all' || sl === '*') {
            line(`Mendeteksi daftar karakter pada akun "${acc.user}"...`);
            try {
                const s = await c.login(acc.user, acc.pass);
                if (!s.ok) {
                    line(`  [!] Login gagal untuk ${acc.user}: ${s.message || s.stage}. Tetap dijadwalkan slot 1.`);
                    expanded.push({ ...acc, slot: '1' });
                    continue;
                }
                const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
                const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
                if (chars.length === 0) {
                    line(`  [!] Tidak ada karakter ditemukan di ${acc.user}.`);
                    continue;
                }
                const isEmblem = Boolean(s.isEmblem || Number(s.accountType) === 2);
                line(`  -> Ditemukan ${chars.length} karakter di akun ${acc.user}${isEmblem ? ' [EMBLEM]' : ' [FREE]'}:`);
                chars.forEach((ch, idx) => {
                    const cName = ch[1] || ('Char_' + ch[0]);
                    const cLv = ch[2] || 1;
                    line(`     Slot ${idx + 1}: ${cName} (Lv ${cLv}, ID: ${ch[0]})`);
                    expanded.push({
                        user: acc.user,
                        pass: acc.pass,
                        targetLevel: acc.targetLevel,
                        slot: String(idx + 1),
                        charId: String(ch[0]),
                        charName: String(cName),
                        charLevel: Number(cLv) || 1
                    });
                });
                await sleep(1000);
            } catch (err) {
                line(`  [!] Gagal cek karakter ${acc.user}: ${err.message}. Fallback ke slot 1.`);
                expanded.push({ ...acc, slot: '1' });
            }
        } else {
            expanded.push(acc);
        }
    }
    return expanded;
}

function runScriptForAccount(scriptName, args, acc) {
    return new Promise(resolve => {
        const childEnv = Object.assign({}, process.env, {
            NS_USER: acc.user,
            NS_PASS: acc.pass,
            NS_CHAR_SLOT: String(acc.slot || '1'),
            NS_TARGET_LEVEL: String(acc.targetLevel || 60)
        });
        if (acc.charId) {
            childEnv.NS_CHAR_ID = String(acc.charId);
        } else {
            delete childEnv.NS_CHAR_ID;
        }

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

async function runBulk(action, extraArgs = [], delaySec = 6) {
    const rawAccounts = loadAccounts();
    if (rawAccounts.length === 0) return;

    const accounts = await expandAccountsIfNeeded(rawAccounts);
    if (accounts.length === 0) return;

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
        case 'halloween':
        case 'event':
            targetScript = 'ns_halloween.js';
            actionLabel = 'HALLOWEEN EVENT BATTLE (AUTO-FARM HEART OF KARI + REWARD)';
            break;
        case 'halloween_loop':
        case 'scheduler':
            targetScript = 'ns_halloween.js';
            actionLabel = 'HALLOWEEN AUTO MATCH SCHEDULER LOOP';
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

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accIdx = `[${i + 1}/${accounts.length}]`;

        let scriptArgs = [];
        if (action === 'daily' || action === 'daily_pure') {
            scriptArgs = ['--pure'];
        } else if (action === 'daily_hh') {
            scriptArgs = ['--pure', '--with-hh-battle'];
        } else if (action === 'daily_level' || action === 'full') {
            scriptArgs = acc.targetLevel ? ['--level', String(acc.targetLevel)] : [];
        } else if (action === 'eudemon' || action === 'dragon') {
            scriptArgs = ['eudemon', '10', '11'];
        } else if (action === 'house' || action === 'hunting') {
            scriptArgs = ['house', '10', '11'];
        } else if (action === 'claim') {
            scriptArgs = ['claim'];
        } else if (action === 'hunt_daily') {
            scriptArgs = ['daily', '10', '11'];
        } else if (action === 'hunt' || action === 'both') {
            scriptArgs = ['both', '10', '11'];
        } else if (action === 'train') {
            scriptArgs = ['all', '5', '15'];
        } else if (action === 'grades') {
            scriptArgs = ['auto', '8'];
        } else if (action === 'level') {
            scriptArgs = [String(acc.targetLevel || 60), '8'];
        } else if (action === 'halloween' || action === 'event') {
            scriptArgs = ['run', '99'];
        } else if (action === 'halloween_loop' || action === 'scheduler') {
            scriptArgs = ['loop'];
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
        const accDuration = Math.round((Date.now() - accStart) / 1000);

        if (res.ok) {
            line(`${accIdx} SELESAI: ${acc.user} (${charDesc}) (durasi: ${accDuration}s)`);
            results.push({ user: acc.user, slot: acc.slot, charName: acc.charName || '', targetLevel: acc.targetLevel, status: 'SUCCESS', duration: accDuration });
        } else {
            line(`${accIdx} GAGAL: ${acc.user} (${charDesc}) (exit: ${res.code || res.error})`);
            results.push({ user: acc.user, slot: acc.slot, charName: acc.charName || '', targetLevel: acc.targetLevel, status: 'FAILED', code: res.code, error: res.error, duration: accDuration });
        }

        if (i < accounts.length - 1) {
            line(`Menunggu jeda aman ${delaySec} detik sebelum karakter berikutnya...`);
            await sleep(delaySec * 1000);
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
    c.enableGracefulStop('menu multi-account');
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
    console.log('  [ EVENT KHUSUS (HALLOWEEN) ]');
    console.log('  8. Auto Halloween Battle Multi-Akun (Cepat & Claim Reward Heart of Kari)');
    console.log('  9. Halloween Scheduler Loop Multi-Akun (Standby Auto Match saat Heart Terisi)');
    console.log('');
    console.log('  [ MISI & LEVELING MULTI-AKUN ]');
    console.log(' 10. Misi Grade S Saja (Auto Stamina Runner - Stage 1-5)');
    console.log(' 11. Auto Grinding Level + Ujian Saja (Target level di accounts.txt)');
    console.log('  0. Kembali ke Menu Utama');
    console.log('======================================================================');

    const choice = (await ask('Pilih menu [0-11, Enter = 1] : ')).trim() || '1';
    if (choice === '0') {
        rl.close();
        return;
    }

    let delay = (await ask('Jeda antar karakter dalam detik (default = 6) : ')).trim();
    delay = parseInt(delay, 10) || 6;

    rl.close();

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
            await runBulk('halloween', [], delay);
            break;
        case '9':
            // Scheduler loop multi-akun langsung panggil runner halloween scheduler
            const hwMod = require('./ns_halloween.js');
            await hwMod.runSchedulerLoop(true, { accountDelay: delay });
            break;
        case '10':
            await runBulk('grades', [], delay);
            break;
        case '11':
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
let delaySec = 6;
const cleanArgs = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--delay' && args[i + 1]) {
        delaySec = parseInt(args[i + 1], 10) || 6;
        i++;
    } else if (!action) {
        action = args[i].toLowerCase();
    } else {
        cleanArgs.push(args[i]);
    }
}

(async () => {
    if (action) {
        await runBulk(action, cleanArgs, delaySec);
    } else {
        await interactiveMenu();
    }
    process.exit(0);
})().catch(err => {
    line('FATAL ERROR: ' + (err.message || err));
    process.exit(1);
});
