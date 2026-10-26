#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_state.js — Cek Status Lengkap Karakter Ninja Saga
 * (Level, XP, Gold, Token, Rank & Level Cap, Status Ujian, Event Items)
 */
'use strict';

const c = require('./nsclient.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const RANK_CAPS = {
    1: 20, // Genin cap = 20
    2: 40, // Chunin cap = 40
    3: 40,
    4: 60, // Jounin cap = 60
    5: 60,
    6: 80, // Special Jounin cap = 80
    7: 80,
    8: 100, // Tutor cap = 100
    9: 100
};

(async () => {
    c.enableGracefulStop('menu bot');
    const u = process.env.NS_USER;
    const p = process.env.NS_PASS;
    if (!u || !p) {
        console.log('[!] Butuh NS_USER dan NS_PASS di environment.');
        process.exit(1);
    }

    const s = await c.login(u, p);
    if (!s.ok) {
        console.log('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')');
        process.exit(2);
    }

    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) {
        console.log('ERROR: Karakter tidak ditemukan.');
        process.exit(3);
    }

    const charId = row[0];
    let x = null;
    let gk = '';
    for (let i = 1; i <= 6; i++) {
        const r = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
        const b = r.body || {};
        if (b.gk) {
            gk = String(b.gk);
            x = b.result || {};
            break;
        }
        await sleep(1500);
    }

    if (!x) {
        console.log('ERROR: Gagal membaca data karakter dari server.');
        process.exit(4);
    }

    const charName = x.character_name || row[1];
    const level = Number(x.character_level) || Number(row[2]) || 1;
    const xp = Number(x.character_xp) || 0;
    const gold = Number(x.character_gold) || 0;
    const tokens = Number(s.tokens !== undefined ? s.tokens : (s.raw && s.raw.result && s.raw.result[2]) || 0);
    const rank = Number(x.character_rank || 1);
    const rankName = RANK_NAMES[rank] || ('Rank ' + rank);
    const rankCap = RANK_CAPS[rank] || 100;
    const gender = Number(x.character_gender) === 0 ? 'Pria' : 'Wanita';

    // Periksa status ujian berdasarkan rank dan level
    let examStatus = 'Lulus semua ujian sesuai rank saat ini.';
    if (level >= 80 && rank < 8) {
        examStatus = 'PERLU UJIAN SENNIN / TUTOR (Level 80 Cap)!';
    } else if (level >= 60 && rank < 6) {
        examStatus = 'PERLU UJIAN SPECIAL JOUNIN (Level 60 Cap)!';
    } else if (level >= 40 && rank < 4) {
        examStatus = 'PERLU UJIAN JOUNIN (Level 40 Cap)!';
    } else if (level >= 20 && rank < 2) {
        examStatus = 'PERLU UJIAN CHUNIN (Level 20 Cap)!';
    }

    // Parsing Currency & Item Event
    const cur = {};
    String(x.character_common_currency || '').split(',').forEach(p => {
        const [a, b] = p.split(':');
        if (a) cur[a] = +b;
    });
    const mat = {};
    String(x.character_material || '').split(',').forEach(p => {
        const [a, b] = p.split(':');
        if (a) mat[a] = +b;
    });

    console.log('\n======================================================================');
    console.log('                     INFORMASI STATUS KARAKTER');
    console.log('======================================================================');
    console.log(` Akun         : ${s.username} (Player ID: ${s.playerId})`);
    console.log(` Karakter     : ${charName} (ID: ${charId}) | Gender: ${gender}`);
    console.log(` Level        : Lv ${level} (Maks Cap Rank: Lv ${rankCap})`);
    console.log(` Rank         : ${rankName} [Rank ID: ${rank}]`);
    console.log(` Status Ujian : ${examStatus}`);
    console.log('----------------------------------------------------------------------');
    console.log(` Gold         : ${gold.toLocaleString('id-ID')}`);
    console.log(` Tokens       : ${tokens.toLocaleString('id-ID')} Tokens`);
    console.log(` Total XP     : ${xp.toLocaleString('id-ID')}`);
    console.log('----------------------------------------------------------------------');

    // Event Items & Essences
    console.log(' Event & Material Khusus:');
    const kariHeart = mat[1027] !== undefined ? mat[1027] : (cur[1027] !== undefined ? cur[1027] : '-');
    const kariCrystal = mat[1026] !== undefined ? mat[1026] : (cur[1026] !== undefined ? cur[1026] : '-');
    console.log(`   - Heart of Kari (Item 1027)    : ${kariHeart}`);
    console.log(`   - Crystal of Kari (Item 1026)  : ${kariCrystal}`);
    const essences = [1126, 1127, 1128, 1129, 1130].map(id => `${id}:${cur[id] !== undefined ? cur[id] : 0}`).join(' | ');
    console.log(`   - Kage Essences (1126..1130)   : ${essences}`);

    // Senjutsu Missions
    const mis = String(x.character_mission || '');
    const cariMsn = (m) => (mis.match(new RegExp('(^|,)' + m + ':([0-9:]+)')) || [])[2] || 'Belum';
    console.log('\n Status Misi Senjutsu / SS:');
    const ssMissions = ['279', '280', '281', '282', '283', '284', '285'];
    const ssOut = ssMissions.map(m => `msn${m}: ${cariMsn(m)}`).join('  ');
    console.log(`   ${ssOut}`);

    // Kage Mission Status
    try {
        const st = await c.amf('Anni9th.kageMissionStatus', [s.sessionKey]);
        const m = (st.body && st.body.mission) || [];
        if (m.length > 0) {
            const ready = m.filter(v => Number(v.claim_status) === 0).length;
            const claimed = m.filter(v => Number(v.claim_status) !== 0).length;
            console.log(`\n Kage Mission: ${m.length} total (${claimed} diklaim, ${ready} siap klaim)`);
        }
    } catch (_) { }

    console.log('======================================================================\n');
    process.exit(0);
})().catch(e => {
    console.log('FATAL: ' + (e.message || e));
    process.exit(1);
});
