#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
'use strict';
const c = require('./nsclient.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const s = await c.login(process.env.NS_USER, process.env.NS_PASS);
    if (!s.ok) { console.log('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')'); process.exit(2); }
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const id = rl.body.result[0][0];
    let x = null;
    for (let i = 1; i <= 6; i++) {
        const r = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, id]);
        if (r.body && r.body.gk) { x = r.body.result; break; }
        await sleep(6000);
    }
    const mis = String(x.character_mission || '');
    const cari = (m) => (mis.match(new RegExp('(^|,)' + m + ':([0-9:]+)')) || [])[2] || 'TIDAK ADA';
    console.log('--- SS missions (character_mission) ---');
    for (const m of ['279', '280', '281', '282', '283', '284', '285']) console.log('  msn' + m + ' = ' + cari(m));
    const ex = (await c.amf('CharacterDAO.getExtraData', [s.sessionKey, id, s.token, x.gk ? String(x.gk) : ''])).body;
    console.log('--- extraData kunci SS/TP ---');
    const e = (ex && ex.result) || {};
    for (const kk of Object.keys(e)) if (/senjutsu|ss|talent|tp|train/i.test(kk)) console.log('  ' + kk + ' = ' + JSON.stringify(e[kk]).slice(0, 200));
    console.log('--- kage ---');
    const cur = {};
    String(x.character_common_currency || '').split(',').forEach(p => { const [a, b] = p.split(':'); if (a) cur[a] = +b; });
    console.log('  essence 1126..1130 = ' + [1126, 1127, 1128, 1129, 1130].map(i => i + ':' + (cur[i] === undefined ? '-' : cur[i])).join(' '));
    console.log('  item event 1027 (halloween) = ' + (cur[1027] === undefined ? '-' : cur[1027]));
    const st = await c.amf('Anni9th.kageMissionStatus', [s.sessionKey]);
    const m = (st.body && st.body.mission) || [];
    console.log('  misi: ' + m.map(v => v.mission_id + '[claim=' + v.claim_status + ' target=' + JSON.stringify(v.target) + ']').join(' ').slice(0, 600));
    console.log('  gold=' + x.character_gold + ' xp=' + x.character_xp + ' lv=' + x.character_level);
    process.exit(0);
})().catch(e => { console.log('FATAL ' + e.message); process.exit(1); });
