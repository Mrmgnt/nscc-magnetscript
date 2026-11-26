const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const vm = require('vm');
const assert = require('assert');
const { formatCerberusReport, sendHermesReport } = require('./lib/ns_hermes_notify.js');
const { PveSocket } = require('./lib/ns_pve_socket.js');
const { PveBattle } = require('./lib/ns_pve_battle.js');
const source = fs.readFileSync(path.join(__dirname, 'ns_coop_minotaur.js'), 'utf8');
const cut = source.indexOf('\n(async () => {');
const context = { module: { exports: {} }, require(name) { if (name === 'fs') return fs; if (name === 'os') return os; if (name === 'path') return path; if (name === './nsclient.js') return {}; if (name.includes('ns_pve_socket')) return { PveSocket: {} }; if (name.includes('ns_pve_battle')) return { PveBattle }; if (name.includes('ns_hermes_notify')) return { formatCerberusReport, sendHermesReport }; throw new Error(name); }, console, process: { hrtime: process.hrtime, env: {}, stdout: {} }, setTimeout, clearTimeout };
vm.runInNewContext(source.slice(0, cut) + '\nmodule.exports = { parseArgs, resolveMinStartEnergy, resolveBattleTimeoutMs, acquireRunLock, isTransientSocketError, hasRequiredEnergy, waitForEnergyRefill, parsePveRankingResponse, extractScoreForChar, findQuestId, buildCharSummaryMap, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, describeDeck, normCharId, idList, evaluateLevel, handleBattlePreTurnStep, clearBattleTimers, traceBattleProgress, handleMidBattleLeave, readSelfHp, readSelfResources, tickSelfSkillCooldowns, trackSelfActionOutcome, hasReactiveForcePacket, trackReactiveForce, pickSuperChargesSkill, recordRoomKick, recordLowLevelMaster, isPasswordRejection };', context);
const { parseArgs, resolveMinStartEnergy, resolveBattleTimeoutMs, acquireRunLock, isTransientSocketError, hasRequiredEnergy, waitForEnergyRefill, parsePveRankingResponse, extractScoreForChar, findQuestId, buildCharSummaryMap, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, describeDeck, normCharId, idList, evaluateLevel, handleBattlePreTurnStep, clearBattleTimers, traceBattleProgress, handleMidBattleLeave, readSelfHp, readSelfResources, tickSelfSkillCooldowns, trackSelfActionOutcome, hasReactiveForcePacket, trackReactiveForce, pickSuperChargesSkill, recordRoomKick, recordLowLevelMaster, isPasswordRejection } = context.module.exports;
assert.equal(parseArgs([]).maxMatches, Infinity);
assert.equal(parseArgs(['--max-matches', '2']).maxMatches, 2);
assert.equal(parseArgs(['--host-room']).hostRoom, true);
assert.deepEqual({ stb: parseArgs(['--stb']).stb, headless: parseArgs(['--stb']).headless, notify: parseArgs(['--stb']).notify, lock: parseArgs(['--stb']).lock }, { stb: true, headless: true, notify: true, lock: true });
assert.equal(parseArgs(['--stb', '--headful', '--no-notify']).headless, false);
assert.equal(parseArgs(['--stb', '--no-notify']).notify, false);
assert.equal(parseArgs(['--half-energy']).minStartEnergy, 'auto');
assert.equal(parseArgs(['--min-start-energy', 'auto']).minStartEnergy, 'auto');
assert.equal(parseArgs(['--min-start-energy', '40']).minStartEnergy, 40);
assert.equal(parseArgs(['--battle-timeout', '2700000']).battleTimeout, 2700000);
assert.throws(() => parseArgs(['--battle-timeout', '0']), /--battle-timeout/);
assert.equal(resolveBattleTimeoutMs(parseArgs([]), {}), 3600000);
assert.equal(resolveBattleTimeoutMs(parseArgs(['--host-start-timeout', '2000000']), {}), 4000000);
assert.equal(resolveBattleTimeoutMs(parseArgs([]), { NS_COOP_BATTLE_TIMEOUT: '1200000' }), 1200000);
assert.equal(resolveBattleTimeoutMs(parseArgs(['--battle-timeout', '2700000']), { NS_COOP_BATTLE_TIMEOUT: '1200000' }), 2700000);
assert.equal(parseArgs(['--lock']).lock, true);
assert.equal(hasRequiredEnergy(5, 5), true);
assert.equal(hasRequiredEnergy(4, 5), false);
assert.equal(hasRequiredEnergy(undefined, 5), false);
assert.equal(resolveMinStartEnergy('auto', true), 50);
assert.equal(resolveMinStartEnergy('auto', false), 25);
assert.equal(resolveMinStartEnergy(40, true), 40);
const testLockUser = 'test_lock_' + process.pid;
const testLockFile = path.join(os.tmpdir(), `ns_pve_cerberus_${testLockUser}.lock`);
const releaseTestLock = acquireRunLock({ username: testLockUser }, true);
assert.equal(fs.existsSync(testLockFile), true);
releaseTestLock();
assert.equal(fs.existsSync(testLockFile), false);
assert.equal(findQuestId([{ display_boss: ['enemy533'], quest_obj: [{ quest: 13, energy: [25, 5] }] }], 'cerberus', 'extreme').quest, 13);
assert.equal(findQuestId([{ display_boss: ['enemy501'], quest_obj: [{ quest: 3, energy: [25, 5] }] }], 'minotaur', 'extreme').quest, 3);
assert.equal(findQuestId([{ display_boss: ['enemy546'], quest_obj: [{ quest: 23, energy: [25, 5] }] }], 'griffin', 'extreme').quest, 23);
const room = normalizeRoom({ room_name: '12', quest: 3, max_player: 3, character_array: [{ character_id: 'free', accountType: 1 }, { character_id: 'emblem', accountType: 2 }] }, 3);
assert.equal(countOtherEmblems(room.players, 'bot'), 1);
assert.equal(countOtherEmblems(room.players, 'emblem'), 0);
assert.equal(hasFullQuickmatchTeam(room.players), false);
assert.equal(hasFullQuickmatchTeam([...room.players, { charId: 'third' }]), true);
assert.deepEqual(normalizePlayer('00027007'), { charId: '00027007', isEmblem: null });
const picked = pickRoom([{ room_name: '1', quest: 3, max_player: 3, character_array: [{ character_id: 'free', accountType: 1, level: 90 }] }, { room_name: '2', quest: 3, max_player: 3, character_array: [{ character_id: 'free', accountType: 1, level: 90 }, { character_id: 'emblem', accountType: 2, level: 90 }] }], 3, 'bot');
assert.equal(picked.room.id, '2');
assert.equal(picked.evaluated[0].reason, 'need_second_emblem');
const lowMaster = pickRoom([{ room_name: '5', quest: 3, max_player: 3, character_array: [{ character_id: 'host', accountType: 2, level: 79 }, { character_id: 'emblem', accountType: 2, level: 90 }] }], 3, 'bot');
assert.equal(lowMaster.room, undefined);
assert.equal(lowMaster.evaluated[0].reason, 'master_level_79');
const level80Master = pickRoom([{ room_name: '6', quest: 3, max_player: 3, character_array: [{ character_id: 'host', accountType: 2, level: 80 }, { character_id: 'emblem', accountType: 2, level: 90 }] }], 3, 'bot');
assert.equal(level80Master.room.id, '6');
const roomCooldown = pickRoom([{ room_name: '2', quest: 3, max_player: 3, character_array: [{ character_id: 'free', accountType: 1, level: 90 }, { character_id: 'emblem', accountType: 2, level: 90 }] }], 3, 'bot', new Set(['2']));
assert.equal(roomCooldown.room, undefined);
assert.equal(roomCooldown.evaluated[0].reason, 'room_cooldown');
const incomplete = pickRoom([{ room_name: '3', quest: 3, max_player: 3, player_count: 1 }], 3, 'bot');
assert.equal(incomplete.room.id, '3');
assert.equal(incomplete.evaluated[0].reason, 'verify_after_join');
const passwordRoom = pickRoom([{ room_name: '4', quest: 3, has_password: true, max_player: 3, player_count: 1 }], 3, 'bot');
assert.equal(passwordRoom.room, undefined);
assert.equal(passwordRoom.evaluated[0].reason, 'password_required');
assert.equal(scanSummary([{ reason: 'room_full' }, { reason: 'room_full' }, { reason: 'need_second_emblem' }]), 'room_full=2, need_second_emblem=1');
const skills = [{ id: '2004', skillId: 'skill2004' }, { id: '632', skillId: 'skill632' }, { id: '345', skillId: 'skill345' }];
assert.equal(chooseMinotaurTurn(skills, ['head', 'left'], 0).skill.skillId, 'skill2004');
assert.equal(chooseMinotaurTurn(skills, ['head', 'left'], 0).targetId, 'head');
assert.equal(chooseMinotaurTurn([{ id: '39', skillId: 'skill39' }, { id: '2004', skillId: 'skill2004' }], ['head'], 0, true).skill.skillId, 'skill39');
assert.equal(chooseMinotaurTurn(skills, ['head', 'left'], 1).skill.skillId, 'skill632');
assert.equal(chooseMinotaurTurn([{ id: '345', skillId: 'skill345' }], ['head', 'left'], 1).targetId, 'left');
assert.equal(captchaRetryDecision({ ok: false, reason: 'verification_rejected', failsLeft: 76 }).action, 'retry');
assert.equal(captchaRetryDecision({ ok: false, reason: 'verification_rejected', failsLeft: 4 }).action, 'stop');
console.log('OK: public room parser, quest, other-Emblem filter, room selection');
// --- Cerberus host-room: roster / level / skill planning ---
assert.equal(normCharId('95114'), '00095114');
assert.equal(normCharId('00084612'), '00084612');
assert.deepEqual(Array.from(idList(['1', { char_id: '2' }, { character_id: '3' }])), ['1', '2', '3']);
assert.equal(evaluateLevel(80, 80).ok, true);
assert.equal(evaluateLevel(79, 80).ok, false);
assert.equal(evaluateLevel(undefined, 80).reason, 'level_unknown');
assert.equal(parseArgs([]).minLevel, 80);
assert.equal(parseArgs(['--min-level', '85']).minLevel, 85);
const mk = ids => ids.map(id => ({ id: String(id), skillId: 'skill' + id }));
// Uzumaki Magnet (Mrmgnt1) deck: no Evasion; Refresh as defense, Seal opener, Moon Cleave AoE, never 652 / 3.
const magnet = mk([3, 652, 97, 345, 156, 112, 102, 84]);
const magnetPick = t => chooseCerberusTurn(magnet, ['head', 'lh'], t).skill.skillId;
assert.equal(magnetPick(0), 'skill84');
assert.equal(magnetPick(1), 'skill345');
assert.equal(magnetPick(2), 'skill112');
const magnetCycle = Array.from({ length: 12 }, (_, i) => magnetPick(i));
assert.ok(!magnetCycle.includes('skill652') && !magnetCycle.includes('skill3'));
assert.equal(chooseCerberusTurn(magnet, ['head'], 0).targetId, 'head');
// Uchiha Razq deck: Evasion first, Seal second, Electric Smash AoE next.
const razq = mk([345, 854, 632, 39, 151, 728, 633, 631, 3000, 3500]);
assert.equal(chooseCerberusTurn(razq, ['h'], 0).skill.skillId, 'skill39');
assert.equal(chooseCerberusTurn(razq, ['h'], 1).skill.skillId, 'skill345');
assert.equal(chooseCerberusTurn(razq, ['h'], 2).skill.skillId, 'skill632');
assert.ok(!Array.from({ length: 20 }, (_, i) => chooseCerberusTurn(razq, ['h'], i).skill.skillId).some(id => /skill3[05]00/.test(id)));
assert.equal(chooseCerberusTurn([], ['h'], 0).skill, null);
assert.ok(describeDeck(razq).includes('defense=39,854'));
const razqNamed = [
    { id: '345', skillId: 'skill345', action: 'skill', name: 'Kinjutsu Five Elements Consuming Seal', damage: 90 },
    { id: '633', skillId: 'skill633', action: 'skill', name: 'Kinjutsu Thunder Explosion', damage: 80 },
    { id: '629', skillId: 'skill629', action: 'skill', name: 'Kinjutsu Flame Armor', damage: 75 },
    { id: '632', skillId: 'skill632', action: 'skill', name: 'Electric Smash', damage: 70 },
    { id: '3110', skillId: 'skill3110', action: 'senjutsu', name: 'Senjutsu Dragon Sublimation', damage: 60 },
    { id: '151', skillId: 'skill151', action: 'skill', name: 'Kinjutsu Dance of Fujin', damage: 50 },
    { id: '854', skillId: 'skill854', action: 'skill', name: 'Kinjutsu Advanced Aphrodite Blessing', damage: 40 },
    { id: '39', skillId: 'skill39', action: 'skill', name: 'Kinjutsu Evasion', damage: 30 },
    { id: '652', skillId: 'skill652', action: 'skill', name: 'Flute of God Killing', damage: 1000 },
];
assert.deepEqual(
    Array.from({ length: 9 }, (_, turn) => chooseQuickmatchTurn('Uchiha Razq', razqNamed, ['h'], turn).skill.skillId),
    ['skill345', 'skill633', 'skill629', 'skill632', 'skill3110', 'skill151', 'skill854', 'skill345', 'skill633']
);
assert.equal(chooseQuickmatchTurn('Uchiha Razq', razqNamed, ['h'], 4).skill.action, 'senjutsu');
assert.deepEqual(
    Array.from({ length: 10 }, (_, turn) => chooseCerberusTurn(razqNamed, ['h'], turn, 'Uchiha Razq').skill.skillId),
    ['skill39', 'skill345', 'skill633', 'skill629', 'skill632', 'skill854', 'skill3110', 'skill151', 'skill39', 'skill345']
);
assert.equal(chooseCerberusTurn(razqNamed, ['h'], 6, 'Uchiha Razq').skill.action, 'senjutsu');
assert.equal(chooseQuickmatchTurn('Other', [{ id: '652', skillId: 'skill652', damage: 999 }, { id: '22', skillId: 'skill22', damage: 10 }], ['h'], 0).skill.skillId, 'skill22');
const sent = [];
const fakeSock = {
    battleInit: () => sent.push('init'),
    battleReady: () => sent.push('ready'),
    startAtb: cid => sent.push(['start_atb', cid]),
    actionReady: cid => sent.push(['action_ready', cid]),
    actionFinish: (dead, cid) => sent.push(['action_finish', dead, cid]),
};
const activeSim = { done: false, battle: { battleCharId: '84542' } };
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'init' }), true);
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'ready' }), true);
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'ready' }), true);
activeSim.battleReadySent = true;
activeSim.battleReadyAfterInitSent = false;
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'ready' }), true);
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'startAtb' }), true);
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'actionReady' }), true);
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'actionFinish', charDead: false }), true);
assert.deepEqual(sent, ['init', 'ready', 'ready', ['start_atb', '84542'], ['action_ready', '84542'], ['action_finish', false, '84542']]);
clearBattleTimers(activeSim);
// Self death + teammate still alive tracing
const traceLogs = [];
const activeTrace = { battle: new PveBattle({ charId: '00084542', strategy: 'B' }) };
activeTrace.battle.nextStep({ event: 'info', state: 'join', ta: ['00084542', '00075128', '00072043'], tb: ['ene_533'] });
const msgSelfDead = {
    event: 'command',
    state: 'battle_action',
    charId: '5331',
    battleAction: { action: 'attack' },
    syncData: [
        { type: 1, ID: '00084542', HP: 0, CP: 4060 },
        { type: 1, ID: '00075128', HP: 2500, CP: 3000 },
        { type: 1, ID: '00072043', HP: 0, CP: 1000 },
        { type: 4, ID: '5330', HP: 64000, maxHP: 128420 },
    ],
};
const deadStep = activeTrace.battle.nextStep(msgSelfDead);
assert.equal(deadStep.charDead, true);
traceBattleProgress(activeTrace, msgSelfDead, '00084542', m => traceLogs.push(m));
assert.ok(traceLogs.some(l => l.includes('SELF DEAD (HP=0)') && l.includes('sisa tim hidup=1 [00075128]') && l.includes('lanjut sampai selesai')));
assert.ok(traceLogs.some(l => l.includes('TEAMMATE DEAD char=00072043')));
assert.ok(traceLogs.some(l => l.includes('SPECTATE') && l.includes('bossHP=[5330:64000/128420]')));
handleMidBattleLeave(activeTrace, '00075128', m => traceLogs.push(m));
assert.ok(traceLogs.some(l => l.includes('LEAVE_BATTLE char=00075128 (sisa tim hidup=0)')));
const sentCmds = [];
const mockPveSock = new PveSocket({ charId: '00084542' });
mockPveSock.sendBattleMessage = m => sentCmds.push(m);
mockPveSock.battleCommand('84542', 'senjutsu', 'skill3110', '5331');
mockPveSock.battleCommand('84542', 'skill', 'skill345', '5331');
assert.deepEqual(sentCmds[0], { event: 'info', state: 'battle_command', charId: 84542, battleAction: { action: 'senjutsu', skillId: 'skill3110' }, targetId: 5331 });
assert.deepEqual(sentCmds[1], { event: 'info', state: 'battle_command', charId: 84542, battleAction: { action: 'skill', skillId: 'skill345' }, targetId: 5331 });
assert.deepEqual(Array.from(activeTrace.battle.enemyIds), [5331, 5330, 5332]);
const repAttempts = formatCerberusReport({ mode: 'public-room', account: 'Mrmgnt', matches: [{ outcome: 'battle_win' }], attempts: [{ outcome: 'retry' }, { outcome: 'retry' }, { outcome: 'battle_win' }] }, {});
assert.ok(repAttempts.summary.includes('Match: 1 total (Menang: 1, Kalah: 0, Retry: 2)'));
console.log('OK: cerberus host roster, level filter, per-account skill planning');
const parsedRank = parsePveRankingResponse({ latest_ranking_data: { player_own_ranking: 166, player_score: 53244 }, season_date: '11/17/2026 - 12/01/2026' });
assert.deepEqual(parsedRank, { rank: 166, score: 53244, seasonDate: '11/17/2026 - 12/01/2026' });
assert.equal(extractScoreForChar({ 84542: 500 }, '00084542'), 500);
const waPayload = formatCerberusReport({ mode: 'public-room', account: 'Mrmgnt', matches: [{ outcome: 'battle_win', reward: { 84542: ['gold46000'] } }] }, { charName: 'Uchiha Razq', energyStart: 100, energyEnd: 0, totalScoreStart: 53244, totalScoreEnd: 53744, rankStart: 166, rankEnd: 165, stopReason: 'Energy habis (0 < 5)' });
assert.equal(waPayload.status, '✅ SUCCESS');
assert.ok(waPayload.summary.includes('Energy: 100 -> 0'));
assert.ok(waPayload.summary.includes('Total Score:'));
assert.ok(waPayload.summary.includes('#166 -> #165'));
assert.ok(waPayload.summary.includes('gold46000'));
(async () => {
    const energyLogs = [];
    const waits = [];
    const refilled = await waitForEnergyRefill({}, 5, message => energyLogs.push(message), {
        initialPve: { energy: 3 },
        readEnergy: async () => ({ energy: 5 }),
        wait: async ms => waits.push(ms),
    });
    assert.equal(refilled.energy, 5);
    assert.deepEqual(waits, [15 * 60 * 1000]);
    assert.equal(energyLogs.length, 1);

    let seenSig = '', seenBody = '';
    const srv = http.createServer((req, res) => {
        seenSig = req.headers['x-hub-signature-256'];
        req.on('data', c => { seenBody += c; });
        req.on('end', () => { res.writeHead(200); res.end('ok'); });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const delivery = await sendHermesReport(waPayload, { url: `http://127.0.0.1:${port}/webhooks/agent-task-reports`, secret: 'testsecret' });
    srv.close();
    assert.equal(delivery.ok, true);
    assert.equal(seenSig, 'sha256=' + crypto.createHmac('sha256', 'testsecret').update(seenBody).digest('hex'));
    assert.equal(isTransientSocketError(new Error('Socket terputus (code=1000)')), true);
    assert.equal(isTransientSocketError(new Error('CAPTCHA ditolak server. fails_left=3.')), false);
    // Reactive Force -> Senjutsu: Super Charges (skill3500) priority for Uchiha Razq vs Cerberus
    const razqWithSuper = [...razqNamed, { id: '3500', skillId: 'skill3500', action: 'senjutsu', name: 'Senjutsu: Super Charges', damage: 0 }];
    const superPick = pickSuperChargesSkill(razqNamed, [{ id: '3500', skillId: 'skill3500', action: 'senjutsu', name: 'Senjutsu: Super Charges' }]);
    assert.equal(superPick && superPick.skillId, 'skill3500');
    const qm0 = chooseQuickmatchTurn('Uchiha Razq', razqWithSuper, ['5331'], 0, { boss: 'cerberus' });
    assert.equal(qm0.skill.skillId, 'skill345');
    assert.ok(!qm0.override);
    const rfBattle = new PveBattle({ charId: '00084542', strategy: 'B', skills: razqWithSuper });
    rfBattle.nextStep({ event: 'info', state: 'join', ta: ['00084542', '00075128', '00072043'], tb: ['ene_533'] });
    const rfActive = { battle: rfBattle, reactiveForcePending: false, lastSelfSkillId: '345' };
    const rfLogs = [];
    // Packet explicit feedback reactive_force on skill345
    const msgRfPacket = {
        event: 'command',
        state: 'battle_action',
        charId: '84542',
        battleAction: { action: 'skill', skillId: 'skill345', dmg: 32000, feedback: [{ type: 'reactive_force', damage: 2400 }] },
        syncData: [{ type: 1, ID: '84542', HP: 5000, maxHP: 5000, SP: 1000 }],
    };
    const hp0Before = readSelfHp(rfActive.battle, '00084542');
    rfActive.battle.nextStep(msgRfPacket);
    const hp0After = readSelfHp(rfActive.battle, '00084542');
    assert.equal(trackReactiveForce(rfActive, msgRfPacket, '00084542', hp0Before, hp0After, m => rfLogs.push(m)), true);
    assert.equal(rfActive.reactiveForcePending, true);
    assert.ok(rfLogs.some(l => l.includes('REACTIVE_FORCE') && l.includes('skill3500')));
    // Next turn prioritizes skill3500 without losing index 1 (skill633)
    const qmSuper = chooseQuickmatchTurn('Uchiha Razq', razqWithSuper, ['5331'], 1, { boss: 'cerberus', reactiveForcePending: rfActive.reactiveForcePending });
    assert.equal(qmSuper.skill.skillId, 'skill3500');
    assert.equal(qmSuper.skill.action, 'senjutsu');
    assert.equal(qmSuper.override, true);
    rfActive.reactiveForcePending = false;
    assert.equal(chooseQuickmatchTurn('Uchiha Razq', razqWithSuper, ['5331'], 1, { boss: 'cerberus', reactiveForcePending: false }).skill.skillId, 'skill633');
    // Fallback HP drain on skill345 without explicit feedback object
    const rfActiveDrain = { battle: rfBattle, reactiveForcePending: false, lastSelfSkillId: '345' };
    const msgRfDrain = {
        event: 'command',
        state: 'battle_action',
        charId: '00084542',
        battleAction: { action: 'skill', skillId: 'skill345' },
        syncData: [{ type: 1, ID: '84542', HP: 3100, maxHP: 5000, SP: 1000 }],
    };
    const hp1Before = readSelfHp(rfActiveDrain.battle, '00084542');
    rfActiveDrain.battle.nextStep(msgRfDrain);
    const hp1After = readSelfHp(rfActiveDrain.battle, '00084542');
    assert.equal(trackReactiveForce(rfActiveDrain, msgRfDrain, '00084542', hp1Before, hp1After), true);
    assert.equal(rfActiveDrain.reactiveForcePending, true);
    // Non-345 HP drop does NOT trigger Reactive Force priority
    const non345Active = { battle: rfBattle, reactiveForcePending: false, lastSelfSkillId: '633' };
    assert.equal(trackReactiveForce(non345Active, { event: 'command', state: 'battle_action', charId: '84542', battleAction: { action: 'skill', skillId: 'skill633', feedback: [{ type: 'reactive_force', damage: 500 }] } }, '00084542', 3100, 2600), false);
    assert.equal(non345Active.reactiveForcePending, false);
    // Host Room uses extraSkills fallback for Super Charges when reactiveForcePending is true
    const hostSuper = chooseCerberusTurn(razqNamed, ['5331'], 2, 'Uchiha Razq', {
        boss: 'cerberus',
        reactiveForcePending: true,
        extraSkills: [{ id: '3500', skillId: 'skill3500', action: 'senjutsu', name: 'Senjutsu: Super Charges' }],
    });
    assert.equal(hostSuper.skill.skillId, 'skill3500');
    assert.equal(hostSuper.skill.action, 'senjutsu');
    assert.equal(hostSuper.override, true);
    assert.equal(chooseQuickmatchTurn('Uchiha Razq', razqWithSuper, ['5011'], 1, { boss: 'minotaur', reactiveForcePending: true }).skill.skillId, 'skill633');
    // Max 2x kick in same room switches to another room
    const kicksMap = new Map();
    assert.deepEqual(recordRoomKick(kicksMap, '5770', '11111', 1000), { count: 1, blocked: false });
    assert.deepEqual(recordRoomKick(kicksMap, '5771', '22222', 1500), { count: 1, blocked: false });
    assert.deepEqual(recordRoomKick(kicksMap, '5770', '11111', 2000), { count: 2, blocked: true });
    const blockedAfterKick = new Set(['5770']);
    const switchRooms = [
        { room_id: '5770', quest: 5333, master_id: '11111', player_count: 1, max_player: 3, character_array: [{ char_id: '11111', level: 100, is_emblem: true }] },
        { room_id: '5771', quest: 5333, master_id: '22222', player_count: 1, max_player: 3, character_array: [{ char_id: '22222', level: 100, is_emblem: true }] },
    ];
    const switchedPick = pickRoom(switchRooms, 5333, '84542', blockedAfterKick);
    assert.equal(switchedPick.room && switchedPick.room.id, '5771');
    // RM < Lv80 seen 2x blocks master ID across incomplete summaries too
    const lowRmMap = new Map();
    assert.deepEqual(recordLowLevelMaster(lowRmMap, '00033333', '5800', 1000), { count: 1, blockedMaster: false, masterId: normCharId('33333') });
    assert.deepEqual(recordLowLevelMaster(lowRmMap, '33333', '5801', 2000), { count: 2, blockedMaster: true, masterId: normCharId('33333') });
    const incompleteWithBlockedRm = [
        { room_id: '5802', quest: 5333, master_id: '33333', player_count: 1, max_player: 3 },
        { room_id: '5803', quest: 5333, master_id: '44444', player_count: 1, max_player: 3 },
    ];
    const skipBlockedRm = pickRoom(incompleteWithBlockedRm, 5333, '84542', new Set(), new Set([normCharId('33333')]));
    assert.equal(skipBlockedRm.room && skipBlockedRm.room.id, '5803');
    // 1x passworded room immediately skipped; "0" string is NOT treated as passworded
    assert.equal(normalizeRoom({ room_id: '5900', quest: 5333, has_password: '0' }, 5333).hasPassword, false);
    assert.equal(normalizeRoom({ room_id: '5901', quest: 5333, need_password: '1' }, 5333).hasPassword, true);
    assert.equal(isPasswordRejection({ status: 2, reason: 'Incorrect password' }), true);
    assert.equal(isPasswordRejection({ status: 0, message: 'Room is locked' }), true);
    assert.equal(isPasswordRejection({ status: 0, reason: 'captcha' }), false);
    const pwRooms = [
        { room_id: '5901', quest: 5333, need_password: '1', player_count: 1, max_player: 3, character_array: [{ char_id: '11111', level: 100, is_emblem: true }] },
        { room_id: '5902', quest: 5333, has_password: '0', player_count: 1, max_player: 3, character_array: [{ char_id: '22222', level: 100, is_emblem: true }] },
    ];
    assert.equal(pickRoom(pwRooms, 5333, '84542').room.id, '5902');
    // Priority optimization tests: char_array + ta pre-filter, 2/3 & Lv100 preference, CP/CD anti-pass, timeouts
    assert.equal(parseArgs([]).waitFullTimeout, 45000);
    assert.equal(parseArgs([]).hostStartTimeout, 75000);
    assert.equal(parseArgs(['--wait-full-timeout', '30000']).waitFullTimeout, 30000);
    const summaryCharMap = buildCharSummaryMap({
        char_array: [
            { char_id: '94222', char_level: 51 },
            { char_id: '88001', char_level: 85 },
            { char_id: '88002', char_level: 100 },
            { char_id: '88003', char_level: 95 },
        ],
    });
    const summaryRooms = [
        { room_name: '4454', quest: 13, max_player: 3, ta: ['00094222', '00088003'] },
        { room_name: '4455', quest: 13, max_player: 3, ta: ['00088002'] },
        { room_name: '4456', quest: 13, max_player: 3, ta: ['00088001', '00088003'] },
        { room_name: '4457', quest: 13, max_player: 3, ta: ['00088002', '00088003'] },
        { room_name: '4458', quest: 13, max_player: 3, ta: ['00088002', '00088003', '00088001'] },
    ];
    const preFiltered = pickRoom(summaryRooms, 13, '84542', new Set(), new Set(), summaryCharMap);
    assert.equal(preFiltered.room && preFiltered.room.id, '4457');
    assert.equal(preFiltered.evaluated.find(e => e.roomId === '4454').reason, 'master_level_51');
    assert.equal(preFiltered.evaluated.find(e => e.roomId === '4458').reason, 'room_full');
    // CP/SP tracking + anti-pass cooldown & living target selection
    const fullRazqDeck = [
        ...razqWithSuper,
        { id: '623', skillId: 'skill623', action: 'skill', name: 'Vacuum Bomb', damage: 798 },
        { id: '728', skillId: 'skill728', action: 'skill', name: "Kinjutsu: Minotaur's Sweep", damage: 377 },
    ];
    const smartBattle = new PveBattle({ charId: '00084542', strategy: 'B', skills: fullRazqDeck });
    smartBattle.nextStep({ event: 'info', state: 'join', ta: ['00084542'], tb: ['ene_533'] });
    smartBattle.nextStep({
        event: 'command',
        state: 'battle_action',
        charId: '84542',
        battleAction: { action: 'skill', skillId: 'skill345' },
        syncData: [
            { type: 1, ID: '84542', HP: 5000, CP: 400, maxCP: 4000, SP: 800 },
            { type: 4, ID: '5331', HP: 0, maxHP: 50000 },
            { type: 4, ID: '5330', HP: 40000, maxHP: 120000 },
        ],
    });
    const resSnap = readSelfResources(smartBattle, '00084542');
    assert.deepEqual(resSnap, { hp: 5000, cp: 400, maxCp: 4000, sp: 800 });
    const smartActive = { lastSelfSkillId: '345', skillCooldowns: new Map() };
    trackSelfActionOutcome(smartActive, { state: 'battle_action', charId: '84542', battleAction: { action: 'skill', skillId: 'skill345' } }, '00084542');
    assert.equal(smartActive.skillCooldowns.get('345'), 25);
    smartActive.lastSelfSkillId = '854';
    trackSelfActionOutcome(smartActive, { state: 'battle_action', charId: '84542', battleAction: { action: 'pass' } }, '00084542');
    assert.equal(smartActive.skillCooldowns.get('854'), 3);
    tickSelfSkillCooldowns(smartActive.skillCooldowns);
    assert.equal(smartActive.skillCooldowns.get('345'), 24);
    assert.equal(smartActive.skillCooldowns.get('854'), 2);
    const lowCpPick = chooseQuickmatchTurn('Uchiha Razq', fullRazqDeck, [5331, 5330, 5332], 0, {
        boss: 'cerberus',
        battleState: { cp: 400, sp: 800, cooldowns: smartActive.skillCooldowns, livingTargetId: 5330 },
    });
    assert.equal(lowCpPick.skill && lowCpPick.skill.skillId, 'skill3110');
    assert.equal(lowCpPick.targetId, 5330);
    const cdAlmostAll = new Map([['345', 10], ['633', 10], ['629', 10], ['632', 10], ['3110', 10], ['151', 10], ['854', 10], ['728', 10], ['39', 10]]);
    const superForCp = chooseQuickmatchTurn('Uchiha Razq', fullRazqDeck, [5331, 5330], 0, {
        boss: 'cerberus',
        battleState: { cp: 5, sp: 700, cooldowns: cdAlmostAll, livingTargetId: 5330 },
    });
    assert.equal(superForCp.skill && superForCp.skill.skillId, 'skill3500');
    cdAlmostAll.set('3500', 5);
    const chargePick = chooseQuickmatchTurn('Uchiha Razq', fullRazqDeck, [5331, 5330], 0, {
        boss: 'cerberus',
        battleState: { cp: 5, sp: 700, cooldowns: cdAlmostAll, livingTargetId: 5330 },
    });
    assert.equal(chargePick.action, 'charge');
    cdAlmostAll.set('623', 5);
    const weaponPick = chooseQuickmatchTurn('Uchiha Razq', fullRazqDeck, [5331, 5330], 0, {
        boss: 'cerberus',
        battleState: { cp: 4000, sp: 1000, cooldowns: cdAlmostAll, livingTargetId: 5330 },
    });
    assert.equal(weaponPick.action, 'weapon_attack');
    console.log('OK: STB flags & Hermes WhatsApp HMAC webhook delivery & Reactive Force & Kick 2x & RM<80 2x & Password 1x & Priority Speedups');
})();
