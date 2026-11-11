#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseAccountsFile, chooseSkills, findValue, winnerIds, normalizedCharId, makeRotation, sendBattleStep, isBattleStart, isBattleFinish } = require('./ns_pvp_duel.js');

const file = path.join(os.tmpdir(), 'pvpduel_' + Date.now() + '.txt');
fs.writeFileSync(file, '# comment\nwinner:alpha:pass:with:colon:2\nloser:beta:secret:1\n');
const accounts = parseAccountsFile(file);
fs.unlinkSync(file);
assert.equal(accounts.winner.password, 'pass:with:colon');
assert.equal(accounts.winner.slot, '2');
assert.equal(accounts.loser.username, 'beta');
assert.throws(() => parseAccountsFile(path.join(os.tmpdir(), 'missing-pvpduel.txt')), /tidak ditemukan/);
assert.deepEqual(chooseSkills({ character_equipped_skills: [12, 9], skill_data: [{ id: 9, damage: 50 }, { id: 12, damage: 120 }] }), ['skill12', 'skill9']);
assert.deepEqual(chooseSkills({ character_skills: ['101', '101', '88'] }), ['skill101', 'skill88']);
assert.equal(findValue({ x: { pvp_point: 210 } }, 'pvp_point'), 210);
assert.deepEqual(winnerIds({ winnerIDs: [1, '2'] }), ['1', '2']);
assert.equal(normalizedCharId('00007586'), '7586');
assert.equal(normalizedCharId(0), '0');
assert.equal(isBattleStart({ state: 'start_atb' }), true);
assert.equal(isBattleFinish({ state: 'battle_finish' }), true);

const calls = [];
const fakeSocket = {
    battleReady: () => calls.push(['ready']),
    startAtb: () => calls.push(['startAtb']),
    actionReady: () => calls.push(['actionReady']),
    actionFinish: dead => calls.push(['actionFinish', dead]),
    battleCommand: (...args) => calls.push(['battleCommand', ...args])
};
const nextSkill = makeRotation(['skill12']);
sendBattleStep(fakeSocket, { role: 'winner', charId: 'w' }, { event: 'command', state: 'action', charId: 'w' }, 'l', nextSkill);
sendBattleStep(fakeSocket, { role: 'loser', charId: 'l' }, { event: 'command', state: 'action', charId: 'l' }, 'w', nextSkill);
sendBattleStep(fakeSocket, { role: 'winner', charId: 'w' }, { state: 'battle_action', char_dead: true }, 'l', nextSkill);
assert.deepEqual(calls[0], ['battleCommand', 'w', 'skill', 'skill12', 'l']);
assert.deepEqual(calls[1], ['battleCommand', 'l', 'dodge', null, 'w']);
assert.deepEqual(calls[2], ['actionFinish', true]);
console.log('OK: parser, skill priority, PvP point, winner result, packet actions');
