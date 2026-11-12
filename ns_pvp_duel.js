#!/usr/bin/env node
'use strict';

/* Live PvP duel. Quick Match uses encrypted socket virtual room "quick". */
const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');
const { PveSocket } = require('./lib/ns_pve_socket.js');

const DEFAULT_FILE = path.join(__dirname, 'pvpduel.txt');
const RETRY_LIMIT = 3;
const QUEUE_TIMEOUT_MS = 45000;
const BATTLE_TIMEOUT_MS = 120000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseAccountsFile(file = DEFAULT_FILE) {
    if (!fs.existsSync(file)) throw new Error('File akun tidak ditemukan: ' + file + ' (salin pvpduel.example.txt).');
    const accounts = new Map();
    let loserAction = 'dodge';
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(':');
        const role = parts.shift().trim().toLowerCase();
        if (role === 'loseraction') {
            const action = String(parts.shift() || '').trim().toLowerCase();
            if (parts.length || !['dodge', 'pass'].includes(action)) throw new Error('loserAction harus dodge atau pass.');
            loserAction = action;
            continue;
        }
        if (parts.length < 3) throw new Error('Format pvpduel.txt salah pada role yang diberikan.');
        const username = parts.shift().trim();
        const slot = parts.pop().trim();
        const password = parts.join(':');
        if (role !== 'winner' && role !== 'loser') throw new Error('Role harus winner atau loser.');
        if (!username || !password) throw new Error('Username/password kosong untuk role ' + role + '.');
        if (!/^\d{1,2}$/.test(slot) || Number(slot) < 1) throw new Error('characterSlot tidak valid untuk role ' + role + '.');
        if (accounts.has(role)) throw new Error('Role duplikat: ' + role + '.');
        accounts.set(role, { role, username, password, slot });
    }
    if (accounts.size !== 2 || !accounts.has('winner') || !accounts.has('loser')) throw new Error('pvpduel.txt wajib berisi tepat satu winner dan satu loser.');
    const winner = accounts.get('winner');
    const loser = accounts.get('loser');
    if (winner.username.toLowerCase() === loser.username.toLowerCase()) throw new Error('Winner dan loser harus akun berbeda.');
    return { winner, loser: { ...loser, loserAction }, loserAction };
}

function skillId(value) {
    if (value && typeof value === 'object') return skillId(value.skill_id || value.skillId || value.id);
    const text = String(value == null ? '' : value).trim();
    return text ? (text.startsWith('skill') ? text : 'skill' + text) : null;
}

function chooseSkills(character) {
    const equipped = Array.isArray(character && (character.character_equipped_skills || character.character_skills)) ? (character.character_equipped_skills || character.character_skills) : [];
    const catalog = Array.isArray(character && (character.skill_data || character.skills_detail)) ? (character.skill_data || character.skills_detail) : [];
    const damageById = new Map();
    for (const item of catalog) {
        const id = skillId(item);
        const damage = Number(item && (item.damage || item.power || item.damage_value));
        if (id && Number.isFinite(damage)) damageById.set(id, damage);
    }
    return [...new Set(equipped.map(skillId).filter(Boolean))].sort((a, b) => (damageById.get(b) || 0) - (damageById.get(a) || 0));
}

function findValue(source, wanted) {
    const needle = String(wanted).toLowerCase();
    const seen = new Set();
    const visit = value => {
        if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
            if (String(key).toLowerCase() === needle && (typeof child === 'string' || typeof child === 'number')) return child;
            const nested = visit(child);
            if (nested !== undefined) return nested;
        }
        return undefined;
    };
    return visit(source);
}

function normalizeMessage(data) { return data && data.message && typeof data.message === 'object' ? data.message : (data || {}); }
function winnerIds(message) {
    const raw = message.winnerIDs || message.winnerIds || message.winners || message.winner_id || message.winnerId;
    return Array.isArray(raw) ? raw.map(String) : raw == null ? [] : [String(raw)];
}
function normalizedCharId(value) { return String(value == null ? '' : value).replace(/^0+/, '') || '0'; }
function makeRotation(skills) { let index = 0; return () => skills.length ? skills[index++ % skills.length] : null; }
function isBattleStart(message) { return ['join', 'start', 'start_atb', 'battle_start'].includes(String(message.state || message.event || '').toLowerCase()); }
function isBattleFinish(message) { return ['battle_win', 'battle_finish', 'battle_lose'].includes(String(message.state || message.event || '').toLowerCase()); }

async function loginAccount(account) {
    const session = await c.login(account.username, account.password);
    if (!session.ok) throw new Error(account.role + ' login gagal: ' + (session.message || session.stage));
    const listed = await c.amf('CharacterDAO.getCharactersList', [session.sessionKey]);
    const characters = listed && listed.body && Array.isArray(listed.body.result) ? listed.body.result : [];
    const row = c.getSelectedChar(characters, account.slot);
    if (!row) throw new Error(account.role + ' tidak memiliki karakter pada slot ' + account.slot + '.');
    const charId = row[0];
    const detail = await c.amf('CharacterDAO.getCharacterById', [session.sessionKey, charId]);
    const character = detail && detail.body && detail.body.result || {};
    return { ...account, session, charId: String(charId), charName: row[1] || String(charId), skills: chooseSkills(character) };
}

async function readPvpInit(session) {
    const response = await c.amf('SystemData.getPvEServerInit', [session.sessionKey, 'en']);
    const body = response && response.body;
    if (!body || !Array.isArray(body.pvp_server) || !body.pvp_server[0]) throw new Error('PvP server tidak tersedia.');
    return { server: body.pvp_server[0], handoffToken: body.handoff_token, handoffNonce: body.handoff_nonce, ver: body.pveServerVersion || '' };
}

async function connectPlayer(player, init) {
    // Live PvP native client uses 9191, unlike server-init PvE room port 9292.
    const server = { ...init.server, port: Number(process.env.NS_PVP_PORT || 9191), ws_port: Number(process.env.NS_PVP_PORT || 9191) };
    const socket = await PveSocket.connect({ server, sessionKey: player.session.sessionKey, charId: player.charId, handoffToken: init.handoffToken, handoffNonce: init.handoffNonce, ver: init.ver });
    socket.auth();
    await socket.waitAuth(15000);
    if (!socket.hasCommandKey()) throw new Error(player.role + ' socket encryption tidak siap.');
    return socket;
}

function sendBattleStep(socket, player, message, opponentId, nextSkill) {
    const state = String(message.state || '').toLowerCase();
    if (state === 'join') socket.battleReady();
    else if (state === 'start') socket.startAtb();
    else if (state === 'start_atb') socket.actionReady();
    else if (state === 'battle_action') socket.actionFinish(Boolean(message.char_dead || message.charDead));
    else if (message.event === 'command' && state === 'action' && normalizedCharId(message.charId) === normalizedCharId(player.charId)) {
        if (player.role === 'loser') socket.battleCommand(player.charId, player.loserAction || 'dodge', null, opponentId);
        else {
            const skill = nextSkill();
            socket.battleCommand(player.charId, skill ? 'skill' : 'attack', skill, opponentId);
        }
    }
}

async function waitUntil(predicate, state, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (state.fatal) throw state.fatal;
        if (predicate()) return;
        await sleep(25);
    }
    throw new Error(label + ' timeout');
}

async function runMatch(players, attempt) {
    const queueStarted = Date.now();
    const [winnerInit, loserInit] = await Promise.all([readPvpInit(players.winner.session), readPvpInit(players.loser.session)]);
    // Socket server rejects occasional simultaneous upgrades from same client IP.
    const winnerSocket = await connectPlayer(players.winner, winnerInit);
    let loserSocket;
    try {
        loserSocket = await connectPlayer(players.loser, loserInit);
    } catch (error) {
        winnerSocket.close();
        throw error;
    }
    const sockets = [winnerSocket, loserSocket];
    const state = { paired: false, battleStartedAt: null, result: null, point: null, fatal: null };
    const nextSkill = makeRotation(players.winner.skills);
    const bind = (player, socket, opponent) => {
        socket.on('close', () => { state.fatal = state.fatal || new Error(player.role + ' socket putus.'); });
        socket.on('error', () => { state.fatal = state.fatal || new Error(player.role + ' socket error.'); });
        socket.on('si_error', () => { state.fatal = state.fatal || new Error(player.role + ' Socket.IO error.'); });
        socket.on('*', (_event, raw) => {
            if (process.env.NS_PVP_DEBUG === '1') console.log('[PvP ' + player.role + '] ' + _event + ' ' + JSON.stringify(raw).slice(0, 700));
            const message = normalizeMessage(raw);
            const ids = [...(message.ta || []), ...(message.tb || []), ...(message.players || []).map(item => item.charId || item.character_id)].map(normalizedCharId);
            if (ids.includes(normalizedCharId(players.winner.charId)) && ids.includes(normalizedCharId(players.loser.charId))) state.paired = true;
            if (isBattleStart(message) && !state.battleStartedAt) state.battleStartedAt = Date.now();
            sendBattleStep(socket, player, message, opponent.charId, nextSkill);
            if (isBattleFinish(message)) {
                const winners = winnerIds(message);
                if (winners.map(normalizedCharId).includes(normalizedCharId(players.winner.charId))) state.result = message;
                else if (winners.length) state.fatal = new Error('Hasil battle bukan kemenangan winner.');
            }
            const point = findValue(raw, 'pvp_point');
            if (point !== undefined && Number.isFinite(Number(point))) state.point = Number(point);
        });
    };
    bind(players.winner, winnerSocket, players.loser);
    bind(players.loser, loserSocket, players.winner);
    try {
        await Promise.all([Promise.resolve().then(() => winnerSocket.quickMatch()), Promise.resolve().then(() => loserSocket.quickMatch())]);
        await waitUntil(() => state.paired, state, QUEUE_TIMEOUT_MS, 'Quick Match');
        const battleStartedAt = state.battleStartedAt || Date.now();
        await waitUntil(() => Boolean(state.result), state, BATTLE_TIMEOUT_MS, 'Battle');
        // Native Back emits join_room then system_get_user. No rematch event is sent.
        await Promise.all([winnerSocket.backToLivePvpLobby(), loserSocket.backToLivePvpLobby()]);
        await Promise.all([winnerSocket.refreshLivePvp(), loserSocket.refreshLivePvp()]);
        const endedAt = Date.now();
        return { attempt, point: state.point, queueSec: (battleStartedAt - queueStarted) / 1000, battleSec: (endedAt - battleStartedAt) / 1000, cycleSec: (endedAt - queueStarted) / 1000 };
    } finally {
        for (const socket of sockets) socket.close();
    }
}

async function main() {
    const accounts = parseAccountsFile(process.argv[2] || DEFAULT_FILE);
    c.enableGracefulStop('menu NSCC');
    const [winner, loser] = await Promise.all([loginAccount(accounts.winner), loginAccount(accounts.loser)]);
    console.log(winner.skills.length ? '[i] Winner ' + winner.charName + ' skill priority: ' + winner.skills.join(', ') : '[i] Skill winner tidak ditemukan. Fallback basic attack.');
    console.log('[i] PvP duel: ' + winner.username + ' vs ' + loser.username + '. Loser action=' + loser.loserAction + '. Tekan Q/Esc/Ctrl+C untuk stop.');
    let wins = 0;
    let bestCycle = Infinity;
    const maxWins = Number(process.env.NS_PVP_MAX_WINS || 0);
    for (;;) {
        let success = false;
        let lastError = null;
        for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
            try {
                const result = await runMatch({ winner, loser }, attempt);
                wins++;
                bestCycle = Math.min(bestCycle, result.cycleSec);
                const points = Number.isFinite(result.point) ? result.point : 'unknown';
                console.log('[PvP #' + wins + '] WIN | points=' + points + ' | +5 | queue=' + result.queueSec.toFixed(1) + 's | battle=' + result.battleSec.toFixed(1) + 's | cycle=' + result.cycleSec.toFixed(1) + 's | best=' + bestCycle.toFixed(1) + 's');
                if (maxWins > 0 && wins >= maxWins) return;
                success = true;
                break;
            } catch (error) {
                lastError = error;
                console.error('[PvP] attempt ' + attempt + '/' + RETRY_LIMIT + ' gagal: ' + error.message);
            }
        }
        if (!success) throw new Error('PvP berhenti setelah ' + RETRY_LIMIT + ' retry: ' + lastError.message);
    }
}

module.exports = { parseAccountsFile, chooseSkills, findValue, winnerIds, normalizedCharId, makeRotation, sendBattleStep, isBattleStart, isBattleFinish };
if (require.main === module) main().catch(error => { console.error('FATAL:', error.message); process.exitCode = 1; });
