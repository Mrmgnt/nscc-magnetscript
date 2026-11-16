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
const { runHuntSession } = require('./ns_hunt.js');
const { runTrainSession } = require('./ns_train.js');
const { runGradeSSession } = require('./ns_grade_s.js');

const argv = process.argv.slice(2);
const iLv = argv.indexOf('--level');
const targetLevel = iLv >= 0 ? Number(argv[iLv + 1] || 0) : (process.env.NS_TARGET_LEVEL ? Number(process.env.NS_TARGET_LEVEL) : 0);
const isPureDaily = argv.includes('--pure');
const withHhBattle = argv.includes('--with-hh-battle');

if (!process.env.NS_USER || !process.env.NS_PASS) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }

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
    const penting = baris.filter(b => /^(Catatan|STOP|ERROR|RINGKASAN|Ringkasan|\[OK\]|\[INFO\]|PERINGATAN|SS Training sudah|TP Training membutuhkan|semua misi|mode misi-saja|LOGIN GAGAL)/.test(b.trim()));
    return penting.length ? penting[penting.length - 1].trim().slice(0, 120) : '';
}

(async () => {
    c.enableGracefulStop('menu bot');
    const shared = {
        user: process.env.NS_USER,
        pass: process.env.NS_PASS
    };
    const hasil = [];

    const huntMode = withHhBattle ? 'both' : 'daily';
    const huntTitle = withHhBattle
        ? 'Daily: Claim & Battle HH + Eudemon Dragon'
        : 'Daily: Claim HH + Eudemon Dragon';
    line('');
    line('################ ' + huntTitle + ' ################');
    const huntRes = await runHuntSession({ mode: huntMode, maks: 10, jeda: 10.5, shared });
    hasil.push([huntTitle, huntRes.exitCode, huntRes.kredit || 0, huntRes.summary || '']);

    // Jika sesi utama (login / char) gagal, langsung hentikan tahap berikutnya
    if (!shared.s || !shared.st || !shared.ex) {
        line('');
        line('################ RINGKASAN HARIAN ################');
        for (const [nama, kode, kredit, alasan] of hasil) {
            line('  ' + nama.padEnd(38) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | sukses/reward: ' + kredit + (alasan ? ' | ' + alasan : ''));
        }
        process.exit(1);
    }

    await sleep(300);

    const trainTitle = 'Daily: TP & SS Training';
    line('');
    line('################ ' + trainTitle + ' ################');
    const trainRes = await runTrainSession({ mode: 'all', maks: 5, jeda: 11, shared });
    hasil.push([trainTitle, trainRes.exitCode, trainRes.kredit || 0, trainRes.exitCode === 0 ? 'Selesai' : 'Ada kegagalan']);

    if (!isPureDaily) {
        const charLevel = Number(shared.st.level || 1);
        const charRank = Number(shared.st.rank || 1);

        if (charLevel >= 80) {
            await sleep(300);
            const gsTitle = 'Daily: Misi Grade S (Map 1-4)';
            line('');
            line('################ ' + gsTitle + ' ################');
            const gsRes = await runGradeSSession({ target: '1-4', jeda: 8, shared });
            hasil.push([gsTitle, gsRes.exitCode, gsRes.battles || 0, `Grade S ${gsRes.battles || 0}x`]);
        }

        let butuhUjianNama = '';
        if (charLevel >= 80 && charRank < 8) butuhUjianNama = 'Ujian Sennin / Tutor (Lv 80 Cap)';
        else if (charLevel >= 60 && charRank < 6) butuhUjianNama = 'Ujian Special Jounin (Lv 60 Cap)';
        else if (charLevel >= 40 && charRank < 4) butuhUjianNama = 'Ujian Jounin (Lv 40 Cap)';
        else if (charLevel >= 20 && charRank < 2) butuhUjianNama = 'Ujian Chunin (Lv 20 Cap)';

        let lvCmd = null;
        let lvTitle = '';
        if (butuhUjianNama) {
            lvTitle = 'Auto Exam: ' + butuhUjianNama;
            lvCmd = [process.execPath, 'ns_level.js', String(targetLevel || charLevel), '8'];
        } else if (targetLevel && targetLevel > charLevel) {
            lvTitle = 'Auto Leveling ke ' + targetLevel;
            lvCmd = [process.execPath, 'ns_level.js', String(targetLevel), '8'];
        }

        if (lvCmd) {
            await sleep(500);
            line('');
            line('################ ' + lvTitle + ' ################');
            const r = await runTahap(lvCmd);
            hasil.push([lvTitle, r.status, angka(r.stdout), sebab(r.stdout)]);
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
