#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_multi_manager.js — Ninja Saga Multi-Account Bulk Runner
 *
 * Fitur:
 *   - Membaca daftar akun dari accounts.txt (format: username:password)
 *   - Menjalankan rutinitas harian (daily, hunt, train, event, atau level) untuk semua akun
 *   - Jeda antar akun (delay) untuk menghindari rate limit / deteksi IP
 *   - Melanjutkan ke akun berikutnya jika salah satu akun gagal / error
 *   - Laporan ringkasan di akhir eksekusi (Success / Failed / Skipped)
 *
 * Penggunaan:
 *   node ns_multi_manager.js                   -> Menu interaktif
 *   node ns_multi_manager.js daily             -> Jalankan ns_daily.js untuk semua akun
 *   node ns_multi_manager.js hunt              -> Jalankan ns_hunt.js untuk semua akun
 *   node ns_multi_manager.js train             -> Jalankan ns_train.js (TP+SS) untuk semua akun
 *   node ns_multi_manager.js event             -> Jalankan ns_event.js (Kage+Halloween) untuk semua akun
 *   node ns_multi_manager.js level 60          -> Jalankan ns_level.js target level 60 untuk semua akun
 *   node ns_multi_manager.js daily --delay 15  -> Jeda 15 detik antar akun
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const REPORT_FILE = path.join(__dirname, 'multi_manager_report.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);

function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        console.log('\n[!] File "accounts.txt" belum ditemukan!');
        console.log('    Salin file "accounts.example.txt" menjadi "accounts.txt"');
        console.log('    lalu isi daftar akun kamu dengan format: username:password\n');
        return [];
    }
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    const accounts = [];
    const lines = raw.split(/\r?\n/);
    for (const l of lines) {
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
        if (user && pass) {
            accounts.push({ user, pass });
        }
    }
    return accounts;
}

function runScriptForAccount(scriptName, args, user, pass) {
    return new Promise(resolve => {
        const childEnv = Object.assign({}, process.env, {
            NS_USER: user,
            NS_PASS: pass
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
    let scriptArgs = [];

    switch (action) {
        case 'hunt':
            targetScript = 'ns_hunt.js';
            scriptArgs = ['run', '10', '20'];
            break;
        case 'train':
            targetScript = 'ns_train.js';
            scriptArgs = ['all', '5', '15'];
            break;
        case 'event':
            targetScript = 'ns_event.js';
            scriptArgs = ['all', '15'];
            break;
        case 'level':
            targetScript = 'ns_level.js';
            scriptArgs = extraArgs.length > 0 ? extraArgs : ['60', '10'];
            break;
        case 'daily':
        default:
            targetScript = 'ns_daily.js';
            scriptArgs = extraArgs.length > 0 ? extraArgs : [];
            break;
    }

    console.log('\n==========================================================');
    console.log('         NINJA SAGA MULTI-ACCOUNT RUNNER');
    console.log('         cc: MagnetScript(Razki)');
    console.log('==========================================================');
    console.log(`  Total Akun Terdaftar : ${accounts.length}`);
    console.log(`  Aksi                 : ${action.toUpperCase()} (${targetScript})`);
    console.log(`  Parameter            : ${scriptArgs.join(' ') || '(default)'}`);
    console.log(`  Jeda Antar Akun      : ${delaySec} detik`);
    console.log('==========================================================\n');

    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accIdx = `[${i + 1}/${accounts.length}]`;
        line(`${accIdx} Memulai akun: ${acc.user} ...`);

        const accStart = Date.now();
        let res;
        try {
            res = await runScriptForAccount(targetScript, scriptArgs, acc.user, acc.pass);
        } catch (e) {
            res = { ok: false, error: e.message };
        }
        const accDuration = Math.round((Date.now() - accStart) / 1000);

        if (res.ok) {
            line(`${accIdx} SELESAI: ${acc.user} (durasi: ${accDuration}s)`);
            results.push({ user: acc.user, status: 'SUCCESS', duration: accDuration });
        } else {
            line(`${accIdx} GAGAL: ${acc.user} (exit: ${res.code || res.error})`);
            results.push({ user: acc.user, status: 'FAILED', code: res.code, error: res.error, duration: accDuration });
        }

        if (i < accounts.length - 1) {
            line(`Menunggu ${delaySec} detik sebelum beralih ke akun berikutnya...`);
            await sleep(delaySec * 1000);
        }
    }

    const totalDuration = Math.round((Date.now() - startTime) / 1000);
    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    const failCount = results.filter(r => r.status === 'FAILED').length;

    // Simpan laporan ringkasan
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
    console.log(`  Total Akun Dikerjakan : ${accounts.length}`);
    console.log(`  Sukses                : ${successCount}`);
    console.log(`  Gagal                 : ${failCount}`);
    console.log(`  Total Waktu           : ${totalDuration} detik`);
    console.log(`  Log Tersimpan Di      : ${REPORT_FILE}`);
    console.log('----------------------------------------------------------');
    results.forEach((r, idx) => {
        const st = r.status === 'SUCCESS' ? '✓ OK  ' : '✗ GAGAL';
        console.log(`  ${idx + 1}. [${st}] ${r.user.padEnd(20)} (${r.duration}s)`);
    });
    console.log('==========================================================\n');
}

async function interactiveMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    const accounts = loadAccounts();
    console.log('\n==========================================================');
    console.log('         NINJA SAGA MULTI-ACCOUNT BULK RUNNER');
    console.log('         cc: MagnetScript(Razki)');
    console.log('==========================================================');
    console.log(`  File Akun: ${ACCOUNTS_FILE} (${accounts.length} akun terdeteksi)`);
    console.log('----------------------------------------------------------');
    console.log('  1. Daily Routine (TP, SS, Hunting, Event, Misi Level)');
    console.log('  2. Hunting House (Semua Room Boss)');
    console.log('  3. Training TP & SS Saja');
    console.log('  4. Event Battle (Kage & Halloween)');
    console.log('  5. Auto Grind Level (Target Misi Tertinggi)');
    console.log('  0. Kembali / Keluar');
    console.log('==========================================================');

    const choice = (await ask('Pilih menu (0-5) : ')).trim();
    if (choice === '0') {
        rl.close();
        return;
    }

    let delay = (await ask('Jeda antar akun dalam detik (default = 10) : ')).trim();
    delay = parseInt(delay, 10) || 10;

    rl.close();

    switch (choice) {
        case '1':
            await runBulk('daily', [], delay);
            break;
        case '2':
            await runBulk('hunt', [], delay);
            break;
        case '3':
            await runBulk('train', [], delay);
            break;
        case '4':
            await runBulk('event', [], delay);
            break;
        case '5':
            await runBulk('level', ['60', '8'], delay);
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
