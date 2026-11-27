'use strict';

const assert = require('assert');
const { getHash } = require('./nscrypt.js');
const {
    runDailyLoginSession,
    summarizeDailyLoginStatusFromExtra
} = require('./ns_daily_login.js');
const { parseCliArgs: parseTgCliArgs } = require('./ns_thanksgiving.js');
const {
    parseMultiCliArgs,
    normalizeLoopBaseAction,
    getFollowupEventAction,
    runBulkLoop
} = require('./ns_multi_manager.js');

(async () => {
    const logs = [];
    const calls = [];
    const sessKey = 'gs_test_session_123';

    // 1. Test Emblem Lv 50 character: Absen Day 5 (Token) + Calendar 2 Milestones + 2 Free Scratches (>20) + Emblem Token + Emblem XP + Emblem +1 LevelUp + 2 Lucky Spins
    let spinCounter = 0;
    let scratchCounter = 0;
    const mockClientEmblem = {
        getHash,
        async login() {
            return { ok: true, sessionKey: sessKey, token: 'tok123', accountType: 2, isEmblem: true, tokens: 100 };
        },
        getSelectedChar(chars) {
            return chars[0];
        },
        async getCharacterByIdWithWait(session) {
            return {
                ok: true,
                gk: 'gk_abc',
                session,
                result: {
                    character_level: 50,
                    character_xp: 120000,
                    character_gold: 500000,
                    character_rank: 4, // Jounin (cap 60) -> eligible for +1 Level Up!
                    character_stamina: 75,
                    character_mission: '',
                    character_essence_item: 'item509:15'
                }
            };
        },
        async getExtraDataWithRetry() {
            return {
                ok: true,
                result: {
                    DailyReward: {
                        allow_to_claim: true,
                        claimed_times: 4,
                        items: [
                            { item_type: 'GOLD', amount: 1000 },
                            { item_type: 'item2', amount: 1 },
                            { item_type: 'GOLD', amount: 5000 },
                            { item_type: 'item3', amount: 1 },
                            { item_type: 'TOKEN', amount: 5 }
                        ]
                    },
                    event_daily_login: { daily_login: true, reward: ['item_899'] },
                    daily_stamp_available: true,
                    free_roulette_times: 2,
                    premium_daily_token: true,
                    emblem_xp_bonus_claim: true,
                    emblem_xp_bonus_times: 0,
                    premium_claim_level: true,
                    lucky_spin_remaining_spin: 2,
                    lucky_spin_consecutive_day: 7
                }
            };
        },
        async amf(service, params) {
            calls.push({ service, params });
            switch (service) {
                case 'CharacterDAO.getCharactersList':
                    return { body: { status: 1, result: [['00012345', 'TestNinja', 50]] } };
                case 'GiftService.confirmDailyItemReward':
                    return { body: { status: 1 } };
                case 'Gashapon.claimDailyLogin':
                    return { body: { status: 1 } };
                case 'NewDailyRewardStamp2017.getStatus':
                    return {
                        body: {
                            status: 1,
                            loginDay: ['1', '1', '1', '1', '1', '0'],
                            rewardDay: ['2 Days', '5 Days', '10 Days', '15 Days', '20 Days', '25 Days'],
                            claimReward: ['2', '1', '1', '0', '0', '0'],
                            item_list: [['gold_10000'], ['token_15'], ['item_899_2'], ['gold_50000'], ['token_25'], ['skill_999']]
                        }
                    };
                case 'NewDailyRewardStamp2017.claimReward':
                    return { body: { status: 1 } };
                case 'RouletteService.randomAddScatchCard':
                    return { body: { status: 1, bango: true } };
                case 'RouletteService.getScratchCardData':
                    return { body: { status: 1, dailyRoulette_remainTime: 2, bouns_discount: false } };
                case 'RouletteService.scratchCardAtfer20Level': {
                    // Pastikan TIDAK PERNAH memanggil dengan 'token'
                    assert.strictEqual(params[1], 'free', 'Scratch card harus selalu mode free!');
                    assert.strictEqual(params[3], getHash(sessKey, 'free'));
                    scratchCounter++;
                    if (scratchCounter === 1) {
                        return { body: { status: 1, reward_type: 'TOKEN', reward_amount: 3, dailyRoulette_remainTime: 1 } };
                    }
                    return { body: { status: 1, reward_type: 'GOLD', reward_amount: 5000, dailyRoulette_remainTime: 0 } };
                }
                case 'SpecialReward.premiumDailyToken':
                    return { body: { status: 1, token: 10 } };
                case 'CharacterDAO.claimEmblemType2XpBonus':
                    return { body: { status: 1 } };
                case 'CharacterDAO.claimLevelUp':
                    assert.strictEqual(params[1], 'claim');
                    assert.strictEqual(params[2], getHash(sessKey, 'claim'));
                    return { body: { status: 1, xp_reward: 45000 } };
                case 'RouletteService.luckySpin':
                    spinCounter++;
                    if (spinCounter === 1) {
                        return { body: { status: 1, reward: ['token_7'], remaining_spin: 1 } };
                    }
                    return { body: { status: 1, reward: ['gold_10000'], remaining_spin: 0 } };
                default:
                    throw new Error('Unexpected AMF service: ' + service);
            }
        }
    };

    const shared = { user: 'emblem_acc', pass: 'secret' };
    const res = await runDailyLoginSession({
        shared,
        client: mockClientEmblem,
        sleep: async () => { },
        rng: () => 0.4,
        log: m => logs.push(m)
    });

    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.details.attendanceClaimed, true);
    assert.strictEqual(res.details.eventLoginClaimed, true);
    assert.strictEqual(res.details.calendarStampedDays, 5);
    assert.strictEqual(res.details.calendarMilestonesClaimed, 2);
    assert.strictEqual(res.details.scratchesDone, 2);
    assert.strictEqual(res.details.emblemTokenClaimed, true);
    assert.strictEqual(res.details.emblemXpBonusClaimed, true);
    assert.strictEqual(res.details.emblemLevelUpClaimed, true);
    assert.strictEqual(res.details.luckySpinsDone, 2);
    // Tokens: 5 (Absen D5) + 15 (Calendar Milestone #1) + 0 (Milestone #2 item) + 3 (Scratch #1) + 10 (Emblem Daily Token) + 7 (Lucky Spin #1) = 40
    assert.strictEqual(res.tokensGained, 40);
    // Pastikan shared.st.level otomatis naik ke 51 setelah claimLevelUp
    assert.strictEqual(shared.st.level, 51);
    // Pastikan tidak ada pemanggilan scratch mode token
    assert.strictEqual(calls.some(c => c.params && c.params.includes('token')), false);

    // 2. Test Low-Level Free Character (Lv 15 Genin) dengan 0 Free Scratch -> pastikan memakai scratchCard (bukan Atfer20Level) & skip ketika 0 kuota gratis!
    const lowCalls = [];
    const mockClientLow = {
        getHash,
        async login() {
            return { ok: true, sessionKey: sessKey, token: 'tok2', accountType: 1, isEmblem: false, tokens: 20 };
        },
        getSelectedChar: chars => chars[0],
        async getCharacterByIdWithWait(session) {
            return {
                ok: true,
                gk: 'gk_low',
                session,
                result: { character_level: 15, character_rank: 1, character_gold: 1000, character_xp: 5000 }
            };
        },
        async getExtraDataWithRetry() {
            return {
                ok: true,
                result: {
                    DailyReward: { allow_to_claim: false, claimed_times: 2, items: [] },
                    free_roulette_times: 1,
                    premium_daily_token: false,
                    lucky_spin_remaining_spin: 0
                }
            };
        },
        async amf(service, params) {
            lowCalls.push({ service, params });
            if (service === 'CharacterDAO.getCharactersList') return { body: { status: 1, result: [['999', 'GeninKid', 15]] } };
            if (service === 'NewDailyRewardStamp2017.getStatus') return { body: { status: 1, loginDay: ['1'], claimReward: ['0', '0', '0', '0', '0', '0'], item_list: [] } };
            if (service === 'RouletteService.randomAddScatchCard') return { body: { status: 1, bango: false } };
            if (service === 'RouletteService.getScratchCardData') return { body: {} }; // fallback ke free_roulette_times = 1
            if (service === 'RouletteService.scratchCard') {
                assert.strictEqual(params[1], 'free');
                return { body: { status: 1, reward_type: 'GOLD', reward_amount: 1500, dailyRoulette_remainTime: 0 } };
            }
            throw new Error('Unexpected low-level AMF: ' + service);
        }
    };

    const lowRes = await runDailyLoginSession({
        user: 'free_kid',
        pass: '123',
        client: mockClientLow,
        sleep: async () => { },
        log: () => { }
    });
    assert.strictEqual(lowRes.exitCode, 0);
    assert.strictEqual(lowRes.details.scratchesDone, 1);
    assert.strictEqual(lowCalls.some(c => c.service === 'RouletteService.scratchCard'), true);
    assert.strictEqual(lowCalls.some(c => c.service === 'RouletteService.scratchCardAtfer20Level'), false);

    // 3. Test summarizeDailyLoginStatusFromExtra Rank Cap guard untuk Emblem +1 Level Up
    const cappedSnap = summarizeDailyLoginStatusFromExtra(
        { premium_claim_level: true, premium_daily_token: true },
        { isEmblem: true, accountType: 2, level: 20, rank: 1 } // Genin cap 20 -> tidak bisa klaim +1 level sebelum ujian Chunin!
    );
    assert.strictEqual(cappedSnap.dailyTokens.emblemLevelUpAvailable, false);
    assert.strictEqual(cappedSnap.dailyTokens.emblemTokenAvailable, true);

    // 4. Test ns_thanksgiving CLI loop & 15m default interval
    const tgLoopDefault = parseTgCliArgs(['node', 'ns_thanksgiving.js', 'loop', 'full']);
    assert.strictEqual(tgLoopDefault.mode, 'loop');
    assert.strictEqual(tgLoopDefault.subMode, 'full');
    assert.strictEqual(tgLoopDefault.intervalMin, 15);

    const tgFlagLoop = parseTgCliArgs(['node', 'ns_thanksgiving.js', 'minigame', '--loop', '--interval-min', '15']);
    assert.strictEqual(tgFlagLoop.mode, 'loop');
    assert.strictEqual(tgFlagLoop.subMode, 'minigame');
    assert.strictEqual(tgFlagLoop.loop, true);
    assert.strictEqual(tgFlagLoop.intervalMin, 15);

    // 5. Test ns_multi_manager smart 15-minute loop (Cycle 1 = Daily+Event, Cycle 2 = Event Only, Cycle 3 New Day = Daily+Event!)
    assert.strictEqual(normalizeLoopBaseAction('auto_all_event'), 'daily_thanksgiving_full');
    assert.strictEqual(getFollowupEventAction('daily_thanksgiving_full'), 'thanksgiving_full');

    const parsedMulti = parseMultiCliArgs(['auto_all_event', '-p', '2']);
    assert.strictEqual(parsedMulti.useLoop, true);
    assert.strictEqual(parsedMulti.intervalMin, 15);
    assert.strictEqual(parsedMulti.concurrency, 2);

    const executedCycles = [];
    const waitedMs = [];
    const fakeDates = ['2026-11-28', '2026-11-28', '2026-11-29'];
    let dateIdx = 0;

    const summaries = await runBulkLoop('auto_all_event', [], 0, 2, {
        maxCycles: 3,
        intervalMin: 15,
        skipReportWrite: true,
        retryWaitSec: 0,
        preExpanded: [
            { user: 'acc1', pass: 'p1', slot: '1', charId: '101', charName: 'NinjaA', charLevel: 90, targetLevel: 100 },
            { user: 'acc2', pass: 'p2', slot: '1', charId: '102', charName: 'NinjaB', charLevel: 85, targetLevel: 100 }
        ],
        getDateStr: () => fakeDates[dateIdx++],
        sleep: async ms => { waitedMs.push(ms); },
        runScriptFn: async (scriptName, args, acc) => {
            executedCycles.push({ scriptName, args, user: acc.user });
            return { ok: true, code: 0 };
        }
    });

    assert.strictEqual(summaries.length, 3);
    // Cycle 1 (2026-11-28): runs ns_daily.js --pure --with-thanksgiving-full
    assert.strictEqual(summaries[0].action, 'daily_thanksgiving_full');
    assert.strictEqual(executedCycles[0].scriptName, 'ns_daily.js');
    assert.deepStrictEqual(executedCycles[0].args, ['--pure', '--with-thanksgiving-full']);
    // Cycle 2 (2026-11-28, 15m later): runs ns_thanksgiving.js full (Battle + Wolf Mini-game!)
    assert.strictEqual(summaries[1].action, 'thanksgiving_full');
    assert.strictEqual(executedCycles[2].scriptName, 'ns_thanksgiving.js');
    assert.deepStrictEqual(executedCycles[2].args, ['full']);
    // Cycle 3 (2026-11-29, new day!): automatically re-runs ns_daily.js --pure --with-thanksgiving-full!
    assert.strictEqual(summaries[2].action, 'daily_thanksgiving_full');
    assert.strictEqual(executedCycles[4].scriptName, 'ns_daily.js');

    // Verify 2 standby waits of 15 minutes (900,000 ms each = 1,800,000 ms total standby; plus tiny worker stagger sleeps)
    const standbyTotalMs = waitedMs.filter(ms => ms >= 10000).reduce((a, b) => a + b, 0);
    assert.strictEqual(standbyTotalMs, 2 * 15 * 60 * 1000);

    console.log('ns_daily_login.test.js OK (All assertions passed!)');
})().catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});
