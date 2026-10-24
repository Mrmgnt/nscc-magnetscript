#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_event.js — bot event battle NinjaSaga (beta 1: TERVERIFIKASI server).
 *
 *   Halloween Event battle  : panel Halloween_battle_2016, 5 musuh, biaya 1 "heart" per battle
 *   Kage Apprenticeship     : panel kage_battle, musuh enemy571 (Tengu Goblin), biaya 10 "energy"
 *
 * Alur yang benar (hasil uji nyata 2026-10-18):
 *   1. <Event>.getBattleStatus [sk]                      -> sisa heart/energy
 *   2. <Event>.startBattle      [sk, enemyId, H(enemyId)] -> potong heart/energy
 *   3. ItemDAO.getBossReward    [sk, sig, bossId, 0, ["token",0], battleLog, ver,
 *                                startBattleId, json, hash, _br, _k8] -> reward
 *      sig  = H(bossId + "|0|token,0")     hash = H(ver + startBattleId + json)
 *      _br dan _k8 boleh string kosong (server menerima; sudah diuji).
 *
 * Pakai:
 *   NS_USER=... NS_PASS=... node ns_event.js halloween [maksBattle]
 *   NS_USER=... NS_PASS=... node ns_event.js kage [maksBattle]
 *   NS_USER=... NS_PASS=... node ns_event.js all [maksBattle]
 * default maksBattle = 99 (artinya: sampai heart/energy habis).
 */
'use strict';
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const line = s => console.log(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Furious Zombie (enemy535) adalah boss utama Halloween — diprioritaskan pertama
const HALLOWEEN_ENEMY = ['enemy535', 'enemy534', 'enemy536', 'enemy537', 'enemy538'];
const HALLOWEEN_NAMA = { enemy534: 'Ghost', enemy535: 'Furious Zombie', enemy536: 'Skull Samurai', enemy537: 'Skeleton Ninja', enemy538: 'Bone Spirit' };
const KAGE_ENEMY = 'enemy571';
const JSON_EMPTY = '{"battles":[]}';

async function login() {
    c.enableGracefulStop('menu bot');
    const u = process.env.NS_USER, p = process.env.NS_PASS;
    if (!u || !p) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }
    const s = await c.login(u, p);
    if (!s.ok) { line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')'); process.exit(2); }
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) {
        line('GAGAL ambil karakter: ' + JSON.stringify(rl.body || rl));
        process.exit(2);
    }
    line('Karakter aktif : ' + row[0] + ' "' + row[1] + '" (Lv ' + (row[2] || '?') + ')');
    return { s, charId: row[0], nama: row[1] };
}

async function baca(ctx) {
    for (let i = 1; i <= 6; i++) {
        const r = await c.amf('CharacterDAO.getCharacterById', [ctx.s.sessionKey, ctx.charId]);
        const b = r.body || {};
        if (b.gk) {
            const x = b.result || {};
            return { gk: String(b.gk), level: Number(x.character_level), xp: Number(x.character_xp), gold: Number(x.character_gold), currency: String(x.character_common_currency || '') };
        }
        await sleep(6000);
    }
    return null;
}

/** satu kali battle event: status -> start -> reward */
async function satuBattle(ctx, svc, enemy, index) {
    const sk = ctx.s.sessionKey;
    const st = await c.amf(svc + '.getBattleStatus', [sk]);
    const res = (st.body && st.body.result) || {};
    if (st.body && Array.isArray(st.body.reward_list)) ctx.rewardList = st.body.reward_list;
    const sisa = res.remain_heart != null ? res.remain_heart : res.energy;
    const biaya = res.battle_cost != null ? res.battle_cost : 1;
    if (sisa == null) return { ok: false, alasan: 'status tak terbaca: ' + JSON.stringify(st.body).slice(0, 160) };
    if (Number(sisa) < Number(biaya)) return { ok: false, habis: true, alasan: 'sisa ' + sisa + ' < biaya ' + biaya };
    let mulai = null;
    // server memberi cooldown "Please wait" / respons kosong -> tunggu lalu ulang
    for (let coba = 1; coba <= 5; coba++) {
        mulai = await c.amf(svc + '.startBattle', [sk, enemy, k.sha1(enemy + k.SALT + sk)]);
        const mb = mulai.body || {};
        const err = String(mb.error || '');
        if (Number(mb.status) === 1) break;
        if ((!mulai.body || !mb.status) && coba < 5) { line('  (respons kosong, tunggu 20s lalu ulang)'); await sleep(20000); continue; }
        if (/please wait/i.test(err) && coba < 5) { line('  (cooldown, tunggu 25s lalu ulang)'); await sleep(25000); continue; }
        if (/energy|heart|not enough|insufficient/i.test(err)) return { ok: false, habis: true, alasan: 'sumber daya habis: ' + err };
        return { ok: false, alasan: 'startBattle ditolak: ' + JSON.stringify(mulai.body).slice(0, 200) };
    }
    if (!mulai.body || Number(mulai.body.status) !== 1) {
        return { ok: false, alasan: 'startBattle ditolak: ' + JSON.stringify(mulai.body).slice(0, 200) };
    }
    await sleep(2000 + index * 250);

    // Payload lengkap sesuai Battle.as (subType BOSS, jalur token):
    // [sk, sig, bossId, 0, EventArray, battleLog, ver, startBattleId, json, hash, _br, _k8]
    const ver = '1';
    const sbId = String(mulai.body.startBattleId || ctx.startBattleId || '1');
    ctx.startBattleId = sbId;
    const json = JSON_EMPTY;
    const sig = k.sha1(enemy + '|0|token,0' + k.SALT + sk);
    const hsh = k.sha1(ver + sbId + json + k.SALT + sk);
    const br = k.br(enemy + '~0~' + sbId);
    const k8 = ctx.ivn ? k.zrb(String(ctx.ivg || ''), String(ctx.ivn)) : '';
    // Retry getBossReward sampai 3x agar reward benar-benar masuk
    let rw = null;
    for (let coba = 1; coba <= 3; coba++) {
        rw = await c.amf('ItemDAO.getBossReward', [sk, sig, enemy, 0, ['token', 0], '', ver, sbId, json, hsh, br, k8]);
        const b = rw.body || {};
        if (b.z9f != null) ctx.ivn = String(b.z9f);
        if (Number(b.status) === 1) break;
        if (coba < 3) { line('  getBossReward gagal (coba ' + coba + '/3), tunggu 10s...'); await sleep(10000); }
    }
    const b = rw.body || {};
    if (b.z9f != null) ctx.ivn = String(b.z9f);
    if (Number(b.status) !== 1) return { ok: false, alasan: 'getBossReward ditolak (3x): ' + JSON.stringify(b).slice(0, 250) };
    return { ok: true, sisaSebelum: sisa, reward: b.reward || [], dapat: b.reward_get || [], rewardGet: b.reward_get };
}

async function klaimKage(ctx) {
    const sk = ctx.s.sessionKey;
    const st = await c.amf('Anni9th.kageMissionStatus', [sk]);
    const b = st.body || {};
    if (Number(b.status) !== 1) { line('  kageMissionStatus gagal: ' + JSON.stringify(b).slice(0, 200)); return; }
    const inv = {};
    String(ctx.st.currency || '').split(',').forEach(p => { const [i, q] = p.split(':'); if (i) inv[i] = Number(q); });
    const misi = b.mission || [];
    const siap = misi.filter(m => Number(m.claim_status) === 0 && Object.keys(m.target || {}).every(t => inv[String(t).replace('item_', '')] >= m.target[t]));
    if (!siap.length) { line('  belum ada misi Kage yang materialnya cukup (' + misi.length + ' misi, sudah claim ' + misi.filter(m => m.claim_status !== 0).length + ')'); return; }
    for (const m of siap) {
        const r = await c.amf('Anni9th.claimKageMissionReward', [sk, m.mission_id]);
        const rb = r.body || {};
        line('  claim ' + m.mission_id + ': ' + (Number(rb.status) === 1 ? 'OK ' + JSON.stringify(rb.reward || rb.result || '') : 'GAGAL ' + JSON.stringify(rb.error || rb).slice(0, 150)));
        await sleep(1500);
    }
}

(async () => {
    const mode = (process.argv[2] || 'all').toLowerCase();
    const maks = Number(process.argv[3] || 99);
    const ctx = await login();
    line('akun      : ' + ctx.s.username);
    line('karakter  : ' + ctx.charId + ' "' + ctx.nama + '"');
    ctx.st = await baca(ctx);
    if (!ctx.st) { line('gagal baca karakter'); process.exit(3); }
    // ivg (extraData.z9t) + ivn dipakai untuk _k8 = _zrb(ivg, ivn); ivn berganti tiap respons
    try {
        const exRes = await c.amf('CharacterDAO.getExtraData', [ctx.s.sessionKey, ctx.charId, ctx.s.token, ctx.st.gk]);
        const ex = (exRes && exRes.body && exRes.body.result) ? exRes.body.result : {};
        ctx.ivg = ex.z9t ? String(ex.z9t) : '';
    } catch (e) { ctx.ivg = ''; }
    line('level ' + ctx.st.level + ' | XP ' + ctx.st.xp + ' | gold ' + ctx.st.gold);
    line('');

    let total = 0, kredit = 0;
    if (mode === 'halloween' || mode === 'all') {
        line('== Halloween Event battle (Furious Zombie enemy535 + lainnya) ==');
        for (let i = 0; i < maks; i++) {
            const enemy = HALLOWEEN_ENEMY[i % HALLOWEEN_ENEMY.length];
            const namaEnemy = HALLOWEEN_NAMA[enemy] || enemy;
            const sebelum = ctx.st;
            const r = await satuBattle(ctx, 'HalloweenEvent2016', enemy, i);
            if (!r.ok) { line((r.habis ? 'STOP  heart habis. ' : 'STOP  ') + r.alasan); break; }
            total++;
            const sesudah = await baca(ctx) || sebelum;
            const dxp = sesudah.xp - sebelum.xp, dgold = sesudah.gold - sebelum.gold;
            if (dxp !== 0 || dgold !== 0) kredit++;
            const rewardStr = r.rewardGet && r.rewardGet.length ? JSON.stringify(r.rewardGet) : JSON.stringify(r.reward);
            line('  #' + (i + 1) + ' ' + namaEnemy + ' (' + enemy + ') OK  heart sisa ' + (r.sisaSebelum - 1) + '  reward ' + rewardStr +
                (dxp || dgold ? '  | KREDIT XP +' + dxp + ' gold +' + dgold : '  | TIDAK MASUK (server cuma kirim preview reward)'));
            ctx.st = sesudah;
            await sleep(1500);
        }
        line('');
    }

    if (mode === 'kage' || mode === 'all') {
        line('== Kage Apprenticeship battle (enemy571 / Tengu Goblin) ==');
        for (let i = 0; i < maks; i++) {
            const sebelum = ctx.st;
            const r = await satuBattle(ctx, 'Anni9th', KAGE_ENEMY, i);
            if (!r.ok) { line((r.habis ? 'STOP  energy habis. ' : 'STOP  ') + r.alasan); break; }
            total++;
            const sesudah = await baca(ctx) || sebelum;
            const dxp = sesudah.xp - sebelum.xp, dgold = sesudah.gold - sebelum.gold;
            if (dxp !== 0 || dgold !== 0) kredit++;
            line('  #' + (i + 1) + ' ' + KAGE_ENEMY + ' OK  energy sisa ~' + (r.sisaSebelum - 10) + '  reward ' + JSON.stringify(r.reward) +
                (dxp || dgold ? '  | KREDIT XP +' + dxp + ' gold +' + dgold : '  | TIDAK MASUK ke karakter'));
            ctx.st = sesudah;
            await sleep(1500);
        }
        ctx.st = await baca(ctx) || ctx.st;
        line('  cek klaim Kage:');
        await klaimKage(ctx);
        line('');
    }

    const akhir = await baca(ctx) || ctx.st;
    line('RINGKASAN  battle sukses ' + total + ' | masuk ke karakter ' + kredit + ' | gold ' + ctx.st.gold + ' -> ' + akhir.gold + ' | XP ' + akhir.xp);
    process.exit(0);
})().catch(e => { line('FATAL ' + e.message); process.exit(1); });
