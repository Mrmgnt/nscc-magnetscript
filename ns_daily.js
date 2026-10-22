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
const { spawnSync } = require('child_process');
const line = s => console.log(s);
const dir = __dirname;

const argv = process.argv.slice(2);
const iLv = argv.indexOf('--level');
const targetLevel = iLv >= 0 ? Number(argv[iLv + 1] || 0) : 0;

const tahap = [
    ['Special Event: Kage', ['node', 'ns_event.js', 'kage', '20']],
    ['Special Event: Halloween', ['node', 'ns_event.js', 'halloween', '10']],
    ['Daily: TP Training', ['node', 'ns_train.js', 'tp', '5', '20']],
    ['Daily: SS Training', ['node', 'ns_train.js', 'ss', '5', '20']],
    ['Daily: Hunting House', ['node', 'ns_hunt.js', 'run', '10', '20']]
];
if (targetLevel) tahap.push(['Auto level ' + targetLevel, ['node', 'ns_level.js', String(targetLevel), '25']]);

if (!process.env.NS_USER || !process.env.NS_PASS) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }

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

const hasil = [];
for (const [nama, cmd] of tahap) {
    line('');
    line('################ ' + nama + ' ################');
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd: dir, encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024 });
    const out = String(r.stdout || '');
    process.stdout.write(out);
    if (r.stderr && !/tput|tcsetattr|Inappropriate ioctl/i.test(r.stderr)) process.stderr.write(String(r.stderr));
    hasil.push([nama, r.status, angka(out), sebab(out)]);
}

line('');
line('################ RINGKASAN HARIAN ################');
for (const [nama, kode, kredit, alasan] of hasil) {
    line('  ' + nama.padEnd(26) + '| ' + (kode === 0 ? 'exit 0' : 'exit ' + kode) + ' | reward masuk: ' + kredit + (alasan ? ' | ' + alasan : ''));
}
const totalMasuk = hasil.reduce((a, h) => a + h[2], 0);
line('');
line('Total reward masuk ke karakter: ' + totalMasuk + ' tahap.');
if (!totalMasuk) line('Tidak ada reward yang masuk. Cek alasan per tahap di atas (limit harian / level / reward akun kosong).');
line('');
line('Catatan: TP/SS dibatasi server 1x per hari, hunting 1x per room per hari,');
line('Kage berhenti sendiri saat energy habis, Halloween berhenti saat heart habis.');
process.exit(hasil.every(h => h[1] === 0) ? 0 : 1);
