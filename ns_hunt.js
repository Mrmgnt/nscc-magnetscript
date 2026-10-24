#!/usr/bin/env node
/**
 * ns_hunt.js — Hunting House / Eudemon Garden (EudemonGarden)
 * cc: MagnetScript(Razki)
 *
 * Port 1:1 dari panels/hunting_house.swf -> OldHuntingHouse.as:437-475.
 * startHunting: [sk, currRoom, currBoss, hash(room+enemyStr), egvToken, enemyStr]
 *   currBoss = qd(qc(qb(qa(gk3, q7), q7), q7))
 * finishHunting: [sk, currRoom, itemUsedInBattle, 0, hash(room+"0"), "1", battleLog, startBattleId,
 *                 '{"battles":[]}', hash("1"+startBattleId+json), _eh(room+"|0|"+startBattleId), egv]
 *
 * Pakai:
 *   node ns_hunt.js status
 *   node ns_hunt.js run [jumlahRoom] [jedaDetik]
 */
'use strict';
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const crypto = require('crypto');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log(s);
function kv(s) { let o = ''; for (const ch of String(s)) { const i = 'GhKmNpRtVwYzJqSx'.indexOf(ch); o += i < 0 ? ch : '0123456789abcdef'.charAt(i); } return o; }
const now = () => Math.floor(Date.now() / 1000);

// _eh dari Battle.as:5371
const TAB = [91, 53, 116, 44, 75, 110, 36, 58, 71, 126, 46, 50, 90, 73, 115, 61];
function eh(str) {
    const rnd = crypto.randomBytes(10);
    const buf = Buffer.from(str, 'utf8');
    let v = 0;
    for (let i = 0; i < buf.length; i++) {
        v = (v ^ TAB[i % 16] ^ rnd[i % 10]) & 0xFF;
        buf[i] = (buf[i] ^ v) & 0xFF;
        buf[i] = (buf[i] + TAB[(i * 3 + v) % 16]) & 0xFF;
        v = (v + buf[i] + i * 11) & 0xFF;
    }
    return rnd.toString('hex') + buf.toString('hex');
}

(async () => {
    const mode = process.argv[2] || 'status';
    const maks = Number(process.argv[3] || 10);
    const jeda = Math.max(8, Number(process.argv[4] || 20));
    const mulaiRoom = Math.max(0, Number(process.argv[5] || 0));
    c.enableGracefulStop('menu bot');
    const u = process.env.NS_USER, p = process.env.NS_PASS;
    if (!u || !p) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }

    const s = await c.login(u, p);
    if (!s.ok) { line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')'); process.exit(2); }
    const h = k.mk(s.sessionKey);
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) { line('gagal ambil karakter'); process.exit(3); }
    const charId = row[0];
    line('Karakter aktif : ' + charId + ' "' + row[1] + '" (Lv ' + (row[2] || '?') + ')');

    async function baca() {
        for (let i = 0; i < 6; i++) {
            const b = (await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId])).body || {};
            if (b.gk) { const x = b.result || {}; return { gk: String(b.gk), level: Number(x.character_level), xp: Number(x.character_xp), gold: Number(x.character_gold), mission: String(x.character_mission || '') }; }
            await sleep(6000);
        }
        return null;
    }
    let st = await baca();
    if (!st) { line('gagal baca karakter'); process.exit(3); }

    const hs = await c.amf('EudemonGarden.getHuntingStatus', [s.sessionKey]);
    const hb = hs.body || {};
    const rooms = ((hb.result || {}).room) || [];
    const q7 = String(hb.q7 || ''), q7f = String(hb.q7f || '');
    if (!rooms.length) { line('server tidak mengirim daftar room'); process.exit(4); }

    if (mode === 'status') {
        line('Hunting House — ' + rooms.length + ' room');
        rooms.forEach((r, i) => {
            const nama = r.boss.join('+');
            line('  [' + i + '] rank ' + r.rank + '  ' + nama + '  XP ' + r.xp + '  gold ' + r.gold + '  status ' + r.status);
        });
        line('');
        line('karakter: level ' + st.level + ' | XP ' + st.xp + ' | gold ' + st.gold);
        process.exit(0);
    }

    const exRes = await c.amf('CharacterDAO.getExtraData', [s.sessionKey, charId, s.token, st.gk]);
    const ex = (exRes && exRes.body && exRes.body.result) ? exRes.body.result : {};
    const gk3 = kv(String(ex.recent_achievement));
    const egv = String(ex.q7t || '');
    if (!gk3 || !q7) { line('token hunting tidak lengkap (gk3/q7 kosong)'); process.exit(5); }

    let n = 0, kredit = 0, batas = 0, levelKurang = 0;
    for (let i = mulaiRoom; i < Math.min(mulaiRoom + maks, rooms.length); i++) {
        // token q7/q7f bersifat sekali pakai -> ambil ulang tiap room
        const hs2 = await c.amf('EudemonGarden.getHuntingStatus', [s.sessionKey]);
        const hb2 = hs2.body || {};
        const q7b = String(hb2.q7 || ''), q7fb = String(hb2.q7f || '');
        const rooms2 = ((hb2.result || {}).room) || rooms;
        const room = rooms2[i] || rooms[i];
        const enemyStr = room.boss.join(',');
        const currBoss = k.tokenBoss(gk3, q7b);
        const egvTok = egv ? k.tokenBoss(egv, q7b) : '';
        const battleLog = q7fb ? k.tokenLog(gk3, q7fb) : '';
        const loc4 = h.getHash(String(i) + enemyStr);

        const mulai = await c.amf('EudemonGarden.startHunting', [s.sessionKey, i, currBoss, loc4, egvTok, enemyStr]);
        const mb = mulai.body || {};
        line('[' + i + '] ' + enemyStr + ' startHunting -> ' + JSON.stringify(mb).slice(0, 200));
        if (Number(mb.status) !== 1) {
            const err = String(mb.error || '');
            if (/daily limit/i.test(err)) { batas++; line('  dilewati: limit harian room ini sudah habis'); }
            else if (/level is too low/i.test(err)) { levelKurang++; line('  dilewati: level belum cukup untuk room ini'); }
            else line('  dilewati: ' + err.slice(0, 140));
            await sleep(5000); continue;
        }
        const sbid = String(mb.startBattleId || mb.sbid || '');
        await sleep(jeda * 1000);

        const json = '{"battles":[]}';
        const fin = await c.amf('EudemonGarden.finishHunting', [s.sessionKey, i, [], 0, h.getHash(String(i) + 0), '1',
            battleLog, sbid, json, h.getHash('1' + sbid + json), eh(String(i) + '|0|' + sbid), egv]);
        const fb = fin.body || {};
        line('    finishHunting -> ' + JSON.stringify(fb).slice(0, 260));
        const st2 = await baca();
        if (st2) {
            const dxp = st2.xp - st.xp, dgold = st2.gold - st.gold;
            if (dxp !== 0 || dgold !== 0) { kredit++; line('    KREDIT  XP +' + dxp + '  gold +' + dgold); }
            else line('    TIDAK ADA PERUBAHAN (masih preview)');
            st = st2;
        }
        n++;
        await sleep(6000);
    }
    line('');
    line('RINGKASAN hunting: ' + n + ' room dicoba, ' + kredit + ' benar-benar dikreditkan' +
        (batas ? ' | ' + batas + ' room kena limit harian' : '') +
        (levelKurang ? ' | ' + levelKurang + ' room butuh level lebih tinggi' : ''));
    if (!kredit && batas) line('Catatan: limit hunting 1x per room per hari — reset besok, bukan bug script.');
    if (!kredit && levelKurang) line('Catatan: room rank tinggi baru terbuka di level lebih tinggi (butuh lv 75-85).');
    process.exit(0);
})().catch(e => { line('FATAL ' + e.message); process.exit(1); });
