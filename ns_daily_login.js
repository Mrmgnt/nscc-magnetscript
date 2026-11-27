#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_daily_login.js — Full Auto Claim Daily Login, Daily Calendar, Free Scratch Card & Daily Token
 *
 * Berdasarkan ekstraksi resmi SWF live cdn.ninjasaga.cc:
 *   1. Absen Login Beruntun 5 Hari (daily_login.swf / Roulette2):
 *      - GiftService.confirmDailyItemReward([sessionKey]) saat extraData.DailyReward.allow_to_claim === true
 *      - Gashapon.claimDailyLogin([sessionKey]) bila event_daily_login aktif
 *   2. Daily Calendar / Stamp Bulanan (Panel_New_Daily_Login.swf / NewDailyLogin2017):
 *      - NewDailyRewardStamp2017.getStatus([sessionKey, 'en']) -> otomatis cap tanggal login hari ini
 *      - NewDailyRewardStamp2017.claimReward([sessionKey, idx]) untuk tiap milestone berstatus "1"
 *   3. Daily Scratch Card Gratis (daily_login_3.swf & daily_login_4.swf / RouletteService):
 *      - RouletteService.randomAddScatchCard([sessionKey]) + RouletteService.getScratchCardData([sessionKey])
 *      - Lv > 20 (atau Lv >= 20 Non-Genin): RouletteService.scratchCardAtfer20Level([sessionKey, 'free', slot, getHash(sessionKey, 'free')])
 *      - Lv 8..20: RouletteService.scratchCard([sessionKey, 'free', slot, getHash(sessionKey, 'free')])
 *      - 100% AMAN: Dikunci hanya mode 'free', TIDAK PERNAH memakai 'token' berbayar!
 *   4. Claim Token Harian & Bonus Harian (popup_emblemClaim.swf / Popup_LuckyDraw_2014.swf):
 *      - SpecialReward.premiumDailyToken([sessionKey]) (+10 Token Emblem / +5 Token Trial Emblem)
 *      - CharacterDAO.claimEmblemType2XpBonus([sessionKey]) (Bonus XP Harian Emblem 30x)
 *      - CharacterDAO.claimLevelUp([sessionKey, 'claim', getHash(sessionKey, 'claim')]) (Free +1 Level Emblem < Lv 80 non-cap)
 *      - RouletteService.luckySpin([sessionKey]) selama lucky_spin_remaining_spin > 0 (Peluang 1-100 Token x Multiplier)
 *
 * Penggunaan CLI:
 *   node ns_daily_login.js                    # Jalankan semua auto claim harian
 *   node ns_daily_login.js status             # Cek status klaim harian saja tanpa eksekusi
 *   node ns_daily_login.js --no-emblem-levelup # Matikan klaim +1 Level Up Emblem (< Lv 80)
 */
'use strict';

const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const { parseScratchCardReward, parseRewardEntry, formatItemName } = require('./lib/ns_mission_history.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const defaultLine = s => console.log(s);

const RANK_CAPS = {
    1: 20, // Genin
    2: 40, // Chunin
    3: 40,
    4: 60, // Jounin
    5: 60,
    6: 80, // Special Jounin
    7: 80,
    8: 100, // Tutor / Sennin
    9: 100
};

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

function formatDailyRewardItem(itemObj) {
    if (!itemObj || typeof itemObj !== 'object') return 'Hadiah Harian';
    const type = String(itemObj.item_type || '').toUpperCase();
    const amt = Number(itemObj.amount || 0);
    if (type === 'GOLD') return `+${amt.toLocaleString('id-ID')} Gold`;
    if (type === 'TOKEN') return `+${amt} Saga Token ★`;
    if (type === 'TP') return `+${amt} TP`;
    if (type === 'SP') return `+${amt} SP`;
    if (type === 'XP') return `+${Math.round(amt * 100)}% XP`;
    const label = formatItemName(type);
    return amt > 1 ? `${label} x${amt}` : label;
}

function extractCalendarRewardList(statusBody) {
    const b = statusBody && typeof statusBody === 'object' ? statusBody : {};
    const list = Array.isArray(b.item_list) ? b.item_list : [];
    const startIdx = b.part2 === true ? 10 : 0;
    const out = [];
    for (let i = startIdx; i < list.length; i++) {
        const entry = list[i];
        if (!entry) continue;
        out.push(Array.isArray(entry) ? entry.join(',') : String(entry));
    }
    return out;
}

function formatCalendarRewardLabel(rawStr) {
    if (!rawStr) return 'Milestone Reward';
    const parts = String(rawStr).split(',');
    const labels = parts.map(part => {
        const parsed = parseRewardEntry(part.trim());
        return parsed ? parsed.label : part.trim();
    }).filter(Boolean);
    return labels.length ? labels.join(' + ') : String(rawStr);
}

function countTokensInCalendarReward(rawStr) {
    if (!rawStr) return 0;
    let tokens = 0;
    for (const part of String(rawStr).split(',')) {
        const parsed = parseRewardEntry(part.trim());
        if (parsed && parsed.kind === 'token') tokens += parsed.qty;
    }
    return tokens;
}

function parseLuckySpinRewards(rewardArr) {
    const arr = Array.isArray(rewardArr) ? rewardArr : (rewardArr ? [rewardArr] : []);
    let tokens = 0;
    let gold = 0;
    const labels = [];
    for (const raw of arr) {
        const parsed = parseRewardEntry(raw);
        if (!parsed) {
            if (raw) labels.push(String(raw));
            continue;
        }
        if (parsed.kind === 'token') {
            tokens += parsed.qty;
            labels.push(`+${parsed.qty} Saga Token ★`);
        } else if (parsed.kind === 'gold') {
            gold += parsed.qty;
            labels.push(`+${parsed.qty.toLocaleString('id-ID')} Gold`);
        } else {
            labels.push(parsed.label);
        }
    }
    return { tokens, gold, label: labels.length ? labels.join(', ') : 'Hadiah Spin' };
}

function summarizeDailyLoginStatusFromExtra(ex, accountInfo = {}) {
    const extra = (ex && typeof ex === 'object') ? ex : {};
    const dr = extra.DailyReward && typeof extra.DailyReward === 'object' ? extra.DailyReward : null;
    const isEmblem = Boolean(accountInfo.isEmblem || Number(accountInfo.accountType) === 2);
    const isTrialEmblem = !isEmblem && Number(extra.trial_emblem_expire_time || 0) > 0;
    const level = Number(accountInfo.level || 1);
    const rank = Number(accountInfo.rank || 1);
    const rankCap = RANK_CAPS[rank] || 100;

    return {
        dailyAttendance: {
            available: Boolean(dr && dr.allow_to_claim),
            dayIndex: Number((dr && dr.claimed_times) || 0) + 1,
            totalDays: Array.isArray(dr && dr.items) ? dr.items.length : 5,
            nextReward: dr && Array.isArray(dr.items) ? dr.items[Number(dr.claimed_times || 0)] : null
        },
        eventDailyLogin: {
            available: Boolean(extra.event_daily_login && extra.event_daily_login.daily_login)
        },
        dailyCalendar: {
            stampAvailableFlag: extra.daily_stamp_available !== undefined ? Boolean(extra.daily_stamp_available) : null
        },
        scratchCard: {
            unlocked: level >= 8,
            mode: (level > 20 || (level === 20 && rank > 1)) ? 'after20' : 'lv8_20',
            freeRemainingExtra: Math.max(0, Number(extra.free_roulette_times || 0))
        },
        dailyTokens: {
            emblemTokenAvailable: Boolean(extra.premium_daily_token),
            emblemTokenAmount: isEmblem ? 10 : (isTrialEmblem ? 5 : 0),
            emblemXpBonusAvailable: Boolean(isEmblem && extra.emblem_xp_bonus_claim && Number(extra.emblem_xp_bonus_times || 0) < 30),
            emblemLevelUpAvailable: Boolean(isEmblem && extra.premium_claim_level && level < 80 && level < rankCap),
            luckySpinRemaining: Math.max(0, Number(extra.lucky_spin_remaining_spin || 0)),
            consecutiveDays: Number(extra.lucky_spin_consecutive_day || extra.consecutive_days || 0)
        }
    };
}

async function runDailyLoginSession(opts = {}) {
    const mode = String(opts.mode || 'claim').toLowerCase();
    const claimEmblemLevelUp = opts.claimEmblemLevelUp !== false;
    const client = opts.client || c;
    const sleepFn = opts.sleep || sleep;
    const line = opts.log || defaultLine;
    const rng = opts.rng || Math.random;

    const shared = opts.shared || null;
    const u = (shared && shared.user) || opts.user || process.env.NS_USER;
    const p = (shared && shared.pass) || opts.pass || process.env.NS_PASS;
    if (!u || !p) {
        line('Butuh NS_USER dan NS_PASS.');
        return { exitCode: 1, kredit: 0, tokensGained: 0, summary: 'Butuh NS_USER dan NS_PASS' };
    }

    let s = (shared && shared.s) || null;
    let h = (shared && shared.h) || null;
    let charId = (shared && shared.charId) || null;
    let row = (shared && shared.row) || null;

    if (!s) {
        s = await client.login(u, p);
        if (!s || !s.ok) {
            const msg = s ? (s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')') : 'login error';
            line('LOGIN GAGAL: ' + msg);
            return { exitCode: 2, kredit: 0, tokensGained: 0, summary: 'LOGIN GAGAL' };
        }
        h = k.mk(s.sessionKey);
    }
    if (!h) h = k.mk(s.sessionKey);

    if (!charId || !row) {
        const rl = await client.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
        const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
        row = client.getSelectedChar(chars, opts.slot || process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
        if (!row) {
            line('Gagal ambil karakter.');
            return { exitCode: 3, kredit: 0, tokensGained: 0, summary: 'Gagal ambil karakter' };
        }
        charId = row[0];
    }

    const isEmblem = Boolean(s.isEmblem || Number(s.accountType) === 2);

    async function bacaKarakter(maxWaitMs = 45000) {
        const res = await client.getCharacterByIdWithWait(s, charId, {
            maxWaitMs,
            credentials: { user: u, pass: p },
            onCooldown: sec => line('  [Cooldown] Menunggu ' + sec + 's sebelum membaca data karakter...')
        });
        if (!res || !res.ok) return null;
        if (res.session && res.session.sessionKey && res.session.sessionKey !== s.sessionKey) {
            s = res.session;
            h = k.mk(s.sessionKey);
        }
        const x = res.result || {};
        const inv = x.character_inventory || {};
        const essenceRaw = inv.char_essence_item != null ? inv.char_essence_item : (x.character_essence_item || '');
        return {
            gk: String(res.gk),
            level: Number(x.character_level) || Number(row[2]) || 1,
            xp: Number(x.character_xp) || 0,
            gold: Number(x.character_gold) || 0,
            rank: Number(x.character_rank || 1),
            stamina: x.character_stamina !== undefined && x.character_stamina !== null ? Number(x.character_stamina) : 75,
            mission: String(x.character_mission || ''),
            essenceRaw: String(essenceRaw || ''),
            tickets: countTickets(essenceRaw),
            raw: x
        };
    }

    let st = (shared && shared.st) || await bacaKarakter(45000);
    if (!st) {
        line('Gagal membaca data karakter (server cooldown).');
        return { exitCode: 3, kredit: 0, tokensGained: 0, summary: 'Gagal baca karakter' };
    }

    let ex = (shared && shared.ex) || null;
    if (!ex) {
        const exRes = await client.getExtraDataWithRetry(s.sessionKey, charId, s.token, st.gk, 3);
        if (!exRes || !exRes.ok || !exRes.result) {
            line('Gagal membaca extraData karakter: ' + ((exRes && exRes.error) || 'kosong'));
            return { exitCode: 4, kredit: 0, tokensGained: 0, summary: 'Gagal extraData' };
        }
        ex = exRes.result;
    }

    if (shared) {
        shared.s = s;
        shared.h = h;
        shared.charId = charId;
        shared.row = row;
        shared.st = st;
        shared.ex = ex;
    }

    const isTrialEmblem = !isEmblem && Number(ex.trial_emblem_expire_time || 0) > 0;
    const statusSnapshot = summarizeDailyLoginStatusFromExtra(ex, {
        isEmblem,
        accountType: s.accountType,
        level: st.level,
        rank: st.rank
    });

    if (!shared) {
        line('Karakter aktif : ' + charId + ' "' + row[1] + '" (Lv ' + st.level + ') [' + (isEmblem ? 'EMBLEM' : (isTrialEmblem ? 'TRIAL EMBLEM' : 'FREE')) + ']');
    }

    if (mode === 'status') {
        let calStatus = null;
        try {
            const calRes = await client.amf('NewDailyRewardStamp2017.getStatus', [s.sessionKey, 'en']);
            const cb = (calRes && calRes.body) || {};
            if (!calRes.fault && (Number(cb.status) === 1 || Array.isArray(cb.loginDay))) {
                const stampedDays = Array.isArray(cb.loginDay) ? cb.loginDay.filter(d => String(d) === '1').length : 0;
                const claimableMilestones = Array.isArray(cb.claimReward)
                    ? cb.claimReward.filter(v => String(v) === '1').length
                    : 0;
                const claimedMilestones = Array.isArray(cb.claimReward)
                    ? cb.claimReward.filter(v => String(v) === '2').length
                    : 0;
                calStatus = { stampedDays, claimableMilestones, claimedMilestones };
            }
        } catch (_) { }

        line('\n== STATUS KLAIM LOGIN HARIAN ==');
        line(`  1. Absen 5 Hari       : ${statusSnapshot.dailyAttendance.available ? `SIAP DIKLAIM (Hari ke-${statusSnapshot.dailyAttendance.dayIndex})` : 'Sudah diklaim / belum tersedia'}`);
        if (calStatus) {
            line(`  2. Daily Calendar     : ${calStatus.stampedDays} hari tercatat bulan ini | Milestone siap klaim: ${calStatus.claimableMilestones} | Sudah diklaim: ${calStatus.claimedMilestones}/6`);
        } else {
            line(`  2. Daily Calendar     : ${statusSnapshot.dailyCalendar.stampAvailableFlag ? 'Stamp tersedia' : 'Tidak ada notifikasi baru'}`);
        }
        line(`  3. Daily Scratch Card : ${statusSnapshot.scratchCard.unlocked ? `${statusSnapshot.scratchCard.freeRemainingExtra}x Free Scratch (${statusSnapshot.scratchCard.mode})` : 'Terkunci (< Lv 8)'}`);
        line(`  4. Emblem Daily Token : ${statusSnapshot.dailyTokens.emblemTokenAvailable ? `SIAP DIKLAIM (+${statusSnapshot.dailyTokens.emblemTokenAmount} Token)` : (isEmblem || isTrialEmblem ? 'Sudah diklaim hari ini' : 'Khusus Emblem / Trial')}`);
        line(`  5. Daily Lucky Spin   : ${statusSnapshot.dailyTokens.luckySpinRemaining}x kesempatan spin gratis`);
        return {
            exitCode: 0,
            kredit: 0,
            tokensGained: 0,
            statusSnapshot,
            calStatus,
            summary: 'Status OK'
        };
    }

    let claimedActions = 0;
    let tokensGained = 0;
    const summaryParts = [];
    const details = {
        attendanceClaimed: false,
        eventLoginClaimed: false,
        calendarStampedDays: 0,
        calendarMilestonesClaimed: 0,
        scratchesDone: 0,
        scratchRewards: [],
        emblemTokenClaimed: false,
        emblemXpBonusClaimed: false,
        emblemLevelUpClaimed: false,
        luckySpinsDone: 0,
        luckySpinRewards: []
    };

    // =========================================================================
    // 1. ABSEN LOGIN HARIAN BERUNTUN (GiftService.confirmDailyItemReward)
    // =========================================================================
    line('== [1/4] Auto Claim Absen Harian (Consecutive Daily Login) ==');
    const dr = ex.DailyReward && typeof ex.DailyReward === 'object' ? ex.DailyReward : null;
    if (dr && Boolean(dr.allow_to_claim)) {
        const dayIdx = Number(dr.claimed_times || 0);
        const rewardItem = Array.isArray(dr.items) ? dr.items[dayIdx] : null;
        try {
            const res = await client.amf('GiftService.confirmDailyItemReward', [s.sessionKey]);
            const b = (res && res.body) || {};
            if (!res.fault && Number(b.status) === 1) {
                details.attendanceClaimed = true;
                claimedActions++;
                dr.allow_to_claim = false;
                dr.claimed_times = dayIdx + 1;
                const rewardText = formatDailyRewardItem(rewardItem);
                if (rewardItem && String(rewardItem.item_type || '').toUpperCase() === 'TOKEN') {
                    tokensGained += Number(rewardItem.amount || 0);
                }
                line(`  [OK] Absen Hari ke-${dayIdx + 1} berhasil diklaim! Hadiah: ${rewardText}`);
                summaryParts.push(`Absen D${dayIdx + 1}`);
            } else {
                line(`  [INFO] Absen Harian tidak dapat diklaim: ${b.error || JSON.stringify(b).slice(0, 120)}`);
            }
        } catch (err) {
            line(`  [WARN] Gagal panggil GiftService.confirmDailyItemReward: ${err.message}`);
        }
    } else {
        line('  [INFO] Absen 5 Hari: Sudah diklaim hari ini / belum tersedia.');
    }

    if (ex.event_daily_login && Boolean(ex.event_daily_login.daily_login)) {
        try {
            const evRes = await client.amf('Gashapon.claimDailyLogin', [s.sessionKey]);
            const eb = (evRes && evRes.body) || {};
            if (!evRes.fault && Number(eb.status) === 1) {
                details.eventLoginClaimed = true;
                claimedActions++;
                ex.event_daily_login.daily_login = false;
                line('  [OK] Event Daily Login Gift berhasil diklaim!');
                summaryParts.push('EventLogin');
            }
        } catch (_) { }
    }

    // =========================================================================
    // 2. DAILY CALENDAR STAMP & MILESTONE (NewDailyRewardStamp2017)
    // =========================================================================
    line('== [2/4] Auto Stamp & Claim Daily Calendar Bulanan ==');
    try {
        const calRes = await client.amf('NewDailyRewardStamp2017.getStatus', [s.sessionKey, 'en']);
        const cb = (calRes && calRes.body) || {};
        if (!calRes.fault && (Number(cb.status) === 1 || Array.isArray(cb.loginDay))) {
            const loginDays = Array.isArray(cb.loginDay) ? cb.loginDay : [];
            const claimArr = Array.isArray(cb.claimReward) ? cb.claimReward : [];
            const rewardDays = Array.isArray(cb.rewardDay) ? cb.rewardDay : [];
            const milestoneRewards = extractCalendarRewardList(cb);
            const stampedCount = loginDays.filter(d => String(d) === '1').length;
            details.calendarStampedDays = stampedCount;

            let milestoneDone = 0;
            for (let idx = 0; idx < claimArr.length; idx++) {
                if (String(claimArr[idx]) !== '1') continue;
                const rLabel = formatCalendarRewardLabel(milestoneRewards[idx]);
                const dayReq = rewardDays[idx] !== undefined ? rewardDays[idx] : `Slot #${idx + 1}`;
                const clRes = await client.amf('NewDailyRewardStamp2017.claimReward', [s.sessionKey, idx]);
                const clBody = (clRes && clRes.body) || {};
                if (!clRes.fault && Number(clBody.status) === 1) {
                    milestoneDone++;
                    claimedActions++;
                    tokensGained += countTokensInCalendarReward(milestoneRewards[idx]);
                    line(`  [OK] Klaim Milestone Kalender (${dayReq} Hari) sukses -> ${rLabel}`);
                } else {
                    line(`  [INFO] Milestone Kalender (${dayReq} Hari) dilewati: ${clBody.error || JSON.stringify(clBody).slice(0, 120)}`);
                }
                await sleepFn(250);
            }
            details.calendarMilestonesClaimed = milestoneDone;
            const alreadyDone = claimArr.filter(v => String(v) === '2').length + milestoneDone;
            line(`  [OK] Kalender Harian tercatat (${stampedCount} hari bulan ini | Milestone diklaim: ${alreadyDone}/${claimArr.length || 6}).`);
            if (milestoneDone > 0) {
                summaryParts.push(`Kalender +${milestoneDone}`);
            } else {
                summaryParts.push(`Stamp ${stampedCount}hr`);
            }
        } else {
            line(`  [INFO] Daily Calendar belum tersedia: ${cb.error || 'tidak aktif'}`);
        }
    } catch (err) {
        line(`  [WARN] Gagal cek Daily Calendar: ${err.message}`);
    }

    // =========================================================================
    // 3. DAILY SCRATCH CARD GRATIS (RouletteService — MURNI FREE, TANPA TOKEN!)
    // =========================================================================
    line('== [3/4] Auto Gosok Daily Scratch Card Gratis ==');
    if (st.level < 8) {
        line(`  [SKIP] Daily Scratch Card terbuka mulai Level 8 (Level saat ini: Lv ${st.level}).`);
    } else {
        try {
            // Cek apakah ada kartu tambahan gratis dari randomAddScatchCard
            let bangoAdded = false;
            try {
                const rnd = await client.amf('RouletteService.randomAddScatchCard', [s.sessionKey]);
                if (rnd && rnd.body && rnd.body.bango) bangoAdded = true;
            } catch (_) { }

            let scBody = {};
            try {
                const scRes = await client.amf('RouletteService.getScratchCardData', [s.sessionKey]);
                scBody = (scRes && scRes.body) || {};
            } catch (_) { }

            let freeRemain = scBody.dailyRoulette_remainTime !== undefined && scBody.dailyRoulette_remainTime !== null
                ? Number(scBody.dailyRoulette_remainTime)
                : Number(ex.free_roulette_times || 0);
            if (!Number.isFinite(freeRemain) || freeRemain < 0) freeRemain = 0;

            const useAfter20 = (st.level > 20) || (st.level === 20 && st.rank > 1);
            const scratchService = useAfter20
                ? 'RouletteService.scratchCardAtfer20Level'
                : 'RouletteService.scratchCard';

            if (freeRemain <= 0) {
                line(`  [INFO] Kuota Free Scratch Card hari ini sudah habis (0x${bangoAdded ? ', bango dicek' : ''}). Mode berbayar Token dilewati demi keamanan.`);
            } else {
                const maxScratchSafe = Math.min(freeRemain, 12);
                line(`  Ditemukan ${freeRemain}x Free Scratch Card (${useAfter20 ? 'Lv > 20' : 'Lv 8-20'}). Menggosok mode FREE...`);
                for (let i = 0; i < maxScratchSafe; i++) {
                    const slot = 1 + Math.floor(rng() * 3);
                    // KEAMANAN MUTLAK: Selalu 'free', tidak pernah 'token'!
                    const freeSig = client.getHash(s.sessionKey, 'free');
                    const finRes = await client.amf(scratchService, [s.sessionKey, 'free', slot, freeSig]);
                    const fb = (finRes && finRes.body) || {};
                    if (finRes.fault || Number(fb.status) !== 1) {
                        line(`  [STOP] Scratch #${i + 1} berhenti: ${fb.error || JSON.stringify(fb).slice(0, 120)}`);
                        break;
                    }
                    const parsed = parseScratchCardReward(fb);
                    details.scratchesDone++;
                    details.scratchRewards.push(parsed.rewardLabel);
                    claimedActions++;
                    if (parsed.tokens > 0) tokensGained += parsed.tokens;
                    if (fb.update_inventory && fb.update_inventory.xp) {
                        st.xp = Number(fb.update_inventory.xp) || st.xp;
                    }
                    line(`  [OK] Scratch #${details.scratchesDone}/${maxScratchSafe} (Kartu ${slot}) -> ${parsed.rewardLabel}`);

                    if (fb.dailyRoulette_remainTime !== undefined && Number(fb.dailyRoulette_remainTime) <= 0) {
                        break;
                    }
                    if (i < maxScratchSafe - 1) await sleepFn(300);
                }
                ex.free_roulette_times = 0;
                if (details.scratchesDone > 0) {
                    summaryParts.push(`Scratch ${details.scratchesDone}x`);
                }
            }
        } catch (err) {
            line(`  [WARN] Gagal menjalankan Daily Scratch Card: ${err.message}`);
        }
    }

    // =========================================================================
    // 4. CLAIM TOKEN HARIAN & BONUS HARIAN (Emblem Token, LevelUp, Lucky Spin)
    // =========================================================================
    line('== [4/4] Auto Claim Token Harian & Bonus Harian ==');

    // 4a. Emblem / Trial Emblem Daily Token (+10 / +5 Token)
    if (Boolean(ex.premium_daily_token)) {
        const expectedTok = isEmblem ? 10 : (isTrialEmblem ? 5 : 10);
        try {
            const tokRes = await client.amf('SpecialReward.premiumDailyToken', [s.sessionKey]);
            const tb = (tokRes && tokRes.body) || {};
            if (!tokRes.fault && Number(tb.status) === 1) {
                const gained = Number(tb.token || tb.reward_token || expectedTok) || expectedTok;
                details.emblemTokenClaimed = true;
                claimedActions++;
                tokensGained += gained;
                ex.premium_daily_token = false;
                s.tokens = Number(s.tokens || 0) + gained;
                line(`  [OK] Claim Token Harian Emblem berhasil: +${gained} Saga Token ★`);
                summaryParts.push(`+${gained} EmblemToken`);
            } else {
                line(`  [INFO] Claim Token Harian Emblem: ${tb.error || 'Sudah diklaim di akun ini hari ini'}`);
            }
        } catch (err) {
            line(`  [WARN] Gagal panggil SpecialReward.premiumDailyToken: ${err.message}`);
        }
    } else if (isEmblem || isTrialEmblem) {
        line('  [INFO] Emblem Daily Token: Sudah diklaim hari ini pada akun ini.');
    } else {
        line('  [INFO] Emblem Daily Token: Akun Free (tidak ada jatah Emblem Token).');
    }

    // 4b. Emblem Type-2 Daily 30x XP Bonus (bila tersedia)
    if (isEmblem && Boolean(ex.emblem_xp_bonus_claim) && Number(ex.emblem_xp_bonus_times || 0) < 30) {
        try {
            const xpRes = await client.amf('CharacterDAO.claimEmblemType2XpBonus', [s.sessionKey]);
            const xb = (xpRes && xpRes.body) || {};
            if (!xpRes.fault && Number(xb.status) === 1) {
                details.emblemXpBonusClaimed = true;
                claimedActions++;
                ex.emblem_xp_bonus_claim = false;
                ex.emblem_xp_bonus_times = 30;
                line('  [OK] Klaim Bonus 30x XP Harian Emblem berhasil diaktifkan!');
                summaryParts.push('EmblemXP');
            }
        } catch (_) { }
    }

    // 4c. Emblem Daily Free Instant +1 Level Up (< Lv 80 & belum menyentuh cap ujian)
    const rankCap = RANK_CAPS[st.rank] || 100;
    if (claimEmblemLevelUp && isEmblem && Boolean(ex.premium_claim_level)) {
        if (st.level >= 80) {
            line(`  [INFO] Emblem Daily +1 Level Up: Karakter sudah Lv ${st.level} (batas fitur < Lv 80).`);
        } else if (st.level >= rankCap) {
            line(`  [INFO] Emblem Daily +1 Level Up: Tertahan batas Rank Cap Lv ${rankCap} (selesaikan ujian dulu).`);
        } else {
            try {
                const claimSig = client.getHash(s.sessionKey, 'claim');
                const lvRes = await client.amf('CharacterDAO.claimLevelUp', [s.sessionKey, 'claim', claimSig]);
                const lb = (lvRes && lvRes.body) || {};
                if (!lvRes.fault && Number(lb.status) === 1) {
                    const prevLv = st.level;
                    st.level = prevLv + 1;
                    if (lb.xp_reward) st.xp += Number(lb.xp_reward) || 0;
                    ex.premium_claim_level = false;
                    details.emblemLevelUpClaimed = true;
                    claimedActions++;
                    line(`  [OK] Klaim Emblem Free +1 Level Up berhasil: Lv ${prevLv} -> Lv ${st.level}!`);
                    summaryParts.push(`LvUp->${st.level}`);
                } else {
                    line(`  [INFO] Emblem Daily +1 Level Up dilewati: ${lb.error || JSON.stringify(lb).slice(0, 120)}`);
                }
            } catch (err) {
                line(`  [WARN] Gagal panggil CharacterDAO.claimLevelUp: ${err.message}`);
            }
        }
    }

    // 4d. Daily Lucky Draw Wheel (RouletteService.luckySpin — Peluang Token & Gold Gratis)
    let spinsLeft = Math.max(0, Number(ex.lucky_spin_remaining_spin || 0));
    if (spinsLeft > 0 && st.level <= 100) {
        const maxSpins = Math.min(spinsLeft, 10);
        line(`  Ditemukan ${spinsLeft}x Daily Lucky Spin gratis. Memutar roda...`);
        for (let spIdx = 0; spIdx < maxSpins; spIdx++) {
            try {
                const spRes = await client.amf('RouletteService.luckySpin', [s.sessionKey]);
                const sb = (spRes && spRes.body) || {};
                if (spRes.fault || Number(sb.status) !== 1) {
                    line(`  [STOP] Lucky Spin berhenti: ${sb.error || JSON.stringify(sb).slice(0, 120)}`);
                    break;
                }
                const parsedSpin = parseLuckySpinRewards(sb.reward);
                details.luckySpinsDone++;
                details.luckySpinRewards.push(parsedSpin.label);
                claimedActions++;
                if (parsedSpin.tokens > 0) tokensGained += parsedSpin.tokens;
                line(`  [OK] Lucky Spin #${details.luckySpinsDone}: ${parsedSpin.label}`);

                if (sb.remaining_spin !== undefined) {
                    spinsLeft = Math.max(0, Number(sb.remaining_spin) || 0);
                    ex.lucky_spin_remaining_spin = spinsLeft;
                    if (spinsLeft <= 0) break;
                } else {
                    ex.lucky_spin_remaining_spin = Math.max(0, maxSpins - (spIdx + 1));
                }
                if (spIdx < maxSpins - 1) await sleepFn(300);
            } catch (err) {
                line(`  [WARN] Gagal memutar Lucky Spin: ${err.message}`);
                break;
            }
        }
        if (details.luckySpinsDone > 0) {
            summaryParts.push(`Spin ${details.luckySpinsDone}x`);
        }
    } else {
        line('  [INFO] Daily Lucky Spin: Sudah habis / tidak ada kesempatan tersisa hari ini.');
    }

    if (tokensGained > 0) {
        summaryParts.push(`Total +${tokensGained} Token`);
    }
    const finalSummary = summaryParts.length ? summaryParts.join(', ') : 'Semua jatah login sudah diklaim';
    line(`  [RINGKASAN LOGIN] Aksi sukses: ${claimedActions} | Token didapat: +${tokensGained} | ${finalSummary}`);

    return {
        exitCode: 0,
        kredit: claimedActions,
        claimedActions,
        tokensGained,
        details,
        summary: finalSummary
    };
}

if (require.main === module) {
    (async () => {
        c.enableGracefulStop('menu bot');
        const argv = process.argv.slice(2);
        const isStatus = argv.includes('status') || argv.includes('--status');
        const noLevelUp = argv.includes('--no-emblem-levelup');
        const res = await runDailyLoginSession({
            mode: isStatus ? 'status' : 'claim',
            claimEmblemLevelUp: !noLevelUp
        });
        process.exit(res.exitCode || 0);
    })().catch(err => {
        defaultLine('FATAL: ' + (err.message || err));
        process.exit(1);
    });
}

module.exports = {
    RANK_CAPS,
    formatDailyRewardItem,
    extractCalendarRewardList,
    formatCalendarRewardLabel,
    parseLuckySpinRewards,
    summarizeDailyLoginStatusFromExtra,
    runDailyLoginSession
};
