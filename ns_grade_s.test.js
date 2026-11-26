'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    getLocalDateStr,
    parseRewardEntry,
    parseSGradeFinishReward,
    parseMissionRewards,
    parseScratchCardReward,
    appendMissionHistory,
    readMissionHistory,
    formatSessionHistoryLines
} = require('./lib/ns_mission_history.js');
const c = require('./nsclient.js');
const {
    parseRewardItems,
    createLoopTracker,
    printHistoryReport,
    runGradeSSession
} = require('./ns_grade_s.js');

// 1. Regression test: tokens: 0 and inv.token balance (265) must NOT produce false positive
{
    const res = parseMissionRewards({
        status: 1,
        update_inventory: {
            xp: 100000,
            gold: 50000,
            token: 265,
            tokens: 0,
            add_item_id: []
        }
    });
    assert.strictEqual(res.tokenGained, 0);
    assert.strictEqual(res.wonToken, false);
    assert.strictEqual(res.newTokenBalance, 265);
    assert.deepStrictEqual(res.items, []);
}

// 2. Test parseSGradeFinishReward against live SLevelMission.finishMission shapes
{
    const liveItemSpin = parseSGradeFinishReward({
        status: 1,
        update_inventory: {
            showPopup: false,
            add_item_id: ['item902', 'xp0_1', 'gold5000_1'],
            xp: 346305328,
            gold: 70898903,
            token: 265
        },
        reward_list: ['item_899,item_899_3,gold_5000,token_10,item_901,item_902']
    }, { prevTokenBalance: 265 });
    assert.strictEqual(liveItemSpin.spinRewardRaw, 'item902');
    assert.strictEqual(liveItemSpin.spinRewardLabel, 'Gan of Steel');
    assert.strictEqual(liveItemSpin.tokenGained, 0);
    assert.strictEqual(liveItemSpin.newTokenBalance, 265);
    assert.strictEqual(liveItemSpin.addItemXp, 0);
    assert.strictEqual(liveItemSpin.addItemGold, 5000);
    assert.strictEqual(liveItemSpin.itemCounts['Gan of Steel'], 1);
    assert.strictEqual(liveItemSpin.wheelList.length, 6);

    const tokenSpin = parseSGradeFinishReward({
        status: 1,
        update_inventory: {
            add_item_id: ['token_10', 'xp82700_1', 'gold5000_1'],
            xp: 5082700,
            gold: 105000,
            token: 275
        },
        reward_list: ['item_899,item_899_3,gold_5000,token_10,item_901,item_902']
    }, { prevTokenBalance: 265 });
    assert.strictEqual(tokenSpin.spinTokens, 10);
    assert.strictEqual(tokenSpin.tokenGained, 10);
    assert.strictEqual(tokenSpin.wonToken, true);
    assert.strictEqual(tokenSpin.spinRewardLabel, '10 Saga Token');

    const ramenSpin = parseSGradeFinishReward({
        status: 1,
        update_inventory: {
            add_item_id: ['item_899_3', 'xp82700_1', 'gold5000_1'],
            token: 275
        }
    }, { prevTokenBalance: 275 });
    assert.strictEqual(ramenSpin.spinRewardLabel, 'Ramen (+10 Energy) x3');
    assert.strictEqual(ramenSpin.itemCounts['Ramen (+10 Energy)'], 3);

    const goldSpin = parseSGradeFinishReward({
        status: 1,
        update_inventory: {
            add_item_id: ['gold_5000', 'xp82700_1', 'gold5000_1'],
            token: 275
        }
    }, { prevTokenBalance: 275 });
    assert.strictEqual(goldSpin.spinGold, 5000);
    assert.strictEqual(goldSpin.tokenGained, 0);

    const noRollWithExtraDrop = parseSGradeFinishReward({
        status: 1,
        update_inventory: {
            add_item_id: ['item1', 'xp0_1', 'gold5000_1', 'item1148'],
            xp: 5082700,
            gold: 110000,
            token: 265
        }
    }, { prevTokenBalance: 265 });
    assert.strictEqual(noRollWithExtraDrop.spinRewardRaw, 'item1');
    assert.strictEqual(noRollWithExtraDrop.spinRewardLabel, '-');
    assert.deepStrictEqual(noRollWithExtraDrop.extraItems, ['Earth Stone Fragment']);
    assert.strictEqual(noRollWithExtraDrop.itemCounts['Earth Stone Fragment'], 1);
}

// 3. Test add_item_id, item quantities, roulette/spin rewards, and token formats
{
    const res = parseMissionRewards({
        status: 1,
        update_inventory: {
            add_item_id: ['item509_2', 'ramen_3', 'fire_magatama']
        },
        reward_get: ['token_10']
    });
    assert.strictEqual(res.tokenGained, 10);
    assert.strictEqual(res.wonToken, true);
    assert.strictEqual(res.itemCounts['Hunting Passport'], 2);
    assert.strictEqual(res.itemCounts['Ramen (+Energi)'], 3);
    assert.strictEqual(res.itemCounts['Fire Magatama'], 1);
    assert.ok(res.items.includes('10 Token'));

    const resObj = parseRewardItems({
        status: 1,
        roulette_reward: { type: 'token', amount: 15 },
        reward: ['xp_82700', 'gold_5000', 'item1026']
    });
    assert.strictEqual(resObj.tokenGained, 15);
    assert.strictEqual(resObj.extraXp, 82700);
    assert.strictEqual(resObj.extraGold, 5000);
    assert.strictEqual(resObj.itemCounts['Crystal of Kari'], 1);

    const scTok = parseScratchCardReward({ status: 1, reward_type: 'TOKEN', reward_amount: '10' });
    assert.strictEqual(scTok.tokens, 10);
    assert.strictEqual(scTok.rewardLabel, '+10 Saga Token ★');
    const scItem = parseScratchCardReward({ status: 1, reward_type: 'ITEM', reward_amount: 'item899' });
    assert.strictEqual(scItem.itemName, 'Ramen (+10 Energy)');
    assert.strictEqual(scItem.rewardLabel, 'ITEM: Ramen (+10 Energy)');
    const scLines = formatSessionHistoryLines([{
        timestamp: '2026-11-26T08:00:00.000Z',
        missionName: 'The Dessert Ronins',
        xp: 24880,
        gold: 3200,
        tokens: 10,
        scratch: { checked: true, bango: true, scratched: true, rewardLabel: '+10 Saga Token ★' }
    }]);
    assert.ok(scLines[0].includes('Scratch: GRATIS -> +10 Saga Token ★'));

    assert.strictEqual(parseRewardEntry('token_0'), null);
    assert.strictEqual(parseRewardEntry({ type: 'token', amount: 0 }), null);
}

// 4. Test appendMissionHistory, readMissionHistory, and formatSessionHistoryLines
{
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nscc-grades-test-'));
    try {
        const histFile = path.join(tmpDir, 'grade_s_history.jsonl');
        const today = getLocalDateStr();

        appendMissionHistory(histFile, {
            account: 'acc1',
            charId: '101',
            charName: 'Naruto',
            missionId: 'msn274',
            missionName: 'Misi 1 (Stage 1)',
            battleNo: 1,
            xp: 82700,
            gold: 5000,
            tokens: 0,
            spinReward: 'Gan of Steel',
            items: ['Gan of Steel']
        });
        appendMissionHistory(histFile, {
            account: 'acc1',
            charId: '101',
            charName: 'Naruto',
            missionId: 'msn275',
            missionName: 'Misi 2 (Stage 2 - Story Genin)',
            battleNo: 2,
            xp: 88600,
            gold: 5300,
            tokens: 10,
            spinReward: '10 Saga Token',
            items: ['10 Token']
        });
        appendMissionHistory(histFile, {
            account: 'acc2',
            charId: '202',
            charName: 'Sasuke',
            date: '2026-01-01',
            timestamp: '2026-01-01T10:00:00.000Z',
            missionId: 'msn274',
            missionName: 'Misi 1 (Stage 1)',
            battleNo: 1,
            xp: 82700,
            gold: 5000,
            tokens: 10,
            spinReward: '10 Saga Token',
            items: ['10 Token']
        });

        const acc1Summary = readMissionHistory(histFile, { account: 'acc1', charId: '101', limit: 10 });
        assert.strictEqual(acc1Summary.totals.missions, 2);
        assert.strictEqual(acc1Summary.totals.xp, 171300);
        assert.strictEqual(acc1Summary.totals.gold, 10300);
        assert.strictEqual(acc1Summary.totals.tokens, 10);
        assert.strictEqual(acc1Summary.totals.tokenMatches, 1);
        assert.strictEqual(acc1Summary.today.missions, 2);
        assert.strictEqual(acc1Summary.today.tokens, 10);
        assert.strictEqual(acc1Summary.todayDate, today);
        assert.strictEqual(acc1Summary.totals.itemTotals['Gan of Steel'], 1);

        const allSummary = readMissionHistory(histFile, { limit: 10 });
        assert.strictEqual(allSummary.totals.missions, 3);
        assert.strictEqual(allSummary.totals.tokens, 20);
        assert.strictEqual(allSummary.totals.tokenMatches, 2);

        const lines = formatSessionHistoryLines(acc1Summary.entries);
        assert.strictEqual(lines.length, 2);
        assert.ok(lines[0].includes('Gan of Steel'));
        assert.ok(lines[1].includes('+10 Token'));

        const noRollLines = formatSessionHistoryLines([{
            timestamp: '2026-11-26T07:07:30.000Z',
            missionName: 'Misi 1 (Stage 1)',
            xpGained: 0,
            goldGained: 5000,
            tokenGained: 0,
            spinReward: '-',
            spinRewardRaw: 'item1',
            extraItems: ['Earth Stone Fragment']
        }]);
        assert.strictEqual(noRollLines.length, 1);
        assert.ok(noRollLines[0].includes('Tidak Roll (item1)'));
        assert.ok(noRollLines[0].includes('Drop: Earth Stone Fragment'));

        const printed = printHistoryReport({ historyFile: histFile, all: true, limit: 10 });
        assert.strictEqual(printed.totals.missions, 3);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// 5. End-to-end mocked runGradeSSession using SLevelMission (getBattleStatus + startMission + finishMission)
(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nscc-grades-session-'));
    const origLogin = c.login;
    const origAmf = c.amf;
    const origGetChar = c.getCharacterByIdWithWait;
    const origGetExtra = c.getExtraDataWithRetry;

    const prevUser = process.env.NS_USER;
    const prevPass = process.env.NS_PASS;

    try {
        process.env.NS_USER = 'demo_user';
        process.env.NS_PASS = 'demo_pass';

        let loginCalls = 0;
        let battleCall = 0;
        let mockEnergy = 75;

        c.login = async () => {
            loginCalls++;
            return {
                ok: true,
                accountType: 2,
                isEmblem: true,
                sessionKey: 'gs_mock_session_123',
                token: 'tok_mock',
                tokens: loginCalls === 1 ? 100 : 110
            };
        };

        c.amf = async (service, params) => {
            if (service === 'CharacterDAO.getCharactersList') {
                return { body: { result: [['999', 'MockNinja', 85]] } };
            }
            if (service === 'SLevelMission.getBattleStatus') {
                return {
                    body: {
                        status: 1,
                        remain_energy: mockEnergy,
                        energy_refill_remain: mockEnergy < 75 ? 350 : 0,
                        result: { chapter_status: 2, mission_status: 5 }
                    }
                };
            }
            if (service === 'SLevelMission.startMission') {
                const mid = params[1];
                const cost = mid === 'msn274' ? 10 : 12;
                mockEnergy -= cost;
                return {
                    body: {
                        status: 1,
                        startBattleId: 1000 + battleCall,
                        slf: '3a23f322fa7b0fc1'
                    }
                };
            }
            if (service === 'SLevelMission.finishMission') {
                battleCall++;
                assert.ok(params[2] && params[2].length > 0, 'battleLog srk(gk5, sln) must be non-empty');
                assert.ok(params[6] && params[6].length > 0, 'sig srk(slv, sln) must be non-empty');
                if (battleCall === 1) {
                    return {
                        body: {
                            status: 1,
                            update_inventory: {
                                showPopup: false,
                                add_item_id: ['item902', 'xp82700_1', 'gold5000_1'],
                                xp: 5082700,
                                gold: 105000,
                                token: 100
                            },
                            reward_list: ['item_899,item_899_3,gold_5000,token_10,item_901,item_902']
                        }
                    };
                }
                return {
                    body: {
                        status: 1,
                        update_inventory: {
                            showPopup: false,
                            add_item_id: ['token_10', 'xp88600_1', 'gold5300_1'],
                            xp: 5171300,
                            gold: 110300,
                            token: 110
                        },
                        reward_list: ['item_899,item_899_3,gold_5000,token_10,item_901,item_902']
                    }
                };
            }
            throw new Error('Unexpected AMF service: ' + service);
        };

        c.getCharacterByIdWithWait = async () => ({
            ok: true,
            gk: 'gk_mock',
            result: {
                character_name: 'MockNinja',
                character_level: 85,
                character_xp: 5000000,
                character_gold: 100000
            }
        });

        c.getExtraDataWithRetry = async () => ({
            ok: true,
            result: {
                totalToken: 100,
                slx: '55aaa52a307f70f23055ed108b2206d28ac1f1c6bf55c3b4',
                xmas2014SpecailReward: 'hwwtpwtGGzzzxwJqVqRSVVxYNVYVYKSGYNGGtKRVVNRJqVNm'
            }
        });

        const histFile = path.join(tmpDir, 'grade_s_history.jsonl');
        const tokFile = path.join(tmpDir, 'grade_s_tokens.log');
        const tracker = createLoopTracker();

        const res = await runGradeSSession({
            target: '1-4',
            jeda: 0.01,
            minWaitMs: 0,
            maxBattles: 2,
            tracker,
            historyFile: histFile,
            tokenLogFile: tokFile
        });

        assert.strictEqual(res.exitCode, 0);
        assert.strictEqual(res.battles, 2);
        assert.strictEqual(res.totalTokensWon, 10);
        assert.strictEqual(res.tokenMatchCount, 1);
        assert.strictEqual(res.initialTokens, 100);
        assert.strictEqual(res.finalTokens, 110);
        assert.strictEqual(res.curEnergy, 53);
        assert.strictEqual(res.totalXpGained, 171300);
        assert.strictEqual(res.totalGoldGained, 10300);
        assert.strictEqual(res.itemCounts['Gan of Steel'], 1);
        assert.strictEqual(res.history.length, 2);
        assert.strictEqual(res.history[0].spinReward, 'Gan of Steel');
        assert.strictEqual(res.history[1].spinReward, '10 Saga Token');

        assert.strictEqual(tracker.cycles, 1);
        assert.strictEqual(tracker.battles, 2);
        assert.strictEqual(tracker.totalTokensWon, 10);
        assert.strictEqual(tracker.tokenMatchCount, 1);

        const saved = readMissionHistory(histFile, { account: 'demo_user', charId: '999', limit: 10 });
        assert.strictEqual(saved.totals.missions, 2);
        assert.strictEqual(saved.totals.tokens, 10);
        assert.strictEqual(saved.totals.tokenMatches, 1);
        assert.strictEqual(saved.totals.itemTotals['Gan of Steel'], 1);

        assert.ok(fs.existsSync(tokFile), 'grade_s_tokens.log should exist');
        console.log('ns_grade_s.test.js OK');
    } finally {
        c.login = origLogin;
        c.amf = origAmf;
        c.getCharacterByIdWithWait = origGetChar;
        c.getExtraDataWithRetry = origGetExtra;
        if (prevUser === undefined) delete process.env.NS_USER; else process.env.NS_USER = prevUser;
        if (prevPass === undefined) delete process.env.NS_PASS; else process.env.NS_PASS = prevPass;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
})();
