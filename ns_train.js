#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_train.js — training harian NinjaSaga.
 *
 *   node ns_train.js tp [maksMisi] [jedaDetik]   -> TP Training  (msn170..msn174, 10 TP per misi)
 *   node ns_train.js ss [maksMisi] [jedaDetik]   -> SS / Senjutsu Training (msn279..msn283)
 *   node ns_train.js all [maksMisi] [jedaDetik]  -> Jalankan TP Training + SS Training
 *
 * TP Training = misi quest berhadiah TP (msn170..msn174, lv40, 2000 XP/gold, 10 TP).
 * SS Training  = misi quest berhadiah SS (msn279..msn283, lv80, 10000 XP/gold, 30 SS).
 * KEDUANYA jalur misi biasa: startMission -> updateCharacter.
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

async function runTrainSession(opts = {}) {
    const mode = String(opts.mode || process.argv[2] || 'tp').toLowerCase();
    const maks = Number(opts.maks !== undefined ? opts.maks : (process.argv[3] || 5));
    const jeda = Number(opts.jeda !== undefined ? opts.jeda : (process.argv[4] || 11));
    const paksa = Boolean(opts.paksa || process.argv.includes('--paksa'));
    const shared = opts.shared || null;

    const u = (shared && shared.user) || process.env.NS_USER;
    const p = (shared && shared.pass) || process.env.NS_PASS;
    if (!u || !p) { line('Butuh NS_USER dan NS_PASS.'); return { exitCode: 1, kredit: 0 }; }
    if (mode !== 'tp' && mode !== 'ss' && mode !== 'all') { line('Pakai: node ns_train.js tp|ss|all [maks] [jeda]'); return { exitCode: 1, kredit: 0 }; }

    let s = (shared && shared.s) || null;
    let h = (shared && shared.h) || null;
    let charId = (shared && shared.charId) || null;
    let row = (shared && shared.row) || null;

    if (!s) {
        s = await c.login(u, p);
        if (!s.ok) { line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')'); return { exitCode: 2, kredit: 0 }; }
        h = k.mk(s.sessionKey);
    }
    if (!h) h = k.mk(s.sessionKey);

    if (!charId || !row) {
        const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
        const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
        row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
        if (!row) { line('ERROR: Tidak ada karakter ditemukan.'); return { exitCode: 3, kredit: 0 }; }
        charId = row[0];
    }
    if (!shared) {
        line('Karakter aktif : ' + charId + ' "' + row[1] + '" (Lv ' + (row[2] || '?') + ') [' + (s.isEmblem ? 'EMBLEM' : 'FREE') + ']');
    }

    async function baca(maxWaitMs = 45000) {
        const res = await c.getCharacterByIdWithWait(s, charId, {
            maxWaitMs,
            credentials: { user: u, pass: p },
            onCooldown: sec => line('  [Cooldown] Menunggu ' + sec + 's sebelum membaca data karakter...')
        });
        if (!res.ok) return null;
        if (res.session && res.session.sessionKey && res.session.sessionKey !== s.sessionKey) {
            s = res.session;
            h = k.mk(s.sessionKey);
        }
        const x = res.result || {};
        return {
            gk: String(res.gk),
            level: Number(x.character_level),
            xp: Number(x.character_xp),
            gold: Number(x.character_gold),
            rank: Number(x.character_rank || 1),
            stamina: x.character_stamina !== undefined && x.character_stamina !== null ? Number(x.character_stamina) : 75,
            mission: String(x.character_mission || ''),
            raw: x
        };
    }

    let extraKeys = null;
    function parseExtraKeys(ex) {
        if (!ex || !ex.isGraphic || !ex.m7v || !ex.statistic_battle || !ex.q7t) {
            return { ok: false, error: 'kunci tanda tangan tidak lengkap dari server', ex: ex || {} };
        }
        const kq0 = kv(String(ex.isGraphic));
        const kq1 = kv(String(ex.statistic_battle));
        const dvx = String(ex.m7v);
        const egv = String(ex.q7t);
        const pet = Array.isArray(ex.player_pet) && ex.player_pet.length ? ex.player_pet[0] : null;
        if (!kq0 || !kq1 || !dvx || !egv) {
            return { ok: false, error: 'kunci tanda tangan kosong setelah decode', ex };
        }
        extraKeys = { kq0, kq1, dvx, egv, pet };
        return { ok: true, ex };
    }

    async function ambilKunciExtra(gk) {
        const exRes = await c.getExtraDataWithRetry(s.sessionKey, charId, s.token, gk, 3);
        if (!exRes.ok || !exRes.result) {
            return { ok: false, error: exRes.error || 'extraData kosong', ex: {} };
        }
        return parseExtraKeys(exRes.result);
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
                    row = rowNew;
                }
                const stNew = await baca(45000);
                if (stNew) {
                    st = stNew;
                    const ek = await ambilKunciExtra(st.gk);
                    if (ek.ok) {
                        if (shared) {
                            shared.s = s; shared.h = h; shared.charId = charId;
                            shared.row = row; shared.st = st; shared.ex = ek.ex;
                        }
                        return true;
                    }
                }
            }
            await sleep(2500);
        }
        return false;
    }

    function cariTP(obj) {
        const out = {};
        for (const kk of Object.keys(obj || {})) if (/tp|train|talent|point/i.test(kk)) {
            const v = obj[kk];
            if (typeof v === 'number' || typeof v === 'string') out[kk] = v;
        }
        return out;
    }

    let st = (shared && shared.st) || await baca(45000);
    if (!st) { line('gagal baca karakter'); return { exitCode: 3, kredit: 0 }; }
    const initExtra = (shared && shared.ex) ? parseExtraKeys(shared.ex) : await ambilKunciExtra(st.gk);
    if (!initExtra.ok || !extraKeys) {
        line('STOP  ' + (initExtra.error || 'kunci tanda tangan extraData gagal diambil'));
        return { exitCode: 4, kredit: 0 };
    }
    if (shared) {
        shared.s = s; shared.h = h; shared.charId = charId;
        shared.row = row; shared.st = st; shared.ex = initExtra.ex;
    }
    const chRaw = st.raw || {};
    line('karakter  : ' + charId + ' | level ' + st.level + ' | XP ' + st.xp + ' | gold ' + st.gold);
    line('field TP karakter : ' + JSON.stringify(cariTP(chRaw)).slice(0, 220));
    line('field TP extraData: ' + JSON.stringify(cariTP(initExtra.ex)).slice(0, 220));
    line('');

    const modesToRun = mode === 'all' ? ['tp', 'ss'] : [mode];
    let hadError = false;
    let totalAccepted = 0;

    for (const curMode of modesToRun) {
        let daftar = (curMode === 'tp' ? TP_MISSIONS : SS_MISSIONS).slice(0, maks);

        if (curMode === 'tp' && st.level < 40) {
            line('TP Training membutuhkan minimal Level 40 (Level karakter saat ini: ' + st.level + '). Dilewati.');
            continue;
        }

        if (curMode === 'ss' && !paksa) {
            if (st.level < 80) {
                line('SS Training membutuhkan minimal Level 80 (Level karakter saat ini: ' + st.level + '). Dilewati.');
                continue;
            }
            let ms = null;
            for (let tryMs = 1; tryMs <= 3; tryMs++) {
                ms = await c.amf('SSTraining.getMissionStatus', [s.sessionKey]);
                if (ms && ms.body && Number(ms.body.status) === 1) break;
                const errTxt = JSON.stringify((ms && ms.body) || ms || '');
                if (/session validation failed|please re-select/i.test(errTxt)) {
                    await relogin();
                }
                if (tryMs < 3) await sleep(2000);
            }
            if (!ms || !ms.body || Number(ms.body.status) !== 1) {
                line('ERROR SS Training: gagal memeriksa SSTraining.getMissionStatus (' + JSON.stringify((ms && ms.body) || (ms && ms.netError) || '').slice(0, 160) + ')');
                hadError = true;
                continue;
            }
            const sisa = ((ms.body.result || {}).mission) || [];
            if (!sisa.length) {
                line('SS Training sudah beres (getMissionStatus kosong). Tidak diulang tanpa --paksa.');
                continue;
            }
            const sisaIds = sisa
                .map(m => {
                    const rawId = typeof m === 'string' || typeof m === 'number' ? String(m) : String((m && (m.id || m.mission_id)) || '');
                    const trimmed = rawId.trim();
                    if (!trimmed) return '';
                    return /^\d+$/.test(trimmed) ? ('msn' + trimmed) : trimmed;
                })
                .filter(Boolean);
            if (sisaIds.length) {
                daftar = sisaIds.slice(0, maks);
            }
            line('SS misi tersisa: ' + daftar.join(', '));
        }

        let ok = 0;
        let kredit = 0;
        let alreadyDone = 0;
        let failedCount = 0;

        for (const mid of daftar) {
            if (!extraKeys) {
                const okRelog = await relogin();
                if (!okRelog || !extraKeys) {
                    line('STOP  kunci tanda tangan tidak tersedia');
                    hadError = true;
                    break;
                }
            }
            const g0 = st.gold, x0 = st.xp;

            let mulai = null;
            for (let coba = 1; coba <= 3; coba++) {
                const { kq0, dvx } = extraKeys;
                const t0 = now();
                mulai = await c.amf('CharacterService.startMission', [s.sessionKey, mid,
                    h.msk(kq0 + '|' + mid + '|' + t0), h.getHash(mid), t0, h.msk(dvx + '|' + mid + '|' + t0)]);
                const mb = (mulai && mulai.body) || {};
                if (Number(mb.status) === 1) break;
                const mbTxt = JSON.stringify(mb);
                if (/session validation failed|please re-select/i.test(mbTxt)) {
                    line('  ' + mid + ' sesi terputus saat startMission — login ulang...');
                    await relogin();
                    continue;
                }
                if (/please wait|wait a moment/i.test(mbTxt)) {
                    await sleep(20000);
                    continue;
                }
                if ((!mulai || !mulai.body) && coba < 3) {
                    await sleep(2500);
                    continue;
                }
                break;
            }

            if (!mulai || !mulai.body || Number(mulai.body.status) !== 1) {
                const mbTxt = JSON.stringify((mulai && mulai.body) || (mulai && mulai.netError) || {});
                if (/already completed today|daily limit/i.test(mbTxt)) {
                    alreadyDone++;
                    line('  ' + mid + ' SUDAH DIKLAIM HARI INI');
                } else {
                    failedCount++;
                    hadError = true;
                    line('  ' + mid + ' DITOLAK start: ' + mbTxt.slice(0, 180));
                }
                continue;
            }

            const cfn = mulai.body.csf ? String(mulai.body.csf) : (mulai.body.cfn ? String(mulai.body.cfn) : '');
            const sbid = mulai.body.startBattleId;
            await sleep(Math.max(10, jeda) * 1000);

            let upd = null;
            for (let coba = 1; coba <= 3; coba++) {
                const { kq1, egv, pet } = extraKeys;
                const bfl = JSON.stringify({ battles: [] });
                const arr = [s.sessionKey, charId, st.level, 0, 0, [], pet ? pet.id : 0, pet ? pet.level : 0, mid, 0, ''];
                upd = await c.amf('CharacterService.updateCharacter', [s.sessionKey, charId, st.level, 0, 0, [],
                    pet ? pet.id : 0, pet ? pet.level : 0, mid, h.getArrayHash(arr), h.updateSequence(), 0, '',
                    '1', h.urk(kq1 + '|' + cfn), sbid, bfl, h.getHash('1' + sbid + bfl),
                    ucEncode(charId + '|0|0|' + mid + '|' + sbid), h.urk(egv + '|' + cfn)]);
                const ub = (upd && upd.body) || {};
                if (Number(ub.status) === 1) break;
                const ubTxt = JSON.stringify(ub);
                if (/please wait/i.test(ubTxt) && coba < 3) {
                    await sleep(10000);
                    continue;
                }
                if ((!upd || !upd.body) && coba < 3) {
                    await sleep(2500);
                    continue;
                }
                break;
            }

            const res = (upd && upd.body) || {};
            if (Number(res.status) !== 1) {
                const resTxt = JSON.stringify(res);
                if (/daily mission already completed today|already completed/i.test(resTxt)) {
                    alreadyDone++;
                    line('  ' + mid + ' SUDAH DIKLAIM HARI INI');
                } else {
                    failedCount++;
                    hadError = true;
                    line('  ' + mid + ' DITOLAK: ' + resTxt.slice(0, 200));
                }
                continue;
            }

            ok++;
            totalAccepted++;
            const inv = res.update_inventory || {};
            if (inv.xp !== undefined && Number(inv.xp) > st.xp) st.xp = Number(inv.xp);
            else st.xp += (curMode === 'tp' ? 2000 : 10000);
            if (inv.gold !== undefined && Number(inv.gold) > st.gold) st.gold = Number(inv.gold);
            else st.gold += (curMode === 'tp' ? 2000 : 10000);

            const dg = st.gold - g0, dx = st.xp - x0;
            if (dg !== 0 || dx !== 0) kredit++;
            line('  ' + mid + ' KREDIT (' + ok + '/' + daftar.length + ')  XP ' + st.xp + (dx ? ' (+' + dx + ')' : '') + ' | gold ' + st.gold + (dg ? ' (+' + dg + ')' : ''));
            await sleep(400);
        }

        line('');
        line('RINGKASAN ' + (curMode === 'tp' ? 'TP Training' : 'SS Training') + ': ' + ok + '/' + daftar.length + ' misi diterima server, ' + kredit + ' benar-benar dikreditkan' + (alreadyDone ? ' | ' + alreadyDone + ' sudah diklaim hari ini' : '') + (failedCount ? ' | ' + failedCount + ' gagal' : ''));
        line('  XP akhir ' + st.xp + ' | gold akhir ' + st.gold);
    }

    return { exitCode: hadError ? 1 : 0, kredit: totalAccepted };
}

if (require.main === module) {
    c.enableGracefulStop('menu bot');
    runTrainSession()
        .then(res => process.exit(res ? res.exitCode : 0))
        .catch(e => { line('FATAL ' + e.message); process.exit(1); });
}

module.exports = { runTrainSession };
