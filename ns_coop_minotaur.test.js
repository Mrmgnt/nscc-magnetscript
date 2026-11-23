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
vm.runInNewContext(source.slice(0, cut) + '\nmodule.exports = { parseArgs, resolveMinStartEnergy, resolveBattleTimeoutMs, acquireRunLock, parsePveRankingResponse, extractScoreForChar, findQuestId, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, describeDeck, normCharId, idList, evaluateLevel, handleBattlePreTurnStep, clearBattleTimers, traceBattleProgress, handleMidBattleLeave };', context);
const { parseArgs, resolveMinStartEnergy, resolveBattleTimeoutMs, acquireRunLock, parsePveRankingResponse, extractScoreForChar, findQuestId, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, describeDeck, normCharId, idList, evaluateLevel, handleBattlePreTurnStep, clearBattleTimers, traceBattleProgress, handleMidBattleLeave } = context.module.exports;
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
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'startAtb' }), true);
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'actionReady' }), true);
assert.equal(handleBattlePreTurnStep(fakeSock, activeSim, { type: 'actionFinish', charDead: false }), true);
assert.deepEqual(sent, ['init', 'ready', ['start_atb', '84542'], ['action_ready', '84542'], ['action_finish', false, '84542']]);
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
assert.deepEqual(sentCmds[0], { event: 'info', state: 'battle_command', charId: '84542', battleAction: { action: 'senjutsu', SENSKILLID: 'skill3110' }, targetId: '5331' });
assert.deepEqual(sentCmds[1], { event: 'info', state: 'battle_command', charId: '84542', battleAction: { action: 'skill', skillId: 'skill345' }, targetId: '5331' });
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
    console.log('OK: STB flags & Hermes WhatsApp HMAC webhook delivery');
})();
