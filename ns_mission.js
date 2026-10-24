#!/usr/bin/env node
/**
 * ns_mission.js — daftar misi per grade + status selesai/belum.
 * cc: MagnetScript(Razki)
 *
 *   node ns_mission.js            # ringkasan semua grade
 *   node ns_mission.js C          # detail misi grade C
 *   node ns_mission.js B          # cek apakah ada grade B di data server
 */
'use strict';
const c = require('./nsclient.js');
const line = s => console.log(s);

// [id, grade, level, xp, nama] — dari dlib MissionDetail.as (232 misi)
const DATA = require('./ns_mission_data.json');

(async () => {
    const s = await c.login(process.env.NS_USER, process.env.NS_PASS);
    if (!s.ok) { line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')'); process.exit(2); }
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) { line('ERROR: Karakter tidak ditemukan.'); process.exit(3); }
    const charId = row[0];
    const b = (await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId])).body;
    const r = b.result || {};
    const lv = Number(r.character_level || 0);
    const rank = Number(r.character_rank || 0);
    const done = new Set(String(r.character_mission || '').split(',').map(x => 'msn' + x.split(':')[0]));

    const grade = (process.argv[2] || '').toUpperCase();
    const semua = DATA.filter(m => m.grade);
    const byGrade = {};
    for (const m of semua) (byGrade[m.grade] = byGrade[m.grade] || []).push(m);
    // Label menu game: Grade S = lv 80-100, Grade A = lv 42-78, B = lv 20-39, C = lv 1-19
    const tier = l => (l >= 80) ? 'S' : (l >= 42 && l <= 78) ? 'A' : l >= 20 && l <= 39 ? 'B' : l >= 1 && l <= 19 ? 'C' : '';

    line('karakter : ' + r.character_name + ' | level ' + lv + ' | rank ' + rank);
    line('grade kamu: ' + (tier(lv) || '-') + '  (S = lv 80-100 stamina, A = lv 42-78, B = lv 20-39, C = lv 1-19)');
    line('');

    if (grade) {
        const pakaiTier = ['A', 'B', 'C', 'S'].includes(grade);
        const list = pakaiTier ? semua.filter(m => tier(m.level) === grade) : (byGrade[grade] || []);
        if (!list.length) {
            line('GRADE ' + grade + ' TIDAK ADA misi untuk level sekarang.');
            line('grade field server: ' + Object.keys(byGrade).sort().join(', '));
            process.exit(0);
        }
        line('GRADE ' + grade + (pakaiTier ? ' (dari level misi)' : ' (field server)') + ' — ' + list.length + ' misi');
        list.sort((a, b2) => a.level - b2.level);
        for (const m of list) {
            const st = done.has(m.id) ? (m.daily ? 'HARIAN' : 'SELESAI') : (m.level <= lv ? 'SIAP' : 'butuh lv ' + m.level);
            const extraNote = m.grade === 'S' ? ' [-12 Stamina]' : '';
            line('  ' + m.id.padEnd(8) + 'lv ' + String(m.level).padEnd(3) + 'XP ' + String(m.xp).padEnd(7) + st.padEnd(12) + m.name.slice(0, 30) + extraNote);
        }
        process.exit(0);
    }

    line('RINGKASAN PER GRADE');
    for (const g of Object.keys(byGrade).sort()) {
        const list = byGrade[g];
        const siap = list.filter(m => m.level <= lv && !done.has(m.id));
        const selesai = list.filter(m => done.has(m.id));
        line('  grade ' + g + ' : ' + list.length + ' misi | selesai ' + selesai.length + ' | siap dikerjakan ' + siap.length);
    }
    line('');
    const siapSemua = semua.filter(m => m.level <= lv && !done.has(m.id)).sort((a, b2) => b2.xp - a.xp);
    line('MISI SIAP (XP terbesar):');
    if (!siapSemua.length) line('  tidak ada — semua misi di level ini sudah selesai');
    for (const m of siapSemua.slice(0, 10)) line('  ' + m.id.padEnd(8) + 'grade ' + m.grade + '  lv ' + m.level + '  XP ' + m.xp + '  ' + m.name.slice(0, 38));
    process.exit(0);
})().catch(e => { line('FATAL ' + e.message); process.exit(1); });
