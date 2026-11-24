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

function normCharKey(v) {
    const s = String(v ?? '').trim();
    return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s;
}

function sameCharId(a, b) {
    const ka = normCharKey(a);
    return ka !== '' && ka === normCharKey(b);
}

const MULTI_LIMB_BOSS_IDS = new Set(['501', '533', '546', '561', '570']);

function numericIdOrString(v) {
    if (v == null) return v;
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return Number(s);
    return s;
}

/**
 * Convert info/join `tb` entries (e.g. ["ene_533"]) to BattleDoc PvEIDs ([5331, 5330, 5332]).
 */
function resolvePveEnemyIds(tb) {
    const out = [];
    for (const raw of (Array.isArray(tb) ? tb : [])) {
        const s = String(raw ?? '').trim();
        if (!s) continue;
        const m = s.match(/^ene_(\d+)$/i);
        if (m && MULTI_LIMB_BOSS_IDS.has(m[1])) {
            const base = m[1];
            out.push(Number(base + '1'), Number(base + '0'), Number(base + '2'));
        } else {
            out.push(numericIdOrString(s));
        }
    }
    return out;
}

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
        this.battleCharId = null;
        this.turn = 0;
        this.lastWinData = null;
        this.result = null;
        this.autoWinSent = false;
        this.playersHp = new Map();
        this.enemiesHp = new Map();
        this.selfDead = false;
    }

    reset() {
        this.phase = 'idle';
        this.cooldowns.clear();
        this.skillCursor = 0;
        this.usedOnceSkills.clear();
        this.battleCharId = null;
        this.turn = 0;
        this.result = null;
        this.lastWinData = null;
        this.autoWinSent = false;
        this.playersHp.clear();
        this.enemiesHp.clear();
        this.selfDead = false;
    }

    setSkills(skills) { this.skills = (skills || []).slice(); }

    // Panggil saat menerima event socket (dari PveSocket event 'battle_msg').
    // data = payload.message (object {event,state,...}).
    handleMessage(data) {
        const event = data && data.event;
        const state = data && data.state;
        if (event === 'info') {
            switch (state) {
                case 'join': {
                    this.team = (data.ta || []).slice();
                    this.enemyIds = resolvePveEnemyIds(data.tb);
                    this.playersHp.clear();
                    for (const id of this.team) {
                        const key = normCharKey(id);
                        if (key) this.playersHp.set(key, { id: String(id), hp: null, maxHp: null, dead: false, left: false });
                    }
                    const selfInTeam = this.team.find(id => sameCharId(id, this.charId));
                    if (selfInTeam != null) this.battleCharId = String(selfInTeam);
                    this.phase = 'starting';
                    this.emit('join', data);
                    break;
                }
                case 'ready': this.emit('player_ready', data); break;
                case 'init': this.phase = 'starting'; this.emit('init', data); break;
                case 'start': this.phase = 'atb'; this.emit('start', data); break;
                default: break;
            }
            return { type: 'info', state, data };
        }
        if (Array.isArray(data && data.syncData)) this.applySyncData(data.syncData);
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

    /**
     * Update tracked player/enemy HP and death flags from server syncData.
     */
    applySyncData(syncData) {
        if (!Array.isArray(syncData)) return;
        for (const item of syncData) {
            if (!item || typeof item !== 'object') continue;
            const rawId = item.ID ?? item.id ?? item.charId;
            const key = normCharKey(rawId);
            const hp = Number(item.HP ?? item.hp);
            if (!key || !Number.isFinite(hp)) continue;
            const maxHpRaw = Number(item.maxHP ?? item.maxHp);
            const maxHp = Number.isFinite(maxHpRaw) ? maxHpRaw : null;
            const itemType = Number(item.type);
            const isPlayer = itemType === 1 || this.playersHp.has(key) || sameCharId(key, this.charId);
            if (isPlayer) {
                const prev = this.playersHp.get(key) || { id: String(rawId), hp: null, maxHp: null, dead: false, left: false };
                const dead = prev.left || hp <= 0;
                this.playersHp.set(key, {
                    id: prev.id || String(rawId),
                    hp,
                    maxHp: maxHp != null ? maxHp : prev.maxHp,
                    dead,
                    left: prev.left,
                });
                if (sameCharId(key, this.charId)) this.selfDead = dead;
            } else if (itemType === 4 || this.enemiesHp.has(key)) {
                const prev = this.enemiesHp.get(key) || { id: String(rawId), hp: null, maxHp: null, dead: false };
                this.enemiesHp.set(key, {
                    id: prev.id || String(rawId),
                    hp,
                    maxHp: maxHp != null ? maxHp : prev.maxHp,
                    dead: hp <= 0,
                });
            }
        }
    }

    /**
     * Mark a player who disconnected/left mid-battle so alive-teammate counts stay accurate.
     */
    markPlayerLeft(charId) {
        const key = normCharKey(charId);
        if (!key) return;
        const prev = this.playersHp.get(key) || { id: String(charId), hp: null, maxHp: null, dead: false, left: true };
        this.playersHp.set(key, { ...prev, dead: true, left: true });
        if (sameCharId(key, this.charId)) this.selfDead = true;
    }

    /**
     * Return snapshot of self, teammates, and enemy HP/survival states.
     */
    getTeamStatus() {
        const players = [...this.playersHp.values()];
        const selfEntry = players.find(p => sameCharId(p.id, this.charId)) || null;
        const alive = players.filter(p => !p.dead && !p.left);
        const dead = players.filter(p => p.dead || p.left);
        return {
            selfDead: this.selfDead,
            selfHp: selfEntry ? selfEntry.hp : null,
            totalPlayers: players.length,
            alivePlayers: alive.map(p => p.id),
            aliveTeammates: alive.filter(p => !sameCharId(p.id, this.charId)).map(p => p.id),
            deadPlayers: dead.map(p => p.id),
            leftPlayers: players.filter(p => p.left).map(p => p.id),
            enemies: [...this.enemiesHp.values()].map(e => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, dead: e.dead })),
        };
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
     *   'init' -> kirim info/init (loadDBCompleted) saat battle join
     *   'ready' -> kirim info/ready (loadBattleCompelete) saat battle init
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
        // Verified Flash Co-op flow: join -> init -> ready -> start -> start_atb.
        if (event === 'info' && state === 'join') return { type: 'init' };
        if (event === 'info' && state === 'init') return { type: 'ready' };
        if (event === 'info' && state === 'start') return { type: 'startAtb' };
        if (state === 'start_atb') return this.decideAfterStartAtb();
        if (state === 'battle_action') {
            const autoWin = this.strategy === 'A' && !this.autoWinSent;
            if (autoWin) this.autoWinSent = true;
            const explicitSelfDead = sameCharId(msg && msg.charId, this.charId) && Boolean(msg && (msg.char_dead || msg.charDead));
            return { type: 'actionFinish', charDead: Boolean(this.selfDead || explicitSelfDead), autoWin };
        }
        if (event === 'command' && state === 'action' && sameCharId(msg.charId, this.charId)) {
            if (msg.charId != null) this.battleCharId = String(msg.charId);
            const livingEnemy = this.enemyIds.find(id => {
                const entry = this.enemiesHp.get(normCharKey(id));
                return !entry || !entry.dead;
            });
            const targetId = livingEnemy !== undefined ? livingEnemy : this.enemyIds[0];
            return {
                type: 'turn',
                charId: numericIdOrString(this.battleCharId || msg.charId),
                targetId: numericIdOrString(targetId),
                battleAction: this.buildTurn(),
            };
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

module.exports = { PveBattle, ACTIONS, normalizeBattleAction, sameCharId, normCharKey, resolvePveEnemyIds };

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
    eq('nextStep join -> init', b3.nextStep({ event: 'info', state: 'join', ta: [5], tb: ['ene_1'] }).type, 'init');
    eq('nextStep init -> ready', b3.nextStep({ event: 'info', state: 'init' }).type, 'ready');
    eq('nextStep start', b3.nextStep({ event: 'info', state: 'start' }).type, 'startAtb');
    eq('nextStep start_atb -> actionReady', b3.nextStep({ state: 'start_atb' }).type, 'actionReady');
    const b4 = new PveBattle({ charId: 5, strategy: 'B' });
    b4.nextStep({ event: 'info', state: 'join', ta: [5], tb: ['ene_1'] });
    eq('other player prompt ignored', b4.nextStep({ event: 'command', state: 'action', charId: 7 }).type, 'none');
    const prompted = b4.nextStep({ event: 'command', state: 'action', charId: 5 });
    eq('own prompt -> turn', prompted.type, 'turn');
    eq('turn targets enemy', prompted.targetId, 'ene_1');
    eq('battle_action -> actionFinish', b4.nextStep({ event: 'command', state: 'battle_action' }).type, 'actionFinish');
    const bPad = new PveBattle({ charId: '00084542', strategy: 'B', skills: [{ skillId: 'skill345' }] });
    bPad.nextStep({ event: 'info', state: 'join', ta: ['84542'], tb: ['ene_533'] });
    eq('battleCharId resolves server ta format', bPad.battleCharId, '84542');
    eq('ene_533 maps to limb 5331', bPad.enemyIds[0], 5331);
    const padTurn = bPad.nextStep({ event: 'command', state: 'action', charId: '84542' });
    eq('zero-padded charId matches unpadded action prompt', padTurn.type, 'turn');
    eq('turn returns numeric server charId', padTurn.charId, 84542);
    eq('turn returns numeric cerberus targetId', padTurn.targetId, 5331);
    const auto = new PveBattle({ charId: 5, strategy: 'A' });
    eq('active attacker requests auto win', auto.nextStep({ event: 'command', state: 'battle_action', charId: 5 }).autoWin, true);
    eq('auto win only once', auto.nextStep({ event: 'command', state: 'battle_action', charId: 5 }).autoWin, false);
    eq('all clients request win after valid action', new PveBattle({ charId: 5, strategy: 'A' }).nextStep({ event: 'command', state: 'battle_action', charId: 7 }).autoWin, true);

    const b2 = new PveBattle({ strategy: 'A' });
    b2.handleMessage({ state: 'start_atb' });
    eq('strategy A sends ack', b2.decideAfterStartAtb().type, 'actionReady');

    // syncData self death & surviving teammate tracking
    const bTeam = new PveBattle({ charId: '00084542', strategy: 'B' });
    bTeam.nextStep({ event: 'info', state: 'join', ta: ['00084542', '00075128', '00072043'], tb: ['ene_533'] });
    const stepDead = bTeam.nextStep({
        event: 'command',
        state: 'battle_action',
        charId: '5331',
        syncData: [
            { type: 1, ID: '00084542', HP: 0, CP: 4060 },
            { type: 1, ID: '00075128', HP: 2500, CP: 3000 },
            { type: 1, ID: '00072043', HP: 1800, CP: 2000 },
            { type: 4, ID: '5330', HP: 50000, maxHP: 128420 },
        ],
    });
    eq('actionFinish charDead reflects syncData HP=0', stepDead.charDead, true);
    eq('getTeamStatus selfDead true', bTeam.getTeamStatus().selfDead, true);
    eq('getTeamStatus aliveTeammates count', bTeam.getTeamStatus().aliveTeammates.length, 2);
    bTeam.markPlayerLeft('00072043');
    eq('markPlayerLeft updates aliveTeammates', bTeam.getTeamStatus().aliveTeammates.length, 1);

    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
