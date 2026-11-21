const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, 'ns_coop_minotaur.js'), 'utf8');
const cut = source.indexOf('\n(async () => {');
const context = { module: { exports: {} }, require(name) { if (name === 'fs') return fs; if (name === 'path') return path; if (name === './nsclient.js') return {}; if (name.includes('ns_pve_socket')) return { PveSocket: {} }; if (name.includes('ns_pve_battle')) return { PveBattle: class {} }; throw new Error(name); }, console, process: { hrtime: process.hrtime }, setTimeout, clearTimeout };
vm.runInNewContext(source.slice(0, cut) + '\nmodule.exports = { parseArgs, findQuestId, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, describeDeck, normCharId, idList, evaluateLevel };', context);
const { parseArgs, findQuestId, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, describeDeck, normCharId, idList, evaluateLevel } = context.module.exports;
assert.equal(parseArgs([]).maxMatches, Infinity);
assert.equal(parseArgs(['--max-matches', '2']).maxMatches, 2);
assert.equal(parseArgs(['--host-room']).hostRoom, true);
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
    { id: '345', skillId: 'skill345', name: 'Kinjutsu Five Elements Consuming Seal', damage: 90 },
    { id: '633', skillId: 'skill633', name: 'Kinjutsu Thunder Explosion', damage: 80 },
    { id: '632', skillId: 'skill632', name: 'Electric Smash', damage: 70 },
    { id: '900', skillId: 'skill900', name: 'Senjutsu Dragon Sublimation', damage: 60 },
    { id: '901', skillId: 'skill901', name: 'Senjutsu Special Snakes Scales', damage: 50 },
    { id: '854', skillId: 'skill854', name: 'Kinjutsu Advanced Aphrodite Blessing', damage: 40 },
    { id: '39', skillId: 'skill39', name: 'Kinjutsu Evasion', damage: 30 },
    { id: '652', skillId: 'skill652', name: 'Flute of God Killing', damage: 1000 },
];
assert.deepEqual(Array.from({ length: 5 }, (_, turn) => chooseQuickmatchTurn('Uchiha Razq', razqNamed, ['h'], turn).skill.skillId), ['skill345', 'skill633', 'skill632', 'skill900', 'skill901']);
assert.deepEqual(Array.from({ length: 4 }, (_, turn) => chooseCerberusTurn(razqNamed, ['h'], turn, 'Uchiha Razq').skill.skillId), ['skill39', 'skill633', 'skill632', 'skill854']);
assert.equal(chooseQuickmatchTurn('Other', [{ id: '652', skillId: 'skill652', damage: 999 }, { id: '22', skillId: 'skill22', damage: 10 }], ['h'], 0).skill.skillId, 'skill22');
console.log('OK: cerberus host roster, level filter, per-account skill planning');
