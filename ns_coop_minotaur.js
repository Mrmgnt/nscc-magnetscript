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
const BOSS_ENEMY_ID = { minotaur: 'enemy533', cerberus: 'enemy546' };
const LEVEL_INDEX = { normal: 1, hard: 2, extreme: 3, extream: 3 };
const AUTO_SKILL_PRIORITY = ['2004', '632', '638', '623', '728', '345', '854', '151', '39'];
const AOE_SKILL_IDS = String((process.env && process.env.NS_COOP_AOE_SKILL_IDS) || '632,638,623,728').split(',').map(id => id.trim()).filter(Boolean);
const STUN_SKILL_ID = String((process.env && process.env.NS_COOP_STUN_SKILL_ID) || '345').trim();

function parseArgs(argv) {
    const args = {
        boss: 'cerberus', level: 'extreme', accounts: 'coop_accounts.txt', maxMatches: Infinity,
        roomPollMs: 1500, hostStartTimeout: 180000, dryRun: false, captureBattle: false, hostRoom: false, headful: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--boss') args.boss = argv[++i];
        else if (key === '--level') args.level = argv[++i];
        else if (key === '--accounts') args.accounts = argv[++i];
        else if (key === '--max-matches') args.maxMatches = Number(argv[++i]);
        else if (key === '--room-poll-ms') args.roomPollMs = Number(argv[++i]);
        else if (key === '--host-start-timeout') args.hostStartTimeout = Number(argv[++i]);
        else if (key === '--dry-run') args.dryRun = true;
        else if (key === '--capture-battle') args.captureBattle = true;
        else if (key === '--host-room') args.hostRoom = true;
        else if (key === '--headful') args.headful = true;
        else throw new Error('Argumen tidak dikenal: ' + key);
    }
    if (!(args.maxMatches > 0) || (!Number.isFinite(args.maxMatches) && args.maxMatches !== Infinity)) throw new Error('--max-matches harus angka positif.');
    for (const [key, value] of [['--room-poll-ms', args.roomPollMs], ['--host-start-timeout', args.hostStartTimeout]]) {
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
    try {
        const detail = await c.amf('CharacterDAO.getCharacterById', [session.sessionKey, row[0]]);
        const data = detail && detail.body && detail.body.gk ? (detail.body.result || {}) : {};
        const owned = new Set((data.character_skills || data.character_skill || []).map(String));
        const equipped = (data.character_equipped_skills || []).map(String).filter(id => owned.has(id));
        const ordered = [...AUTO_SKILL_PRIORITY.filter(id => owned.has(id)), ...equipped.filter(id => !AUTO_SKILL_PRIORITY.includes(id))];
        skills = [...new Set(ordered)].map((id, index) => ({ skillId: 'skill' + id, id, damage: 1000 - index, once: id === '2004' }));
    } catch (_) {}
    return {
        ok: true, session, charId: String(row[0]), charName: row[1], level: Number(row[2]) || null,
        isEmblem: Boolean(session.isEmblem || Number(session.accountType) === 2), skills,
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
function pickRoom(rooms, questId, botCharId) {
    const evaluated = [];
    for (const raw of (Array.isArray(rooms) ? rooms : [])) {
        const room = normalizeRoom(raw, questId);
        if (!room || !room.id || room.quest !== Number(questId)) {
            const enemies = Array.isArray(raw && raw.tb) ? raw.tb.join(',') : '';
            evaluated.push({ reason: 'quest_or_id', quest: room && room.quest, enemies });
            continue;
        }
        if (room.hasPassword) { evaluated.push({ roomId: room.id, reason: 'password_required' }); continue; }
        if (room.slots != null && room.slots < 1) { evaluated.push({ roomId: room.id, reason: 'room_full' }); continue; }
        // Room summary often omits roster. Join only to verify it; READY stays blocked
        // until join_room confirms another Emblem player.
        if (!room.schemaComplete) { evaluated.push({ roomId: room.id, reason: 'verify_after_join', room, otherEmblems: null }); continue; }
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
        const bufferedBattle = [];
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
            if (++captchaAttempts > 1) { resetActive('captcha_retry_limit'); return; }
            solvingCaptcha = true;
            line('  #' + active.match + ' CAPTCHA verifikasi join...');
            solver.solve('pve').then(async ok => {
                if (!ok) { fatal = new Error('CAPTCHA ditolak server. Selesaikan CAPTCHA secara manual sebelum menjalankan ulang agar akun tidak terkunci.'); return; }
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
        const applyRoster = data => {
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
            active.otherEmblems = countOtherEmblems(players, result.charId);
            active.emblemStatusUnknown = players.some(player => player.isEmblem == null);
            // Public rooms expose only character IDs on some PvE packets. User opted
            // to continue those rooms, while explicit non-Emblem rosters stay blocked.
            if (!active.emblemStatusUnknown && active.otherEmblems < 1 && !active.started) resetActive('emblem_player_left');
            return true;
        };
        const sendReady = () => {
            if (!active || active.done || active.ready) return;
            socket.ready(result.charId);
            active.readySentNs = nowNs();
            active.joinAcceptedToReadyMs = elapsedMs(active.joinAcceptedNs);
            if (active.joinAcceptedToReadyMs > 250) active.latencyWarning = 'ready lambat';
            active.ready = true;
            line('  #' + active.match + ' READY room=' + active.room.id + ' (' + active.joinAcceptedToReadyMs.toFixed(1) + ' ms)' + (active.rosterConfirmed ? '' : ' roster=menunggu') + '; tunggu host max ' + Math.round(args.hostStartTimeout / 1000) + ' dtk');
        };
        socket.on('join_room', data => {
            if (!active || active.done) return;
            if (active.joinAccepted) { applyRoster(data); return; }
            if (Number(data && data.status) !== 1 || data.room_name === 'lobby') {
                // Some servers emit join rejection just before captcha_required.
                // Hold state briefly so CAPTCHA can resend this same join command.
                if (!active.captchaRequested && !joinRejectTimer) watchJoinResponse('join_rejected', 1500);
                return;
            }
            if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
            active.joinAccepted = true;
            active.joinAcceptedNs = nowNs();
            applyRoster(data);
            if (active && !active.done) sendReady();
        });
        socket.on('ready', applyRoster);
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
            if (message.state === 'battle_lose') { resetActive('battle_lose'); return; }
            const step = active.battle.nextStep(message);
            if (step.type === 'ready') socket.battleReady();
            else if (step.type === 'startAtb') socket.startAtb();
            else if (step.type === 'actionReady') socket.actionReady();
            else if (step.type === 'actionFinish') socket.actionFinish(step.charDead);
            else if (step.type === 'turn' && !args.captureBattle) {
                active.commandReceivedNs = nowNs();
                const turn = chooseMinotaurTurn(result.skills, active.battle.enemyIds, active.turn++);
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
            const picked = pickRoom(rooms, quest.quest, result.charId);
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

async function runHostRoom(args, account) {
    const { CaptchaSolver } = require('./lib/ns_captcha_solver.js');
    const solver = new CaptchaSolver({ headful: args.headful, log: line, username: account.username, password: account.password });
    let socket = null;
    try {
        await solver.open();
        const result = await loginAccount(account, solver.webLoginData);
        if (!result.ok) throw new Error('Login gagal: ' + result.error);
        const pve = await readPveInit(result.session);
        const quest = pve && findQuestId(pve.questList, args.boss, args.level);
        if (!pve || !quest || !pve.pvpServer || !pve.pvpServer[0]) throw new Error('PvE boss Extreme tidak tersedia.');
        if (!pickSkill(result.skills, '39')) throw new Error('Kinjutsu: Evasion (skill39) tidak ditemukan pada karakter host.');
        socket = await connectPve({ server: pve.pvpServer[0], sessionKey: result.session.sessionKey, charId: result.charId, handoffToken: pve.handoffToken, handoffNonce: pve.handoffNonce, ver: pve.ver });
        let active = null;
        let fatal = null;
        let solvingCaptcha = false;
        const lookup = new Map();
        const sleepUntil = async predicate => { while (!predicate()) { if (fatal) throw fatal; await sleep(50); } };
        const rawPlayers = data => data && (data.character_array || data.characters || data.players || data.player_array);
        const getPlayerInfo = async (raw, charId) => {
            const fromRoom = normalizePlayer(raw);
            if (fromRoom && fromRoom.level != null) return fromRoom;
            const detail = await c.amf('CharacterDAO.getCharacterById', [result.session.sessionKey, charId]);
            const body = detail && detail.body || {};
            const data = body.result || body.character || body;
            const level = Number(data.character_level ?? data.characterLevel ?? data.level);
            const accountType = data.accountType ?? data.account_type ?? data.userType ?? data.user_type ?? data.isEmblem ?? data.is_emblem;
            return { charId: String(charId), level: Number.isFinite(level) ? level : null, isEmblem: boolEmblem(accountType) || Number(accountType) === 2 };
        };
        const validateRoster = data => {
            if (!active) return;
            const roster = rawPlayers(data);
            if (!Array.isArray(roster)) return;
            for (const raw of roster) {
                const id = String((raw && typeof raw === 'object' ? raw.character_id ?? raw.characterId ?? raw.charId ?? raw.id : raw) ?? '');
                if (!id || id === String(result.charId) || lookup.has(id)) continue;
                lookup.set(id, { status: 'checking' });
                getPlayerInfo(raw, id).then(player => {
                    if (!active) return;
                    const allowed = player.isEmblem === true && Number(player.level) > 60;
                    lookup.set(id, { status: allowed ? 'valid' : 'invalid', player });
                    if (!allowed) {
                        line('  KICK char=' + id + ' (butuh Emblem + Lv >60; dapat Emblem=' + Boolean(player.isEmblem) + ', Lv=' + (player.level ?? '?') + ')');
                        active.pendingKicks.add(id);
                        socket.kickPlayer(id);
                    } else {
                        line('  VALID char=' + id + ' (Emblem, Lv ' + player.level + ')');
                    }
                    maybeStart();
                }).catch(() => {
                    if (!active) return;
                    lookup.set(id, { status: 'invalid' });
                    line('  KICK char=' + id + ' (data Emblem/level tidak terbaca)');
                    socket.kickPlayer(id);
                });
            }
        };
        const markReady = data => {
            if (!active) return;
            const direct = data && (data.character_id ?? data.characterId ?? data.charId ?? data.id);
            if (direct != null) active.ready.add(String(direct));
            const roster = rawPlayers(data);
            if (Array.isArray(roster)) for (const raw of roster) {
                const id = String((raw && typeof raw === 'object' ? raw.character_id ?? raw.characterId ?? raw.charId ?? raw.id : raw) ?? '');
                const flag = raw && typeof raw === 'object' && (raw.ready ?? raw.is_ready ?? raw.isReady);
                if (id && (flag === true || flag === 1 || flag === '1' || !direct)) active.ready.add(id);
            }
        };
        const maybeStart = () => {
            if (!active || active.started) return;
            const valid = [...lookup.entries()].filter(([, value]) => value.status === 'valid').map(([id]) => id);
            if (valid.length !== 2 || !active.ready.has(String(result.charId)) || !valid.every(id => active.ready.has(id))) return;
            active.started = true;
            line('  READY 3/3 valid. HOST START CERBERUS');
            socket.startGame();
        };
        socket.on('error', () => { fatal = fatal || new Error('Socket error'); });
        socket.on('si_error', () => { fatal = fatal || new Error('Socket.IO error'); });
        socket.on('close', () => { if (!fatal) fatal = new Error('Socket terputus'); });
        socket.on('captcha_required', () => {
            if (!active || solvingCaptcha) return;
            solvingCaptcha = true;
            solver.solve('pve').then(async ok => {
                if (!ok) { fatal = new Error('CAPTCHA ditolak server. Selesaikan manual sebelum lanjut.'); return; }
                await sleep(750);
                if (active && !active.roomId) socket.createRoom({ password: '', mode: 3, quest: quest.quest, ver: pve.ver });
            }).finally(() => { solvingCaptcha = false; });
        });
        socket.on('join_room', data => {
            if (!active || Number(data && data.status) !== 1 || data.room_name === 'lobby') return;
            if (!active.roomId) {
                active.roomId = String(data.room_name);
                active.ready.add(String(result.charId));
                line('  HOST ROOM=' + active.roomId + ' | tunggu Emblem Lv >60 | refresh 1 dtk');
                socket.ready(result.charId);
            }
            validateRoster(data);
        });
        socket.on('ready', data => { validateRoster(data); markReady(data); maybeStart(); });
        socket.on('leave_room', data => { if (!active) return; const id = String(data && (data.character_id ?? data.characterId ?? data.charId ?? data.id) || ''); if (id) { lookup.delete(id); active.ready.delete(id); } });
        for (const event of ['force_lobby', 'destroy_battle']) socket.on(event, data => {
            if (active) { active.done = true; active.reason = event + (data && (data.reason || data.message) ? ':' + (data.reason || data.message) : ''); }
        });
        socket.on('kick_user', data => {
            if (!active) return;
            const id = String(data && (data.character_id ?? data.characterId ?? data.charId ?? data.id) || '');
            // Server echoes host's own kick command. Keep hosting after a rejected player leaves.
            // Some server packets echo the host ID instead of kicked character ID.
            // A pending local kick is therefore authoritative for this event.
            if ((id && lookup.get(id)?.status === 'invalid') || active.pendingKicks.size) {
                const kickedId = active.pendingKicks.has(id) ? id : active.pendingKicks.values().next().value;
                active.pendingKicks.delete(kickedId);
                lookup.delete(kickedId);
                active.ready.delete(kickedId);
                line('  KICK SELESAI char=' + kickedId + ' (server=' + (id || '?') + '); lanjut tunggu pemain lain');
                return;
            }
            active.done = true;
            active.reason = 'kick_user';
        });
        socket.on('battle_msg', raw => {
            const message = messageValue(raw);
            if (!active || !message) return;
            if (['join', 'start', 'start_atb'].includes(message.state) && !active.battleStarted) { active.battleStarted = true; line('  START CERBERUS'); }
            if (message.state === 'battle_finish' || message.state === 'battle_win') { active.done = true; active.won = true; return; }
            const step = active.battle.nextStep(message);
            if (step.type === 'ready') socket.battleReady();
            else if (step.type === 'startAtb') socket.startAtb();
            else if (step.type === 'actionReady') socket.actionReady();
            else if (step.type === 'actionFinish') socket.actionFinish(step.charDead);
            else if (step.type === 'turn') {
                const turn = chooseMinotaurTurn(result.skills, active.battle.enemyIds, active.turn++, true);
                line('  HOST SKILL ' + turn.label + ' skill' + (turn.skill ? turn.skill.id : 'weapon'));
                socket.battleCommand(result.charId, turn.skill ? 'skill' : 'weapon_attack', turn.skill && turn.skill.id, turn.targetId);
            }
        });
        socket.on('battle_start', () => { if (active) { active.battleStarted = true; line('  START CERBERUS'); } });
        socket.auth();
        await socket.waitAuth(15000);
        if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk.');
        socket.joinLobby();
        line('  PVE AUTH OK');
        let roomNo = 0;
        while (!fatal) {
            lookup.clear();
            active = { roomId: null, ready: new Set(), pendingKicks: new Set(), started: false, done: false, won: false, battleStarted: false, turn: 0, battle: new PveBattle({ charId: result.charId, strategy: 'B', skills: result.skills }) };
            line('  #' + (++roomNo) + ' CREATE ROOM CERBERUS EXTREME');
            socket.createRoom({ password: '', mode: 3, quest: quest.quest, ver: pve.ver });
            const ticker = setInterval(() => { if (active && active.roomId) { socket.getRoomSummary(); line('  ROOM ' + active.roomId + ' valid=' + [...lookup.values()].filter(x => x.status === 'valid').length + '/2 ready=' + active.ready.size + '/3'); } }, 1000);
            await sleepUntil(() => active.done);
            clearInterval(ticker);
            if (active.won) line('  WIN CERBERUS'); else line('  RETRY (' + (active.reason || 'room_reset') + ')');
            if (active.roomId) socket.leaveRoom(active.roomId);
            await sleep(1000);
        }
    } finally {
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

module.exports = { parseArgs, parseAccountsFile, findQuestId, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, chooseMinotaurTurn, runDryRun, runLive };