#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_level.js — auto naik level NinjaSaga, termasuk ujian.
 *
 * Pakai:
 *   NS_USER=... NS_PASS=... node ns_level.js <targetLevel> [jedaDetik] [--easy]
 * contoh:
 *   node ns_level.js 80 25
 *   node ns_level.js 80 25 --easy     (ujian Special Jounin & Sennin pakai jalur easy)
 *
 * Cara kerja:
 *  - pilih misi grade non-S (XP tertinggi) yang level syaratnya sudah terpenuhi
 *  - misi dijalankan pakai startMission + updateCharacter (alur yang sudah terbukti)
 *  - kalau level menyentuh ambang ujian (20 Chunin, 40 Jounin, 60 Special Jounin, 80 Sennin)
 *    dan ujian itu belum ada di character_mission, rantai ujian dijalankan dulu
 *  - semua angka yang dilaporkan = balasan server
 *
 * Catatan: ujian HARD bisa kena flag anti-cheat server (is_hard_mode_locked).
 * Bot berhenti kalau server menolak atau flag itu aktif.
 */
'use strict';
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const { ucEncode } = require('./nscrypt.js');
const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function kv(s) { let o = ''; for (const ch of String(s)) { const i = 'GhKmNpRtVwYzJqSx'.indexOf(ch); o += i < 0 ? ch : '0123456789abcdef'.charAt(i); } return o; }
const now = () => Math.floor(Date.now() / 1000);

// [missionId, syaratLevel, xp] — grade non-S, sp=0, bukan misi ujian/event. Sumber: MissionDetail.as
const MISI = [['msn2',1,20],['msn246',1,100],['msn0',1,130],['msn3',2,40],['msn46',2,560],['msn4',3,60],['msn13',3,60],['msn105',3,250],['msn7',4,70],['msn14',4,80],['msn5',4,450],['msn106',4,600],['msn54',4,800],['msn8',5,80],['msn149',5,250],['msn107',5,300],['msn121',5,400],['msn36',5,500],['msn9',6,150],['msn15',6,150],['msn224',6,900],['msn6',6,1000],['msn10',7,260],['msn16',7,260],['msn125',7,360],['msn239',7,1400],['msn12',8,300],['msn17',8,300],['msn11',8,400],['msn20',8,400],['msn122',8,750],['msn18',9,320],['msn19',9,320],['msn21',9,900],['msn150',10,320],['msn28',10,335],['msn29',10,335],['msn35',10,400],['msn22',10,400],['msn126',10,560],['msn111',10,600],['msn30',11,350],['msn39',11,350],['msn23',11,400],['msn112',11,750],['msn31',12,370],['msn32',12,370],['msn24',12,400],['msn37',12,500],['msn225',12,3000],['msn33',13,400],['msn34',13,400],['msn38',13,400],['msn25',13,400],['msn26',14,400],['msn40',14,420],['msn41',14,420],['msn27',15,400],['msn42',15,450],['msn43',15,480],['msn151',15,760],['msn127',15,1160],['msn44',16,450],['msn50',16,600],['msn51',16,600],['msn45',17,510],['msn47',17,540],['msn48',18,570],['msn53',18,570],['msn52',18,600],['msn128',18,1700],['msn49',19,600],['msn60',20,624],['msn152',20,1300],['msn61',21,620],['msn114',21,850],['msn117',21,2160],['msn90',21,2400],['msn62',22,710],['msn115',22,900],['msn120',22,1200],['msn84',22,3000],['msn63',23,800],['msn116',23,1200],['msn118',23,3000],['msn91',23,3600],['msn65',24,900],['msn119',24,3100],['msn85',24,4800],['msn68',25,1020],['msn162',25,2200],['msn92',25,4800],['msn86',25,5400],['msn74',26,1150],['msn66',26,4000],['msn87',26,7200],['msn67',27,1290],['msn93',27,6000],['msn88',27,8400],['msn72',28,1450],['msn94',28,8400],['msn69',29,1630],['msn95',29,9000],['msn73',30,1820],['msn163',30,4000],['msn108',30,9600],['msn75',31,2040],['msn109',31,10200],['msn77',32,2280],['msn110',32,10800],['msn78',33,2540],['msn129',33,10000],['msn76',34,2840],['msn130',34,10000],['msn79',35,3160],['msn164',35,6500],['msn131',35,10500],['msn81',36,3520],['msn97',36,12600],['msn80',37,3910],['msn98',37,15600],['msn82',38,4350],['msn99',38,15600],['msn83',39,4600],['msn104',39,18000],['msn165',40,6000],['msn182',40,8156],['msn166',40,9000],['msn183',41,10170],['msn138',42,4870],['msn184',42,12640],['msn139',44,6880],['msn167',45,7500],['msn168',45,12000],['msn140',46,7810],['msn141',48,8890],['msn142',50,10160],['msn143',52,11630],['msn144',54,13330],['msn148',56,15320],['msn147',58,17620],['msn214',60,18950],['msn215',62,21470],['msn216',64,24880],['msn217',66,29410],['msn218',68,34760],['msn219',70,40290],['msn220',72,46730],['msn221',74,55180],['msn222',76,65130],['msn223',78,76840],['msn274',80,82700],['msn275',81,88600],['msn276',82,92580],['msn277',83,95430],['msn278',84,100000]];

// Daftar misi grade resmi dari Data.as Ninja Saga (Mission Room: Grade C, B, A, S)
// Misi grade ini adalah misi grinding inti yang TIDAK ADA BATASAN pengerjaan (repeatable grinding).
const GRADE_C_ARR = [
    'msn2', 'msn3', 'msn4', 'msn7', 'msn8', 'msn9', 'msn10', 'msn12', 'msn13', 'msn14',
    'msn15', 'msn16', 'msn17', 'msn18', 'msn19', 'msn28', 'msn29', 'msn30', 'msn31', 'msn32',
    'msn33', 'msn34', 'msn39', 'msn40', 'msn41', 'msn42', 'msn43', 'msn44', 'msn45', 'msn47',
    'msn48', 'msn49', 'msn53'
];
const GRADE_B_ARR = [
    'msn60', 'msn61', 'msn62', 'msn63', 'msn65', 'msn67', 'msn68', 'msn69', 'msn72', 'msn73',
    'msn74', 'msn75', 'msn76', 'msn77', 'msn78', 'msn79', 'msn80', 'msn81', 'msn82', 'msn83'
];
const GRADE_A_ARR = [
    'msn138', 'msn139', 'msn140', 'msn141', 'msn142', 'msn143', 'msn144', 'msn148', 'msn147',
    'msn214', 'msn215', 'msn216', 'msn217', 'msn218', 'msn219', 'msn220', 'msn221', 'msn222', 'msn223'
];
const GRADE_S_ARR = [
    'msn274', 'msn275', 'msn276', 'msn277', 'msn278'
];
const REPEATABLE_GRADE = new Set([
    ...GRADE_C_ARR,
    ...GRADE_B_ARR,
    ...GRADE_A_ARR,
    ...GRADE_S_ARR
]);
const GRADE_C_SET = new Set(GRADE_C_ARR);
const GRADE_B_SET = new Set(GRADE_B_ARR);
const GRADE_A_SET = new Set(GRADE_A_ARR);
const GRADE_S_SET = new Set(GRADE_S_ARR);

// tambahan misi vendor level 79+ yang belum ada di daftar ringkas (Stage 1-5, XP besar)
let DATA = null;
try {
    DATA = require('./ns_mission_data.json');
    const ada = new Set(MISI.map(m => m[0]));
    for (const m of DATA) if (m.vendor && m.xp > 0 && m.level >= 79 && !ada.has(m.id)) MISI.push([m.id, m.level, m.xp]);
} catch (e) { /* data lengkap tidak ada, pakai daftar ringkas */ }

// Misi yang bisa diulang harian: daily.
let DAILY = new Set(), VENDOR = new Set();
try {
    for (const m of require('./ns_mission_data.json')) {
        if (m.daily) DAILY.add(m.id);
        if (m.vendor) VENDOR.add(m.id);
    }
} catch (e) { /* kalau file tidak ada, anggap tidak ada misi berulang */ }
const ULANG = new Set([...DAILY]);
// peta grade misi (E/D/C/S).
let GRADE = new Map();
try {
    for (const m of require('./ns_mission_data.json')) if (m.grade) GRADE.set(m.id, String(m.grade).toUpperCase());
} catch (e) { /* abaikan */ }
const JEDA_ANTAR_MISI = 2; // detik jeda aman antar misi (seperti pada ns_grade_s.js)

const UJIAN = {
    20: { hard: ['msn55', 'msn56', 'msn57', 'msn58', 'msn59'], easy: null, nama: 'Chunin' },
    40: { hard: ['msn132', 'msn133', 'msn134', 'msn135', 'msn136'], easy: null, nama: 'Jounin' },
    60: { hard: ['msn200', 'msn205', 'msn202', 'msn206', 'msn203', 'msn207', 'msn204', 'msn208', 'msn201', 'msn209', 'msn210', 'msn211', 'msn212'], easy: ['msn226', 'msn227', 'msn228', 'msn229', 'msn230', 'msn231', 'msn232', 'msn233', 'msn234', 'msn235', 'msn236', 'msn237', 'msn238'], nama: 'Special Jounin' },
    80: { hard: ['msn266', 'msn259', 'msn267', 'msn260', 'msn268', 'msn261', 'msn270', 'msn262', 'msn269', 'msn263', 'msn264', 'msn265'], easy: ['msn250', 'msn252', 'msn249', 'msn253', 'msn248', 'msn254', 'msn247', 'msn255', 'msn251', 'msn256', 'msn257', 'msn258'], nama: 'Sennin LV80' }
};

const RANK_NAMES = {
    0: 'Academy Student',
    1: 'Genin',
    2: 'Chunin',
    3: 'Tensai Chunin',
    4: 'Jounin',
    5: 'Tensai Jounin',
    6: 'Special Jounin',
    7: 'Tensai Special Jounin',
    8: 'Tutor / Sennin',
    9: 'Senior Tutor'
};

function butuhUjian(st) {
    if (!st) return null;
    const lv = Number(st.level || 1);
    const rk = Number(st.rank !== undefined ? st.rank : 1);
    // Level 80 Cap: butuh Ujian Sennin / Tutor
    if (lv >= 80 && rk < 8) return { t: 80, nama: 'Sennin / Ninja Tutor (Lv 80)', targetRank: 8 };
    // Level 60 Cap: butuh Ujian Special Jounin
    if (lv >= 60 && rk < 6) return { t: 60, nama: 'Special Jounin (Lv 60)', targetRank: 6 };
    // Level 40 Cap: butuh Ujian Jounin
    if (lv >= 40 && rk < 4) return { t: 40, nama: 'Jounin (Lv 40)', targetRank: 4 };
    // Level 20 Cap: butuh Ujian Chunin
    if (lv >= 20 && rk < 2) return { t: 20, nama: 'Chunin (Lv 20)', targetRank: 2 };
    return null;
}

(async () => {
    const target = Number(process.argv[2] || 0);
    const jeda = Number(process.env.NS_JEDA || process.argv[3] || 8);
    // Ujian SELALU hard mode — --easy diabaikan kecuali --force-easy juga disertakan
    const pakaiEasy = process.argv.includes('--force-easy') && process.argv.includes('--easy');
    const onlyMission = process.argv.includes('--only-mission');
    // noEvent/noHunt hanya aktif jika flag eksplisit (bukan otomatis dari onlyMission)
    const noEvent = process.argv.includes('--no-event');
    const noHunt = process.argv.includes('--no-hunt');
    const iG = process.argv.indexOf('--grade');
    const gradeFilter = iG >= 0 ? String(process.argv[iG + 1] || '').toUpperCase() : '';
    const iMax = process.argv.indexOf('--max');
    const maxMisi = iMax >= 0 ? Number(process.argv[iMax + 1] || 0) : 0;
    const iOne = process.argv.indexOf('--one');
    const oneMid = iOne >= 0 ? String(process.argv[iOne + 1] || '') : '';
    // Label grade di menu game NinjaSaga:
    //   Grade C = lv 1-19, Grade B = lv 20-41, Grade A = lv 42-79, Grade S = lv 80-100
    function tierGrade(lv) {
        if (lv >= 80) return 'S';
        if (lv >= 42 && lv <= 79) return 'A';
        if (lv >= 20 && lv <= 41) return 'B';
        if (lv >= 1 && lv <= 19) return 'C';
        return '';
    }
    function getMissionGrade(mid, lv) {
        if (GRADE_C_SET.has(mid)) return 'C';
        if (GRADE_B_SET.has(mid)) return 'B';
        if (GRADE_A_SET.has(mid)) return 'A';
        if (GRADE_S_SET.has(mid)) return 'S';
        return tierGrade(lv);
    }
    function lulusGrade(mid, lv) {
        if (!gradeFilter) return true;
        return getMissionGrade(mid, lv) === gradeFilter;
    }
    c.enableGracefulStop('menu bot');
    const u = process.env.NS_USER, p = process.env.NS_PASS;
    if (!u || !p) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }
    if (!target) { line('Pakai: node ns_level.js <targetLevel> [jedaDetik] [--easy]'); process.exit(1); }
    line('Menghubungkan ke server Ninja Saga untuk auto level ' + target + '...');

    let s = await c.login(u, p);
    if (!s.ok) { line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')'); process.exit(2); }
    let rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    let chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    let row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) { line('ERROR: Tidak ada karakter ditemukan.'); process.exit(3); }
    let charId = row[0];
    let h = k.mk(s.sessionKey);
    line('akun      : ' + s.username);
    line('karakter  : ' + charId + ' "' + row[1] + '" (Lv ' + (row[2] || '?') + ')');
    line('target    : level ' + target + ' | jeda ' + jeda + 's | ujian ' + (pakaiEasy ? 'EASY' : 'HARD'));
    if (onlyMission) line('mode      : MISI SAJA (tanpa event / hunting / training, ujian tetap otomatis) | grade ' + (gradeFilter || 'otomatis') + ' | maks ' + (maxMisi || 'tanpa batas') + ' misi');
    line('');

    // =========================================================
    // Kunci tanda tangan extraData — diambil CUKUP 1X saat login/startup
    // (Bukan per misi, karena pemanggilan berulang dengan token gk yang sama
    //  akan ditolak server dengan "Session validation failed. Please re-select your character.")
    // =========================================================
    let extraKeys = null;

    async function ambilKunciExtra() {
        for (let i = 1; i <= 3; i++) {
            const res = await c.amf('CharacterDAO.getExtraData', [s.sessionKey, charId, s.token, st.gk]);
            const b = (res && res.body) || {};
            if (b.result) {
                const ex = b.result;
                if (ex.is_hard_mode_locked === true || String(ex.is_hard_mode_locked) === '1') {
                    line('STOP: is_hard_mode_locked aktif');
                    process.exit(4);
                }
                const kq0 = kv(String(ex.isGraphic)), kq1 = kv(String(ex.statistic_battle));
                const dvx = String(ex.m7v), egv = String(ex.q7t);
                const pet = Array.isArray(ex.player_pet) && ex.player_pet.length ? ex.player_pet[0] : null;
                if (!kq0 || !kq1 || !dvx) {
                    line('STOP: kunci tanda tangan tidak lengkap dari server');
                    process.exit(4);
                }
                extraKeys = { kq0, kq1, dvx, egv, pet };
                return true;
            }
            if (i < 3) await sleep(2000);
        }
        return false;
    }

    async function relogin() {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const sNew = await c.login(u, p);
            if (sNew && sNew.ok) {
                s = sNew;
                h = k.mk(s.sessionKey);
                const rlNew = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
                const charsNew = (rlNew && rlNew.body && Array.isArray(rlNew.body.result)) ? rlNew.body.result : [];
                const rowNew = c.getSelectedChar(charsNew, process.env.NS_CHAR_ID || charId);
                if (rowNew) {
                    charId = rowNew[0];
                }
                const stNew = await baca();
                if (stNew) {
                    st = stNew;
                    await ambilKunciExtra();
                }
                return true;
            }
            await sleep(2000);
        }
        return false;
    }

    async function baca() {
        for (let i = 1; i <= 6; i++) {
            const r = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
            const b = (r && r.body) || {};
            if (b.gk) {
                const x = b.result || {};
                return {
                    gk: String(b.gk),
                    level: Number(x.character_level),
                    xp: Number(x.character_xp),
                    gold: Number(x.character_gold),
                    rank: Number(x.character_rank || 1),
                    mission: String(x.character_mission || '')
                };
            }
            if (b.cooldown || /wait a moment/i.test(String(b.error || ''))) {
                const waitSec = Math.max(3, Number(b.cooldown || 6) + 1);
                await sleep(waitSec * 1000);
                continue;
            }
            if (Number(b.error) === 101 || Number(b.error) === 102) {
                const sNew = await c.login(u, p);
                if (sNew && sNew.ok) { s = sNew; h = k.mk(s.sessionKey); }
            }
            if (i < 6) await sleep(2000);
        }
        return null;
    }

    // ---- daftar misi yang sudah lewat: format server "266:1:2:3,259:..." ----
    function parseMisi(str) {
        const set = new Set();
        for (const bagian of String(str || '').split(',')) {
            const id = bagian.split(':')[0].trim();
            if (id) set.add('msn' + id);
        }
        return set;
    }

    async function jalankanMisi(mid) {
        if (selesaiSet.has(mid) && !REPEATABLE_GRADE.has(mid) && !ULANG.has(mid)) return { ok: true, skip: true };
        if (!extraKeys) {
            line('  mengambil kunci extraData karakter...');
            await ambilKunciExtra();
            if (!extraKeys) return { ok: false, err: 'kunci extraData kosong' };
        }
        const { kq0, kq1, dvx, egv, pet } = extraKeys;

        const t0 = now();
        let mulai = null;
        for (let coba = 1; coba <= 3; coba++) {
            mulai = await c.amf('CharacterService.startMission', [s.sessionKey, mid,
                h.msk(kq0 + '|' + mid + '|' + t0), h.getHash(mid), t0, h.msk(dvx + '|' + mid + '|' + t0)]);
            const b = mulai.body || {};
            if (Number(b.status) === 1) break;
            if (Number(b.error) === 108) { selesaiSet.add(mid); return { ok: true, skip: true }; } // level terlalu tinggi untuk misi ini
            if (Number(b.error) === 104) {
                if (DAILY.has(mid)) { gagalHariIni.add(mid); return { ok: true, skip: true }; } // harian: sudah dipakai hari ini
                if (REPEATABLE_GRADE.has(mid)) {
                    // Misi grade resmi: istirahatkan 30s di cooldown, jangan diblokir permanen
                    cooldown.set(mid, Date.now() + 30000);
                    return { ok: true, skip: true };
                }
                // error 104: misi sudah pernah selesai di akun ini (permanen, jangan diulang terus)
                selesaiSet.add(mid);
                return { ok: true, skip: true };
            } // sudah pernah selesai
            if (/Session validation failed|Please re-select/i.test(JSON.stringify(b))) {
                line('  sesi login terputus di server — login ulang...');
                await relogin();
                continue;
            }
            if (/please wait|wait/i.test(JSON.stringify(b))) { await sleep(25000); continue; }
            break;
        }
        const mb = mulai.body || {};
        if (Number(mb.status) !== 1) return { ok: false, err: 'start: ' + JSON.stringify(mb).slice(0, 160) };
        const sbid = mb.startBattleId;
        const cfn = mb.csf ? String(mb.csf) : '';
        await sleep(Math.max(5, jeda) * 1000);

        const bfl = JSON.stringify({ battles: [] });
        const arr = [s.sessionKey, charId, st.level, 0, 0, [], pet ? pet.id : 0, pet ? pet.level : 0, mid, 0, ''];
        const upd = await c.amf('CharacterService.updateCharacter', [s.sessionKey, charId, st.level, 0, 0, [],
            pet ? pet.id : 0, pet ? pet.level : 0, mid, h.getArrayHash(arr), h.updateSequence(), 0, '',
            '1', h.urk(kq1 + '|' + cfn), sbid, bfl, h.getHash('1' + sbid + bfl),
            ucEncode(charId + '|0|0|' + mid + '|' + sbid), h.urk(egv + '|' + cfn)]);
        if (!upd.body || Number(upd.body.status) !== 1) {
            const txt = JSON.stringify(upd.body || {}).slice(0, 200);
            if (/Daily mission already completed today/i.test(txt)) {
                if (DAILY.has(mid)) { gagalHariIni.add(mid); return { ok: true, skip: true }; }
                if (REPEATABLE_GRADE.has(mid)) {
                    cooldown.set(mid, Date.now() + 30000);
                    return { ok: true, skip: true };
                }
                selesaiSet.add(mid); return { ok: true, skip: true };
            }
            return { ok: false, err: 'update: ' + txt };
        }
        if (DAILY.has(mid)) {
            gagalHariIni.add(mid);
        } else if (!REPEATABLE_GRADE.has(mid)) {
            selesaiSet.add(mid);
        }
        return { ok: true };
    }

    let st = await baca();
    if (!st) { line('gagal baca karakter'); process.exit(3); }
    const okExtra = await ambilKunciExtra();
    if (!okExtra || !extraKeys) { line('gagal mengambil kunci extraData karakter dari server'); process.exit(4); }
    const selesaiSet = parseMisi(st.mission);
    // Misi grade resmi (C/B/A/S) adalah misi grinding tanpa batas — jangan masukkan ke daftar 'selesai'
    for (const mid of REPEATABLE_GRADE) {
        selesaiSet.delete(mid);
    }
    const gagalHariIni = new Set();
    const cooldown = new Map(); // mid -> timestamp boleh dicoba lagi (jangan hapus permanen)
    const awal = { level: st.level, xp: st.xp, gold: st.gold };
    line('AWAL      level ' + awal.level + ' | XP ' + awal.xp + ' | gold ' + awal.gold);
    line('grade     : ' + (tierGrade(awal.level) || '-') + ' (Grade A = lv 42-79, B = lv 20-41, C = lv 1-19, S = lv 80-100)');
    if (st.level >= target) { line('sudah di level target, tidak ada yang dikerjakan.'); process.exit(0); }
    if (target > 100) { line('CATATAN: target maksimal 100 — dipangkas ke 100.'); target = 100; }
    line('');

    let n = 0, gagalBeruntun = 0, selesai = 0, tanpaXp = 0, tunggu = 0;
    const MAKS = 500;
    const jedaTunggu = Math.max(10, Number(process.env.NS_WAIT_SEC || 20)) * 1000; // 20 detik
    let sudahHunting = false;

    // Mode auto-grind murni misi grade level (tanpa event Kage/Halloween)
    const ujianSkip = new Set();

    if (oneMid) {
        line('== TES SATU MISI: ' + oneMid + ' ==');
        const r = await jalankanMisi(oneMid);
        line('  hasil  : ' + JSON.stringify(r));
        const stA = await baca() || st;
        line('  XP     : ' + st.xp + ' -> ' + stA.xp + '  (delta ' + (stA.xp - st.xp) + ')');
        line('  gold   : ' + st.gold + ' -> ' + stA.gold + '  (delta ' + (stA.gold - st.gold) + ')');
        process.exit(r.ok ? 0 : 1);
    }
    while (st.level < target && n < MAKS && (!maxMisi || n < maxMisi)) {
        // 1) Ujian wajib jika karakter menyentuh batas level cap rank (20 Chunin, 40 Jounin, 60 Sp Jounin, 80 Sennin)
        const pendingExam = butuhUjian(st);
        if (pendingExam) {
            line('');
            line('======================================================================');
            line('  [!] UJIAN OTOMATIS: Level ' + st.level + ' - ' + pendingExam.nama);
            line('  Rank saat ini : ' + (RANK_NAMES[st.rank] || ('Rank ' + st.rank)) + ' -> Target: ' + (RANK_NAMES[pendingExam.targetRank] || ('Rank ' + pendingExam.targetRank)));
            line('  Ujian ini WAJIB diselesaikan agar batas level terbuka dan XP bisa bertambah.');
            line('======================================================================');

            const cfg = UJIAN[pendingExam.t];
            const rantaiPenuh = (pakaiEasy && cfg.easy) ? cfg.easy : cfg.hard;
            // Jalankan misi yang belum tercatat, atau seluruh rantai jika status rank belum tereksekusi
            let rantaiUjian = rantaiPenuh.filter(mid => !selesaiSet.has(mid));
            if (!rantaiUjian.length) {
                // Semua tercatat di selesaiSet tapi rank belum naik -> jalankan ulang rantai ujian penuh
                rantaiUjian = rantaiPenuh;
            }

            line('  Memulai rangkaian ujian ' + pendingExam.nama + ' (' + rantaiUjian.length + ' misi, ' + (pakaiEasy && cfg.easy ? 'EASY' : 'HARD') + ')...');
            let okU = 0;
            for (const mid of rantaiUjian) {
                line('  -> Menjalankan ujian stage: ' + mid + '...');
                const r = await jalankanMisi(mid);
                if (!r.ok) {
                    line('  [X] Ujian stage ' + mid + ' GAGAL: ' + (r.fatal || r.err));
                    if (r.fatal) { line('STOP: ' + r.fatal); process.exit(4); }
                    break;
                }
                okU++;
                line('  [✓] Ujian stage ' + mid + ' SELESAI (' + okU + '/' + rantaiUjian.length + ')');
                selesaiSet.add(mid);
                await sleep(JEDA_ANTAR_MISI * 1000);
            }

            line('  Hasil rangkaian ujian: ' + okU + '/' + rantaiUjian.length + ' tahap sukses diproses.');
            line('  Memperbarui data rank karakter dari server...');
            await relogin();
            st = await baca() || st;

            if (st.rank >= pendingExam.targetRank) {
                line('  🎉 SELAMAT! Karakter berhasil LULUS ujian ' + pendingExam.nama + '!');
                line('  Rank Baru: ' + (RANK_NAMES[st.rank] || ('Rank ' + st.rank)) + ' | Level Cap terbuka!');
                tanpaXp = 0; gagalBeruntun = 0; gagalHariIni.clear(); cooldown.clear();
            } else {
                line('  [!] Catatan: Rank masih ' + (RANK_NAMES[st.rank] || ('Rank ' + st.rank)) + '. Server mungkin butuh sinkronisasi.');
                await sleep(5000);
                await relogin();
                st = await baca() || st;
                if (st.rank >= pendingExam.targetRank) {
                    line('  🎉 SINKRONISASI SUKSES: Rank baru ' + (RANK_NAMES[st.rank] || ('Rank ' + st.rank)) + '!');
                    tanpaXp = 0; gagalBeruntun = 0; gagalHariIni.clear(); cooldown.clear();
                }
            }
            line('======================================================================\n');
            n++;
            continue;
        }

        // 2) Misi Grade: pilih misi dengan XP TERBESAR di level karakter
        const kandidat = MISI.filter(m => {
            const mid = m[0], lv = m[1];
            if (lv > st.level) return false;
            if (!lulusGrade(mid, lv)) return false;
            if (gagalHariIni.has(mid)) return false;
            if (cooldown.get(mid) > Date.now()) return false;
            // Jika mode onlyMission (auto grind), HANYA izinkan misi grade resmi (C/B/A/S) yang bisa diulang tanpa batas
            if (onlyMission && !REPEATABLE_GRADE.has(mid)) return false;
            // Jika bukan misi grade repeatable dan bukan misi ulang harian, jangan jalankan lagi kalau sudah selesai
            if (!REPEATABLE_GRADE.has(mid) && !ULANG.has(mid) && selesaiSet.has(mid)) return false;
            return true;
        }).sort((a, b) => (b[2] - a[2]) || (b[1] - a[1])).slice(0, 40);
        if (!kandidat.length) {
            line('semua misi grade ' + (gradeFilter || 'semua') + ' yang tersedia di level ' + st.level + ' sedang istirahat / tuntas.');
            cooldown.clear(); // Pulihkan cooldown misi grade repeatable agar bisa diulang
            // Fallback Hunting House jika misi grade di level ini habis tapi belum capai target
            if (!noHunt && !sudahHunting) {
                sudahHunting = true;
                line('misi level ' + st.level + ' habis — mencoba Hunting House untuk naik level...');
                const hr = require('child_process').spawnSync('node', ['ns_hunt.js', 'run', '10', '18'], { cwd: __dirname, stdio: 'inherit', env: process.env });
                await relogin();
                if (st && st.level > awal.level) {
                    line('naik ke level ' + st.level + '! Melanjutkan misi grade baru...');
                    sudahHunting = false; gagalHariIni.clear(); tanpaXp = 0; gagalBeruntun = 0;
                    continue;
                }
            }
            tunggu++;
            line('semua misi grade di level ' + st.level + ' sedang cooling down. Tunggu ' + Math.round(jedaTunggu / 1000) + ' detik (putaran ' + tunggu + ')...');
            await sleep(jedaTunggu);
            sudahHunting = false; gagalHariIni.clear(); tanpaXp = 0; gagalBeruntun = 0;
            continue;
        }
        let sukses = false;
        for (const [mid, lv, xp] of kandidat) {
            const r = await jalankanMisi(mid);
            if (!r.ok) { line('  ' + mid + ' ditolak (' + (r.fatal || r.err) + ')'); if (r.fatal) { line('STOP: ' + r.fatal); process.exit(4); } continue; }
            if (r.skip) { line('  ' + mid + ' dilewati (sudah selesai / jatah habis / diistirahatkan)'); await sleep(1000); continue; }
            await sleep(JEDA_ANTAR_MISI * 1000);
            const st2 = await baca();
            if (!st2) break;
            n++; sukses = true; gagalBeruntun = 0; selesai++;
            const dXp = st2.xp - st.xp;
            const dGold = st2.gold - st.gold;
            const mInfo = (DATA && DATA.find(x => x.id === mid)) || {};
            const mName = mInfo.name ? `[${mInfo.name}]` : '';
            line('  +-------------------------------------------------------------');
            line(`  | ✓ [#${n}] Misi ${mid} ${mName} SELESAI`);
            line(`  |   Level : Lv ${st.level}${st2.level > st.level ? ' -> Lv ' + st2.level + ' (LEVEL UP! 🎉)' : ''}`);
            line(`  |   XP    : +${dXp.toLocaleString()} (XP Karakter: ${st2.xp.toLocaleString()})`);
            line(`  |   Gold  : +${dGold.toLocaleString()} (Gold Karakter: ${st2.gold.toLocaleString()})`);
            line('  +-------------------------------------------------------------');
            st = st2;
            if (dXp <= 0) {
                // Deteksi apakah XP 0 karena tertahan Level Cap & wajib Ujian
                const cekUjianLagi = butuhUjian(st);
                if (cekUjianLagi) {
                    line('');
                    line('  [!] DETEKSI LEVEL CAP: Karakter mencapai Lv ' + st.level + ' dan belum lulus Ujian!');
                    line('  [!] XP tertahan pada batas level. Mengalihkan langsung ke UJIAN ' + cekUjianLagi.nama + '...');
                    tanpaXp = 0;
                    break;
                }

                // reward bisa telat masuk — cek 1x setelah 15s
                await sleep(15000);
                const st3 = await baca();
                const telat = st3 ? st3.xp - st.xp : 0;
                if (st3 && telat > 0) {
                    const telatGold = st3.gold - st.gold;
                    line(`    (Reward telat masuk) XP +${telat.toLocaleString()} | Gold +${telatGold.toLocaleString()}`);
                    st = st3; tanpaXp = 0;
                } else {
                    if (st3) st = st3;
                    tanpaXp++;
                    cooldown.set(mid, Date.now() + 30000);
                    line('    ' + mid + ' belum bayar saat ini — istirahat 30 detik, mencoba misi lain.');
                }
            } else { tanpaXp = 0; }
            break;
        }
        if (tanpaXp >= 3) {
            line('');
            line('PERINGATAN: 3 misi berturut-turut diterima server tapi XP 0.');
            line('Artinya reward akun sedang kosong (cap harian tercapai / misi di level ini habis).');
            line('Ini bukan salah pilih misi — misi yang sama bisa kasih XP lagi setelah reset.');
            if (onlyMission) {
                line('mode misi-saja: lanjut cek kandidat lain (misi yang XP 0 sudah ditandai habis).');
                tanpaXp = 0; gagalBeruntun = 0;
                continue;
            }
            tunggu++;
            line('tunggu ' + Math.round(jedaTunggu / 1000) + ' detik (putaran tunggu ' + tunggu + ').');
            await sleep(jedaTunggu);
            tanpaXp = 0; gagalBeruntun = 0; gagalHariIni.clear(); sudahHunting = false;
            continue;
        }
        if (!sukses) {
            gagalBeruntun++;
            line('  tidak ada misi kandidat yang diterima di level ' + st.level + ' (' + gagalBeruntun + '/3)');
            if (gagalBeruntun >= 3) {
                // Coba fallback ke hunting house dulu sebelum menyerah
                if (!noHunt && !sudahHunting) {
                    sudahHunting = true;
                    line('misi level ' + st.level + ' tidak diterima — mencoba Hunting House untuk XP...');
                    require('child_process').spawnSync('node', ['ns_hunt.js', 'run', '10', '18'], { cwd: __dirname, stdio: 'inherit', env: process.env });
                    await relogin();
                    const stH = st;
                    if (stH) {
                        const dx = stH.xp - st.xp;
                        st = stH;
                        if (stH.level > st.level || dx > 0) {
                            line('mendapat XP dari hunting! Lanjut misi...');
                            gagalBeruntun = 0; sudahHunting = false; gagalHariIni.clear(); tanpaXp = 0;
                            continue;
                        }
                    }
                }
                if (onlyMission && noHunt && noEvent) {
                    if (st.level >= target) {
                        line('mode misi-saja: target level telah tercapai. Selesai.');
                        break;
                    }
                    line('mode misi-saja: menunggu jeda server ' + Math.round(jedaTunggu / 1000) + ' detik sebelum mencoba lagi...');
                    await sleep(jedaTunggu);
                    gagalBeruntun = 0; gagalHariIni.clear(); cooldown.clear(); tanpaXp = 0;
                    continue;
                }
                tunggu++;
                line('tidak ada misi yang bisa dikerjakan sekarang — tunggu ' + Math.round(jedaTunggu / 1000) + ' detik (putaran tunggu ' + tunggu + ').');
                await sleep(jedaTunggu);
                gagalBeruntun = 0; gagalHariIni.clear(); cooldown.clear(); sudahHunting = false; tanpaXp = 0;
                continue;
            }
            await sleep(10000);
        }
    }

    line('');
    line('RINGKASAN  level ' + awal.level + ' -> ' + st.level + ' (target ' + target + ')');
    line('  misi sukses : ' + selesai);
    line('  XP          : ' + awal.xp + ' -> ' + st.xp);
    line('  gold        : ' + awal.gold + ' -> ' + st.gold);
    process.exit(st.level >= target ? 0 : 5);
})().catch(e => { line('FATAL ' + e.message); process.exit(1); });
