#!/usr/bin/env node
'use strict';
/**
 * Public co-op boss runner. One account joins existing rooms only.
 * It never creates rooms or starts games. Battle commands stay disabled until
 * live target and skill mappings are captured and verified.
 */
const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');
const { PveSocket } = require('./lib/ns_pve_socket.js');
const { PveBattle } = require('./lib/ns_pve_battle.js');

const line = message => console.log(message);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Live room list maps public Co-op bosses to their enemy IDs.
const BOSS_ENEMY_ID = { minotaur: 'enemy501', cerberus: 'enemy533', griffin: 'enemy546', wanyudo: 'enemy561', gashadokuro: 'enemy570' };
const LEVEL_INDEX = { normal: 1, hard: 2, extreme: 3, extream: 3 };
const AUTO_SKILL_PRIORITY = ['633', '632', '638', '623', '728', '345', '854', '151', '39'];
const AOE_SKILL_IDS = String((process.env && process.env.NS_COOP_AOE_SKILL_IDS) || '632,638,623,728').split(',').map(id => id.trim()).filter(Boolean);
const STUN_SKILL_ID = String((process.env && process.env.NS_COOP_STUN_SKILL_ID) || '345').trim();

function parseArgs(argv) {
    const args = {
        boss: 'cerberus', level: 'extreme', accounts: 'coop_accounts.txt', maxMatches: Infinity,
        roomPollMs: 1500, hostStartTimeout: 180000, minLevel: 80, hostWait: 1800000, startTimeout: 60000, dryRun: false, captureBattle: false, hostRoom: false, headful: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--boss') args.boss = argv[++i];
        else if (key === '--level') args.level = argv[++i];
        else if (key === '--accounts') args.accounts = argv[++i];
        else if (key === '--max-matches') args.maxMatches = Number(argv[++i]);
        else if (key === '--room-poll-ms') args.roomPollMs = Number(argv[++i]);
        else if (key === '--host-start-timeout') args.hostStartTimeout = Number(argv[++i]);
        else if (key === '--min-level') args.minLevel = Number(argv[++i]);
        else if (key === '--host-wait') args.hostWait = Number(argv[++i]);
        else if (key === '--start-timeout') args.startTimeout = Number(argv[++i]);
        else if (key === '--dry-run') args.dryRun = true;
        else if (key === '--capture-battle') args.captureBattle = true;
        else if (key === '--host-room') args.hostRoom = true;
        else if (key === '--headful') args.headful = true;
        else throw new Error('Argumen tidak dikenal: ' + key);
    }
    if (!(args.maxMatches > 0) || (!Number.isFinite(args.maxMatches) && args.maxMatches !== Infinity)) throw new Error('--max-matches harus angka positif.');
    for (const [key, value] of [['--room-poll-ms', args.roomPollMs], ['--host-start-timeout', args.hostStartTimeout], ['--min-level', args.minLevel], ['--host-wait', args.hostWait], ['--start-timeout', args.startTimeout]]) {
        if (!(value > 0) || !Number.isFinite(value)) throw new Error(key + ' harus angka positif.');
    }
    return args;
}

function parseAccountsFile(file, requiredCount = 1) {
    if (!fs.existsSync(file)) throw new Error('File akun tidak ditemukan: ' + file + ' (salin coop_accounts.example.txt).');
    const accounts = [];
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const value = raw.trim();
        if (!value || value.startsWith('#')) continue;
        const parts = value.split(':');
        if (parts.length < 3) continue;
        const role = parts[0].trim().toLowerCase();
        if (role !== 'main') continue;
        const slot = /^\d{1,2}$/.test(String(parts.at(-1)).trim()) ? String(parts.pop()).trim() : '1';
        const username = String(parts[1] || '').trim();
        const password = parts.slice(2).join(':');
        if (!username || !password) throw new Error('Format akun tidak valid: ' + raw);
        accounts.push({ role, username, password, slot });
    }
    if (requiredCount != null && accounts.length !== requiredCount) {
        throw new Error('Mode public-room butuh tepat ' + requiredCount + ' akun main, ditemukan ' + accounts.length + '.');
    }
    return accounts;
}

function levelSuffix(level) { return LEVEL_INDEX[String(level || '').toLowerCase()] || 3; }
async function connectPve(options) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try { return await PveSocket.connect(options); }
        catch (error) {
            lastError = error;
            if (attempt < 3) await sleep(1500 * attempt);
        }
    }
    throw new Error('WebSocket PvE gagal setelah 3 percobaan: ' + (lastError && lastError.message));
}
function bossMatches(group, boss) {
    const wanted = String(boss || '').toLowerCase();
    const enemyId = BOSS_ENEMY_ID[wanted];
    const display = (group.display_boss || []).map(String).join(' ').toLowerCase();
    return Boolean((enemyId && display.includes(enemyId)) || display.includes(wanted) || String(group.name || '').toLowerCase().includes(wanted));
}
function findQuestId(questList, boss, level) {
    const suffix = levelSuffix(level);
    for (const group of (Array.isArray(questList) ? questList : [])) {
        if (!bossMatches(group, boss)) continue;
        for (const item of (group.quest_obj || [])) {
            if (Number(item.quest) % 10 === suffix) return { quest: Number(item.quest), energy: item.energy || [] };
        }
    }
    return null;
}

async function loginAccount(account, webData) {
    const session = await c.login(account.username, account.password, webData);
    if (!session.ok) return { ok: false, error: session.message || session.stage || 'login gagal' };
    const list = await c.amf('CharacterDAO.getCharactersList', [session.sessionKey]);
    const chars = list && list.body && Array.isArray(list.body.result) ? list.body.result : [];
    const row = c.getSelectedChar(chars, account.slot || undefined);
    if (!row) return { ok: false, error: 'karakter tidak ditemukan' };
    let skills = [];
    let equippedDeck = [];
    try {
        const detail = await c.amf('CharacterDAO.getCharacterById', [session.sessionKey, row[0]]);
        const data = detail && detail.body && detail.body.gk ? (detail.body.result || {}) : {};
        const rawSkills = data.character_skills || data.character_skill || [];
        const skillDetails = new Map(rawSkills.map(raw => {
            const id = String(raw && typeof raw === 'object' ? (raw.skill_id ?? raw.skillId ?? raw.id ?? raw.value) : raw);
            const name = raw && typeof raw === 'object' ? String(raw.skill_name ?? raw.skillName ?? raw.name ?? raw.title ?? '') : '';
            return [id, { id, name }];
        }));
        const owned = new Set(skillDetails.keys());
        const equipped = (data.character_equipped_skills || []).map(String).filter(id => owned.has(id));
        const ordered = [...AUTO_SKILL_PRIORITY.filter(id => owned.has(id)), ...equipped.filter(id => !AUTO_SKILL_PRIORITY.includes(id))];
        skills = [...new Set(ordered)].map((id, index) => ({ skillId: 'skill' + id, id, name: (skillDetails.get(id) || {}).name || '', damage: 1000 - index, once: id === '2004' }));
        // Default in-game deck (same source as PvP arena script); Cerberus host mode ranks it per role.
        equippedDeck = [...new Set(equipped)].map(id => ({ skillId: 'skill' + id, id, name: (skillDetails.get(id) || {}).name || '' }));
    } catch (_) {}
    return {
        ok: true, session, charId: String(row[0]), charName: row[1], level: Number(row[2]) || null,
        isEmblem: Boolean(session.isEmblem || Number(session.accountType) === 2), skills, equipped: equippedDeck,
    };
}

async function readPveInit(session) {
    const result = await c.amf('SystemData.getPvEServerInit', [session.sessionKey, 'en']);
    const body = result && result.body;
    if (!body) return null;
    return {
        handoffToken: body.handoff_token, handoffNonce: body.handoff_nonce, pvpServer: body.pvp_server,
        questList: body.quest_list, energy: Number(body.character_energy), ver: body.pveServerVersion,
        status: body.status, pveStatus: body.pve_status,
    };
}

function boolEmblem(value) {
    return value === true || String(value || '').toLowerCase() === 'emblem';
}
function normalizePlayer(raw) {
    // PvE room events can contain only a character ID, without account status.
    if (typeof raw === 'string' || typeof raw === 'number') return { charId: String(raw), isEmblem: null };
    if (!raw || typeof raw !== 'object') return null;
    const charId = raw.character_id ?? raw.characterId ?? raw.char_id ?? raw.charId ?? raw.id;
    const emblemValue = raw.isEmblem ?? raw.is_emblem ?? raw.emblem ?? raw.accountType ?? raw.account_type ?? raw.userType ?? raw.user_type;
    const hasEmblem = emblemValue !== undefined && emblemValue !== null;
    if (charId == null || !hasEmblem) return null;
    const levelValue = raw.character_level ?? raw.characterLevel ?? raw.level ?? raw.lv;
    const level = Number(levelValue);
    return { charId: String(charId), isEmblem: boolEmblem(emblemValue) || Number(emblemValue) === 2, level: Number.isFinite(level) ? level : null };
}
function normalizeRoom(raw, questId) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.room_name ?? raw.roomName ?? raw.room_id ?? raw.roomId ?? raw.id;
    const quest = Number(raw.quest ?? raw.quest_id ?? raw.questId ?? raw.mission ?? raw.mission_id);
    const mode = raw.mode ?? raw.level ?? raw.difficulty;
    const rosterRaw = raw.character_array ?? raw.characters ?? raw.players ?? raw.player_array ?? raw.user_array;
    const players = Array.isArray(rosterRaw) ? rosterRaw.map(normalizePlayer) : [];
    const hasPassword = Boolean(raw.has_password ?? raw.hasPassword ?? raw.password_required);
    const capacity = Number(raw.max_player ?? raw.maxPlayer ?? raw.capacity ?? 3);
    const declaredCount = Number(raw.player_count ?? raw.playerCount ?? raw.count ?? players.length);
    const slots = Number.isFinite(capacity) && Number.isFinite(declaredCount) ? capacity - declaredCount : null;
    const schemaComplete = Boolean(id != null && quest === Number(questId) && Array.isArray(rosterRaw) && players.length === rosterRaw.length && slots != null);
    return { id: id == null ? null : String(id), quest, mode, players, slots, hasPassword, schemaComplete, raw };
}
function findRoomMaster(data, rawPlayers, players) {
    const masterId = data && (data.master_id ?? data.masterId ?? data.host_id ?? data.hostId ?? data.owner_id ?? data.ownerId ?? data.room_master_id ?? data.roomMasterId);
    if (masterId != null) return (players || []).find(player => player.charId === String(masterId)) || null;
    const index = (rawPlayers || []).findIndex(player => player && typeof player === 'object' && Boolean(player.is_master ?? player.isMaster ?? player.is_host ?? player.isHost ?? player.is_owner ?? player.isOwner));
    return (players || [])[index >= 0 ? index : 0] || null;
}
function pickRoom(rooms, questId, botCharId, blockedRoomIds = new Set()) {
    const evaluated = [];
    for (const raw of (Array.isArray(rooms) ? rooms : [])) {
        const room = normalizeRoom(raw, questId);
        if (!room || !room.id || room.quest !== Number(questId)) {
            const enemies = Array.isArray(raw && raw.tb) ? raw.tb.join(',') : '';
            evaluated.push({ reason: 'quest_or_id', quest: room && room.quest, enemies });
            continue;
        }
        if (blockedRoomIds.has(room.id)) { evaluated.push({ roomId: room.id, reason: 'room_cooldown' }); continue; }
        if (room.hasPassword) { evaluated.push({ roomId: room.id, reason: 'password_required' }); continue; }
        if (room.slots != null && room.slots < 1) { evaluated.push({ roomId: room.id, reason: 'room_full' }); continue; }
        // Room summary often omits roster. Join only to verify it; READY stays blocked
        // until join_room confirms another Emblem player.
        if (!room.schemaComplete) { evaluated.push({ roomId: room.id, reason: 'verify_after_join', room, otherEmblems: null }); continue; }
        const master = findRoomMaster(room.raw, room.raw.character_array || room.raw.characters || room.raw.players || [], room.players);
        if (!master || !(master.level >= 80)) { evaluated.push({ roomId: room.id, reason: master && master.level != null ? 'master_level_' + master.level : 'master_level_unknown' }); continue; }
        const otherEmblems = room.players.filter(player => player.charId !== String(botCharId) && player.isEmblem).length;
        if (otherEmblems < 1) { evaluated.push({ roomId: room.id, reason: 'need_second_emblem' }); continue; }
        evaluated.push({ roomId: room.id, reason: 'accepted', room, otherEmblems });
    }
    const candidates = evaluated.filter(item => item.room).sort((left, right) => (right.otherEmblems ?? -1) - (left.otherEmblems ?? -1) || (right.room.slots ?? 0) - (left.room.slots ?? 0) || left.room.id.localeCompare(right.room.id, undefined, { numeric: true }));
    return { room: candidates[0] && candidates[0].room, evaluated };
}
function scanSummary(evaluated) {
    const counts = new Map();
    for (const item of evaluated || []) {
        if (item.reason === 'accepted') continue;
        const label = item.reason === 'quest_or_id' && item.quest != null
            ? 'other_quest=' + item.quest + (item.enemies ? '/' + item.enemies : '')
            : item.reason;
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].map(([reason, count]) => reason + '=' + count).join(', ') || 'tidak ada room';
}
function countOtherEmblems(players, botCharId) {
    const ids = new Set();
    let count = 0;
    for (const player of players || []) {
        if (!player || player.charId === String(botCharId) || ids.has(player.charId)) continue;
        ids.add(player.charId);
        if (player.isEmblem) count++;
    }
    return count;
}
function roomArray(data) { return data && (data.room_array || data.rooms || data.roomArray); }
function messageValue(raw) {
    const message = raw && raw.message ? raw.message : raw;
    if (typeof message !== 'string') return message;
    try { return JSON.parse(message); } catch (_) { return null; }
}
function pickSkill(skills, id) { return (skills || []).find(skill => String(skill.id) === String(id)) || null; }
function normalizeSkillName(skill) { return String(skill && skill.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function pickNamedSkill(skills, names, fallbackId) {
    const wanted = names.map(name => name.toLowerCase());
    return (skills || []).find(skill => wanted.some(name => normalizeSkillName(skill).includes(name))) || pickSkill(skills, fallbackId);
}
function hasFullQuickmatchTeam(players) { return Array.isArray(players) && players.length >= 3; }
function isUchihaRazq(charName) { return String(charName || '').trim().toLowerCase() === 'uchiha razq'; }
function rankedSkills(skills, excludedIds = []) {
    const excluded = new Set(excludedIds.map(String));
    return [...(skills || [])]
        .filter(skill => !excluded.has(String(skill.id)) && !AVOID_SKILLS.has(String(skill.id)))
        .sort((left, right) => (Number(right.damage) || 0) - (Number(left.damage) || 0));
}
function chooseQuickmatchTurn(charName, skills, enemyIds, turn) {
    const head = enemyIds && enemyIds[0];
    if (isUchihaRazq(charName)) {
        const sequence = [
            pickNamedSkill(skills, ['five element consuming seal', 'five elements seal'], '345'),
            pickNamedSkill(skills, ['thunder explosion'], '633'),
            pickNamedSkill(skills, ['electric smash'], '632'),
            pickNamedSkill(skills, ['dragon sublimation']),
            pickNamedSkill(skills, ['special snakes scales', 'special snake scales']),
        ].filter(Boolean);
        if (turn < sequence.length) return { skill: sequence[turn], targetId: head, label: 'razq_priority' };
        const fallback = rankedSkills(skills, sequence.map(skill => skill.id));
        const skill = fallback.length ? fallback[(turn - sequence.length) % fallback.length] : sequence.at(-1);
        return skill ? { skill, targetId: head, label: 'razq_fallback' } : { skill: null, targetId: head, label: 'weapon' };
    }
    const fallback = rankedSkills(skills, ['2004']);
    const skill = fallback.length ? fallback[turn % fallback.length] : pickSkill(skills, '2004');
    return skill ? { skill, targetId: head, label: 'ranked' } : { skill: null, targetId: head, label: 'weapon' };
}
function captchaRetryDecision(outcome) {
    if (outcome && outcome.ok) return { action: 'verified' };
    const failsLeft = Number(outcome && outcome.failsLeft);
    if (outcome && outcome.reason === 'verification_rejected' && Number.isFinite(failsLeft) && failsLeft >= 5) {
        return { action: 'retry', failsLeft };
    }
    return { action: 'stop', failsLeft: Number.isFinite(failsLeft) ? failsLeft : null };
}
function chooseMinotaurTurn(skills, enemyIds, turn, hostDodgeFirst = false) {
    const head = enemyIds && enemyIds[0];
    const evasion = pickSkill(skills, '39');
    if (hostDodgeFirst && turn === 0 && evasion) return { skill: evasion, targetId: head, label: 'host_evasion' };
    const leftHand = (enemyIds && enemyIds[1]) || head;
    const seal = pickSkill(skills, '2004');
    if (turn === 0 && seal) return { skill: seal, targetId: head, label: 'seal_head' };
    if (turn === 1) {
        const aoe = AOE_SKILL_IDS.map(id => pickSkill(skills, id)).find(Boolean);
        if (aoe) return { skill: aoe, targetId: head, label: 'aoe_head' };
        const stun = pickSkill(skills, STUN_SKILL_ID);
        if (stun) return { skill: stun, targetId: leftHand, label: 'stun_left_hand' };
    }
    const fallback = (skills || []).filter(skill => String(skill.id) !== '2004');
    const skill = fallback.length ? fallback[(Math.max(0, turn - 2)) % fallback.length] : seal;
    return skill ? { skill, targetId: head, label: 'strongest' } : { skill: null, targetId: head, label: 'weapon' };
}
function nowNs() { return typeof process.hrtime.bigint === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1000000n; }
function elapsedMs(start) { return Number(nowNs() - start) / 1e6; }

async function runDryRun(args, account) {
    const result = await loginAccount(account);
    if (!result.ok) throw new Error('Login gagal: ' + result.error);
    const pve = await readPveInit(result.session);
    const quest = pve && findQuestId(pve.questList, args.boss, args.level);
    if (!pve || !quest || !pve.pvpServer || !pve.pvpServer[0]) throw new Error('PvE boss Extreme tidak tersedia.');
    const socket = await connectPve({ server: pve.pvpServer[0], sessionKey: result.session.sessionKey, charId: result.charId, handoffToken: pve.handoffToken, handoffNonce: pve.handoffNonce, ver: pve.ver });
    try {
        let rooms = null;
        socket.on('get_room_summary', data => {
            rooms = roomArray(data);
        });
        socket.auth();
        await socket.waitAuth(15000);
        if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk.');
        socket.getRoomSummary();
        const deadline = Date.now() + 15000;
        while (!Array.isArray(rooms)) {
            if (Date.now() >= deadline) throw new Error('room summary timeout');
            await sleep(25);
        }
        const picked = pickRoom(rooms, quest.quest, result.charId);
        line('  DRY RUN ' + result.charName + ': rooms=' + rooms.length + ', kandidat=' + (picked.room ? picked.room.id : 'tidak ada'));
        return { quest: quest.quest, rooms: rooms.length, candidate: picked.room && picked.room.id, rejects: picked.evaluated.filter(item => item.reason !== 'accepted') };
    } finally { socket.close(); }
}

async function runLive(args, account) {
    if (String(args.boss).toLowerCase() !== 'cerberus') throw new Error('Quickmatch hanya mendukung boss Cerberus.');
    const { CaptchaSolver } = require('./lib/ns_captcha_solver.js');
    const solver = new CaptchaSolver({ headful: args.headful, log: line, username: account.username, password: account.password });
    let solverOpened = false;
    const ensureSolver = async () => {
        if (solverOpened) return;
        await solver.open();
        solverOpened = true;
    };
    let socket = null;
    const report = { generatedAt: new Date().toISOString(), mode: 'public-room', account: account.username, matches: [], scans: [], error: null };
    const saveReport = () => fs.writeFileSync(path.join(process.cwd(), 'coop_report.json'), JSON.stringify(report, null, 2));
    try {
        // Web login binds CAPTCHA solver and PvE socket to same account session.
        await ensureSolver();
        const result = await loginAccount(account, solver.webLoginData);
        if (!result.ok) throw new Error('Login gagal: ' + result.error);
        const pve = await readPveInit(result.session);
        const quest = pve && findQuestId(pve.questList, args.boss, args.level);
        if (!pve || !quest || !pve.pvpServer || !pve.pvpServer[0]) throw new Error('PvE boss Extreme tidak tersedia.');
        if (!result.skills.length) throw new Error('Skill karakter tidak terbaca; battle otomatis dihentikan.');
        const joinCost = Number(quest.energy[1]);
        if (!(joinCost > 0)) throw new Error('Biaya energy join tidak valid.');
        socket = await connectPve({ server: pve.pvpServer[0], sessionKey: result.session.sessionKey, charId: result.charId, handoffToken: pve.handoffToken, handoffNonce: pve.handoffNonce, ver: pve.ver });

        let rooms = null;
        let active = null;
        let fatal = null;
        let solvingCaptcha = false;
        let captchaAttempts = 0;
        let joinRejectTimer = null;
        const masterProfileCache = new Map();
        const rejectedRoomUntil = new Map();
        const bufferedBattle = [];
        const blockRoom = (roomId, reason) => {
            if (!roomId) return;
            const until = Date.now() + 120000;
            rejectedRoomUntil.set(String(roomId), until);
            line('  ROOM ' + roomId + ' skip 120 dtk (' + reason + ')');
        };
        const resetActive = reason => {
            if (!active) return;
            if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
            active.reason = active.reason || reason;
            active.done = true;
        };
        const requestRooms = () => { rooms = null; socket.getRoomSummary(); };
        const watchJoinResponse = (reason, timeoutMs) => {
            if (joinRejectTimer) clearTimeout(joinRejectTimer);
            joinRejectTimer = setTimeout(() => {
                joinRejectTimer = null;
                if (active && !active.done && !active.joinAccepted) resetActive(reason);
            }, timeoutMs);
        };
        socket.on('error', () => { fatal = fatal || new Error('Socket error'); });
        socket.on('si_error', () => { fatal = fatal || new Error('Socket.IO error'); });
        socket.on('close', () => { if (!fatal) fatal = new Error('Socket terputus'); });
        socket.on('get_room_summary', data => {
            rooms = roomArray(data);
        });
        socket.on('captcha_required', () => {
            if (!active || active.done || active.joinAccepted || solvingCaptcha) return;
            active.captchaRequested = true;
            if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
            if (++captchaAttempts > 2) { fatal = new Error('CAPTCHA berulang; berhenti agar akun tidak terkunci.'); return; }
            solvingCaptcha = true;
            line('  #' + active.match + ' CAPTCHA verifikasi join...');
            solver.solve('pve').then(async outcome => {
                const decision = captchaRetryDecision(outcome);
                if (decision.action === 'stop') {
                    fatal = new Error('CAPTCHA ditolak server. fails_left=' + (decision.failsLeft == null ? 'unknown' : decision.failsLeft) + '. Selesaikan manual sebelum lanjut.');
                    return;
                }
                if (decision.action === 'retry') {
                    line('  CAPTCHA ditolak; fails_left=' + decision.failsLeft + '. Ulang join room.');
                    await sleep(1000);
                    if (active && !active.done) {
                        socket.joinRoom(active.room.id, '', pve.ver);
                        watchJoinResponse('captcha_join_timeout', 12000);
                    }
                    return;
                }
                // Give server verification state time to reach PvE socket before retrying join.
                await sleep(750);
                if (!active || active.done) return;
                line('  #' + active.match + ' CAPTCHA OK; ulang join room=' + active.room.id);
                socket.joinRoom(active.room.id, '', pve.ver);
                watchJoinResponse('captcha_join_timeout', 12000);
            }).catch(error => {
                resetActive('captcha_error:' + String(error.message || error).slice(0, 80));
            }).finally(() => { solvingCaptcha = false; });
        });
        const applyRoster = async data => {
            if (!active || active.done || !data) return false;
            const raw = data.character_array || data.characters || data.players;
            if (!Array.isArray(raw)) return false;
            const players = raw.map(normalizePlayer);
            if (players.some(player => !player)) {
                active.rosterFields = raw.slice(0, 3).map(player => player && typeof player === 'object' ? Object.keys(player) : []);
                resetActive('roster_schema_incomplete');
                return false;
            }
            active.rosterConfirmed = true;
            active.players = players;
            active.master = findRoomMaster(data, raw, players);
            if (active.master && active.master.level == null) {
                const rosterActive = active;
                const cached = masterProfileCache.get(active.master.charId);
                if (cached !== undefined) active.master.level = cached;
                else {
                    try {
                        const response = await c.amf('CharacterDAO.getCharacterProfileById', [result.session.sessionKey, rosterActive.master.charId, true]);
                        if (active !== rosterActive || rosterActive.done) return false;
                        const profile = (response && response.body && response.body.result) || {};
                        const level = Number(profile.character_level ?? profile.characterLevel ?? profile.level);
                        masterProfileCache.set(rosterActive.master.charId, Number.isFinite(level) ? level : null);
                        rosterActive.master.level = Number.isFinite(level) ? level : null;
                    } catch (_) {
                        if (active !== rosterActive || rosterActive.done) return false;
                        masterProfileCache.set(rosterActive.master.charId, null);
                    }
                }
            }
            if (!active.master || !(active.master.level >= 80)) {
                const reason = active.master && active.master.level != null ? 'master_level_' + active.master.level : 'master_level_unknown';
                blockRoom(active.room.id, reason);
                resetActive(reason);
                return false;
            }
            active.otherEmblems = countOtherEmblems(players, result.charId);
            active.emblemStatusUnknown = players.some(player => player.isEmblem == null);
            // Public rooms expose only character IDs on some PvE packets. User opted
            // to continue those rooms, while explicit non-Emblem rosters stay blocked.
            if (!active.emblemStatusUnknown && active.otherEmblems < 1 && !active.started) resetActive('emblem_player_left');
            return true;
        };
        const sendReady = () => {
            if (!active || active.done || active.ready) return;
            if (!hasFullQuickmatchTeam(active.players)) {
                if (!active.waitingFullTeam) {
                    active.waitingFullTeam = true;
                    line('  #' + active.match + ' WAIT room=' + active.room.id + ' player=' + active.players.length + '/3; tunggu room penuh sebelum READY');
                }
                return;
            }
            socket.ready(result.charId);
            active.readySentNs = nowNs();
            active.joinAcceptedToReadyMs = elapsedMs(active.joinAcceptedNs);
            if (active.joinAcceptedToReadyMs > 250) active.latencyWarning = 'ready lambat';
            active.ready = true;
            line('  #' + active.match + ' READY room=' + active.room.id + ' (' + active.joinAcceptedToReadyMs.toFixed(1) + ' ms)' + (active.rosterConfirmed ? '' : ' roster=menunggu') + '; tunggu host max ' + Math.round(args.hostStartTimeout / 1000) + ' dtk');
        };
        socket.on('join_room', async data => {
            if (!active || active.done) return;
            if (active.joinAccepted) {
                const applied = await applyRoster(data);
                if (applied && active && !active.done) sendReady();
                return;
            }
            if (Number(data && data.status) !== 1 || data.room_name === 'lobby') {
                // Some servers emit join rejection just before captcha_required.
                // Hold state briefly so CAPTCHA can resend this same join command.
                if (!active.captchaRequested && !joinRejectTimer) watchJoinResponse('join_rejected', 1500);
                return;
            }
            if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
            active.joinAccepted = true;
            active.joinAcceptedNs = nowNs();
            await applyRoster(data);
            if (active && !active.done) sendReady();
        });
        socket.on('ready', data => {
            applyRoster(data)
                .then(applied => { if (applied && active && !active.done) sendReady(); })
                .catch(error => { resetActive('roster_error:' + String(error.message || error).slice(0, 80)); });
        });
        socket.on('leave_room', data => {
            if (!active || active.done || !data) return;
            const left = String(data.character_id ?? data.characterId ?? data.charId ?? data.id ?? '');
            if (!active.rosterConfirmed) return;
            if (left) active.players = active.players.filter(player => player.charId !== left);
            const others = active.players.filter(player => player.charId !== String(result.charId));
            if (active.emblemStatusUnknown) {
                if (!others.length) resetActive('all_other_players_left');
                return;
            }
            if (countOtherEmblems(active.players, result.charId) < 1) resetActive('emblem_player_left');
        });
        const roomEventDetail = data => {
            if (!data || typeof data !== 'object') return {};
            return {
                status: data.status,
                reason: data.reason || data.message || data.error,
                keys: Object.keys(data).slice(0, 12),
            };
        };
        for (const event of ['kick_user', 'force_lobby', 'destroy_battle']) {
            socket.on(event, data => {
                if (active && !active.done) {
                    const detail = roomEventDetail(data);
                    active.roomEvents = active.roomEvents || [];
                    active.roomEvents.push({ event, ...detail });
                    line('  #' + active.match + ' SERVER ' + event + (detail.reason ? ' (' + detail.reason + ')' : ''));
                    if (event === 'force_lobby') blockRoom(active.room.id, 'force_lobby');
                }
                resetActive(event);
            });
        }
        const markBattleStarted = () => {
            if (!active || active.started) return;
            active.started = true;
            line('  #' + active.match + ' START ' + String(args.boss).toUpperCase());
        };
        socket.on('battle_start', markBattleStarted);
        socket.on('battle_msg', raw => {
            const message = messageValue(raw);
            if (!message || !active || active.done) return;
            if (bufferedBattle.length < 100) bufferedBattle.push({ event: message.event, state: message.state, charId: message.charId });
            if (['join', 'start', 'start_atb'].includes(message.state)) markBattleStarted();
            if (message.state === 'battle_finish' || message.state === 'battle_win') { active.outcome = message.state; active.done = true; return; }
            if (message.state === 'battle_lose') { active.outcome = 'battle_lose'; active.done = true; return; }
            const step = active.battle.nextStep(message);
            if (step.type === 'ready') socket.battleReady();
            else if (step.type === 'startAtb') socket.startAtb();
            else if (step.type === 'actionReady') socket.actionReady();
            else if (step.type === 'actionFinish') socket.actionFinish(step.charDead);
            else if (step.type === 'turn' && !args.captureBattle) {
                active.commandReceivedNs = nowNs();
                const turn = chooseQuickmatchTurn(result.charName, result.skills, active.battle.enemyIds, active.turn++);
                socket.battleCommand(result.charId, turn.skill ? 'skill' : 'weapon_attack', turn.skill && turn.skill.skillId, turn.targetId);
                active.lastAction = turn.label + ':' + (turn.skill ? turn.skill.skillId : 'weapon_attack');
                active.battleCommandLatencyMs = elapsedMs(active.commandReceivedNs);
                line('  #' + active.match + ' SKILL ' + active.lastAction + ' (' + active.battleCommandLatencyMs.toFixed(1) + ' ms)');
            }
        });
        socket.auth();
        await socket.waitAuth(15000);
        if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk.');
        socket.joinLobby();
        let knownEnergy = Number(pve.energy);
        let lastEnergyCheckAt = Date.now();

        while (report.matches.length < args.maxMatches) {
            // Room scan stays socket-only; avoid slow AMF refresh on every 1.5s poll.
            if (Date.now() - lastEnergyCheckAt >= 30000) {
                const fresh = await readPveInit(result.session);
                if (!fresh || !Number.isFinite(fresh.energy)) break;
                knownEnergy = fresh.energy;
                lastEnergyCheckAt = Date.now();
            }
            if (!Number.isFinite(knownEnergy) || knownEnergy < joinCost) break;
            requestRooms();
            const scanDeadline = Date.now() + 15000;
            while (!Array.isArray(rooms)) {
                if (fatal) throw fatal;
                if (Date.now() >= scanDeadline) throw new Error('room summary timeout');
                await sleep(25);
            }
            for (const [roomId, until] of rejectedRoomUntil) if (until <= Date.now()) rejectedRoomUntil.delete(roomId);
            const picked = pickRoom(rooms, quest.quest, result.charId, new Set(rejectedRoomUntil.keys()));
            const matchNo = report.matches.length + 1;
            report.scans.push({ at: new Date().toISOString(), rooms: rooms.length, candidate: picked.room && picked.room.id, rejects: picked.evaluated.filter(item => item.reason !== 'accepted') });
            if (!picked.room) {
                line('  #' + matchNo + ' REFRESH rooms=' + rooms.length + ' (' + scanSummary(picked.evaluated) + '); ulang ' + (args.roomPollMs / 1000) + ' dtk');
                await sleep(args.roomPollMs);
                continue;
            }
            active = { match: matchNo, room: picked.room, players: picked.room.players.slice(), rosterConfirmed: picked.room.schemaComplete, started: false, ready: false, done: false, reason: null, outcome: null, startedAt: Date.now(), turn: 0, battle: new PveBattle({ charId: result.charId, strategy: 'B', skills: result.skills }) };
            captchaAttempts = 0;
            line('  #' + matchNo + ' JOIN room=' + active.room.id + (picked.otherEmblems == null ? ' (verifikasi roster)' : ' emblem=' + picked.room.players.filter(player => player.isEmblem).length));
            socket.joinRoom(active.room.id, '', pve.ver);
            const readyDeadline = Date.now() + args.hostStartTimeout;
            while (!active.done && !active.ready && Date.now() < readyDeadline) {
                if (fatal) throw fatal;
                await sleep(10);
            }
            if (!active.done && !active.ready) resetActive('ready_timeout');
            if (active && !active.done && !active.started) {
                // Host timer begins only after our READY command, never during CAPTCHA/join.
                const hostDeadline = active.readySentNs
                    ? Date.now() + Math.max(0, args.hostStartTimeout - Math.round(elapsedMs(active.readySentNs)))
                    : Date.now() + args.hostStartTimeout;
                while (!active.done && !active.started && Date.now() < hostDeadline) {
                    if (fatal) throw fatal;
                    await sleep(10);
                }
                if (!active.done && !active.started) resetActive('host_start_timeout');
            }
            if (active && !active.done && active.started && !args.captureBattle) {
                const battleDeadline = Date.now() + args.hostStartTimeout * 2;
                while (!active.done && Date.now() < battleDeadline) {
                    if (fatal) throw fatal;
                    await sleep(10);
                }
                if (!active.done) resetActive('battle_timeout');
            }
            if (active.room && !active.outcome) socket.leaveRoom(active.room.id);
            const summary = { match: active.match, roomId: active.room.id, otherEmblems: active.otherEmblems, emblemStatusUnknown: active.emblemStatusUnknown, rosterConfirmed: active.rosterConfirmed, rosterFields: active.rosterFields, roomEvents: active.roomEvents, ready: active.ready, outcome: active.outcome || 'retry', reason: active.reason, joinAcceptedToReadyMs: active.joinAcceptedToReadyMs, latencyWarning: active.latencyWarning, lastAction: active.lastAction, battleCommandLatencyMs: active.battleCommandLatencyMs, durationMs: Date.now() - active.startedAt, battle: bufferedBattle.splice(0) };
            report.matches.push(summary);
            // Force a fresh energy read after every joined room/battle attempt.
            lastEnergyCheckAt = 0;
            saveReport();
            if (summary.outcome === 'battle_finish' || summary.outcome === 'battle_win') line('  #' + summary.match + ' WIN ' + String(args.boss).toUpperCase() + ' (' + summary.outcome + ')');
            else if (summary.outcome === 'battle_lose') line('  #' + summary.match + ' LOSE ' + String(args.boss).toUpperCase());
            else line('  #' + summary.match + ' RETRY (' + (summary.reason || summary.outcome) + ')');
            active = null;
        }
    } catch (error) {
        report.error = error.message;
        process.exitCode = 1;
        throw error;
    } finally {
        saveReport();
        if (socket) socket.close();
        await solver.close();
    }
}

// ---- Cerberus host-room: skill planning (auto-pick best from the character's equipped deck) ----
const DEFENSE_SKILLS = ['39', '854', '84'];          // Evasion, Aphrodite's Blessing, Refresh
const OPENER_SKILLS = ['2004', '345'];                // Assault Class (once), Five Elements Seal (-25% HP)
const AOE_SKILLS = ['632', '633', '623', '728', '631', '112']; // Electric Smash, Thunder Explosion, Vacuum Bomb, Minotaur Sweep, Lightning Cannon, Moon Cleave
const AVOID_SKILLS = new Set(['652', '3']);           // Flute of God Killing (0 dmg while boss HP>=50%), Fat Woman (boss immune)
function skillNumber(skill) { return Number(String(skill && (skill.id ?? skill.skillId)).replace(/^skill/, '')); }
function skillKey(skill) { return String(skillNumber(skill)); }
function buildSkillDeck(skills) {
    const usable = (skills || []).filter(skill => {
        const n = skillNumber(skill);
        return Number.isFinite(n) && !AVOID_SKILLS.has(String(n)) && (n < 2000 || n === 2004);
    });
    const byId = new Map(usable.map(skill => [skillKey(skill), skill]));
    const pick = ids => ids.map(id => byId.get(id)).filter(Boolean);
    const defense = pick(DEFENSE_SKILLS);
    const opener = pick(OPENER_SKILLS);
    const aoe = pick(AOE_SKILLS);
    const used = new Set([...defense, ...opener, ...aoe].map(skillKey));
    const rest = usable.filter(skill => !used.has(skillKey(skill)));
    return { defense, opener, aoe, rest };
}
function chooseCerberusTurn(skills, enemyIds, turn, charName = '') {
    const head = enemyIds && enemyIds[0];
    if (isUchihaRazq(charName)) {
        const sequence = [
            pickNamedSkill(skills, ['kinjutsu evasion', 'evasion'], '39'),
            pickNamedSkill(skills, ['thunder explosion'], '633'),
            pickNamedSkill(skills, ['electric smash'], '632'),
            pickNamedSkill(skills, ['advanced aphrodite s blessing', 'aphrodite s blessing'], '854'),
        ].filter(Boolean);
        if (turn < sequence.length) return { skill: sequence[turn], targetId: head, label: 'razq_host_priority' };
        const fallback = rankedSkills(skills, sequence.map(skill => skill.id));
        const skill = fallback.length ? fallback[(turn - sequence.length) % fallback.length] : sequence.at(-1);
        return skill ? { skill, targetId: head, label: 'razq_host_fallback' } : { skill: null, targetId: head, label: 'weapon' };
    }
    const deck = buildSkillDeck(skills);
    const sequence = [];
    if (deck.defense[0]) sequence.push({ skill: deck.defense[0], label: 'defend' });
    if (deck.opener[0]) sequence.push({ skill: deck.opener[0], label: 'opener' });
    const cycle = [...deck.aoe, ...deck.opener.filter(skill => skillKey(skill) !== '2004'), ...deck.rest]
        .map(skill => ({ skill, label: deck.aoe.includes(skill) ? 'aoe' : 'damage' }));
    let choice = null;
    if (turn < sequence.length) choice = sequence[turn];
    else if (cycle.length) choice = cycle[(turn - sequence.length) % cycle.length];
    return choice ? { skill: choice.skill, targetId: head, label: choice.label } : { skill: null, targetId: head, label: 'weapon' };
}
function describeDeck(skills) {
    const deck = buildSkillDeck(skills);
    const ids = list => list.map(skillKey).join(',') || '-';
    return 'defense=' + ids(deck.defense) + ' opener=' + ids(deck.opener) + ' aoe=' + ids(deck.aoe) + ' damage=' + ids(deck.rest);
}
function normCharId(raw) {
    const s = String(raw ?? '').trim();
    return /^\d+$/.test(s) ? s.padStart(8, '0') : s;
}
function idList(raw) {
    // Accept ["001", ...] or [{character_id|char_id|id}, ...]
    if (!Array.isArray(raw)) return [];
    return raw.map(item => String(item && typeof item === 'object' ? (item.character_id ?? item.char_id ?? item.charId ?? item.id ?? '') : item ?? '')).filter(Boolean);
}
function evaluateLevel(level, minLevel) {
    const value = Number(level);
    if (!Number.isFinite(value)) return { ok: false, reason: 'level_unknown' };
    return value >= minLevel ? { ok: true } : { ok: false, reason: 'level_' + value + '<' + minLevel };
}

async function runHostRoom(args, account) {
    const { CaptchaSolver } = require('./lib/ns_captcha_solver.js');
    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'cerberus_host_' + new Date().toISOString().replace(/[:.]/g, '-') + '.log');
    const stamp = () => new Date().toISOString();
    const say = message => { line(message); try { fs.appendFileSync(logFile, stamp() + ' ' + message + '\n'); } catch (_) {} };
    const trace = (tag, data) => { try { fs.appendFileSync(logFile, stamp() + ' [raw] ' + tag + ' ' + JSON.stringify(data).slice(0, 1500) + '\n'); } catch (_) {} };
    const report = { generatedAt: stamp(), mode: 'host-room', boss: args.boss, level: args.level, minLevel: args.minLevel, account: account.username, matches: [], attempts: [], error: null };
    const reportFile = path.join(process.cwd(), 'cerberus_host_report.json');
    const saveReport = () => { try { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); } catch (_) {} };
    const solver = new CaptchaSolver({ headful: args.headful, log: say, username: account.username, password: account.password });
    const battleTimeoutMs = Number(process.env.NS_COOP_BATTLE_TIMEOUT) || 600000;
    const profileCache = new Map();
    let socket = null;
    try {
        say('  LOG ' + logFile);
        await solver.open();
        const result = await loginAccount(account, solver.webLoginData);
        if (!result.ok) throw new Error('Login gagal: ' + result.error);
        const hostLevel = evaluateLevel(result.level, args.minLevel);
        if (!hostLevel.ok) throw new Error('Level host tidak memenuhi syarat (' + hostLevel.reason + ').');
        const pve = await readPveInit(result.session);
        const quest = pve && findQuestId(pve.questList, args.boss, args.level);
        if (!pve || !quest || !pve.pvpServer || !pve.pvpServer[0]) throw new Error('PvE boss tidak tersedia.');
        const hostCost = Number(quest.energy[0]);
        const hostId = normCharId(result.charId);
        say('  HOST ' + result.charName + ' Lv' + result.level + ' energy=' + pve.energy + ' biaya_room=' + hostCost + ' quest=' + quest.quest);
        say('  DECK ' + describeDeck(result.equipped));
        if (!(pve.energy >= hostCost)) throw new Error('Energy host kurang (' + pve.energy + ' < ' + hostCost + ').');
        socket = await connectPve({ server: pve.pvpServer[0], sessionKey: result.session.sessionKey, charId: hostId, handoffToken: pve.handoffToken, handoffNonce: pve.handoffNonce, ver: pve.ver });
        let active = null;
        let fatal = null;
        let solvingCaptcha = false;
        let captchaAttempts = 0;
        let createRejectTimer = null;
        const clearCreateTimer = () => { if (createRejectTimer) { clearTimeout(createRejectTimer); createRejectTimer = null; } };
        const finish = (reason, outcome) => { if (!active || active.done) return; active.reason = active.reason || reason; if (outcome) active.outcome = outcome; active.done = true; };
        const sendCreate = () => socket.createRoom({ password: '', mode: 3, quest: quest.quest, ver: pve.ver });

        const evaluatePlayer = (rawId, info) => {
            const id = normCharId(rawId);
            if (!active || !id || id === hostId) return;
            const existing = active.players.get(id);
            if (existing) {
                if (existing.status === 'invalid' && Date.now() - (existing.kickedAt || 0) >= 2500) {
                    existing.kickedAt = Date.now();
                    active.pendingKicks.add(id);
                    say('  RE-KICK char=' + id + ' (masih di room)');
                    socket.kickPlayer(id);
                }
                return;
            }
            const cached = profileCache.get(id);
            const entry = { status: 'checking', level: null, name: (info && info.char_name) || (cached && cached.name) || null, kickedAt: 0 };
            active.players.set(id, entry);
            const decide = (level, name) => {
                if (!active || active.players.get(id) !== entry) return;
                const numericLevel = Number(level);
                entry.level = Number.isFinite(numericLevel) ? numericLevel : null;
                if (name) entry.name = name;
                if (entry.level != null) profileCache.set(id, { level: entry.level, name: entry.name });
                const verdict = evaluateLevel(entry.level, args.minLevel);
                if (verdict.ok) {
                    entry.status = 'valid';
                    say('  VALID char=' + id + (entry.name ? ' (' + entry.name + ')' : '') + ' Lv' + entry.level);
                    maybeStart();
                } else {
                    entry.status = 'invalid';
                    entry.kickedAt = Date.now();
                    active.pendingKicks.add(id);
                    active.readyIds.delete(id);
                    say('  KICK char=' + id + (entry.name ? ' (' + entry.name + ')' : '') + ' (' + verdict.reason + ')');
                    socket.kickPlayer(id);
                }
            };
            if (info && Number.isFinite(Number(info.char_level))) { decide(info.char_level, info.char_name); return; }
            if (cached && Number.isFinite(Number(cached.level))) { decide(cached.level, cached.name); return; }
            c.amf('CharacterDAO.getCharacterProfileById', [result.session.sessionKey, id, true])
                .then(r => { const d = (r && r.body && r.body.result) || {}; decide(d.character_level ?? d.characterLevel ?? d.level, d.character_name); })
                .catch(() => decide(null, null));
        };
        const syncMembers = (rawIds, infoMap) => {
            if (!active || !active.roomId) return;
            const members = new Set(rawIds.map(normCharId).filter(id => id && id !== hostId));
            for (const id of members) evaluatePlayer(id, infoMap && infoMap.get(id));
            if (!active.started) {
                for (const id of [...active.players.keys()]) {
                    if (members.has(id)) continue;
                    active.players.delete(id);
                    active.readyIds.delete(id);
                    active.pendingKicks.delete(id);
                    say('  LEAVE char=' + id);
                }
            }
        };
        const maybeStart = () => {
            if (!active || active.started || active.done || !active.roomId) return;
            const valid = [...active.players.entries()].filter(([, p]) => p.status === 'valid').map(([id]) => id);
            if (valid.length !== 2 || active.players.size !== 2) return;
            if (!valid.every(id => active.readyIds.has(id))) return;
            active.started = true;
            active.startSentAt = Date.now();
            say('  READY 3/3 valid (' + valid.join(',') + '). HOST START CERBERUS');
            socket.startGame();
        };

        socket.on('error', () => { fatal = fatal || new Error('Socket error'); });
        socket.on('si_error', () => { fatal = fatal || new Error('Socket.IO error'); });
        socket.on('close', () => { if (!fatal) fatal = new Error('Socket terputus'); });
        socket.on('captcha_required', () => {
            if (!active || solvingCaptcha || active.done) return;
            clearCreateTimer();
            if (++captchaAttempts > 2) { fatal = new Error('CAPTCHA berulang; berhenti agar akun tidak terkunci.'); return; }
            solvingCaptcha = true;
            say('  CAPTCHA verifikasi create room...');
            solver.solve('pve').then(async outcome => {
                const decision = captchaRetryDecision(outcome);
                if (decision.action === 'stop') {
                    fatal = new Error('CAPTCHA ditolak server. fails_left=' + (decision.failsLeft == null ? 'unknown' : decision.failsLeft) + '. Selesaikan manual sebelum lanjut.');
                    return;
                }
                if (decision.action === 'retry') {
                    say('  CAPTCHA ditolak; fails_left=' + decision.failsLeft + '. Ulang create room.');
                    await sleep(1000);
                    if (active && !active.done && !active.roomId) sendCreate();
                    return;
                }
                await sleep(750);
                if (active && !active.done && !active.roomId) { say('  CAPTCHA OK; ulang create room'); sendCreate(); }
            }).catch(error => finish('captcha_error:' + String(error.message || error).slice(0, 80))).finally(() => { solvingCaptcha = false; });
        });
        socket.on('join_room', data => {
            trace('join_room', data);
            if (!active || !data) return;
            if (!active.roomId) {
                if (Number(data.status) === 1 && data.room_name && data.room_name !== 'lobby') {
                    clearCreateTimer();
                    active.roomId = String(data.room_name);
                    active.createdAt = Date.now();
                    say('  HOST ROOM=' + active.roomId + ' | menunggu 2 pemain Lv>=' + args.minLevel);
                } else if (data.room_name !== 'lobby' && !createRejectTimer) {
                    createRejectTimer = setTimeout(() => { createRejectTimer = null; if (active && !active.roomId && !solvingCaptcha) finish('create_rejected(status=' + data.status + ')'); }, 2000);
                }
                return;
            }
            const ids = idList(data.ta);
            if (ids.length) syncMembers(ids, null);
            else if (data.characterId != null && normCharId(data.characterId) !== hostId) syncMembers([...active.players.keys(), normCharId(data.characterId)], null);
        });
        socket.on('get_room_summary', data => {
            if (!active || !active.roomId || active.done) return;
            const rooms = roomArray(data);
            if (!Array.isArray(rooms)) return;
            const room = rooms.find(r => String(r.room_name) === active.roomId);
            if (!room) {
                // Server omits 3/3 full rooms from get_room_summary; only count missing when room is empty.
                if (!active.started && active.players.size === 0 && ++active.missing >= 15) finish('room_missing');
                return;
            }
            active.missing = 0;
            const infoMap = new Map((data.char_array || []).map(ch => [normCharId(ch.char_id), ch]));
            syncMembers(idList(room.ta), infoMap);
            maybeStart();
        });
        const onReadyList = data => {
            if (!active || !data) return;
            trace('ready', data);
            const ids = idList(data.character_array).map(normCharId).filter(id => id && id !== hostId);
            for (const id of ids) evaluatePlayer(id, null);
            active.readyIds = new Set(ids.filter(id => active.players.get(id)?.status !== 'invalid'));
            maybeStart();
        };
        socket.on('ready', onReadyList);
        socket.on('cancel_ready', onReadyList);
        socket.on('reset_ready', () => { if (active && !active.started) active.readyIds.clear(); });
        socket.on('leave_room', data => {
            trace('leave_room', data);
            if (!active || !data) return;
            const id = normCharId(data.character_id ?? data.characterId ?? data.charId ?? data.id ?? '');
            if (id && id !== hostId && !active.started) {
                active.players.delete(id);
                active.readyIds.delete(id);
                active.pendingKicks.delete(id);
                say('  LEAVE char=' + id);
            }
        });
        socket.on('kick_user', data => {
            trace('kick_user', data);
            if (!active || active.done) return;
            const id = normCharId(data && (data.character_id ?? data.characterId ?? data.charId ?? data.id) || '');
            // Server echoes our own kick (often without leading zeros); normalize and clear player slot so repeat joiners are re-kicked.
            if (active.pendingKicks.size || (id && active.players.get(id)?.status === 'invalid')) {
                const kicked = (id && active.pendingKicks.has(id)) ? id : (active.pendingKicks.values().next().value || id);
                active.pendingKicks.delete(kicked);
                active.players.delete(kicked);
                active.readyIds.delete(kicked);
                say('  KICK SELESAI char=' + kicked + '; lanjut tunggu pemain lain');
                return;
            }
            finish('kick_user');
        });
        for (const event of ['force_lobby', 'destroy_battle']) socket.on(event, data => { trace(event, data); if (active && !active.done) finish(event + (data && (data.reason || data.message) ? ':' + (data.reason || data.message) : '')); });
        const markBattleStarted = () => { if (active && !active.battleStarted) { active.battleStarted = true; active.battleStartedAt = Date.now(); say('  START CERBERUS (battle masuk)'); } };
        socket.on('battle_start', markBattleStarted);
        socket.on('battle_msg', raw => {
            const message = messageValue(raw);
            if (!active || !message) return;
            trace('battle_msg', message);
            if (['join', 'start', 'start_atb'].includes(message.state)) markBattleStarted();
            active.battleStates.push(message.state || message.event);
            if (active.battleStates.length > 400) active.battleStates.shift();
            if (message.state === 'battle_finish' || message.state === 'battle_win') {
                const winners = idList(message.winnerIDs || message.winner_ids || message.winners).map(normCharId);
                const outcome = winners.length ? (winners.includes(hostId) ? 'win' : 'lose') : (message.state === 'battle_win' ? 'win' : 'finish_unknown');
                active.score = message.score; active.reward = message.reward;
                finish('battle_' + message.state, outcome);
                return;
            }
            if (message.state === 'battle_lose') { finish('battle_lose', 'lose'); return; }
            const step = active.battle.nextStep(message);
            if (step.type === 'ready') socket.battleReady();
            else if (step.type === 'startAtb') socket.startAtb();
            else if (step.type === 'actionReady') socket.actionReady();
            else if (step.type === 'actionFinish') socket.actionFinish(step.charDead);
            else if (step.type === 'turn') {
                const turn = chooseCerberusTurn(result.equipped, active.battle.enemyIds, active.turn++, result.charName);
                const action = turn.skill ? 'skill' : 'weapon_attack';
                socket.battleCommand(hostId, action, turn.skill && turn.skill.skillId, turn.targetId);
                active.actions.push(turn.label + ':' + (turn.skill ? turn.skill.skillId : 'weapon_attack'));
                say('  TURN ' + active.turn + ' ' + turn.label + ' ' + (turn.skill ? turn.skill.skillId : 'weapon_attack') + ' -> ' + turn.targetId);
            }
        });

        socket.auth();
        await socket.waitAuth(15000);
        if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk.');
        socket.joinLobby();
        say('  PVE AUTH OK');
        let roomNo = 0;
        while (!fatal && report.matches.length < args.maxMatches) {
            const energyNow = (await readPveInit(result.session) || {}).energy;
            if (!(energyNow >= hostCost)) { say('  STOP: energy habis (' + energyNow + ' < ' + hostCost + ')'); break; }
            captchaAttempts = 0;
            active = { roomId: null, createdAt: null, players: new Map(), readyIds: new Set(), pendingKicks: new Set(), missing: 0, started: false, startSentAt: null, battleStarted: false, battleStartedAt: null, done: false, outcome: null, reason: null, turn: 0, actions: [], battleStates: [], battle: new PveBattle({ charId: hostId, strategy: 'B', skills: result.equipped }) };
            const matchStartedAt = Date.now();
            say('  #' + (++roomNo) + ' CREATE ROOM CERBERUS EXTREME (energy ' + energyNow + ')');
            sendCreate();
            let lastPoll = 0;
            let lastLogAt = 0;
            let lastStatusText = '';
            let restarted = false;
            while (!active.done) {
                if (fatal) throw fatal;
                const now = Date.now();
                if (active.roomId && !active.started && now - lastPoll >= 2000) {
                    lastPoll = now;
                    for (const [id, p] of active.players.entries()) {
                        if (p.status === 'invalid' && now - (p.kickedAt || 0) >= 2500) evaluatePlayer(id, null);
                    }
                    if (active.players.size < 2) socket.getRoomSummary();
                    const valid = [...active.players.values()].filter(p => p.status === 'valid').length;
                    const statusText = '  ROOM ' + active.roomId + ' pemain=' + active.players.size + ' valid=' + valid + '/2 ready=' + active.readyIds.size + '/2';
                    if (statusText !== lastStatusText || now - lastLogAt >= 15000) {
                        lastStatusText = statusText;
                        lastLogAt = now;
                        say(statusText);
                    }
                }
                if (!active.roomId && !solvingCaptcha && now - matchStartedAt > 90000) finish('create_timeout');
                else if (active.roomId && !active.started && now - active.createdAt > args.hostWait) finish('wait_players_timeout');
                else if (active.started && !active.battleStarted) {
                    if (!restarted && now - active.startSentAt > 8000) { restarted = true; say('  START belum diterima server, kirim ulang'); socket.startGame(); }
                    if (now - active.startSentAt > args.startTimeout) finish('start_timeout');
                } else if (active.battleStarted && now - active.battleStartedAt > battleTimeoutMs) finish('battle_timeout', 'timeout');
                await sleep(100);
            }
            if (active.roomId && active.outcome == null) socket.leaveRoom(active.roomId);
            const after = await readPveInit(result.session);
            const summary = { match: roomNo, roomId: active.roomId, outcome: active.outcome || 'retry', reason: active.reason, battleStarted: active.battleStarted, players: [...active.players.entries()].map(([id, p]) => ({ id, name: p.name, level: p.level, status: p.status })), actions: active.actions, score: active.score, reward: active.reward, energyBefore: energyNow, energyAfter: after && after.energy, durationMs: Date.now() - matchStartedAt, battleStates: active.battleStates.slice(-60) };
            report.attempts.push(summary);
            if (active.battleStarted) report.matches.push(summary);
            saveReport();
            if (active.outcome === 'win') say('  #' + roomNo + ' WIN CERBERUS');
            else if (active.outcome === 'lose') say('  #' + roomNo + ' LOSE CERBERUS');
            else say('  #' + roomNo + ' RETRY (' + (active.reason || active.outcome) + ')');
            active = null;
            await sleep(1500);
        }
        say('  SELESAI: ' + report.matches.length + ' match battle. Log: ' + logFile);
    } catch (error) {
        report.error = error.message;
        process.exitCode = 1;
        throw error;
    } finally {
        saveReport();
        if (socket) socket.close();
        await solver.close();
    }
}

(async () => {
    if (process.argv.includes('--selftest')) return;
    const args = parseArgs(process.argv.slice(2));
    const accounts = parseAccountsFile(args.accounts, 1);
    if (args.dryRun) await runDryRun(args, accounts[0]);
    else if (args.hostRoom) await runHostRoom(args, accounts[0]);
    else await runLive(args, accounts[0]);
})().catch(error => { line('STOP: ' + error.message); process.exitCode = 1; });

module.exports = { parseArgs, parseAccountsFile, findQuestId, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, buildSkillDeck, describeDeck, normCharId, idList, evaluateLevel, runDryRun, runLive, runHostRoom };
