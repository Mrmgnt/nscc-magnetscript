#!/usr/bin/env node
/**
 * cc: MagnetScript(Razki)
 *
 * ns_daily.js — Satu script untuk semua jatah harian NinjaSaga + Auto Claim Login Harian.
 *
 * Penggunaan:
 *   NS_USER=... NS_PASS=... node ns_daily.js                   # Login Claim + Claim HH + Eudemon Dragon + TP & SS (+ Grade S jika Lv>=80)
 *   NS_USER=... NS_PASS=... node ns_daily.js --pure            # Murni: Login Claim + Claim HH (tanpa battle HH) + Eudemon Dragon + TP + SS
 *   NS_USER=... NS_PASS=... node ns_daily.js --only-login-claim # Khusus Absen + Calendar + Scratch Gratis + Claim Token Harian saja
 *   NS_USER=... NS_PASS=... node ns_daily.js --with-hh-battle  # Tambah battle Boss Hunting House juga
 *   NS_USER=... NS_PASS=... node ns_daily.js --with-thanksgiving-battle    # Tambah event battle Thanksgiving
 *   NS_USER=... NS_PASS=... node ns_daily.js --with-thanksgiving-minigame  # Tambah mini-game Thanksgiving
 *   NS_USER=... NS_PASS=... node ns_daily.js --with-thanksgiving-full      # Tambah battle + mini-game Thanksgiving
 *   NS_USER=... NS_PASS=... node ns_daily.js --pure --with-thanksgiving-full --loop-event # Full Automate + Loop Event tiap 15m
 *   NS_USER=... NS_PASS=... node ns_daily.js --level 85        # Tambah auto misi/ujian ke target level
 *
 * Urutan Jatah Harian:
 *   0. Full Auto Claim Daily Login (Absen 5 Hari + Daily Calendar + Free Scratch Card + Claim Token Harian & Lucky Spin)
 *   1. Daily Claim Hunting House + Eudemon Dragon (3x per room untuk Emblem, 1x untuk Free)
 *   2. Daily TP Training + SS Training
 *   3. Opsional: Thanksgiving Event (Battle + Werewolf) / Battle Hunting House / Grade S / Auto Leveling
 */
'use strict';
const { spawn } = require('child_process');
const line = s => console.log(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = __dirname;
const c = require('./nsclient.js');
const { getLocalDateStr } = require('./lib/ns_mission_history.js');
const { runDailyLoginSession } = require('./ns_daily_login.js');
const { runHuntSession } = require('./ns_hunt.js');
const { runTrainSession } = require('./ns_train.js');
const { runGradeSSession } = require('./ns_grade_s.js');
const { runThanksgivingSession, formatTime } = require('./ns_thanksgiving.js');

const argv = process.argv.slice(2);
const iLv = argv.indexOf('--level');
const targetLevel = iLv >= 0 ? Number(argv[iLv + 1] || 0) : (process.env.NS_TARGET_LEVEL ? Number(process.env.NS_TARGET_LEVEL) : 0);
const iInt = argv.indexOf('--interval-min');
const intervalMin = iInt >= 0 ? Math.max(1, Number(argv[iInt + 1] || 15)) : 15;
const isPureDaily = argv.includes('--pure');
const withHhBattle = argv.includes('--with-hh-battle');
const skipLoginClaim = argv.includes('--no-login-claim');
const onlyLoginClaim = argv.includes('--only-login-claim');
const noEmblemLevelUp = argv.includes('--no-emblem-levelup');
const loopEvent = argv.includes('--loop-event') || argv.includes('--loop');
const thanksgivingMode = argv.includes('--with-thanksgiving-full') ? 'full'
    : argv.includes('--with-thanksgiving-battle') ? 'battle'
        : argv.includes('--with-thanksgiving-minigame') ? 'minigame'
            : (loopEvent ? 'full' : '');

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

async function runFullDailyOnce() {
    const shared = {
        user: process.env.NS_USER,
        pass: process.env.NS_PASS
    };
    const hasil = [];

    if (!skipLoginClaim || onlyLoginClaim) {
        const loginTitle = 'Daily: Absen + Calendar + Scratch + Token';
        line('');
        line('################ ' + loginTitle + ' ################');
        const loginRes = await runDailyLoginSession({
            shared,
            claimEmblemLevelUp: !noEmblemLevelUp
        });
        hasil.push([loginTitle, loginRes.exitCode, loginRes.kredit || 0, loginRes.summary || '']);

        if (loginRes.exitCode !== 0 || !shared.s || !shared.st || !shared.ex) {
            line('');
            line('################ RINGKASAN HARIAN ################');
            for (const [nama, kode, kredit, alasan] of hasil) {
                line('  ' + nama.padEnd(42) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | sukses/reward: ' + kredit + (alasan ? ' | ' + alasan : ''));
            }
            return { ok: false, hasil };
        }

        if (onlyLoginClaim) {
            line('');
            line('################ RINGKASAN LOGIN HARIAN ################');
            for (const [nama, kode, kredit, alasan] of hasil) {
                line('  ' + nama.padEnd(42) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | sukses/reward: ' + kredit + (alasan ? ' | ' + alasan : ''));
            }
            return { ok: true, hasil };
        }
        await sleep(50);
    }

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
            line('  ' + nama.padEnd(42) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | sukses/reward: ' + kredit + (alasan ? ' | ' + alasan : ''));
        }
        return { ok: false, hasil };
    }

    await sleep(50);

    const trainTitle = 'Daily: TP & SS Training';
    line('');
    line('################ ' + trainTitle + ' ################');
    const trainRes = await runTrainSession({ mode: 'all', maks: 5, jeda: 3, shared });
    hasil.push([trainTitle, trainRes.exitCode, trainRes.kredit || 0, trainRes.exitCode === 0 ? 'Selesai' : 'Ada kegagalan']);

    if (thanksgivingMode) {
        const eventTitle = 'Thanksgiving Event: ' + thanksgivingMode;
        line('');
        line('################ ' + eventTitle + ' ################');
        const eventRes = await runThanksgivingSession({ mode: thanksgivingMode, shared });
        hasil.push([eventTitle, eventRes.exitCode, eventRes.kredit || 0, eventRes.summary || '']);
    }

    if (!isPureDaily) {
        const charLevel = Number(shared.st.level || 1);
        const charRank = Number(shared.st.rank || 1);

        if (charLevel >= 80) {
            await sleep(50);
            const gsTitle = 'Daily: Misi Grade S (Map 1-4)';
            line('');
            line('################ ' + gsTitle + ' ################');
            const gsRes = await runGradeSSession({ target: '1-4', jeda: 11, shared });
            const gsSummary = `Grade S ${gsRes.battles || 0}x` + (gsRes.totalTokensWon > 0 ? ` (+${gsRes.totalTokensWon} Token)` : '');
            hasil.push([gsTitle, gsRes.exitCode, gsRes.battles || 0, gsSummary]);
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
            lvCmd = [process.execPath, 'ns_level.js', String(targetLevel || charLevel), '3'];
        } else if (targetLevel && targetLevel > charLevel) {
            lvTitle = 'Auto Leveling ke ' + targetLevel;
            lvCmd = [process.execPath, 'ns_level.js', String(targetLevel), '3'];
        }

        if (lvCmd) {
            await sleep(100);
            line('');
            line('################ ' + lvTitle + ' ################');
            const r = await runTahap(lvCmd);
            hasil.push([lvTitle, r.status, angka(r.stdout), sebab(r.stdout)]);
        }
    }

    line('');
    line('################ RINGKASAN HARIAN ################');
    for (const [nama, kode, kredit, alasan] of hasil) {
        line('  ' + nama.padEnd(42) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | sukses/reward: ' + kredit + (alasan ? ' | ' + alasan : ''));
    }
    line('');
    line('Catatan: Absen/Kalender/Scratch/Token/TP/SS 1x per hari; Eudemon 3x/room (Emblem) atau 1x/room (Free).');
    return { ok: hasil.every(h => h[1] === 0), hasil };
}

async function waitIntervalMinutes(minutes) {
    const waitSec = Math.max(60, Math.round(minutes * 60));
    const ts = () => '[' + new Date().toTimeString().slice(0, 8) + '] ';
    console.log(`\n${ts()}[AUTO-LOOP] Energi Event (Heart & Bullet Werewolf) habis. Menunggu ${minutes} menit (${formatTime(waitSec)}) sebelum cek & run ulang...`);
    console.log(`${ts()}[AUTO-LOOP] Tekan [Q] atau [Ctrl+C] kapan saja untuk kembali ke menu.`);
    let remain = waitSec;
    while (remain > 0) {
        const step = Math.min(30, remain);
        await sleep(step * 1000);
        remain -= step;
        if (remain > 0) {
            console.log(`${ts()}[STANDBY] Cek ulang Event dalam ${formatTime(remain)}...`);
        }
    }
}

(async () => {
    c.enableGracefulStop('menu bot');
    let lastDailyDate = getLocalDateStr();
    const firstRun = await runFullDailyOnce();
    if (!loopEvent) {
        process.exit(firstRun.ok ? 0 : 1);
    }

    const evMode = thanksgivingMode || 'full';
    let cycle = 2;
    while (true) {
        await waitIntervalMinutes(intervalMin);
        const today = getLocalDateStr();
        if (today !== lastDailyDate) {
            line(`\n=== [AUTO-LOOP PUTARAN #${cycle}] HARI BARU TERDETEKSI (${today}) -> JALANKAN ULANG FULL DAILY + EVENT ===`);
            await runFullDailyOnce();
            lastDailyDate = today;
        } else {
            line(`\n=== [AUTO-LOOP PUTARAN #${cycle}] CEK & JALANKAN EVENT THANKSGIVING (${evMode}: Battle + Wolf Mini-game) ===`);
            const evRes = await runThanksgivingSession({
                mode: evMode,
                shared: { user: process.env.NS_USER, pass: process.env.NS_PASS }
            });
            line(`  -> Ringkasan Putaran #${cycle}: ${evRes.summary || '-'} (exit ${evRes.exitCode})`);
        }
        cycle++;
    }
})().catch(e => {
    line('FATAL ' + (e.message || e));
    process.exit(1);
});
