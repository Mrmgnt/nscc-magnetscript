#!/usr/bin/env node
/**
 * cc: MagnetScript(Razki)
 *
 * ns_daily.js — Satu script untuk semua jatah harian NinjaSaga.
 *
 * Penggunaan:
 *   NS_USER=... NS_PASS=... node ns_daily.js                   # Claim HH + Eudemon Dragon + TP & SS (+ Grade S jika Lv>=80)
 *   NS_USER=... NS_PASS=... node ns_daily.js --pure            # Murni: Claim HH (tanpa battle HH) + Eudemon Dragon + TP + SS
 *   NS_USER=... NS_PASS=... node ns_daily.js --with-hh-battle  # Tambah battle Boss Hunting House juga
 *   NS_USER=... NS_PASS=... node ns_daily.js --level 85        # Tambah auto misi/ujian ke target level
 *
 * Urutan Jatah Harian:
 *   1. Daily Claim Hunting House + Eudemon Dragon (3x per room untuk Emblem, 1x untuk Free)
 *   2. Daily TP Training + SS Training
 *   3. Opsional: Battle Hunting House / Grade S / Auto Leveling
 */
'use strict';
const { spawn } = require('child_process');
const line = s => console.log(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = __dirname;
const c = require('./nsclient.js');

const argv = process.argv.slice(2);
const iLv = argv.indexOf('--level');
const targetLevel = iLv >= 0 ? Number(argv[iLv + 1] || 0) : (process.env.NS_TARGET_LEVEL ? Number(process.env.NS_TARGET_LEVEL) : 0);
const isPureDaily = argv.includes('--pure');
const withHhBattle = argv.includes('--with-hh-battle');

if (!process.env.NS_USER || !process.env.NS_PASS) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }

async function bangunDaftarTahap() {
    const huntMode = withHhBattle ? 'both' : 'daily';
    const huntTitle = withHhBattle
        ? 'Daily: Claim & Battle HH + Eudemon Dragon'
        : 'Daily: Claim HH + Eudemon Dragon';

    const list = [
        [huntTitle, [process.execPath, 'ns_hunt.js', huntMode, '10', '11']],
        ['Daily: TP & SS Training', [process.execPath, 'ns_train.js', 'all', '5', '15']]
    ];

    if (isPureDaily) {
        return list;
    }

    // Cek profil karakter untuk evaluasi Ujian (Lv 20, 40, 60, 80) & Grade S
    let charLevel = Number(process.env.NS_CHAR_LEVEL || 1);
    let charRank = 1;
    try {
        const u = process.env.NS_USER, p = process.env.NS_PASS;
        const s = await c.login(u, p);
        if (s && s.sessionKey) {
            const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
            const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
            const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
            if (row) {
                charLevel = Number(row[2] || 1);
                charRank = Number(row[3] || 1);
            }
        }
    } catch (_) { }

    if (charLevel >= 80) {
        list.push(['Daily: Misi Grade S', [process.execPath, 'ns_grade_s.js', '5']]);
    }

    let butuhUjianNama = '';
    if (charLevel >= 80 && charRank < 8) butuhUjianNama = 'Ujian Sennin / Tutor (Lv 80 Cap)';
    else if (charLevel >= 60 && charRank < 6) butuhUjianNama = 'Ujian Special Jounin (Lv 60 Cap)';
    else if (charLevel >= 40 && charRank < 4) butuhUjianNama = 'Ujian Jounin (Lv 40 Cap)';
    else if (charLevel >= 20 && charRank < 2) butuhUjianNama = 'Ujian Chunin (Lv 20 Cap)';

    if (butuhUjianNama) {
        list.push(['Auto Exam: ' + butuhUjianNama, [process.execPath, 'ns_level.js', String(targetLevel || charLevel), '8']]);
    } else if (targetLevel && targetLevel > charLevel) {
        list.push(['Auto Leveling ke ' + targetLevel, [process.execPath, 'ns_level.js', String(targetLevel), '8']]);
    }

    return list;
}

function runTahap(cmd) {
    return new Promise(resolve => {
        let stdout = '';
        let stderr = '';
        const child = spawn(cmd[0], cmd.slice(1), {
            cwd: dir,
            env: process.env,
            windowsHide: true
        });

        child.stdout.on('data', chunk => {
            const str = chunk.toString();
            stdout += str;
            process.stdout.write(str);
        });

        child.stderr.on('data', chunk => {
            const str = chunk.toString();
            stderr += str;
            if (!/tput|tcsetattr|Inappropriate ioctl/i.test(str)) {
                process.stderr.write(str);
            }
        });

        child.on('close', code => {
            resolve({ status: code || 0, stdout, stderr });
        });

        child.on('error', err => {
            resolve({ status: 1, stdout, stderr: err.message });
        });
    });
}

function angka(out) {
    let total = 0;
    const mBattles = out.matchAll(/(\d+)\/(\d+)\s+battle sukses/g);
    for (const m of mBattles) total += Number(m[1] || 0);
    const mKredit = out.matchAll(/(\d+)\s+benar-benar dikreditkan/g);
    for (const m of mKredit) total += Number(m[1] || 0);
    if (/Berhasil klaim Daily Hunting Passport/i.test(out)) total += 1;
    if (total > 0) return total;
    const k = out.match(/KREDIT|MENANG!/g);
    return k ? k.length : 0;
}

function sebab(out) {
    const baris = out.split(/\r?\n/).filter(Boolean);
    const penting = baris.filter(b => /^(Catatan|STOP|RINGKASAN|Ringkasan|\[OK\]|\[INFO\]|PERINGATAN|SS Training sudah|semua misi|mode misi-saja|LOGIN GAGAL)/.test(b.trim()));
    return penting.length ? penting[penting.length - 1].trim().slice(0, 120) : '';
}

(async () => {
    c.enableGracefulStop('menu bot');
    const tahap = await bangunDaftarTahap();
    const hasil = [];
    for (let idx = 0; idx < tahap.length; idx++) {
        const [nama, cmd] = tahap[idx];
        line('');
        line('################ ' + nama + ' ################');
        const r = await runTahap(cmd);
        hasil.push([nama, r.status, angka(r.stdout), sebab(r.stdout)]);
        if (idx < tahap.length - 1) {
            await sleep(2000);
        }
    }

    line('');
    line('################ RINGKASAN HARIAN ################');
    for (const [nama, kode, kredit, alasan] of hasil) {
        line('  ' + nama.padEnd(38) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | sukses/reward: ' + kredit + (alasan ? ' | ' + alasan : ''));
    }
    line('');
    line('Catatan: TP/SS dibatasi server 1x per hari, Eudemon Dragon 3x/room (Emblem) atau 1x/room (Free).');
    process.exit(hasil.every(h => h[1] === 0) ? 0 : 1);
})().catch(e => {
    line('FATAL ' + (e.message || e));
    process.exit(1);
});
