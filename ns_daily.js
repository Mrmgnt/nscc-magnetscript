#!/usr/bin/env node
/**
 * cc: MagnetScript(Razki)
 *
 * ns_daily.js — satu script untuk semua jatah harian NinjaSaga.
 *
 *   NS_USER=... NS_PASS=... node ns_daily.js            # event + daily + hunting
 *   NS_USER=... NS_PASS=... node ns_daily.js --level 80 # tambah auto misi/ujian ke 80
 *
 * Urutan (sesuai permintaan user):
 *   1. Special event  : Kage Apprenticeship (sampai energy habis) -> Halloween (sampai heart habis)
 *   2. Daily mission  : TP Training -> SS Training -> Hunting House
 *   3. Auto misi      : misi level tertinggi + ujian (kalau --level diisi)
 *
 * Tiap tahap jalan sebagai proses terpisah supaya satu gagal tidak mematikan yang lain.
 * Output anak ditangkap lalu dicetak, sehingga ringkasan bisa menunjukkan berapa reward
 * yang BENAR-BENAR masuk (bukan cuma "exit 0").
 */
'use strict';
const { spawn, spawnSync } = require('child_process');
const line = s => console.log(s);
const dir = __dirname;
const c = require('./nsclient.js');

const argv = process.argv.slice(2);
const iLv = argv.indexOf('--level');
const targetLevel = iLv >= 0 ? Number(argv[iLv + 1] || 0) : (process.env.NS_TARGET_LEVEL ? Number(process.env.NS_TARGET_LEVEL) : 0);

if (!process.env.NS_USER || !process.env.NS_PASS) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }

async function bangunDaftarTahap() {
    const list = [
        ['Special Event: Kage', ['node', 'ns_event.js', 'kage', '20']],
        ['Special Event: Halloween', ['node', 'ns_event.js', 'halloween', '10']],
        ['Daily: TP Training', ['node', 'ns_train.js', 'tp', '5', '20']],
        ['Daily: SS Training', ['node', 'ns_train.js', 'ss', '5', '20']],
        ['Daily: Hunting House', ['node', 'ns_hunt.js', 'run', '10', '20']]
    ];

    // Cek profil karakter untuk evaluasi Ujian (Lv 20, 40, 60, 80) & Grade S
    let charLevel = 1;
    let charRank = 1;
    try {
        const u = process.env.NS_USER, p = process.env.NS_PASS;
        const s = await c.login(u, p);
        if (s && s.sessionKey) {
            const charId = process.env.NS_CHAR_ID || (s.characters && s.characters[0] && (s.characters[0].id || s.characters[0].character_id));
            if (charId) {
                const sc = await c.selectCharacter(s.sessionKey, charId);
                const rawChar = (sc && sc.character) || (s.characters && s.characters.find(x => String(x.id || x.character_id) === String(charId))) || {};
                charLevel = Number(rawChar.character_level || rawChar.level || 1);
                charRank = Number(rawChar.character_rank || 1);
            }
        }
    } catch (e) {
        // Jika gagal pre-check, fallback ke variabel env
        charLevel = Number(process.env.NS_CHAR_LEVEL || 1);
    }

    // Jika level >= 80, sertakan jatah misi Grade S harian
    if (charLevel >= 80) {
        list.push(['Daily: Misi Grade S', ['node', 'ns_grade_s.js', '5']]);
    }

    // Deteksi kebutuhan Ujian di Level 20, 40, 60, 80
    let butuhUjianNama = '';
    if (charLevel >= 80 && charRank < 8) butuhUjianNama = 'Ujian Sennin / Tutor (Lv 80 Cap)';
    else if (charLevel >= 60 && charRank < 6) butuhUjianNama = 'Ujian Special Jounin (Lv 60 Cap)';
    else if (charLevel >= 40 && charRank < 4) butuhUjianNama = 'Ujian Jounin (Lv 40 Cap)';
    else if (charLevel >= 20 && charRank < 2) butuhUjianNama = 'Ujian Chunin (Lv 20 Cap)';

    if (butuhUjianNama) {
        list.push(['Auto Exam: ' + butuhUjianNama, ['node', 'ns_level.js', String(targetLevel || charLevel), '8']]);
    } else if (targetLevel && targetLevel > charLevel) {
        list.push(['Auto Leveling ke ' + targetLevel, ['node', 'ns_level.js', String(targetLevel), '8']]);
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
    // "RINGKASAN hunting: 10 room dicoba, 4 benar-benar dikreditkan"
    let m = out.match(/(\d+)\s+benar-benar dikreditkan/);
    if (m) return Number(m[1]);
    // "RINGKASAN  battle sukses 2 | masuk ke karakter 2"
    m = out.match(/masuk ke karakter\s+(\d+)/);
    if (m) return Number(m[1]);
    // hitung baris KREDIT
    const k = out.match(/KREDIT/g);
    return k ? k.length : 0;
}
function sebab(out) {
    const baris = out.split(/\r?\n/).filter(Boolean);
    const penting = baris.filter(b => /^(Catatan|STOP|RINGKASAN|PERINGATAN|SS Training sudah|semua misi|mode misi-saja|LOGIN GAGAL)/.test(b.trim()));
    return penting.length ? penting[penting.length - 1].trim().slice(0, 120) : '';
}

(async () => {
    c.enableGracefulStop('menu bot');
    const tahap = await bangunDaftarTahap();
    const hasil = [];
    for (const [nama, cmd] of tahap) {
        line('');
        line('################ ' + nama + ' ################');
        const r = await runTahap(cmd);
        hasil.push([nama, r.status, angka(r.stdout), sebab(r.stdout)]);
    }

    line('');
    line('################ RINGKASAN HARIAN ################');
    for (const [nama, kode, kredit, alasan] of hasil) {
        line('  ' + nama.padEnd(26) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | reward masuk: ' + kredit + (alasan ? ' | ' + alasan : ''));
    }
    const totalMasuk = hasil.reduce((a, h) => a + h[2], 0);
    line('');
    line('');
    line('Catatan: TP/SS dibatasi server 1x per hari, hunting 1x per room per hari,');
    line('Kage berhenti sendiri saat energy habis, Halloween berhenti saat heart habis.');
    process.exit(hasil.every(h => h[1] === 0) ? 0 : 1);
})().catch(e => {
    line('FATAL ' + (e.message || e));
    process.exit(1);
});
