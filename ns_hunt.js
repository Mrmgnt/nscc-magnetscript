#!/usr/bin/env node
/**
 * ns_hunt.js — Hunting House & Eudemon Dragon (Eudemon Garden) Bot
 * cc: MagnetScript(Razki)
 *
 * Fitur & Mode:
 *   1. node ns_hunt.js status
 *      -> Cek status lengkap Hunting House (tiket item509, klaim harian, boss zone)
 *         & Eudemon Dragon (10 room, sisa jatah 1x Free / 3x Emblem).
 *
 *   2. node ns_hunt.js claim
 *      -> Auto Claim Daily Hunting House Passport (5 tiket Free / 10 tiket Emblem) tanpa battle.
 *
 *   3. node ns_hunt.js eudemon [jumlahRoom] [jedaDetik] [mulaiRoom]
 *      -> Farming Eudemon Dragon / Eudemon Garden saja.
 *         Otomatis deteksi Emblem (3x lawan per room) & Free User (1x lawan per room).
 *         Menyelesaikan seluruh sisa kuota di semua room sampai habis (0x).
 *
 *   4. node ns_hunt.js house [maksBattle] [jedaDetik]
 *      -> Auto Claim Daily Hunting House Passport + Battle Boss Hunting House (selama tiket cukup).
 *
 *   5. node ns_hunt.js daily [jumlahRoom] [jedaDetik]
 *      -> Paket Harian: Auto Claim Daily Hunting House (tanpa battle HH) + Farming Eudemon Dragon Full (3x/1x).
 *
 *   6. node ns_hunt.js both [jumlahRoom] [jedaDetik]
 *      -> Jalankan Keduanya: Auto Claim & Battle Hunting House + Farming Eudemon Dragon Full.
 */
'use strict';
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const crypto = require('crypto');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log(s);

// Server amf.ninjasaga.cc menolak finishHunting jika durasi battle < 10 detik ("Battle completed too quickly")
// dan langsung menghanguskan sesi startHunting tersebut. Gunakan minimal 10.5 detik agar 100% commit ke DB.
const MIN_BATTLE_WAIT_MS = 10500;

function kv(s) {
    let o = '';
    for (const ch of String(s || '')) {
        const i = 'GhKmNpRtVwYzJqSx'.indexOf(ch);
        o += i < 0 ? ch : '0123456789abcdef'.charAt(i);
    }
    return o;
}

// _eh dari Battle.as:10702
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

function countTickets(essenceStr) {
    if (!essenceStr) return 0;
    return String(essenceStr)
        .split(',')
        .map(x => x.trim())
        .filter(x => x === 'item509' || x.startsWith('item509:'))
        .reduce((acc, item) => {
            if (item.includes(':')) return acc + (Number(item.split(':')[1]) || 1);
            return acc + 1;
        }, 0);
}

function parseRewardInfo(fb) {
    const rewardAll = Array.isArray(fb.reward) ? fb.reward : [];
    const rewardGet = Array.isArray(fb.reward_get) ? fb.reward_get : [];
    let xpGain = 0;
    let goldGain = 0;
    const items = [];
    for (const r of rewardAll) {
        const str = String(r || '');
        if (str.startsWith('xp_') || str.startsWith('xp')) {
            xpGain += Number(str.replace(/^xp_?/, '')) || 0;
        } else if (str.startsWith('gold_') || str.startsWith('gold')) {
            goldGain += Number(str.replace(/^gold_?/, '')) || 0;
        }
    }
    const itemSource = rewardGet.length ? rewardGet : rewardAll;
    for (const r of itemSource) {
        const str = String(r || '');
        if (!str.startsWith('xp') && !str.startsWith('gold') && !str.startsWith('petxp')) {
            items.push(str);
        }
    }
    return { xpGain, goldGain, items, raw: rewardAll };
}

(async () => {
    const rawMode = (process.argv[2] || 'status').toLowerCase();
    const maks = Number(process.argv[3] || 10);
    const defaultJeda = Number(process.env.NS_HUNT_DELAY || 10.5);
    const reqJeda = Number(process.argv[4] || defaultJeda);
    const battleWaitMs = Math.max(MIN_BATTLE_WAIT_MS, Math.round(reqJeda * 1000));
    const battleWaitSecLabel = (battleWaitMs / 1000).toFixed(1).replace(/\.0$/, '');
    const mulaiRoom = Math.max(0, Number(process.argv[5] || 0));

    c.enableGracefulStop('menu bot');
    const u = process.env.NS_USER, p = process.env.NS_PASS;
    if (!u || !p) { line('Butuh NS_USER dan NS_PASS.'); process.exit(1); }

    const s = await c.login(u, p);
    if (!s.ok) {
        line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')');
        process.exit(2);
    }
    const h = k.mk(s.sessionKey);
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) { line('Gagal ambil karakter.'); process.exit(3); }
    const charId = row[0];
    // Di Account.as: FREE = 1, PREMIUM (EMBLEM) = 2
    const isEmblem = Boolean(s.isEmblem || Number(s.accountType) === 2);
    line('Karakter aktif : ' + charId + ' "' + row[1] + '" (Lv ' + (row[2] || '?') + ') [' + (isEmblem ? 'EMBLEM' : 'FREE') + ']');

    async function baca(maxRetries = 10) {
        for (let i = 0; i < maxRetries; i++) {
            const b = (await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId])).body || {};
            if (b.gk) {
                const x = b.result || {};
                const inv = x.character_inventory || {};
                const essenceRaw = inv.char_essence_item != null ? inv.char_essence_item : (x.character_essence_item || x.char_essence_item || '');
                return {
                    gk: String(b.gk),
                    level: Number(x.character_level),
                    xp: Number(x.character_xp),
                    gold: Number(x.character_gold),
                    mission: String(x.character_mission || ''),
                    essenceRaw: String(essenceRaw || ''),
                    tickets: countTickets(essenceRaw),
                };
            }
            // Server memberlakukan cooldown ~12-15s jika getCharacterById baru saja dipanggil
            await sleep(3000);
        }
        return null;
    }

    let st = await baca(10);
    if (!st) { line('Gagal membaca data karakter (server cooldown). Coba beberapa detik lagi.'); process.exit(3); }

    const exRes = await c.amf('CharacterDAO.getExtraData', [s.sessionKey, charId, s.token, st.gk]);
    const ex = (exRes && exRes.body && exRes.body.result) ? exRes.body.result : {};
    const gk3 = kv(String(ex.recent_achievement || ''));
    const gk4 = kv(String(ex.map_key || ''));
    const egv = String(ex.q7t || '');
    const ivg = String(ex.z9t || '');

    // Helper: Ambil status Hunting House (ItemDAO.getCharacterHuntingList)
    async function getHuntingHouseInfo() {
        const res = await c.amf('ItemDAO.getCharacterHuntingList', [s.sessionKey]);
        const b = (res && res.body) || {};
        const list = b.hunting_list || {};
        const zones = [];
        for (const zKey of Object.keys(list)) {
            const arr = list[zKey];
            if (!Array.isArray(arr) || arr.length === 0) continue;
            if (zKey === 'zone0') {
                const sp = arr.map(x => Array.isArray(x) ? x[0] : x).filter(Boolean);
                if (sp.length) zones.push({ zone: zKey, bosses: [sp[0]], mode: 'special' });
            } else {
                zones.push({
                    zone: zKey,
                    bosses: arr,
                    mode: arr.length >= 2 ? 'hard' : 'easy'
                });
            }
        }
        return {
            ok: Number(b.status) === 1,
            raw: b,
            z9n: b.z9 != null ? String(b.z9) : '',
            ivn: b.z9f != null ? String(b.z9f) : '',
            cost: Number(b.hunting_cost || 5),
            updateTime: Number(b.update_time || 0),
            canClaimPassport: Boolean(b.get_hunting_passport || ex.get_hunting_passport),
            zones,
        };
    }

    // Helper: Auto Claim Daily Hunting House Passport (item509: 5 Free / 10 Emblem)
    async function claimDailyPassport() {
        line('== Claim Daily Hunting House Passport (item509) ==');
        const hhInfo = await getHuntingHouseInfo();
        const tiketAwal = st.tickets;
        const claimRes = await c.amf('ItemDAO.getDailyHuntingPassport', [s.sessionKey]);
        const cb = (claimRes && claimRes.body) || {};

        if (Number(cb.status) === 1) {
            const dapat = Number(cb.reward || (isEmblem ? 10 : 5));
            const totalTiket = tiketAwal + dapat;
            st.tickets = totalTiket;
            line('  [OK] Berhasil klaim Daily Hunting Passport: +' + dapat + ' tiket (item509) | Total tiket: ' + totalTiket);
            return { claimed: true, reward: dapat, totalTickets: totalTiket };
        } else {
            const msg = cb.error || (hhInfo.canClaimPassport ? 'Gagal klaim' : 'Sudah diklaim hari ini');
            line('  [INFO] Daily Hunting Passport: ' + msg + ' | Tiket saat ini: ' + tiketAwal);
            return { claimed: false, reward: 0, totalTickets: tiketAwal };
        }
    }

    // Helper: Battle Hunting House (ItemDAO.startHunting -> ItemDAO.getBossReward)
    async function runHuntingHouseBattles(maxBattles) {
        await claimDailyPassport();
        line('');
        line('== Farming Hunting House Boss ==');
        if (st.level < 5) {
            line('  [SKIP] Hunting House terbuka mulai Level 5 (Level saat ini: ' + st.level + ').');
            return { tried: 0, won: 0 };
        }

        let tried = 0, won = 0;
        for (let bIdx = 0; bIdx < maxBattles; bIdx++) {
            const hh = await getHuntingHouseInfo();
            if (!hh.ok) {
                line('  [STOP] Gagal mengambil daftar boss Hunting House: ' + JSON.stringify(hh.raw).slice(0, 160));
                break;
            }
            if (!hh.zones.length) {
                line('  [STOP] Tidak ada boss Hunting House yang tersedia di map.');
                break;
            }
            if (st.tickets < hh.cost) {
                line('  [STOP] Tiket Hunting Passport (item509) tidak cukup: sisa ' + st.tickets + ' tiket, butuh ' + hh.cost + ' tiket.');
                break;
            }
            if (!gk4 || !hh.z9n) {
                line('  [STOP] Token Hunting House (gk4/z9n) kosong.');
                break;
            }

            // Pilih boss: prioritaskan zone hard (2 boss = 2x drop untuk biaya tiket yang sama), lalu easy
            const sortedZones = hh.zones.slice().sort((a, b) => b.bosses.length - a.bosses.length);
            const pick = sortedZones[bIdx % sortedZones.length];
            const bosssid = pick.bosses.join(',');

            const slotid = k.zra(gk4, hh.z9n);
            const loc5 = ivg ? k.zra(ivg, hh.z9n) : '';
            const battleLog = hh.ivn ? k.zrb(gk4, hh.ivn) : '';

            const mulai = await c.amf('ItemDAO.startHunting', [s.sessionKey, bosssid, slotid, loc5]);
            const mb = (mulai && mulai.body) || {};
            if (Number(mb.status) !== 1) {
                const err = String(mb.error || JSON.stringify(mb).slice(0, 160));
                line('  [' + pick.zone + '] ' + bosssid + ' startHunting ditolak: ' + err);
                break;
            }

            tried++;
            const sbid = String(mb.startBattleId || mb.sbid || '1');
            st.tickets = Math.max(0, st.tickets - hh.cost);
            line('  [#' + (bIdx + 1) + ' ' + pick.zone + ' (' + pick.mode + ')] Lawan ' + bosssid + ' (biaya ' + hh.cost + ' tiket, sisa ~' + st.tickets + ') -> battle ' + battleWaitSecLabel + 's...');

            await sleep(battleWaitMs);

            const ver = '1';
            const jsonStr2 = '{"battles":[]}';
            const eventArray = ['', 0];
            const sigData = eventArray.join(',');
            const sig = h.getHash(String(bosssid) + '|0|' + sigData);
            const hash = h.getHash(ver + sbid + jsonStr2);
            const br2 = k.br(String(bosssid) + '~0~' + sbid);
            const k8 = (ivg && hh.ivn) ? k.zrb(ivg, hh.ivn) : '';

            const fin = await c.amf('ItemDAO.getBossReward', [
                s.sessionKey, sig, bosssid, 0, eventArray,
                battleLog, ver, sbid, jsonStr2, hash, br2, k8
            ]);

            const fb = (fin && fin.body) || {};
            if (Number(fb.status) === 1) {
                won++;
                const rw = parseRewardInfo(fb);
                const info = [];
                if (rw.xpGain > 0) info.push('XP +' + rw.xpGain.toLocaleString('id-ID'));
                if (rw.goldGain > 0) info.push('Gold +' + rw.goldGain.toLocaleString('id-ID'));
                if (rw.items.length) info.push('Item: ' + rw.items.join(', '));
                line('    -> MENANG! ' + (info.length ? info.join(' | ') : JSON.stringify(rw.raw).slice(0, 180)));
            } else {
                line('    -> GAGAL klaim reward boss: ' + JSON.stringify(fb).slice(0, 200));
            }

            await sleep(1000);
        }

        line('  Ringkasan Hunting House: ' + won + '/' + tried + ' battle sukses | Sisa tiket (item509): ' + st.tickets);
        return { tried, won };
    }

    // Helper: Farming Eudemon Dragon / Eudemon Garden (Full Auto 3x Emblem / 1x Free)
    async function runEudemonGarden(maxRooms) {
        line('== Farming Eudemon Dragon (Eudemon Garden) ==');
        const hsInit = await c.amf('EudemonGarden.getHuntingStatus', [s.sessionKey]);
        const hbInit = (hsInit && hsInit.body) || {};
        const roomsInit = ((hbInit.result || {}).room) || [];
        if (!roomsInit.length) {
            line('  [STOP] Server tidak mengirim daftar room Eudemon Garden.');
            return { tried: 0, won: 0, skippedDone: 0, skippedLock: 0 };
        }
        if (!gk3) {
            line('  [STOP] Token Eudemon Garden (gk3) kosong.');
            return { tried: 0, won: 0, skippedDone: 0, skippedLock: 0 };
        }

        let tried = 0, won = 0, skippedDone = 0, skippedLock = 0;
        let totalXpGained = 0, totalGoldGained = 0;
        let cachedHs = hbInit; // gunakan respons awal untuk battle pertama agar hemat 1 request
        const lockedRooms = new Set();

        const endRoom = Math.min(mulaiRoom + maxRooms, roomsInit.length);

        async function clearRoom(roomIdx) {
            const rInfo = roomsInit[roomIdx];
            if (!rInfo) return;
            const initialTime = Number(rInfo.time || 0);
            const namaBoss = Array.isArray(rInfo.boss) ? rInfo.boss.join('+') : String(rInfo.boss || '');

            if (initialTime <= 0) {
                skippedDone++;
                line('  [Room ' + roomIdx + '] ' + namaBoss + ' (Rank ' + rInfo.rank + ') -> SKIP (Jatah: 0x)');
                return;
            }

            const kuotaLabel = Math.max(initialTime, isEmblem ? 3 : 1);
            let safetyTries = 0;
            const maxSafetyTries = initialTime + 3;

            while (safetyTries < maxSafetyTries) {
                safetyTries++;
                const hb2 = cachedHs || ((await c.amf('EudemonGarden.getHuntingStatus', [s.sessionKey])).body || {});
                cachedHs = null;

                const q7b = String(hb2.q7 || '');
                const q7fb = String(hb2.q7f || '');
                const rooms2 = ((hb2.result || {}).room) || [];
                const room = rooms2[roomIdx] || rInfo;
                const sisaTime = Number(room.time != null ? room.time : 0);

                if (sisaTime <= 0) {
                    break;
                }

                const keBerapa = kuotaLabel - sisaTime + 1;
                const enemyStr = Array.isArray(room.boss) ? room.boss.join(',') : String(room.boss || '');
                const currBoss = k.tokenBoss(gk3, q7b);
                const egvTok = egv ? k.tokenBoss(egv, q7b) : '';
                const battleLog = q7fb ? k.tokenLog(gk3, q7fb) : '';
                const loc4 = h.getHash(String(roomIdx) + enemyStr);

                const mulai = await c.amf('EudemonGarden.startHunting', [s.sessionKey, roomIdx, currBoss, loc4, egvTok, enemyStr]);
                const mb = (mulai && mulai.body) || {};

                if (Number(mb.status) !== 1) {
                    const err = String(mb.error || '');
                    if (/daily limit/i.test(err)) {
                        skippedDone++;
                        line('  [Room ' + roomIdx + '] ' + enemyStr + ' -> Limit harian room ini sudah habis.');
                    } else if (/level is too low/i.test(err)) {
                        skippedLock++;
                        lockedRooms.add(roomIdx);
                        line('  [Room ' + roomIdx + '] ' + enemyStr + ' -> Level karakter belum cukup untuk room ini.');
                    } else {
                        line('  [Room ' + roomIdx + '] ' + enemyStr + ' startHunting ditolak: ' + (err || JSON.stringify(mb).slice(0, 140)));
                    }
                    break;
                }

                tried++;
                // Penting: di Main.as:1140, Central.main.startBattleId bernilai default "1"
                const sbid = String(mb.startBattleId || mb.sbid || '1');
                line('  [Room ' + roomIdx + ' | Lawan ' + Math.max(1, keBerapa) + '/' + kuotaLabel + '] ' + enemyStr + ' (Sisa jatah: ' + sisaTime + 'x) -> battle ' + battleWaitSecLabel + 's...');
                await sleep(battleWaitMs);

                const json = '{"battles":[]}';
                const fin = await c.amf('EudemonGarden.finishHunting', [
                    s.sessionKey, roomIdx, [], 0, h.getHash(String(roomIdx) + 0), '1',
                    battleLog, sbid, json, h.getHash('1' + sbid + json),
                    eh(String(roomIdx) + '|0|' + sbid), egv
                ]);

                const fb = (fin && fin.body) || {};
                if (Number(fb.status) === 1) {
                    won++;
                    const rw = parseRewardInfo(fb);
                    const xpDapat = rw.xpGain || Number(room.xp || 0);
                    const goldDapat = rw.goldGain || Number(room.gold || 0);
                    totalXpGained += xpDapat;
                    totalGoldGained += goldDapat;
                    const itemKet = rw.items.length ? ' | Drop: ' + rw.items.join(', ') : '';
                    line('    -> MENANG! XP +' + xpDapat.toLocaleString('id-ID') + ' | Gold +' + goldDapat.toLocaleString('id-ID') + itemKet);
                } else {
                    const fErr = String(fb.error || JSON.stringify(fb).slice(0, 160));
                    line('    -> finishHunting gagal (' + fErr + '), akan diulang dari startHunting...');
                }

                await sleep(1000);
            }
        }

        // Pass 1: Bersihkan seluruh room dari mulaiRoom s/d endRoom
        for (let i = mulaiRoom; i < endRoom; i++) {
            await clearRoom(i);
        }

        // Pass 2 (Verifikasi Akhir): Pastikan tidak ada room terbuka yang masih menyisakan jatah > 0
        const hsVerify = await c.amf('EudemonGarden.getHuntingStatus', [s.sessionKey]);
        const hbVerify = (hsVerify && hsVerify.body) || {};
        const roomsVerify = ((hbVerify.result || {}).room) || [];
        let sisaBelumSelesai = 0;
        for (let i = mulaiRoom; i < Math.min(endRoom, roomsVerify.length); i++) {
            const rem = Number((roomsVerify[i] && roomsVerify[i].time) || 0);
            if (rem > 0 && !lockedRooms.has(i)) {
                sisaBelumSelesai += rem;
                roomsInit[i] = roomsVerify[i];
            }
        }

        if (sisaBelumSelesai > 0) {
            line('');
            line('  [VERIFIKASI] Masih ada ' + sisaBelumSelesai + 'x sisa jatah Eudemon Dragon, menyelesaikan otomatis...');
            cachedHs = hbVerify;
            for (let i = mulaiRoom; i < Math.min(endRoom, roomsVerify.length); i++) {
                const rem = Number((roomsVerify[i] && roomsVerify[i].time) || 0);
                if (rem > 0 && !lockedRooms.has(i)) {
                    await clearRoom(i);
                }
            }
        }

        line('');
        line('  Ringkasan Eudemon Dragon: ' + won + '/' + tried + ' battle sukses | Total Reward XP +' + totalXpGained.toLocaleString('id-ID') + ' | Total Gold +' + totalGoldGained.toLocaleString('id-ID') +
            (skippedDone ? ' | ' + skippedDone + ' room sudah 0x' : '') +
            (skippedLock ? ' | ' + skippedLock + ' room terkunci level' : ''));
        return { tried, won, skippedDone, skippedLock, totalXpGained, totalGoldGained };
    }

    // ─────────────────────────────────────────────────────────
    // EKSEKUSI BERDASARKAN MODE
    // ─────────────────────────────────────────────────────────
    if (rawMode === 'status') {
        const hh = await getHuntingHouseInfo();
        const hs = await c.amf('EudemonGarden.getHuntingStatus', [s.sessionKey]);
        const rooms = (((hs && hs.body && hs.body.result) || {}).room) || [];

        line('');
        line('=== STATUS HUNTING HOUSE ===');
        line('  Tiket Hunting Passport (item509) : ' + st.tickets + ' tiket');
        line('  Jatah Klaim Harian (5/10 tiket)  : ' + (hh.canClaimPassport ? 'BELUM DIKLAIM (Siap Klaim!)' : 'Sudah diklaim hari ini'));
        line('  Biaya Battle Saat Ini            : ' + hh.cost + ' tiket');
        if (hh.zones.length) {
            line('  Daftar Zone Boss Aktif           : ' + hh.zones.map(z => z.zone + '(' + z.bosses.join('+') + ')').join(', '));
        }

        line('');
        line('=== STATUS EUDEMON DRAGON (' + rooms.length + ' Room) ===');
        let totalSisaEudemon = 0;
        rooms.forEach((r, i) => {
            const nama = Array.isArray(r.boss) ? r.boss.join('+') : String(r.boss || '');
            const sisa = Number(r.time || 0);
            totalSisaEudemon += sisa;
            line('  [' + i + '] Rank ' + r.rank + ' | ' + nama.padEnd(18) + ' | XP ' + String(r.xp).padEnd(6) + ' | Gold ' + String(r.gold).padEnd(6) + ' | Jatah: ' + sisa + 'x');
        });
        line('  Total Sisa Battle Eudemon Hari Ini: ' + totalSisaEudemon + 'x (' + (isEmblem ? 'Akun Emblem: 3x/room' : 'Akun Free: 1x/room') + ')');
        line('');
        line('Karakter: Level ' + st.level + ' | XP ' + st.xp.toLocaleString('id-ID') + ' | Gold ' + st.gold.toLocaleString('id-ID'));
        process.exit(0);
    }

    if (rawMode === 'claim') {
        await claimDailyPassport();
        process.exit(0);
    }

    if (rawMode === 'house' || rawMode === 'hunting') {
        await runHuntingHouseBattles(maks);
        process.exit(0);
    }

    if (rawMode === 'eudemon' || rawMode === 'dragon') {
        await runEudemonGarden(maks);
        process.exit(0);
    }

    if (rawMode === 'daily' || rawMode === 'eudemon_claim') {
        await claimDailyPassport();
        line('');
        await runEudemonGarden(maks);
        process.exit(0);
    }

    if (rawMode === 'both' || rawMode === 'all' || rawMode === 'run') {
        await runHuntingHouseBattles(maks);
        line('');
        await runEudemonGarden(maks);
        process.exit(0);
    }

    line('Mode tidak dikenal: ' + rawMode);
    line('Gunakan: status | claim | eudemon | house | daily | both');
    process.exit(1);
})().catch(e => {
    line('FATAL ' + e.message);
    process.exit(1);
});
