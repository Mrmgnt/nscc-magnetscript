#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_train.js — training harian NinjaSaga.
 *
 *   node ns_train.js tp [maksMisi] [jedaDetik]   -> TP Training  (msn170..msn174, 10 TP per misi)
 *   node ns_train.js ss [maksMisi] [jedaDetik]   -> SS / Senjutsu Training (msn279..msn283)
 *
 * TP Training = misi quest berhadiah TP (msn170..msn174, lv40, 2000 XP/gold, 10 TP).
 * SS Training  = misi quest berhadiah SS (msn279..msn283, lv80, 10000 XP/gold, 30 SS).
 * KEDUANYA jalur misi biasa: startMission -> updateCharacter.
 * SSTraining.finishSSMission JANGAN dipakai: dibalas status 1 tapi tidak pernah commit.
 */
'use strict';
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const { ucEncode } = require('./nscrypt.js');
const line = s => console.log(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TP_MISSIONS = ['msn170', 'msn171', 'msn172', 'msn173', 'msn174'];
const SS_MISSIONS = ['msn279', 'msn280', 'msn281', 'msn282', 'msn283'];
function kv(s) { let o = ''; for (const ch of String(s)) { const i = 'GhKmNpRtVwYzJqSx'.indexOf(ch); o += i < 0 ? ch : '0123456789abcdef'.charAt(i); } return o; }
const now = () => Math.floor(Date.now() / 1000);

(async () => {
    const mode = (process.argv[2] || 'tp').toLowerCase();
    const maks = Number(process.argv[3] || 5);
    const jeda = Number(process.argv[4] || 20);
    c.enableGracefulStop('menu bot');
    const u = process.env.NS_USER, p = process.env.NS_PASS;
    if (!u || !p) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }
    if (mode !== 'tp' && mode !== 'ss') { line('Pakai: node ns_train.js tp|ss [maks] [jeda]'); process.exit(1); }

    const s = await c.login(u, p);
    if (!s.ok) { line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')'); process.exit(2); }
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) { line('ERROR: Tidak ada karakter ditemukan.'); process.exit(3); }
    const charId = row[0];
    const h = k.mk(s.sessionKey);
    line('Karakter aktif : ' + charId + ' "' + row[1] + '" (Lv ' + (row[2] || '?') + ')');

    async function baca() {
        for (let i = 1; i <= 6; i++) {
            const r = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
            const b = r.body || {};
            if (b.gk) { const x = b.result || {}; return { gk: String(b.gk), level: Number(x.character_level), xp: Number(x.character_xp), gold: Number(x.character_gold), mission: String(x.character_mission || '') }; }
            await sleep(6000);
        }
        return null;
    }
    const extra = async gk => {
        const r = await c.amf('CharacterDAO.getExtraData', [s.sessionKey, charId, s.token, gk]);
        return (r && r.body && r.body.result) ? r.body.result : {};
    };
    // cari field yang berbau TP di karakter & extraData (buat laporan, bukan keputusan)
    function cariTP(obj) {
        const out = {};
        for (const kk of Object.keys(obj || {})) if (/tp|train|talent|point/i.test(kk)) {
            const v = obj[kk];
            if (typeof v === 'number' || typeof v === 'string') out[kk] = v;
        }
        return out;
    }

    let st = await baca();
    if (!st) { line('gagal baca karakter'); process.exit(3); }
    let ex = await extra(st.gk);
    const chRes = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
    const chRaw = (chRes && chRes.body && chRes.body.result) ? chRes.body.result : {};
    line('karakter  : ' + charId + ' | level ' + st.level + ' | XP ' + st.xp + ' | gold ' + st.gold);
    line('field TP karakter : ' + JSON.stringify(cariTP(chRaw)).slice(0, 220));
    line('field TP extraData: ' + JSON.stringify(cariTP(ex)).slice(0, 220));
    line('misi sudah lewat  : ' + (st.mission || '(kosong)').slice(0, 200));
    line('');

    const daftar = (mode === 'tp' ? TP_MISSIONS : SS_MISSIONS).slice(0, maks);
    // Pengaman SS: jangan farming. Server TIDAK membatasi (misi bisa diulang dan tetap dikreditkan),
    // jadi default cuma jalan kalau getMissionStatus masih menyisakan misi.
    if (mode === 'ss' && !process.argv.includes('--paksa')) {
        const ms = await c.amf('SSTraining.getMissionStatus', [s.sessionKey]);
        const sisa = ((ms.body || {}).result || {}).mission || [];
        if (!sisa.length) {
            line('SS Training sudah beres (getMissionStatus kosong). Tidak diulang tanpa --paksa.');
            process.exit(0);
        }
        line('SS misi tersisa: ' + sisa.map(m => m.id).join(', '));
    }
    let ok = 0;
    let kredit = 0;
    for (const mid of daftar) {
        const g0 = st.gold, x0 = st.xp;
        const kq0 = kv(String(ex.isGraphic)), dvx = String(ex.m7v);
        if (!kq0 || !dvx) { line('STOP  kunci tanda tangan tidak lengkap'); break; }

        const t0 = now();
        const mulai = await c.amf('CharacterService.startMission', [s.sessionKey, mid,
            h.msk(kq0 + '|' + mid + '|' + t0), h.getHash(mid), t0, h.msk(dvx + '|' + mid + '|' + t0)]);
        if (!mulai.body || Number(mulai.body.status) !== 1) {
            line('  ' + mid + ' DITOLAK start: ' + JSON.stringify(mulai.body).slice(0, 180));
            continue;
        }
        const cfn = mulai.body.csf ? String(mulai.body.csf) : '';
        const sbid = mulai.body.startBattleId;
        await sleep(Math.max(10, jeda) * 1000);

        // TP dan SS SAMA: jalur misi biasa -> updateCharacter.
        // SS Training ternyata tidak butuh SSTraining.finishSSMission (itu hanya preview, tidak commit).
        const kq1 = kv(String(ex.statistic_battle)), egv = String(ex.q7t);
        const pet = Array.isArray(ex.player_pet) && ex.player_pet.length ? ex.player_pet[0] : null;
        const bfl = JSON.stringify({ battles: [] });
        const arr = [s.sessionKey, charId, st.level, 0, 0, [], pet ? pet.id : 0, pet ? pet.level : 0, mid, 0, ''];
        const r = await c.amf('CharacterService.updateCharacter', [s.sessionKey, charId, st.level, 0, 0, [],
            pet ? pet.id : 0, pet ? pet.level : 0, mid, h.getArrayHash(arr), h.updateSequence(), 0, '',
            '1', h.urk(kq1 + '|' + cfn), sbid, bfl, h.getHash('1' + sbid + bfl),
            ucEncode(charId + '|0|0|' + mid + '|' + sbid), h.urk(egv + '|' + cfn)]);
        const res = r.body || {};
        if (Number(res.status) !== 1) { line('  ' + mid + ' DITOLAK: ' + JSON.stringify(res).slice(0, 200)); continue; }

        ok++;
        st = await baca() || st;
        ex = await extra(st.gk);
        const dg = st.gold - g0, dx = st.xp - x0;
        if (dg !== 0 || dx !== 0) kredit++;
        line('  ' + mid + ' ' + (dg !== 0 || dx !== 0 ? 'KREDIT' : 'PREVIEW-SAJA') + ' (' + ok + '/' + daftar.length + ')  XP ' + st.xp + (dx ? ' (+' + dx + ')' : '') + ' | gold ' + st.gold + (dg ? ' (+' + dg + ')' : ''));
        await sleep(2000);
    }

    line('');
    line('RINGKASAN ' + (mode === 'tp' ? 'TP Training' : 'SS Training') + ': ' + ok + '/' + daftar.length + ' misi diterima server, ' + kredit + ' benar-benar dikreditkan');
    line('  XP akhir ' + st.xp + ' | gold akhir ' + st.gold);
    process.exit(0);
})().catch(e => { line('FATAL ' + e.message); process.exit(1); });
