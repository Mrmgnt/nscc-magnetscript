'use strict';
/**
 * lib/ns_pve_battle.js - protokol battle Co-op Hunting (Minotaur).
 *
 * Meniru alur network battle dari network_library.swf (ninjasaga/net/Client.as,
 * ninjasaga/Socket.as) supaya bot bisa "bermain" per giliran (ATB).
 *
 * Dua jalur (lihat pve_protocol.md #6):
 *   Jalur A - server relay/percaya klien : kirim battle_win setelah start_atb (cepat).
 *   Jalur B - server authoritative          : tiap giliran pilih skill damage tertinggi
 *            yang tidak cooldown, kirim battle_command; menang bergantung stat.
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
        this.cooldowns = new Map(); // skillId -> turns remaining
        this.phase = 'idle'; // idle|starting|atb|acting|finished
        this.enemyIds = [];
        this.team = [];
        this.turn = 0;
        this.lastWinData = null;
        this.result = null;
    }

    reset() { this.phase = 'idle'; this.cooldowns.clear(); this.turn = 0; this.result = null; this.lastWinData = null; }

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
        const best = this.pickBestSkill();
        if (best) { this.markCooldown(best.skillId, best.cooldown || 0); return { action: ACTIONS.SKILL, skillId: best.skillId }; }
        return { action: ACTIONS.WEAPON_ATTACK };
    }

    // Keputusan apa yang harus dikirim setelah start_atb.
    // Jalur A: kirim battle_win (auto-kill). Jalur B: kirim battle_command.
    decideAfterStartAtb() {
        if (this.strategy === 'A') return { type: 'win' };
        if (this.strategy === 'B') return { type: 'turn', battleAction: this.buildTurn() };
        // auto: coba A dulu, fallback B lewat timeout di orchestrator
        return { type: 'win', fallback: 'turn' };
    }

    /**
     * nextStep - tentukan aksi setelah menerima sebuah pesan battle dari server.
     * Mengembalikan { type }:
     *   'join'  -> kirim startAtb (masuk ATB)
     *   'startAtb' -> saat server broadcast start_atb: Jalur A (win) / B (turn)
     *   'turn'  -> kirim battle_command giliran
     *   'win'   -> kirim battle_win
     *   'none'
     */
    nextStep(msg) {
        const event = msg && msg.event;
        const state = msg && msg.state;
        this.handleMessage(msg);
        if (event === 'info' && state === 'join') return { type: 'ready' };
        if (event === 'info' && state === 'start') return { type: 'startAtb' };
        if (state === 'start_atb') {
            // server broadcast start_atb (mengandung atbArr) memicu giliran
            const d = this.decideAfterStartAtb();
            if (d.type === 'win') return { type: 'win' };
            return { type: 'turn', battleAction: d.battleAction || this.buildTurn() };
        }
        if (state === 'battle_command' || state === 'action' || state === 'action_finish') {
            if (this.strategy === 'B' || this.strategy === 'auto') return { type: 'turn', battleAction: this.buildTurn() };
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
    eq('pick best skill', turn.skillId, 803);
    b.markCooldown(803, 2);
    eq('second best after cd', b.buildTurn().skillId, 701);

    // full message flow
    b.handleMessage({ event: 'info', state: 'join', ta: [42, 7, 9], tb: ['ene_minotaur'] });
    eq('phase after join', b.phase, 'starting');
    eq('team size', b.team.length, 3);
    b.handleMessage({ state: 'start_atb' });
    eq('phase after start_atb', b.phase, 'atb');
    const d = b.decideAfterStartAtb();
    eq('strategy B -> turn', d.type, 'turn');
    b.handleMessage({ state: 'battle_win', winnerIDs: [42] });
    eq('phase after win', b.phase, 'finished');

    // nextStep model
    const b3 = new PveBattle({ charId: 5, strategy: 'auto' });
    eq('nextStep join', b3.nextStep({ event: 'info', state: 'join', ta: [5], tb: ['ene_1'] }).type, 'ready');
    eq('nextStep start', b3.nextStep({ event: 'info', state: 'start' }).type, 'startAtb');
    eq('nextStep start_atb -> win (auto)', b3.nextStep({ state: 'start_atb' }).type, 'win');
    const b4 = new PveBattle({ charId: 5, strategy: 'B' });
    eq('nextStep start_atb -> turn (B)', b4.nextStep({ state: 'start_atb' }).type, 'turn');

    const b2 = new PveBattle({ strategy: 'A' });
    b2.handleMessage({ state: 'start_atb' });
    eq('strategy A -> win', b2.decideAfterStartAtb().type, 'win');

    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
