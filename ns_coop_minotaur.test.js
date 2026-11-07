'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { EnergyScheduler } = require('./lib/ns_energy_scheduler');
const { PveBattle } = require('./lib/ns_pve_battle');

async function simulate(scenario, stage = 0, limit = 1) {
    const accounts = ['alpha', 'beta', 'gamma'].map((username, index) => ({ username, role: index < 2 ? 'host' : 'main', password: 'fixture', slot: '1' }));
    const energies = Object.fromEntries(accounts.map(account => [account.username, 100]));
    const files = new Map();
    const sockets = [];
    let clock = 0;
    let captchaCalls = 0;
    let createCalls = 0;
    let ready = [];
    let hostId = null;
    let charged = false;
    let actionReady = new Set();
    const fakeProcess = { cwd: () => '/fixture', exitCode: 0 };
    if (stage) files.set('coop_validation.json', JSON.stringify({ roster: 'alpha,beta,gamma', quest: 3, stage }));
    class FakeSocket extends EventEmitter {
        constructor(options) { super(); this.charId = options.charId; this.closed = false; sockets.push(this); }
        static async connect(options) { return new FakeSocket(options); }
        hasCommandKey() { return true; }
        auth() {}
        async waitAuth() {}
        createRoom() {
            createCalls++;
            if (['captcha', 'captcha-fail'].includes(scenario) && createCalls === 1) {
                this.emit('captcha_required'); this.emit('captcha_required'); return;
            }
            if (scenario === 'timeout') return;
            ready = []; hostId = this.charId; charged = false; actionReady = new Set();
            this.emit('join_room', { status: 1, room_name: 'room-' + createCalls });
        }
        joinRoom(room) { this.emit('join_room', { status: 1, room_name: room, characterId: this.charId }); }
        ready(characterId) {
            ready.push(String(characterId));
            for (const socket of sockets.filter(item => !item.closed)) socket.emit('ready', { character_array: ready.slice() });
        }
        startGame() {
            const active = sockets.filter(socket => !socket.closed);
            for (const socket of active) socket.emit('battle_start');
            for (const socket of active) socket.emit('battle_msg', { message: { event: 'info', state: 'join', ta: active.map(item => item.charId), tb: ['ene_501'] } });
            for (const socket of active) socket.emit('battle_msg', { message: { event: 'info', state: 'start_atb' } });
        }
        battleWin() {}
        battleCommand(charId, action, skillId, targetId) {
            assert.equal(String(charId), String(hostId));
            assert.equal(action, 'skill');
            assert.equal(skillId, 'skill345');
            assert.equal(targetId, 'ene_501');
            if (scenario === 'lose') {
                this.emit('battle_msg', { message: { state: 'battle_finish', winnerIDs: ['enemy501'] } }); return;
            }
            if (!charged && scenario !== 'unconfirmed-energy') {
                for (const account of accounts) energies[account.username] -= account.username === hostId ? 25 : 5;
                charged = true;
            }
            this.emit('battle_msg', { message: { event: 'info', state: 'battle_finish', winnerIDs: sockets.filter(socket => !socket.closed).map(socket => String(socket.charId)) } });
        }
        battleJoin() {}
        battleReady() {}
        startAtb() {}
        actionReady() {
            actionReady.add(String(this.charId));
            const active = sockets.filter(socket => !socket.closed);
            if (actionReady.size === active.length) {
                for (const socket of active) socket.emit('battle_msg', { message: { event: 'command', state: 'action', charId: hostId, charType: 'player' } });
            }
        }
        actionFinish() {}
        leaveRoom() {}
        close() { this.closed = true; }
    }
    class FakeSolver {
        async solve() { captchaCalls++; return scenario !== 'captcha-fail'; }
        async close() {}
    }
    const client = {
        login: async username => ({ ok: true, sessionKey: username }),
        getSelectedChar: rows => rows[0],
        amf: async (method, args) => method === 'CharacterDAO.getCharactersList'
            ? { body: { result: [[args[0], args[0], 100]] } }
            : method === 'CharacterDAO.getCharacterById'
                ? { body: { gk: true, result: { character_skills: ['345', '854'], character_equipped_skills: ['345', '854', '3000'] } } }
                : { body: { character_energy: energies[args[0]], pvp_server: [{}], handoff_token: 'fixture', handoff_nonce: 'fixture', pveServerVersion: 'fixture', quest_list: [{ display_boss: ['enemy501'], quest_obj: [{ quest: 3, energy: [25, 5] }] }] } },
    };
    const context = {
        module: { exports: {} },
        console: { log() {} },
        process: fakeProcess,
        Date: class extends Date { static now() { return clock; } },
        setTimeout: callback => setImmediate(() => { clock += 1000; callback(); }),
        clearTimeout: clearImmediate,
        require(name) {
            if (name === 'fs') return {
                readFileSync(file) { const value = files.get(path.basename(file)); if (value == null) throw new Error('missing'); return value; },
                writeFileSync(file, value) { files.set(path.basename(file), value); },
            };
            if (name === 'path') return path;
            if (name === './nsclient.js') return client;
            if (name.includes('ns_energy_scheduler')) return { EnergyScheduler };
            if (name.includes('ns_pve_socket')) return { PveSocket: FakeSocket };
            if (name.includes('ns_pve_battle')) return { PveBattle };
            if (name.includes('ns_captcha_solver')) return { CaptchaSolver: FakeSolver };
            throw new Error('Unexpected dependency: ' + name);
        },
    };
    const source = fs.readFileSync(path.join(__dirname, 'ns_coop_minotaur.js'), 'utf8');
    vm.runInNewContext(source.slice(0, source.indexOf('\n(async () => {')) + '\nmodule.exports = { runLive };', context);
    await context.module.exports.runLive({ boss: 'minotaur', level: 'extreme', strategy: 'A', maxMatches: limit, password: '1111' }, accounts);
    assert(sockets.every(socket => socket.closed), 'all sockets cleaned up');
    return { report: JSON.parse(files.get('coop_report.json')), validation: files.has('coop_validation.json') ? JSON.parse(files.get('coop_validation.json')) : null, createCalls, captchaCalls, exitCode: fakeProcess.exitCode, energies };
}

(async () => {
    const success = await simulate('success', 0, Infinity);
    assert.equal(success.report.matches.length, 1);
    assert.equal(success.report.matches[0].confirmed, true, JSON.stringify(success.report.matches[0]));
    assert.equal(success.validation.stage, 1);
    assert.equal(success.exitCode, 0);
    const rotation = await simulate('success', 1, 3);
    assert.deepEqual(rotation.report.matches.map(match => match.host), ['alpha', 'beta', 'gamma']);
    assert.equal(rotation.validation.stage, 3);
    assert.deepEqual(rotation.energies, { alpha: 65, beta: 65, gamma: 65 });
    const captcha = await simulate('captcha');
    assert.equal(captcha.captchaCalls, 1);
    assert.equal(captcha.createCalls, 2);
    assert.equal(captcha.report.matches[0].confirmed, true);
    for (const scenario of ['timeout', 'lose', 'unconfirmed-energy', 'captcha-fail']) {
        const failure = await simulate(scenario);
        assert.equal(failure.report.matches[0].confirmed, false, scenario);
        assert.equal(failure.exitCode, 1, scenario);
        assert.equal(failure.validation, null, scenario);
        assert.deepEqual(failure.energies, { alpha: 100, beta: 100, gamma: 100 }, scenario);
    }
    console.log('OK: rotation, gate 1/3/full, captcha dedupe/retry, timeout, loss, energy proof, cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
