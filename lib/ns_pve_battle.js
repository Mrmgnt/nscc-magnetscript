'use strict';
/**
 * lib/ns_pve_battle.js - protokol battle Co-op Hunting (Minotaur).
 *
 * Meniru alur network battle dari network_library.swf (ninjasaga/net/Client.as,
 * ninjasaga/Socket.as) supaya bot bisa "bermain" per giliran (ATB).
 *
 * Server mengirim command/action saat karakter mendapat giliran. Client lalu memilih
 * aksi dan mengirim battle_command dengan target. start_atb bukan prompt giliran.
 *
 * CLI: node lib/ns_pve_battle.js --selftest
 */
const { EventEmitter } = require('events');

// Aksi battle yang dikirim via battle_command (dari Socket.sendData switch).
const ACTIONS = { SKILL: 'skill', BLOODLINE: 'bloodline', SENJUTSU: 'senjutsu', ITEM: 'item', CHARGE: 'charge', PASS: 'pass', DODGE: 'dodge', WEAPON_ATTACK: 'weapon_attack' };

function normalizeBattleAction(ba) {
    if (!ba) return null;
    switch (ba.action) {
        case 'senjutsu': return { skillId: ba.SENSKILLID, action: ba.action };
        case 'bloodline': return { skillId: ba.BLSKILLID, action: ba.action };
        case 'skill': return { skillId: ba.skillId, action: ba.action };
        case 'item': return { item: ba.item, action: ba.action };
        case 'charge': case 'pass': case 'dodge': case 'weapon_attack': return { action: ba.action };
        default: return ba;
    }
}

class PveBattle extends EventEmitter {
    constructor(opts) {
        super();
        this.opts = opts || {};
        this.strategy = this.opts.strategy || 'auto'; // 'auto' (A->B fallback) | 'A' | 'B'
        this.charId = this.opts.charId;
        this.skills = (this.opts.skills || []).slice(); // [{skillId, damage, cooldown}]
        this.skillCursor = 0;
        this.usedOnceSkills = new Set();
        this.cooldowns = new Map(); // skillId -> turns remaining
        this.phase = 'idle'; // idle|starting|atb|acting|finished
        this.enemyIds = [];
        this.team = [];
        this.turn = 0;
        this.lastWinData = null;
        this.result = null;
        this.autoWinSent = false;
    }

    reset() { this.phase = 'idle'; this.cooldowns.clear(); this.skillCursor = 0; this.usedOnceSkills.clear(); this.turn = 0; this.result = null; this.lastWinData = null; this.autoWinSent = false; }

    setSkills(skills) { this.skills = (skills || []).slice(); }

    // Panggil saat menerima event socket (dari PveSocket event 'battle_msg').
    // data = payload.message (object {event,state,...}).
    handleMessage(data) {
        const event = data && data.event;
        const state = data && data.state;
        if (event === 'info') {
            switch (state) {
                case 'join': this.team = (data.ta || []).slice(); this.enemyIds = (data.tb || []).slice(); this.phase = 'starting'; this.emit('join', data); break;
                case 'ready': this.emit('player_ready', data); break;
                case 'init': this.phase = 'starting'; this.emit('init', data); break;
                case 'start': this.phase = 'atb'; this.emit('start', data); break;
                default: break;
            }
            return { type: 'info', state, data };
        }
        switch (state) {
            case 'start_atb': this.phase = 'atb'; this.turn = 0; this.emit('start_atb', data); break;
            case 'battle_action': this.emit('battle_action', data); break;
            case 'battle_command': this.emit('battle_command', data); break;
            case 'action_finish': this.tickCooldowns(); this.emit('action_finish', data); break;
            case 'battle_win': this.phase = 'finished'; this.lastWinData = data; this.emit('battle_win', data); break;
            case 'battle_lose': this.phase = 'finished'; this.result = 'lose'; this.emit('battle_lose', data); break;
            case 'battle_finish': this.phase = 'finished'; this.result = data; this.emit('battle_finish', data); break;
            default: break;
        }
        return { type: state || event, state, data };
    }

    tickCooldowns() { for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, v - 1); }

    markCooldown(skillId, turns) { if (skillId != null) this.cooldowns.set(String(skillId), turns || 0); }

    // Pilih skill damage tertinggi yang tidak cooldown (Jalur B).
    pickBestSkill() {
        let best = null;
        for (const s of this.skills) {
            const cd = this.cooldowns.get(String(s.skillId)) || 0;
            if (cd > 0) continue;
            if (!best || (s.damage || 0) > (best.damage || 0)) best = s;
        }
        return best;
    }

    // Bangun aksi giliran untuk karakter kita.
    buildTurn() {
        if (this.skills.length) {
            for (let offset = 0; offset < this.skills.length; offset++) {
                const skill = this.skills[this.skillCursor % this.skills.length];
                this.skillCursor++;
                if (skill.once && this.usedOnceSkills.has(String(skill.skillId))) continue;
                if (skill.once) this.usedOnceSkills.add(String(skill.skillId));
                return { action: ACTIONS.SKILL, skillId: skill.skillId };
            }
        }
        return { action: ACTIONS.WEAPON_ATTACK };
    }

    // start_atb starts ATB animation. Client must ack info/action after tween.
    decideAfterStartAtb() {
        return { type: 'actionReady' };
    }

    /**
     * nextStep - tentukan aksi setelah menerima sebuah pesan battle dari server.
     * Mengembalikan { type }:
     *   'join'  -> kirim startAtb (masuk ATB)
     *   'startAtb' -> send start_atb after server starts battle
     *   'actionReady' -> ack ATB tween completion
     *   'actionFinish' -> ack battle_action completion
     *   'turn'  -> kirim battle_command giliran
     *   'none'
     */
    nextStep(msg) {
        const event = msg && msg.event;
        const state = msg && msg.state;
        this.handleMessage(msg);
        if (event === 'info' && state === 'join') return { type: 'ready' };
        if (event === 'info' && state === 'start') return { type: 'startAtb' };
        if (state === 'start_atb') return this.decideAfterStartAtb();
        if (state === 'battle_action') {
            const autoWin = this.strategy === 'A' && !this.autoWinSent;
            if (autoWin) this.autoWinSent = true;
            return { type: 'actionFinish', charDead: false, autoWin };
        }
        if (event === 'command' && state === 'action' && String(msg.charId) === String(this.charId)) {
            return { type: 'turn', targetId: this.enemyIds[0], battleAction: this.buildTurn() };
        }
        return { type: 'none' };
    }

    parseFinish(data) {
        // Coba ekstrak score/prize/reward dari data battle_finish (best effort)
        const out = { raw: data, score: null, reward: null };
        if (!data) return out;
        if (typeof data === 'object') {
            out.score = data.score != null ? data.score : (data.point != null ? data.point : (data.player_score != null ? data.player_score : null));
            out.reward = data.reward_get || data.reward || data.prize || null;
        }
        return out;
    }
}

module.exports = { PveBattle, ACTIONS, normalizeBattleAction };

if (require.main === module && process.argv.includes('--selftest')) {
    let fail = 0;
    const eq = (l, g, w) => { const ok = g === w; if (!ok) fail++; console.log((ok ? '  OK   ' : '  FAIL ') + l + (ok ? '' : ' got=' + JSON.stringify(g) + ' want=' + JSON.stringify(w))); };
    console.log('  selftest lib/ns_pve_battle.js');

    eq('normalize skill', JSON.stringify(normalizeBattleAction({ action: 'skill', skillId: 701 })), '{"skillId":701,"action":"skill"}');
    eq('normalize senjutsu', JSON.stringify(normalizeBattleAction({ action: 'senjutsu', SENSKILLID: 803 })), '{"skillId":803,"action":"senjutsu"}');
    eq('normalize charge', JSON.stringify(normalizeBattleAction({ action: 'charge' })), '{"action":"charge"}');

    const b = new PveBattle({ charId: 42, strategy: 'B', skills: [{ skillId: 701, damage: 100, cooldown: 3 }, { skillId: 803, damage: 250, cooldown: 0 }] });
    const turn = b.buildTurn();
    eq('first equipped skill', turn.skillId, 701);
    eq('second equipped skill', b.buildTurn().skillId, 803);
    eq('skill rotation wraps', b.buildTurn().skillId, 701);
    const once = new PveBattle({ skills: [{ skillId: 'skill2004', once: true }, { skillId: 'skill345' }] });
    eq('once skill first', once.buildTurn().skillId, 'skill2004');
    eq('once skill skipped later', once.buildTurn().skillId, 'skill345');
    eq('rotation excludes used once skill', once.buildTurn().skillId, 'skill345');

    // full message flow
    b.handleMessage({ event: 'info', state: 'join', ta: [42, 7, 9], tb: ['ene_minotaur'] });
    eq('phase after join', b.phase, 'starting');
    eq('team size', b.team.length, 3);
    b.handleMessage({ state: 'start_atb' });
    eq('phase after start_atb', b.phase, 'atb');
    const d = b.decideAfterStartAtb();
    eq('start_atb -> actionReady', d.type, 'actionReady');
    b.handleMessage({ state: 'battle_win', winnerIDs: [42] });
    eq('phase after win', b.phase, 'finished');

    // nextStep model
    const b3 = new PveBattle({ charId: 5, strategy: 'auto' });
    eq('nextStep join', b3.nextStep({ event: 'info', state: 'join', ta: [5], tb: ['ene_1'] }).type, 'ready');
    eq('nextStep start', b3.nextStep({ event: 'info', state: 'start' }).type, 'startAtb');
    eq('nextStep start_atb -> actionReady', b3.nextStep({ state: 'start_atb' }).type, 'actionReady');
    const b4 = new PveBattle({ charId: 5, strategy: 'B' });
    b4.nextStep({ event: 'info', state: 'join', ta: [5], tb: ['ene_1'] });
    eq('other player prompt ignored', b4.nextStep({ event: 'command', state: 'action', charId: 7 }).type, 'none');
    const prompted = b4.nextStep({ event: 'command', state: 'action', charId: 5 });
    eq('own prompt -> turn', prompted.type, 'turn');
    eq('turn targets enemy', prompted.targetId, 'ene_1');
    eq('battle_action -> actionFinish', b4.nextStep({ event: 'command', state: 'battle_action' }).type, 'actionFinish');
    const auto = new PveBattle({ charId: 5, strategy: 'A' });
    eq('active attacker requests auto win', auto.nextStep({ event: 'command', state: 'battle_action', charId: 5 }).autoWin, true);
    eq('auto win only once', auto.nextStep({ event: 'command', state: 'battle_action', charId: 5 }).autoWin, false);
    eq('all clients request win after valid action', new PveBattle({ charId: 5, strategy: 'A' }).nextStep({ event: 'command', state: 'battle_action', charId: 7 }).autoWin, true);

    const b2 = new PveBattle({ strategy: 'A' });
    b2.handleMessage({ state: 'start_atb' });
    eq('strategy A sends ack', b2.decideAfterStartAtb().type, 'actionReady');

    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
