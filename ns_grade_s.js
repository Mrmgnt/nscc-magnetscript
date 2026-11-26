#!/usr/bin/env node
/**
 * ns_grade_s.js — Auto Selesaikan Misi Grade S (Stage 1 s/d 5) via SLevelMission + Spin Reward Log
 * Ninja Saga CC — cc: MagnetScript(Razki)
 *
 * Fitur:
 *   1. Menggunakan protokol resmi server `SLevelMission`:
 *        - `SLevelMission.getBattleStatus` (cek energi & timer refill server real)
 *        - `SLevelMission.startMission`    (dapat `slf` / `sln` + potong energi sesuai stage)
 *        - `SLevelMission.finishMission`   (klaim XP, Gold, & hasil roda SPIN Grade S Mission Reward)
 *      Biaya energi per stage (dari Panel_80level_mission_map.swf):
 *        - Stage 1 (msn274, Req Lv 80) : XP 82.700  | Gold 5.000 | -10 Energi
 *        - Stage 2 (msn275, Req Lv 81) : XP 88.600  | Gold 5.300 | -12 Energi
 *        - Stage 3 (msn276, Req Lv 82) : XP 92.580  | Gold 5.500 | -14 Energi
 *        - Stage 4 (msn277, Req Lv 83) : XP 95.430  | Gold 5.600 | -16 Energi
 *        - Stage 5 (msn278, Req Lv 84) : XP 100.000 | Gold 5.900 | -25 Energi
 *   2. Mencatat history per misi & hasil SPIN roda hadiah (Ramen, Ramen x3, 5000 Gold, 10 Token,
 *      Gan of Fire God, Gan of Steel) ke console dan `logs/grade_s_history.jsonl`.
 *   3. Counter Token (per match, sesi, loop, hari ini, total) + log khusus `logs/grade_s_tokens.log`.
 *   4. Mode CLI:
 *        - node ns_grade_s.js 1-4 [jeda]           -> Rotasi Stage 1-4 sampai energi habis
 *        - node ns_grade_s.js 1 [jeda]             -> Fokus Stage 1 (atau 1..5) sampai energi habis
 *        - node ns_grade_s.js loop [jeda]          -> Scheduler harian (rotasi 1-4, tunggu refill, lanjut)
 *        - node ns_grade_s.js spam <1-5> [jeda]    -> Ulang 1 stage terus-menerus + tunggu refill
 *        - node ns_grade_s.js history [limit] [--all] -> Lihat history misi & counter token tersimpan
 */
'use strict';

const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const {
    ITEM_NAMES,
    formatItemName,
    parseSGradeFinishReward,
    parseMissionRewards,
    appendMissionHistory,
    readMissionHistory,
    formatSessionHistoryLines
} = require('./lib/ns_mission_history.js');

const LOGS_DIR = path.join(__dirname, 'logs');
const TOKEN_LOG_FILE = path.join(LOGS_DIR, 'grade_s_tokens.log');
const HISTORY_LOG_FILE = path.join(LOGS_DIR, 'grade_s_history.jsonl');

// Server SLevelMission.finishMission menolak battle < ~10.5 detik ("Mission completed too quickly")
const MIN_BATTLE_WAIT_MS = 11000;
const MAX_ENERGY_DEFAULT = 75;

const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function kv(s) {
    let o = '';
    for (const ch of String(s || '')) {
        const i = 'GhKmNpRtVwYzJqSx'.indexOf(ch);
        o += i < 0 ? ch : '0123456789abcdef'.charAt(i);
    }
    return o;
}

const STAGES = [
    { num: 1, id: 'msn274', mid: 'msn274', reqLv: 80, staminaCost: 10, energyCost: 10, xp: 82700, gold: 5000, name: 'Misi 1 (Stage 1)' },
    { num: 2, id: 'msn275', mid: 'msn275', reqLv: 81, staminaCost: 12, energyCost: 12, xp: 88600, gold: 5300, name: 'Misi 2 (Stage 2 - Story Genin)' },
    { num: 3, id: 'msn276', mid: 'msn276', reqLv: 82, staminaCost: 14, energyCost: 14, xp: 92580, gold: 5500, name: 'Misi 3 (Stage 3)' },
    { num: 4, id: 'msn277', mid: 'msn277', reqLv: 83, staminaCost: 16, energyCost: 16, xp: 95430, gold: 5600, name: 'Misi 4 (Stage 4)' },
    { num: 5, id: 'msn278', mid: 'msn278', reqLv: 84, staminaCost: 25, energyCost: 25, xp: 100000, gold: 5900, name: 'Stage 5 (Bonus)' }
];

function parseRewardItems(ub, opts) {
    return parseMissionRewards(ub, opts);
}

function logTokenReward(user, charName, charId, stageName, tokenCount, beforeToken, afterToken, note = '', tokenLogFile = TOKEN_LOG_FILE) {
    const dir = path.dirname(tokenLogFile);
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    }
    const timeStr = new Date().toISOString();
    const extra = note ? ` | ${note}` : '';
    const logText = `[${timeStr}] Akun: ${user} | Karakter: ${charName} (ID: ${charId}) | Misi: ${stageName} | DAPAT ${tokenCount} TOKEN! | Saldo: ${beforeToken} -> ${afterToken}${extra}\n`;
    try {
        fs.appendFileSync(tokenLogFile, logText, 'utf8');
    } catch (_) {}
}

function formatItemCounterSummary(itemCounts) {
    const entries = Object.entries(itemCounts || {}).filter(([, qty]) => qty > 0);
    if (!entries.length) return 'Tidak ada item/drop tambahan';
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.map(([name, qty]) => `${name} x${qty}`).join(', ');
}

function formatSec(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

function printHistoryReport(options = {}) {
    const showAll = Boolean(options.all);
    const limit = Math.max(1, parseInt(options.limit, 10) || 30);
    const historyFile = options.historyFile || HISTORY_LOG_FILE;
    const filterAccount = showAll ? '' : (options.account || process.env.NS_USER || '');
    const filterCharId = showAll ? '' : (options.charId || process.env.NS_CHAR_ID || '');

    const summary = readMissionHistory(historyFile, {
        account: filterAccount,
        charId: filterCharId,
        limit
    });

    console.log('\n======================================================================');
    console.log('             HISTORY & COUNTER TOKEN MISI GRADE S');
    console.log('======================================================================');
    console.log(` File Log   : ${historyFile}`);
    if (filterAccount || filterCharId) {
        console.log(` Filter     : Akun=${filterAccount || '*'} | CharID=${filterCharId || '*'} (pakai --all untuk semua akun)`);
    } else {
        console.log(' Filter     : Semua akun & karakter');
    }
    console.log('----------------------------------------------------------------------');
    console.log(` Total Misi Selesai : ${summary.totals.missions}x`);
    console.log(` Total XP           : +${summary.totals.xp.toLocaleString()}`);
    console.log(` Total Gold         : +${summary.totals.gold.toLocaleString()}`);
    console.log(` Counter Token Total: +${summary.totals.tokens} Token (${summary.totals.tokenMatches}x match dapat token)`);
    console.log(` Hari Ini (${summary.todayDate}): ${summary.today.missions}x misi | +${summary.today.tokens} Token (${summary.today.tokenMatches}x match)`);
    console.log(` Rekap Item Spin    : ${formatItemCounterSummary(summary.totals.itemTotals)}`);

    const byMissionList = Object.values(summary.totals.byMission);
    if (byMissionList.length) {
        console.log('----------------------------------------------------------------------');
        console.log(' Rekap Per Misi:');
        for (const m of byMissionList) {
            console.log(
                `   - ${(m.missionName || m.missionId).padEnd(30)}: ${String(m.count).padStart(3)}x | Token: +${String(m.tokens).padEnd(4)} (${m.tokenMatches}x) | XP: +${m.xp.toLocaleString()}`
            );
        }
    }

    console.log('----------------------------------------------------------------------');
    if (!summary.recent.length) {
        console.log(' Belum ada riwayat misi Grade S yang tercatat.');
    } else {
        console.log(` ${summary.recent.length} Riwayat Misi Terakhir:`);
        for (const e of summary.recent) {
            const dt = e.timestamp ? new Date(e.timestamp) : null;
            const timeLabel = dt && !isNaN(dt.getTime())
                ? `${e.date || dt.toISOString().slice(0, 10)} ${dt.toTimeString().slice(0, 8)}`
                : '-';
            const who = e.charName ? `${e.account || '-'}/${e.charName}` : (e.account || '-');
            const tokStr = e.tokens > 0 ? `+${e.tokens} Token ★` : '-';
            const spinStr = (e.spinReward && e.spinReward !== '-')
                ? e.spinReward
                : (e.spinRewardRaw === 'item1' ? 'Tidak Roll (item1)' : '-');
            const drops = Array.isArray(e.extraItems) && e.extraItems.length
                ? e.extraItems
                : (Array.isArray(e.items) ? e.items.filter(x => !/^\d+\s*Token$/i.test(x) && x !== e.spinReward) : []);
            const dropStr = drops.length ? ` | Drop: ${drops.map(formatItemName).join(', ')}` : '';
            console.log(
                `   [${timeLabel}] (${who}) ${(e.missionName || e.missionId)} -> XP +${Number(e.xp || 0).toLocaleString()} | Gold +${Number(e.gold || 0).toLocaleString()} | Token: ${tokStr} | Spin: ${spinStr}${dropStr}`
            );
        }
    }
    console.log('======================================================================\n');
    return summary;
}

const args = process.argv.slice(2);
const rawTarget = (args[0] || '1-4').toLowerCase();
const isHistoryMode = rawTarget === 'history' || rawTarget === '--history' || rawTarget === 'riwayat' || rawTarget === 'log';
const isLoopMode = rawTarget === 'loop' || rawTarget === '--loop' || args.includes('--loop');
const isSpamMode = rawTarget === 'spam' || rawTarget === '--spam';
const isMapMode = rawTarget === 'all' || rawTarget === '1-4' || rawTarget === 'map' || rawTarget === 'rotation' || isLoopMode;
let singleStageNum = 0;
if (!isMapMode && !isSpamMode && !isHistoryMode && rawTarget !== 'auto') {
    singleStageNum = parseInt(rawTarget, 10) || 0;
}
const spamStageNum = isSpamMode ? parseInt(args[1], 10) || 0 : 0;
const jedaSec = Math.max(11, parseFloat(args[isSpamMode ? 2 : 1]) || 11);
const maxBattles = parseInt(args[isSpamMode ? 3 : 2], 10) || 0;

function createLoopTracker() {
    return {
        cycles: 0,
        battles: 0,
        totalXp: 0,
        totalGold: 0,
        totalTokensWon: 0,
        tokenMatchCount: 0,
        itemCounts: {},
        history: []
    };
}

async function fetchSLevelBattleStatus(sessionKey) {
    const res = await c.amf('SLevelMission.getBattleStatus', [sessionKey]);
    const b = (res && res.body) || {};
    if (Number(b.status) !== 1) {
        return { ok: false, error: b.error || (res && res.netError) || JSON.stringify(b).slice(0, 140), raw: b };
    }
    const r = b.result || {};
    return {
        ok: true,
        remainEnergy: b.remain_energy !== undefined ? Number(b.remain_energy) : MAX_ENERGY_DEFAULT,
        refillRemainSec: Number(b.energy_refill_remain || 0),
        chapterStatus: Number(r.chapter_status || 1),
        missionStatus: Number(r.mission_status || 0),
        raw: b
    };
}

async function runGradeSSession(opts = {}) {
    const shared = opts.shared || null;
    const tracker = opts.tracker || null;
    const historyFile = opts.historyFile || HISTORY_LOG_FILE;
    const tokenLogFile = opts.tokenLogFile || TOKEN_LOG_FILE;
    const minWaitMs = opts.minWaitMs !== undefined ? Math.max(0, Number(opts.minWaitMs)) : MIN_BATTLE_WAIT_MS;
    const localTarget = String(opts.target || rawTarget).toLowerCase();
    const localIsLoopMode = localTarget === 'loop' || localTarget === '--loop' || args.includes('--loop');
    const localIsMapMode = localTarget === 'all' || localTarget === '1-4' || localTarget === 'map' || localTarget === 'rotation' || localIsLoopMode;
    let localSingleStageNum = 0;
    if (!localIsMapMode && localTarget !== 'auto') {
        localSingleStageNum = parseInt(localTarget, 10) || 0;
    }
    const requestedJeda = parseFloat(opts.jeda !== undefined ? opts.jeda : jedaSec);
    const waitMs = Math.max(minWaitMs, Math.round((Number.isFinite(requestedJeda) ? requestedJeda : 11) * 1000));
    const waitSecLabel = (waitMs / 1000).toFixed(1).replace(/\.0$/, '');
    const localMaxBattles = parseInt(opts.maxBattles !== undefined ? opts.maxBattles : maxBattles, 10) || 0;

    const user = (shared && shared.user) || process.env.NS_USER;
    const pass = (shared && shared.pass) || process.env.NS_PASS;
    if (!user || !pass) {
        console.log('[!] Diperlukan NS_USER dan NS_PASS di environment.');
        return { exitCode: 1, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: 0, curEnergy: 0 };
    }

    let s = (shared && shared.s) || null;
    let h = (shared && shared.h) || null;
    let charId = (shared && shared.charId) || null;
    let charRow = (shared && shared.row) || null;

    if (!s) {
        line('Menghubungkan ke server Ninja Saga...');
        s = await c.login(user, pass);
        if (!s.ok) {
            line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')');
            return { exitCode: 2, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: 0, curEnergy: 0 };
        }
        h = k.mk(s.sessionKey);
    }
    if (!h) h = k.mk(s.sessionKey);

    let initialTokens = Number(s.tokens !== undefined ? s.tokens : (s.raw && s.raw.result && s.raw.result[2]) || 0);
    const isEmblem = Boolean(s.isEmblem || Number(s.accountType) === 2);

    if (!charId || !charRow) {
        const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
        const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
        charRow = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
        if (!charRow) {
            line('ERROR: Tidak ada karakter ditemukan.');
            return { exitCode: 3, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: 0, curEnergy: 0 };
        }
        charId = charRow[0];
    }

    // Ambil data detail karakter (gunakan shared jika sudah ada)
    let charObj = (shared && shared.st && shared.st.raw) || null;
    let gk = (shared && shared.st && shared.st.gk) || '';
    if (!charObj || !gk) {
        const chRes = await c.getCharacterByIdWithWait(s, charId, {
            maxWaitMs: 45000,
            credentials: { user, pass },
            onCooldown: sec => line(`  [Cooldown] Menunggu ${sec}s sebelum membaca data karakter...`)
        });
        if (!chRes.ok || !chRes.result) {
            line('ERROR: Gagal membaca data karakter: ' + (chRes.error || 'server cooldown'));
            return { exitCode: 4, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: 0, curEnergy: 0 };
        }
        if (chRes.session && chRes.session.sessionKey && chRes.session.sessionKey !== s.sessionKey) {
            s = chRes.session;
            h = k.mk(s.sessionKey);
        }
        charObj = chRes.result;
        gk = chRes.gk;
    }

    const charName = charObj.character_name || charRow[1];
    let curLevel = Number(charObj.character_level) || 1;
    let curXp = Number(charObj.character_xp) || 0;
    let curGold = Number(charObj.character_gold) || 0;

    // Ambil kunci tanda tangan extraData (slx & xmas2014SpecailReward untuk SLevelMission.finishMission)
    let ex = (shared && shared.ex) || null;
    if (!ex) {
        const exRes = await c.getExtraDataWithRetry(s.sessionKey, charId, s.token, gk, 3);
        if (exRes.ok && exRes.result) ex = exRes.result;
    }

    const extractSLevelKeys = (extraObj) => {
        if (!extraObj) return null;
        const slv = String(extraObj.slx || '');
        const gk5 = kv(String(extraObj.xmas2014SpecailReward || ''));
        if (!slv || !gk5) return null;
        return { slv, gk5 };
    };

    let sLevelKeys = extractSLevelKeys(ex);
    if (!sLevelKeys) {
        line('ERROR: Kunci Grade S (slx / xmas2014SpecailReward) tidak ditemukan di extraData server.');
        return { exitCode: 5, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: 0, curEnergy: 0 };
    }

    if (!initialTokens && ex && ex.totalToken !== undefined) {
        initialTokens = Number(ex.totalToken);
    }
    let curTokens = initialTokens;

    // Cek status energi real Grade S dari server
    const battleStatus = await fetchSLevelBattleStatus(s.sessionKey);
    if (!battleStatus.ok) {
        line('ERROR: Gagal membaca SLevelMission.getBattleStatus: ' + battleStatus.error);
        return { exitCode: 6, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: 0, curEnergy: 0 };
    }

    let curEnergy = battleStatus.remainEnergy;
    let refillRemainSec = battleStatus.refillRemainSec;
    const chapterStatus = battleStatus.chapterStatus;
    const missionStatus = battleStatus.missionStatus;

    const priorStats = readMissionHistory(historyFile, { account: user, charId, limit: 1 });

    console.log('\n======================================================================');
    console.log('       MISI GRADE S (SLevelMission + SPIN REWARD) - AUTO RUNNER');
    console.log('                     cc: MagnetScript(Razki)');
    console.log('======================================================================');
    console.log(` Akun         : ${user} (${isEmblem ? 'Emblem' : 'Free'})`);
    console.log(` Karakter     : ${charName} (ID: ${charId})`);
    console.log(` Level        : Lv ${curLevel} | Gold: ${curGold.toLocaleString()} | XP: ${curXp.toLocaleString()}`);
    console.log(` Saldo Token  : ${initialTokens} Tokens | Token Sesi: +0 (0x match)`);
    console.log(` History Char : ${priorStats.totals.missions}x misi tercatat | Total Token: +${priorStats.totals.tokens} (${priorStats.totals.tokenMatches}x)`);
    console.log(` Energi Rank S: ${curEnergy} / ${MAX_ENERGY_DEFAULT}${refillRemainSec > 0 ? ` (Refill +1 dalam ${formatSec(refillRemainSec)})` : ' (Penuh)'}`);
    console.log('======================================================================\n');

    if (curLevel < 80) {
        line(`[!] Karakter "${charName}" masih Level ${curLevel}.`);
        line('    Misi Grade S membutuhkan minimal Level 80.');
        return { exitCode: 0, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: curEnergy, curEnergy, refillRemainSec, isEmblem };
    }

    const isStageUnlocked = (st) => {
        if (st.num === 1) return true;
        if (chapterStatus > 1) return true;
        return missionStatus >= (st.num - 1);
    };

    let stageQueue = [];
    let modeLabel = '';

    if (localIsMapMode) {
        stageQueue = STAGES.slice(0, 4).filter(st => curLevel >= st.reqLv && isStageUnlocked(st));
        if (!stageQueue.length) stageQueue = [STAGES[0]];
        modeLabel = `Rotasi Stage 1 s/d ${stageQueue.length}`;
        line(`Mode Target   : ${modeLabel}`);
        line('Daftar Misi   : ' + stageQueue.map(st => `${st.name} [${st.id}, -${st.energyCost}E]`).join(', '));
    } else if (localSingleStageNum >= 1 && localSingleStageNum <= 5) {
        const picked = STAGES[localSingleStageNum - 1];
        if (curLevel < picked.reqLv) {
            line(`[!] Level tidak cukup untuk ${picked.name} (Butuh Lv ${picked.reqLv}, Level saat ini: ${curLevel}).`);
            return { exitCode: 0, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: curEnergy, curEnergy, refillRemainSec, isEmblem };
        }
        if (!isStageUnlocked(picked)) {
            line(`[!] ${picked.name} belum terbuka (chapter_status=${chapterStatus}, mission_status=${missionStatus}).`);
            return { exitCode: 0, battles: 0, totalTokensWon: 0, tokenMatchCount: 0, curStamina: curEnergy, curEnergy, refillRemainSec, isEmblem };
        }
        stageQueue = [picked];
        modeLabel = `Fokus ${picked.name} [${picked.id}, -${picked.energyCost} Energi]`;
        line(`Mode Target   : ${modeLabel}`);
    } else {
        const available = STAGES.filter(st => curLevel >= st.reqLv && isStageUnlocked(st));
        const topStage = available[available.length - 1] || STAGES[0];
        stageQueue = [topStage];
        modeLabel = `Auto Stage Tertinggi (${topStage.name}, -${topStage.energyCost} Energi)`;
        line(`Mode Target   : ${modeLabel}`);
    }

    line(`Jeda Battle   : ${waitSecLabel} detik (syarat minimal server >= 10.5s) | Log: ${path.relative(__dirname, historyFile)}`);
    line('Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti dan kembali ke menu.\n');

    let battleSuccess = 0;
    let totalXpGained = 0;
    let totalGoldGained = 0;
    let totalTokensWon = 0;
    let tokenMatchCount = 0;
    let hadError = false;
    const stageBattleCounts = {};
    const collectedItemCounts = {};
    const sessionHistory = [];

    let stageCursor = 0;
    let roundNumber = 1;

    while (true) {
        if (localMaxBattles > 0 && battleSuccess >= localMaxBattles) {
            line(`[i] Batas maksimal battle yang ditentukan (${localMaxBattles}x) telah tercapai.`);
            break;
        }

        const curStage = stageQueue[stageCursor];
        if (curEnergy < curStage.energyCost) {
            // Pada mode rotasi 1-4, cek apakah masih ada stage berbiaya lebih kecil yang cukup energinya
            if (localIsMapMode && stageQueue.some(st => curEnergy >= st.energyCost)) {
                stageCursor = (stageCursor + 1) % stageQueue.length;
                continue;
            }
            line(`[i] Energi Grade S tersisa ${curEnergy}/${MAX_ENERGY_DEFAULT}, kurang dari biaya ${curStage.energyCost} untuk ${curStage.name}.`);
            break;
        }

        const mid = curStage.mid;
        line(`>>> [Putaran #${roundNumber}] Memulai ${curStage.name} [${mid}] (Energi: ${curEnergy} -> ${curEnergy - curStage.energyCost})...`);

        // 1. SLevelMission.startMission
        const stRes = await c.amf('SLevelMission.startMission', [s.sessionKey, mid, h.getHash(mid)]);
        const sb = (stRes && stRes.body) || {};
        if (Number(sb.status) !== 1 || !sb.slf) {
            const errTxt = JSON.stringify(sb).slice(0, 180);
            if (/energy|not enough/i.test(errTxt)) {
                line(`[i] Server menyatakan energi tidak cukup untuk ${curStage.name}: ${errTxt}`);
                break;
            }
            hadError = true;
            line(`  ✗ Gagal SLevelMission.startMission: ${errTxt}`);
            break;
        }

        const sln = String(sb.slf);
        curEnergy = Math.max(0, curEnergy - curStage.energyCost);
        line(`    Simulasi pertarungan (${waitSecLabel}s, Battle ID: ${sb.startBattleId || '-'})...`);

        await sleep(waitMs);

        // 2. SLevelMission.finishMission
        const battleLog = k.srk(sLevelKeys.gk5, sln);
        const finHash = h.getHash(mid + '0');
        const finSig = k.srk(sLevelKeys.slv, sln);

        const finRes = await c.amf('SLevelMission.finishMission', [
            s.sessionKey, mid, battleLog, [], 0, finHash, finSig
        ]);
        const fb = (finRes && finRes.body) || {};

        if (Number(fb.status) !== 1) {
            hadError = true;
            line(`  ✗ Gagal SLevelMission.finishMission: ${JSON.stringify(fb).slice(0, 180)}`);
            break;
        }

        battleSuccess++;
        stageBattleCounts[curStage.name] = (stageBattleCounts[curStage.name] || 0) + 1;

        const parsed = parseSGradeFinishReward(fb, {
            prevTokenBalance: curTokens,
            baseXp: curStage.xp,
            baseGold: curStage.gold
        });

        let matchXp = curStage.xp;
        if (parsed.invXp !== null) {
            matchXp = Math.max(0, parsed.invXp - curXp);
            curXp = parsed.invXp;
        } else if (parsed.addItemXp !== null) {
            matchXp = parsed.addItemXp;
            curXp += matchXp;
        } else {
            curXp += matchXp;
        }

        let matchGold = (parsed.addItemGold !== null ? parsed.addItemGold : curStage.gold) + (parsed.spinGold || 0);
        if (parsed.invGold !== null && parsed.invGold > curGold) {
            matchGold = parsed.invGold - curGold;
            curGold = parsed.invGold;
        } else {
            curGold += matchGold;
        }

        const prevTokenBal = curTokens;
        if (parsed.newTokenBalance !== null) {
            curTokens = parsed.newTokenBalance;
        } else {
            curTokens += parsed.tokenGained;
        }

        const matchTokens = parsed.tokenGained;
        if (matchTokens > 0) {
            tokenMatchCount++;
            totalTokensWon += matchTokens;
        }

        totalXpGained += matchXp;
        totalGoldGained += matchGold;

        for (const [itemName, qty] of Object.entries(parsed.itemCounts)) {
            collectedItemCounts[itemName] = (collectedItemCounts[itemName] || 0) + qty;
            if (tracker) {
                tracker.itemCounts[itemName] = (tracker.itemCounts[itemName] || 0) + qty;
            }
        }

        const historyRecord = appendMissionHistory(historyFile, {
            source: 'ns_grade_s',
            account: user,
            charId: String(charId),
            charName,
            level: curLevel,
            missionId: mid,
            missionName: curStage.name,
            battleNo: battleSuccess,
            xp: matchXp,
            gold: matchGold,
            tokens: matchTokens,
            spinReward: parsed.spinRewardLabel,
            spinRewardRaw: parsed.spinRewardRaw,
            rewardWheel: parsed.wheelList,
            items: parsed.items,
            extraItems: parsed.extraItems,
            rawItems: parsed.rawItems,
            rawRewardFields: parsed.rawRewardFields
        });
        sessionHistory.push(historyRecord);

        if (tracker) {
            tracker.battles++;
            tracker.totalXp += matchXp;
            tracker.totalGold += matchGold;
            if (matchTokens > 0) {
                tracker.totalTokensWon += matchTokens;
                tracker.tokenMatchCount++;
            }
            tracker.history.push(historyRecord);
        }

        const tokLabel = matchTokens > 0 ? `+${matchTokens} Token ★` : '-';
        const spinDisplay = parsed.spinRewardRaw === 'item1'
            ? 'Tidak Roll [item1]'
            : `${parsed.spinRewardLabel}${parsed.spinRewardRaw ? ` [${parsed.spinRewardRaw}]` : ''}`;
        line(`  [DONE] #${battleSuccess} | ${curStage.name} [${mid}]`);
        line(`         Spin   : ${spinDisplay}${parsed.extraItems.length ? ` | Drop Bonus: ${parsed.extraItems.join(', ')}` : ''}`);
        line(`         Hasil  : XP +${matchXp.toLocaleString()} | Gold +${matchGold.toLocaleString()} | Token: ${tokLabel} (Saldo: ${curTokens})`);
        if (tracker) {
            line(`         Counter: Sesi +${totalTokensWon} Token (${tokenMatchCount}x) | Total Loop +${tracker.totalTokensWon} Token (${tracker.tokenMatchCount}/${tracker.battles} match) | Energi ~${curEnergy}/${MAX_ENERGY_DEFAULT}`);
        } else {
            line(`         Counter: Battle ${battleSuccess}x | Token Sesi +${totalTokensWon} (${tokenMatchCount}x dapat token) | Energi ~${curEnergy}/${MAX_ENERGY_DEFAULT}`);
        }

        if (matchTokens > 0) {
            console.log('\n**********************************************************************');
            console.log(' [TOKEN REWARD] SAGA TOKEN DARI SPIN GRADE S!');
            console.log(`     Karakter : ${charName} (ID: ${charId})`);
            console.log(`     Misi     : ${curStage.name} [ID: ${mid}]`);
            console.log(`     Hadiah   : +${matchTokens} Saga Token (Saldo: ${prevTokenBal} -> ${curTokens})`);
            console.log(`     Counter Sesi Token: +${totalTokensWon} Token (${tokenMatchCount}x match)`);
            if (tracker) {
                console.log(`     Counter Loop Token: +${tracker.totalTokensWon} Token (${tracker.tokenMatchCount}x match)`);
            }
            console.log('**********************************************************************\n');
            logTokenReward(user, charName, charId, curStage.name, matchTokens, prevTokenBal, curTokens, `Spin=${parsed.spinRewardRaw || 'token'}`, tokenLogFile);
        }

        stageCursor++;
        if (stageCursor >= stageQueue.length) {
            stageCursor = 0;
            roundNumber++;
        }

        await sleep(100);
    }

    // Sinkron energi real & saldo token akhir dari server
    const bsEnd = await fetchSLevelBattleStatus(s.sessionKey);
    if (bsEnd.ok) {
        curEnergy = bsEnd.remainEnergy;
        refillRemainSec = bsEnd.refillRemainSec;
    }

    let finalTokens = curTokens;
    let serverTokenVerified = true;
    if (battleSuccess > 0 && !opts.skipEndTokenVerify) {
        try {
            const sEnd = await c.login(user, pass);
            if (sEnd && sEnd.ok && sEnd.tokens !== undefined) {
                finalTokens = Number(sEnd.tokens);
                serverTokenVerified = true;
                if (shared) {
                    shared.s = sEnd;
                    if (sEnd.sessionKey) shared.h = k.mk(sEnd.sessionKey);
                }
                const serverDiff = Math.max(0, finalTokens - initialTokens);
                if (serverDiff > totalTokensWon) {
                    const extraDelta = serverDiff - totalTokensWon;
                    totalTokensWon = serverDiff;
                    if (tokenMatchCount === 0) tokenMatchCount = 1;
                    if (tracker) {
                        tracker.totalTokensWon += extraDelta;
                        if (tracker.tokenMatchCount === 0) tracker.tokenMatchCount = 1;
                    }
                    logTokenReward(
                        user, charName, charId,
                        'Verifikasi Saldo Akhir Server',
                        extraDelta, initialTokens, finalTokens,
                        'Terdeteksi dari selisih saldo token server',
                        tokenLogFile
                    );
                }
            }
        } catch (_) {}
    }

    if (tracker) tracker.cycles++;

    const cumulativeStats = readMissionHistory(historyFile, { account: user, charId, limit: 1 });

    console.log('\n======================================================================');
    console.log('                   RINGKASAN FARMING MISI GRADE S');
    console.log('======================================================================');
    console.log(` Akun              : ${user}`);
    console.log(` Karakter          : ${charName} (Lv ${curLevel})`);
    console.log(` Mode Dijalankan   : ${modeLabel}`);
    console.log(` Pertarungan Selesai: ${battleSuccess} kali battle`);
    if (Object.keys(stageBattleCounts).length > 1) {
        console.log(' Detail Per Misi   :');
        for (const [stName, cnt] of Object.entries(stageBattleCounts)) {
            console.log(`   - ${stName.padEnd(28)}: ${cnt}x battle`);
        }
    }
    console.log(` Total XP Didapat  : +${totalXpGained.toLocaleString()} XP`);
    console.log(` Total Gold Masuk  : +${totalGoldGained.toLocaleString()} Gold`);
    console.log(` Rekap Item/Drop   : ${formatItemCounterSummary(collectedItemCounts)}`);

    const historyLines = formatSessionHistoryLines(sessionHistory, 25);
    if (historyLines.length) {
        console.log('----------------------------------------------------------------------');
        console.log(' Riwayat Per Misi Sesi Ini:');
        for (const hl of historyLines) console.log(hl);
    }

    console.log('----------------------------------------------------------------------');
    if (totalTokensWon > 0 || finalTokens > initialTokens) {
        const tokDiff = Math.max(totalTokensWon, finalTokens - initialTokens);
        console.log(` ★★★ COUNTER TOKEN SESI: +${tokDiff} SAGA TOKEN (${tokenMatchCount}x match dapat token) ★★★`);
        console.log(`     Saldo Awal  : ${initialTokens} Token`);
        console.log(`     Saldo Akhir : ${finalTokens} Token (+${tokDiff} Token)${serverTokenVerified ? ' [Verified Server]' : ''}`);
        console.log('     Log Token   : logs/grade_s_tokens.log');
    } else {
        console.log(` Counter Token Sesi: +0 Token (0/${battleSuccess} match dapat token | Saldo: ${finalTokens} Token)`);
    }
    if (tracker) {
        console.log(` Counter Loop Run  : Putaran #${tracker.cycles} | ${tracker.battles}x battle | +${tracker.totalTokensWon} Token (${tracker.tokenMatchCount}x match) | Spin Item: ${formatItemCounterSummary(tracker.itemCounts)}`);
    }
    console.log(` Counter Hari Ini  : ${cumulativeStats.today.missions}x misi | +${cumulativeStats.today.tokens} Token (${cumulativeStats.today.tokenMatches}x match)`);
    console.log(` Counter Total Log : ${cumulativeStats.totals.missions}x misi | +${cumulativeStats.totals.tokens} Token (${cumulativeStats.totals.tokenMatches}x match) | File: logs/grade_s_history.jsonl`);
    console.log('----------------------------------------------------------------------');
    console.log(` Energi Rank S     : ${curEnergy} / ${MAX_ENERGY_DEFAULT}${refillRemainSec > 0 ? ` (Refill +1 dalam ${formatSec(refillRemainSec)})` : ''}`);
    console.log('======================================================================\n');

    return {
        exitCode: hadError ? 1 : 0,
        battles: battleSuccess,
        totalTokensWon,
        tokenMatchCount,
        totalXpGained,
        totalGoldGained,
        itemCounts: collectedItemCounts,
        history: sessionHistory,
        curStamina: curEnergy,
        curEnergy,
        refillRemainSec,
        isEmblem,
        initialTokens,
        finalTokens
    };
}

async function waitForRefill(lastRes, minEnergyNeeded = 10) {
    const curEnergy = Number((lastRes && lastRes.curEnergy) || 0);
    const needEnergy = Math.max(1, minEnergyNeeded - curEnergy);
    const secPerEnergy = (lastRes && lastRes.isEmblem) ? 360 : 600;
    const firstRemain = Number((lastRes && lastRes.refillRemainSec) || 0);
    const totalWaitSec = Math.max(60, (firstRemain > 0 ? firstRemain : secPerEnergy) + Math.max(0, needEnergy - 1) * secPerEnergy + 5);
    line(`Standby menunggu regenerasi energi Rank S (+${needEnergy} energi -> min ${minEnergyNeeded}, estimasi ${formatSec(totalWaitSec)})...`);
    for (let seconds = totalWaitSec; seconds > 0; seconds -= 30) {
        process.stdout.write(`\rMenunggu refill energi Rank S: ${formatSec(seconds)} tersisa...   `);
        await sleep(Math.min(30000, seconds * 1000));
    }
    console.log('');
}

async function main() {
    c.enableGracefulStop('menu bot');
    if (isHistoryMode) {
        const showAll = args.includes('--all');
        const numArg = args.slice(1).find(a => /^\d+$/.test(a));
        printHistoryReport({ all: showAll, limit: numArg ? parseInt(numArg, 10) : 30 });
        process.exit(0);
    }

    if (!isLoopMode && !isSpamMode) {
        const res = await runGradeSSession();
        process.exit(res ? res.exitCode : 0);
    }

    const tracker = createLoopTracker();

    if (isSpamMode) {
        if (spamStageNum < 1 || spamStageNum > 5) throw new Error('Mode spam butuh Stage 1 sampai 5.');
        const stageEnergy = STAGES[spamStageNum - 1].energyCost;
        line('>>> MODE SPAM MISI GRADE S DIAKTIFKAN <<<');
        line(`Bot menjalankan Stage ${spamStageNum} (-${stageEnergy} Energi) terus menerus; saat energi habis bot menunggu refill.`);
        line('Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti.\n');
        while (true) {
            const res = await runGradeSSession({ target: String(spamStageNum), jeda: jedaSec, tracker });
            if (res && res.exitCode) process.exit(res.exitCode);
            await waitForRefill(res, stageEnergy);
        }
    }

    line('>>> MODE SCHEDULER MISI GRADE S DIAKTIFKAN <<<');
    line('Bot akan menghabiskan energi Stage 1-4, lalu standby otomatis menunggu refill energi.');
    line('Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti.\n');
    while (true) {
        const res = await runGradeSSession({ tracker });
        if (res && res.exitCode) process.exit(res.exitCode);
        await waitForRefill(res, 10);
    }
}

if (require.main === module) {
    main().catch(err => {
        line('FATAL: ' + err.message);
        process.exit(1);
    });
}

module.exports = {
    STAGES,
    ITEM_NAMES,
    MIN_BATTLE_WAIT_MS,
    formatItemName,
    parseRewardItems,
    createLoopTracker,
    printHistoryReport,
    runGradeSSession
};
