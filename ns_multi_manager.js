#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_multi_manager.js — Ninja Saga Multi-Account & Multi-Character Runner
 *
 * Fitur:
 *   - Membaca daftar akun dari accounts.txt dengan format:
 *       username:password:targetLevel:characterSlot
 *     Contoh:
 *       akun1:pass1:60:1   (Akun 1, karakter slot 1, target Lv 60)
 *       akun1:pass1:40:2   (Akun 1, karakter slot 2, target Lv 40)
 *       akun2:pass2:80:1   (Akun 2, karakter slot 1, target Lv 80)
 *       akun3:pass3:100:1  (Akun 3, karakter slot 1, target Lv 100)
 *   - Menjalankan seluruh rutinitas otomatis secara sekuensial (bergantian):
 *       Daily Routine, Event, Hunting House, SS/TP, dan Auto Leveling
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
        const separator = trimmed.includes(':') ? ':' : (trimmed.includes(',') ? ',' : null);
        if (!separator) continue;
        const parts = trimmed.split(separator).map(s => s.trim());
        const user = parts[0] || '';
        const pass = parts[1] || '';
        const targetLevel = parts[2] ? parseInt(parts[2], 10) : 60;
        const slot = parts[3] || '1'; // default slot 1
        if (user && pass) {
            accounts.push({ user, pass, targetLevel: isNaN(targetLevel) ? 60 : targetLevel, slot });
        }
    }
    return accounts;
}

function runScriptForAccount(scriptName, args, acc) {
    return new Promise(resolve => {
        const childEnv = Object.assign({}, process.env, {
            NS_USER: acc.user,
            NS_PASS: acc.pass,
            NS_CHAR_SLOT: String(acc.slot || '1'),
            NS_TARGET_LEVEL: String(acc.targetLevel || 60)
        });

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

async function runBulk(action, extraArgs = [], delaySec = 10) {
    const accounts = loadAccounts();
    if (accounts.length === 0) return;

    let targetScript = 'ns_daily.js';

    switch (action) {
        case 'hunt':
            targetScript = 'ns_hunt.js';
            break;
        case 'train':
            targetScript = 'ns_train.js';
            break;
        case 'event':
            targetScript = 'ns_event.js';
            break;
        case 'grades':
            targetScript = 'ns_grade_s.js';
            break;
        case 'level':
            targetScript = 'ns_level.js';
            break;
        case 'daily':
        default:
            targetScript = 'ns_daily.js';
            break;
    }

    console.log('\n==========================================================');
    console.log('      NINJA SAGA MULTI-ACCOUNT & MULTI-CHAR RUNNER');
    console.log('                cc: MagnetScript(Razki)');
    console.log('==========================================================');
    console.log(`  Total Entri Terdaftar : ${accounts.length}`);
    console.log(`  Aksi                  : ${action.toUpperCase()} (${targetScript})`);
    console.log(`  Jeda Antar Karakter   : ${delaySec} detik`);
    console.log('==========================================================\n');

    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accIdx = `[${i + 1}/${accounts.length}]`;
        
        let scriptArgs = [];
        if (action === 'daily') {
            scriptArgs = acc.targetLevel ? ['--level', String(acc.targetLevel)] : [];
        } else if (action === 'level') {
            scriptArgs = [String(acc.targetLevel || 60), '8'];
        } else if (action === 'grades') {
            scriptArgs = ['all', '8'];
        } else if (action === 'hunt') {
            scriptArgs = ['run', '10', '20'];
        } else if (action === 'train') {
            scriptArgs = ['all', '5', '15'];
        } else if (action === 'event') {
            scriptArgs = ['all', '15'];
        }
        if (extraArgs.length > 0) scriptArgs = extraArgs;

        line(`${accIdx} Memulai: ${acc.user} | Char Slot: ${acc.slot} | Target: Lv ${acc.targetLevel} ...`);

        const accStart = Date.now();
        let res;
        try {
            res = await runScriptForAccount(targetScript, scriptArgs, acc);
        } catch (e) {
            res = { ok: false, error: e.message };
        }
        const accDuration = Math.round((Date.now() - accStart) / 1000);

        if (res.ok) {
            line(`${accIdx} SELESAI: ${acc.user} (Slot ${acc.slot}) (durasi: ${accDuration}s)`);
            results.push({ user: acc.user, slot: acc.slot, targetLevel: acc.targetLevel, status: 'SUCCESS', duration: accDuration });
        } else {
            line(`${accIdx} GAGAL: ${acc.user} (Slot ${acc.slot}) (exit: ${res.code || res.error})`);
            results.push({ user: acc.user, slot: acc.slot, targetLevel: acc.targetLevel, status: 'FAILED', code: res.code, error: res.error, duration: accDuration });
        }

        if (i < accounts.length - 1) {
            line(`Menunggu jeda aman ${delaySec} detik sebelum karakter berikutnya...`);
            await sleep(delaySec * 1000);
        }
    }

    const totalDuration = Math.round((Date.now() - startTime) / 1000);
    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    const failCount = results.filter(r => r.status === 'FAILED').length;

    // Simpan laporan ringkasan ke JSON
    try {
        fs.writeFileSync(REPORT_FILE, JSON.stringify({
            action,
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
        console.log(`  ${idx + 1}. [${st}] ${r.user.padEnd(16)} Slot ${r.slot} (Target Lv ${r.targetLevel}) (${r.duration}s)`);
    });
    console.log('==========================================================\n');
}

async function interactiveMenu() {
    c.enableGracefulStop('menu multi-account');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    const accounts = loadAccounts();
    console.log('\n==========================================================');
    console.log('      NINJA SAGA MULTI-ACCOUNT & MULTI-CHAR RUNNER');
    console.log('                cc: MagnetScript(Razki)');
    console.log('==========================================================');
    console.log(`  File Akun: ${ACCOUNTS_FILE} (${accounts.length} entri terdeteksi)`);
    console.log('----------------------------------------------------------');
    console.log('  1. Daily Complete + Auto Leveling (Sesuai target di accounts.txt)');
    console.log('  2. Auto Grinding Level Saja (Target level di accounts.txt)');
    console.log('  3. Misi Grade S (Auto Stamina Runner - Stage 1-5)');
    console.log('  4. Hunting House (Semua Room Boss)');
    console.log('  5. Training TP & SS Saja');
    console.log('  6. Event Battle (Kage & Halloween)');
    console.log('  0. Kembali ke Menu Utama');
    console.log('==========================================================');

    const choice = (await ask('Pilih menu [0-6] : ')).trim();
    if (choice === '0' || !choice) {
        rl.close();
        return;
    }

    let delay = (await ask('Jeda antar karakter dalam detik (default = 10) : ')).trim();
    delay = parseInt(delay, 10) || 10;

    rl.close();

    switch (choice) {
        case '1':
            await runBulk('daily', [], delay);
            break;
        case '2':
            await runBulk('level', [], delay);
            break;
        case '3':
            await runBulk('grades', [], delay);
            break;
        case '4':
            await runBulk('hunt', [], delay);
            break;
        case '5':
            await runBulk('train', [], delay);
            break;
        case '6':
            await runBulk('event', [], delay);
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
let delaySec = 10;
const cleanArgs = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--delay' && args[i + 1]) {
        delaySec = parseInt(args[i + 1], 10) || 10;
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
