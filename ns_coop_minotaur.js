#!/usr/bin/env node
'use strict';
/**
 * Public co-op boss runner. One account joins existing rooms only.
 * It never creates rooms or starts games. Battle commands stay disabled until
 * live target and skill mappings are captured and verified.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const c = require('./nsclient.js');
const { PveSocket } = require('./lib/ns_pve_socket.js');
const { PveBattle } = require('./lib/ns_pve_battle.js');
const { sendHermesReport, formatCerberusReport } = require('./lib/ns_hermes_notify.js');

const USE_COLOR = Boolean(process && process.stdout && process.stdout.isTTY);
function nowTime() {
    const d = new Date();
    const p = v => String(v).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function paint(code, text) { return USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text; }
function formatLogLine(message) {
    const raw = String(message ?? '');
    const trimmed = raw.trim();
    if (!trimmed) return '';
    let color = '37';
    if (/\b(WIN|OK|terkirim|CAPTCHA OK)\b/i.test(trimmed)) color = '1;32';
    else if (/\b(LOSE|STOP:|ERROR|gagal|ditolak|putus|terputus|SELF DEAD|TEAMMATE DEAD)\b/i.test(trimmed)) color = '1;31';
    else if (/\b(START|READY|HOST|QUICKMATCH|DECK|CREATE ROOM|HERMES|SELF REVIVED)\b/i.test(trimmed)) color = '1;36';
    else if (/\b(CAPTCHA|captcha:)\b/i.test(trimmed)) color = '35';
    else if (/\b(JOIN|WAIT|VALID|KICK|LEAVE|LEAVE_BATTLE|ROOM|SERVER|SKIP|SPECTATE)\b/i.test(trimmed)) color = '33';
    else if (/\b(SKILL|TURN|RECV|SENT)\b/i.test(trimmed)) color = '34';
    else if (/\bREFRESH\b/i.test(trimmed)) color = '90';
    return `${paint('90', '[' + nowTime() + ']')}  ${paint(color, trimmed)}`;
}
const line = message => {
    const out = formatLogLine(message);
    if (!out) { console.log(''); return; }
    console.log(out);
};
const divider = label => {
    console.log('');
    if (label) console.log(paint('90', '---------------------------------------------------------------------- ' + label));
    else console.log(paint('90', '----------------------------------------------------------------------'));
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Live room list maps public Co-op bosses to their enemy IDs.
const BOSS_ENEMY_ID = { minotaur: 'enemy501', cerberus: 'enemy533', griffin: 'enemy546', wanyudo: 'enemy561', gashadokuro: 'enemy570' };
const LEVEL_INDEX = { normal: 1, hard: 2, extreme: 3, extream: 3 };
const AUTO_SKILL_PRIORITY = ['633', '632', '638', '623', '728', '345', '629', '854', '151', '39'];
const AOE_SKILL_IDS = String((process.env && process.env.NS_COOP_AOE_SKILL_IDS) || '632,638,623,728').split(',').map(id => id.trim()).filter(Boolean);
const STUN_SKILL_ID = String((process.env && process.env.NS_COOP_STUN_SKILL_ID) || '345').trim();
const DEFAULT_BATTLE_TIMEOUT_MS = 3600000;
const MAX_KICKS_PER_ROOM = 2;
const MAX_LOW_LEVEL_RM_SEEN = 2;
const KICK_SKIP_MS = 600000;

function incrementBoundedCounter(counterMap, key, now = Date.now(), ttlMs = KICK_SKIP_MS, metaMatch = null) {
    const k = key == null ? '' : String(key).trim();
    if (!k || !counterMap || typeof counterMap.get !== 'function' || typeof counterMap.set !== 'function') return null;
    const prev = counterMap.get(k);
    const expired = prev && Number.isFinite(prev.updatedAt) && (now - prev.updatedAt > ttlMs);
    const metaChanged = typeof metaMatch === 'function' ? Boolean(prev && !metaMatch(prev)) : false;
    const count = (!prev || expired || metaChanged) ? 1 : prev.count + 1;
    return { key: k, count, prev };
}

function recordRoomKick(kickCounts, roomId, masterId = null, now = Date.now(), maxKicks = MAX_KICKS_PER_ROOM, ttlMs = KICK_SKIP_MS) {
    const masterKey = masterId ? normCharId(masterId) : '';
    const step = incrementBoundedCounter(kickCounts, roomId, now, ttlMs, prev => !prev.masterId || !masterKey || prev.masterId === masterKey);
    if (!step) return { count: 0, blocked: false };
    const blocked = step.count >= maxKicks;
    if (blocked) kickCounts.delete(step.key);
    else kickCounts.set(step.key, { count: step.count, masterId: masterKey || (step.prev && step.prev.masterId) || '', updatedAt: now });
    return { count: step.count, blocked };
}

function recordLowLevelMaster(lowCounts, masterId, roomId = null, now = Date.now(), maxSeen = MAX_LOW_LEVEL_RM_SEEN, ttlMs = KICK_SKIP_MS) {
    const masterKey = masterId ? normCharId(masterId) : '';
    const fallbackRoom = roomId == null ? '' : String(roomId).trim();
    const trackKey = masterKey || (fallbackRoom ? 'room:' + fallbackRoom : '');
    const step = incrementBoundedCounter(lowCounts, trackKey, now, ttlMs);
    if (!step) return { count: 0, blockedMaster: false, masterId: null };
    const blockedMaster = step.count >= maxSeen;
    if (blockedMaster) lowCounts.delete(step.key);
    else lowCounts.set(step.key, { count: step.count, updatedAt: now });
    return { count: step.count, blockedMaster, masterId: masterKey || null };
}

function parseArgs(argv) {
    const envNotify = process.env && (process.env.NS_HERMES_NOTIFY === '1' || Boolean(process.env.HERMES_NOTIFY_URL));
    const args = {
        boss: 'cerberus', level: 'extreme', accounts: 'coop_accounts.txt', maxMatches: Infinity,
        roomPollMs: 1500, hostStartTimeout: 180000, minLevel: 80, hostWait: 1800000, startTimeout: 60000,
        battleTimeout: null,
        dryRun: false, captureBattle: false, hostRoom: false, headful: false, headless: false, stb: false,
        notify: envNotify, minStartEnergy: null, lock: false,
    };
    let explicitNotify = null;
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
        else if (key === '--battle-timeout') args.battleTimeout = Number(argv[++i]);
        else if (key === '--dry-run') args.dryRun = true;
        else if (key === '--capture-battle') args.captureBattle = true;
        else if (key === '--host-room') args.hostRoom = true;
        else if (key === '--headful') args.headful = true;
        else if (key === '--headless') args.headless = true;
        else if (key === '--stb') { args.stb = true; args.headless = true; args.lock = true; if (explicitNotify === null) explicitNotify = true; }
        else if (key === '--notify') explicitNotify = true;
        else if (key === '--no-notify') explicitNotify = false;
        else if (key === '--half-energy') args.minStartEnergy = 'auto';
        else if (key === '--min-start-energy') {
            const raw = String(argv[++i] || '').trim().toLowerCase();
            args.minStartEnergy = raw === 'auto' ? 'auto' : Number(raw);
        }
        else if (key === '--lock') args.lock = true;
        else throw new Error('Argumen tidak dikenal: ' + key);
    }
    if (explicitNotify !== null) args.notify = explicitNotify;
    if (args.headful) args.headless = false;
    if (args.minStartEnergy !== null && args.minStartEnergy !== 'auto' && (!(args.minStartEnergy > 0) || !Number.isFinite(args.minStartEnergy))) {
        throw new Error('--min-start-energy harus angka positif atau auto.');
    }
    if (!(args.maxMatches > 0) || (!Number.isFinite(args.maxMatches) && args.maxMatches !== Infinity)) throw new Error('--max-matches harus angka positif.');
    for (const [key, value] of [['--room-poll-ms', args.roomPollMs], ['--host-start-timeout', args.hostStartTimeout], ['--min-level', args.minLevel], ['--host-wait', args.hostWait], ['--start-timeout', args.startTimeout]]) {
        if (!(value > 0) || !Number.isFinite(value)) throw new Error(key + ' harus angka positif.');
    }
    if (args.battleTimeout !== null && (!(args.battleTimeout > 0) || !Number.isFinite(args.battleTimeout))) {
        throw new Error('--battle-timeout harus angka positif.');
    }
    return args;
}

function resolveBattleTimeoutMs(args = {}, env = (typeof process !== 'undefined' && process.env) || {}) {
    const cliVal = Number(args && args.battleTimeout);
    if (Number.isFinite(cliVal) && cliVal > 0) return cliVal;
    const envVal = Number(env && env.NS_COOP_BATTLE_TIMEOUT);
    if (Number.isFinite(envVal) && envVal > 0) return envVal;
    const hostStartTimeout = Number(args && args.hostStartTimeout) || 0;
    return Math.max(hostStartTimeout * 2, DEFAULT_BATTLE_TIMEOUT_MS);
}

function resolveMinStartEnergy(spec, isEmblem) {
    if (spec === null || spec === undefined) return 0;
    if (spec === 'auto') return isEmblem ? 50 : 25;
    return Number(spec) || 0;
}

function acquireRunLock(account, enabled) {
    if (!enabled) return () => {};
    const safeUser = String(account && account.username || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const lockFile = path.join(os.tmpdir(), `ns_pve_cerberus_${safeUser}.lock`);
    if (fs.existsSync(lockFile)) {
        try {
            const oldPid = Number(fs.readFileSync(lockFile, 'utf8').trim());
            if (oldPid && oldPid !== process.pid) {
                process.kill(oldPid, 0);
                throw new Error('SKIP: proses Cerberus lain masih berjalan (PID ' + oldPid + ').');
            }
        } catch (err) {
            if (err && String(err.message || '').startsWith('SKIP:')) throw err;
        }
    }
    fs.writeFileSync(lockFile, String(process.pid));
    return () => { try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (_) {} };
}

async function checkPreRunEnergyGate(args, account) {
    if (args.minStartEnergy === null || args.minStartEnergy === undefined || args.dryRun) return true;
    const session = await c.login(account.username, account.password);
    if (!session || !session.ok) throw new Error('Login gagal saat cek energy: ' + ((session && session.message) || 'unknown'));
    const pve = await readPveInit(session);
    if (!pve || !Number.isFinite(pve.energy)) throw new Error('Gagal membaca energy akun.');
    const threshold = resolveMinStartEnergy(args.minStartEnergy, session.isEmblem);
    if (pve.energy < threshold) {
        line('SKIP: Energy saat ini ' + pve.energy + ' (< minimal setengah ' + threshold + '). Tunggu refill berikutnya.');
        return false;
    }
    line('OK ENERGY: ' + pve.energy + ' >= minimal ' + threshold + '; lanjut jalankan Cerberus.');
    return true;
}

function createSolverSession(args, account, logFn) {
    const { CaptchaSolver } = require('./lib/ns_captcha_solver.js');
    const solver = new CaptchaSolver({
        headful: args.headful,
        headless: args.headless && !args.headful,
        log: logFn,
        username: account.username,
        password: account.password,
    });
    let opened = false;
    return {
        solver,
        async ensure() {
            if (opened) return;
            await solver.open();
            opened = true;
        },
        async releaseIfStb() {
            if (!args.stb || !opened) return;
            await solver.releaseBrowser();
            opened = false;
        },
        async close() {
            opened = false;
            await solver.close();
        },
    };
}

async function notifyCerberusSummary(args, report, meta, logFn) {
    if (!args || !args.notify) return;
    try {
        const payload = formatCerberusReport(report, meta);
        const res = await sendHermesReport(payload);
        if (logFn) {
            if (res && res.ok) logFn('  HERMES WA report terkirim (HTTP ' + res.status + ')');
            else logFn('  HERMES WA report gagal: ' + ((res && (res.error || ('HTTP ' + res.status))) || 'unknown'));
        }
    } catch (err) {
        if (logFn) logFn('  HERMES WA report gagal: ' + (err && err.message || err));
    }
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

const MAX_SOCKET_RECONNECTS = 5;
function isTransientSocketError(err) {
    const msg = String(err && err.message || err || '');
    return /Socket terputus|Socket\.IO terputus|Socket error|room summary timeout|connect timeout|WebSocket closed/i.test(msg);
}
async function reconnectPveSession({ oldSocket, session, charId, minEnergy, label, logFn, bindSocket }) {
    if (logFn) logFn('  RECONNECT socket (' + label + ')...');
    if (oldSocket) { try { oldSocket.close(); } catch (_) {} }
    await sleep(3000);
    const freshPve = await readPveInit(session);
    if (!freshPve || !freshPve.pvpServer || !freshPve.pvpServer[0]) {
        return { ok: false, stopReason: 'PvE server tidak tersedia saat reconnect', energy: freshPve && freshPve.energy };
    }
    if (!Number.isFinite(freshPve.energy) || freshPve.energy < minEnergy) {
        return { ok: false, stopReason: 'Energy habis (' + freshPve.energy + ' < ' + minEnergy + ')', energy: freshPve.energy, energyDepleted: true };
    }
    const nextSock = await connectPve({
        server: freshPve.pvpServer[0],
        sessionKey: session.sessionKey,
        charId,
        handoffToken: freshPve.handoffToken,
        handoffNonce: freshPve.handoffNonce,
        ver: freshPve.ver,
    });
    if (bindSocket) bindSocket(nextSock, freshPve);
    nextSock.auth();
    await nextSock.waitAuth(15000);
    if (!nextSock.hasCommandKey()) throw new Error('Command key socket tidak terbentuk saat reconnect.');
    nextSock.joinLobby();
    if (logFn) logFn('  OK RECONNECT socket (energy=' + freshPve.energy + ')');
    return { ok: true, socket: nextSock, pve: freshPve };
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
            return [id, { id, name, action: 'skill' }];
        }));
        let senjutsuList = Array.isArray(data.senjutsu) ? data.senjutsu : [];
        if (detail && detail.body && detail.body.gk && typeof c.getExtraDataWithRetry === 'function') {
            try {
                const exRes = await c.getExtraDataWithRetry(session.sessionKey, row[0], session.token, detail.body.gk, 3);
                if (exRes && exRes.ok && exRes.result && Array.isArray(exRes.result.senjutsu)) {
                    senjutsuList = exRes.result.senjutsu;
                }
            } catch (_) {}
        }
        const SENJUTSU_KNOWN_NAMES = {
            '3000': 'Sage Mode',
            '3500': 'Senjutsu: Super Charges',
            '3110': 'Senjutsu: Dragon Sublimation',
        };
        const senjutsuIds = new Set();
        for (const raw of senjutsuList) {
            const id = String(raw && typeof raw === 'object' ? (raw.skill_id ?? raw.skillId ?? raw.id ?? '') : raw || '');
            if (!id) continue;
            senjutsuIds.add(id);
            const name = raw && typeof raw === 'object' ? String(raw.skill_name ?? raw.skillName ?? raw.name ?? raw.title ?? '') : '';
            if (!skillDetails.has(id)) {
                skillDetails.set(id, { id, name: name || SENJUTSU_KNOWN_NAMES[id] || '', action: 'senjutsu' });
            } else {
                const cur = skillDetails.get(id);
                cur.action = 'senjutsu';
                if (!cur.name && (name || SENJUTSU_KNOWN_NAMES[id])) cur.name = name || SENJUTSU_KNOWN_NAMES[id];
            }
        }
        const rawEquipped = (data.character_equipped_skills || []).map(String);
        for (const id of rawEquipped) {
            if (Number(id) >= 3000 && !skillDetails.has(id)) {
                senjutsuIds.add(id);
                skillDetails.set(id, { id, name: SENJUTSU_KNOWN_NAMES[id] || '', action: 'senjutsu' });
            }
        }
        const owned = new Set(skillDetails.keys());
        const equipped = rawEquipped.filter(id => owned.has(id));
        const ordered = [
            ...AUTO_SKILL_PRIORITY.filter(id => owned.has(id)),
            ...equipped.filter(id => !AUTO_SKILL_PRIORITY.includes(id)),
            ...[...senjutsuIds].filter(id => !AUTO_SKILL_PRIORITY.includes(id) && !equipped.includes(id)),
        ];
        const toEntry = (id, damage) => {
            const info = skillDetails.get(id) || {};
            const action = info.action || (senjutsuIds.has(id) ? 'senjutsu' : 'skill');
            return { skillId: 'skill' + id, id, name: info.name || '', action, damage, once: id === '2004' };
        };
        skills = [...new Set(ordered)].map((id, index) => toEntry(id, 1000 - index));
        // Default in-game deck (same source as PvP arena script); Cerberus host mode ranks it per role.
        equippedDeck = [...new Set(equipped)].map(id => toEntry(id, undefined));
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
function parsePveRankingResponse(body) {
    const data = body && body.latest_ranking_data;
    if (!data || typeof data !== 'object') return null;
    const rank = Number(data.player_own_ranking);
    const score = Number(data.player_score);
    return {
        rank: Number.isFinite(rank) && rank > 0 ? rank : null,
        score: Number.isFinite(score) ? score : null,
        seasonDate: body.season_date || null,
    };
}
async function readPveRanking(session) {
    try {
        const result = await c.amf('PVEService.getRankingList', [session.sessionKey]);
        return parsePveRankingResponse(result && result.body);
    } catch (_) {
        return null;
    }
}
function extractScoreForChar(scoreObj, charId) {
    if (!scoreObj || typeof scoreObj !== 'object') return null;
    const target = normCharId(charId);
    for (const [k, v] of Object.entries(scoreObj)) {
        if (normCharId(k) === target && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
}
function fmtIdNum(n) { return Number.isFinite(Number(n)) ? Number(n).toLocaleString('id-ID') : '-'; }
function updateRankingMeta(meta, ranking, prevRanking, matchScore) {
    if (!ranking) return null;
    if (meta.totalScoreStart == null && ranking.score != null) meta.totalScoreStart = ranking.score;
    if (meta.rankStart == null && ranking.rank != null) meta.rankStart = ranking.rank;
    if (ranking.score != null) meta.totalScoreEnd = ranking.score;
    if (ranking.rank != null) meta.rankEnd = ranking.rank;
    const parts = [];
    if (matchScore != null) parts.push('Match Score: +' + fmtIdNum(matchScore));
    if (ranking.score != null) {
        const deltaScore = prevRanking && prevRanking.score != null ? ranking.score - prevRanking.score : null;
        parts.push('Total Score: ' + fmtIdNum(ranking.score) + (deltaScore ? ' (+' + fmtIdNum(deltaScore) + ')' : ''));
    }
    if (ranking.rank != null) {
        const deltaRank = prevRanking && prevRanking.rank != null ? prevRanking.rank - ranking.rank : 0;
        const move = deltaRank > 0 ? ' (naik ' + deltaRank + ')' : (deltaRank < 0 ? ' (turun ' + Math.abs(deltaRank) + ')' : '');
        parts.push('Rank: #' + ranking.rank + move);
    }
    return parts.join(' | ');
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
function boolFlag(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    if (typeof value === 'number') return value !== 0;
    const s = String(value).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}
function isPasswordRejection(data) {
    if (!data || typeof data !== 'object') return false;
    const pwFlag = data.has_password ?? data.hasPassword ?? data.password_required ?? data.passwordRequired ?? data.is_password ?? data.isPassword ?? data.need_password ?? data.needPassword ?? data.password_locked ?? data.passwordLocked;
    if (boolFlag(pwFlag)) return true;
    const msg = String(data.reason ?? data.message ?? data.error ?? '').toLowerCase();
    return /passw|\bpw\b|sandi|locked/.test(msg);
}
function normalizeRoom(raw, questId) {
    if (!raw || typeof raw !== 'object') return null;
    const id = raw.room_name ?? raw.roomName ?? raw.room_id ?? raw.roomId ?? raw.id;
    const quest = Number(raw.quest ?? raw.quest_id ?? raw.questId ?? raw.mission ?? raw.mission_id);
    const mode = raw.mode ?? raw.level ?? raw.difficulty;
    const rosterRaw = raw.character_array ?? raw.characters ?? raw.players ?? raw.player_array ?? raw.user_array;
    const players = Array.isArray(rosterRaw) ? rosterRaw.map(normalizePlayer) : [];
    const hasPassword = boolFlag(raw.has_password ?? raw.hasPassword ?? raw.password_required ?? raw.passwordRequired ?? raw.is_password ?? raw.isPassword ?? raw.need_password ?? raw.needPassword ?? raw.password_locked ?? raw.passwordLocked ?? raw.locked);
    const capacity = Number(raw.max_player ?? raw.maxPlayer ?? raw.capacity ?? 3);
    const declaredCount = Number(raw.player_count ?? raw.playerCount ?? raw.count ?? players.length);
    const slots = Number.isFinite(capacity) && Number.isFinite(declaredCount) ? capacity - declaredCount : null;
    const schemaComplete = Boolean(id != null && quest === Number(questId) && Array.isArray(rosterRaw) && players.length === rosterRaw.length && slots != null);
    return { id: id == null ? null : String(id), quest, mode, players, slots, hasPassword, schemaComplete, raw };
}
function findRoomMaster(data, rawPlayers, players) {
    const masterId = data && (data.master_id ?? data.masterId ?? data.host_id ?? data.hostId ?? data.owner_id ?? data.ownerId ?? data.room_master_id ?? data.roomMasterId);
    if (masterId != null) return (players || []).find(player => normCharId(player.charId) === normCharId(masterId)) || null;
    const index = (rawPlayers || []).findIndex(player => player && typeof player === 'object' && Boolean(player.is_master ?? player.isMaster ?? player.is_host ?? player.isHost ?? player.is_owner ?? player.isOwner));
    return (players || [])[index >= 0 ? index : 0] || null;
}
function pickRoom(rooms, questId, botCharId, blockedRoomIds = new Set(), blockedMasterIds = new Set()) {
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
        const rawMasterId = room.raw && (room.raw.master_id ?? room.raw.masterId ?? room.raw.host_id ?? room.raw.hostId ?? room.raw.owner_id ?? room.raw.ownerId ?? room.raw.room_master_id ?? room.raw.roomMasterId);
        const masterNorm = rawMasterId != null ? normCharId(rawMasterId) : '';
        if (masterNorm && blockedMasterIds && blockedMasterIds.has(masterNorm)) {
            evaluated.push({ roomId: room.id, reason: 'master_level_low_blocked' });
            continue;
        }
        // Room summary often omits roster. Join only to verify it; READY stays blocked
        // until join_room confirms another Emblem player.
        if (!room.schemaComplete) { evaluated.push({ roomId: room.id, reason: 'verify_after_join', room, otherEmblems: null }); continue; }
        const master = findRoomMaster(room.raw, room.raw.character_array || room.raw.characters || room.raw.players || [], room.players);
        if (master && master.charId && blockedMasterIds && blockedMasterIds.has(normCharId(master.charId))) {
            evaluated.push({ roomId: room.id, reason: 'master_level_low_blocked' });
            continue;
        }
        if (!master || !(master.level >= 80)) { evaluated.push({ roomId: room.id, reason: master && master.level != null ? 'master_level_' + master.level : 'master_level_unknown' }); continue; }
        const botNorm = normCharId(botCharId);
        const otherEmblems = room.players.filter(player => normCharId(player.charId) !== botNorm && player.isEmblem).length;
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
    const botNorm = normCharId(botCharId);
    let count = 0;
    for (const player of players || []) {
        const pid = normCharId(player && player.charId);
        if (!player || !pid || pid === botNorm || ids.has(pid)) continue;
        ids.add(pid);
        if (player.isEmblem) count++;
    }
    return count;
}
function roomArray(data) { return data && (data.room_array || data.rooms || data.roomArray); }
function clearBattleTimers(active) {
    if (active && active.initFallbackTimer) {
        clearTimeout(active.initFallbackTimer);
        active.initFallbackTimer = null;
    }
}
function sendBattleReadyOnce(socket, active, logFn, afterInit = false) {
    clearBattleTimers(active);
    if (!active || active.done) return;
    if (afterInit) {
        if (active.battleReadyAfterInitSent) return;
        active.battleReadyAfterInitSent = true;
        active.battleReadySent = true;
        socket.battleReady();
        if (logFn) logFn('SENT battle_ready');
        return;
    }
    if (active.battleReadySent) return;
    active.battleReadySent = true;
    socket.battleReady();
    if (logFn) logFn('SENT battle_ready');
}
function handleBattlePreTurnStep(socket, active, step, logFn) {
    if (step.type === 'init') {
        if (!active.battleInitSent) {
            active.battleInitSent = true;
            socket.battleInit();
            if (logFn) logFn('SENT battle_init');
            clearBattleTimers(active);
            active.initFallbackTimer = setTimeout(() => {
                if (active && !active.done && !active.battleReadySent && !active.atbStarted) {
                    sendBattleReadyOnce(socket, active, msg => logFn && logFn(msg + ' (fallback)'), false);
                }
            }, 4500);
        }
        return true;
    }
    if (step.type === 'ready') {
        sendBattleReadyOnce(socket, active, logFn, true);
        return true;
    }
    if (step.type === 'startAtb') {
        active.atbStarted = true;
        clearBattleTimers(active);
        const cid = active && active.battle && active.battle.battleCharId;
        socket.startAtb(cid);
        if (logFn) logFn('SENT start_atb');
        return true;
    }
    if (step.type === 'actionReady') { socket.actionReady(active && active.battle && active.battle.battleCharId); return true; }
    if (step.type === 'actionFinish') { socket.actionFinish(step.charDead, active && active.battle && active.battle.battleCharId); return true; }
    return false;
}
function traceBattleProgress(active, message, selfId, logFn) {
    if (!active || !active.battle || typeof active.battle.getTeamStatus !== 'function') return null;
    const status = active.battle.getTeamStatus();
    const selfNorm = normCharId(selfId);
    if (!active.knownDeadTeammates) active.knownDeadTeammates = new Set();
    if (status.selfDead && !active.wasSelfDead) {
        active.wasSelfDead = true;
        active.selfDiedAt = active.selfDiedAt || Date.now();
        if (logFn) {
            if (status.aliveTeammates.length > 0) {
                logFn('SELF DEAD (HP=0), sisa tim hidup=' + status.aliveTeammates.length + ' [' + status.aliveTeammates.join(',') + ']; match lanjut sampai selesai');
            } else {
                logFn('SELF DEAD (HP=0), tidak ada tim tersisa');
            }
        }
    } else if (!status.selfDead && active.wasSelfDead) {
        active.wasSelfDead = false;
        if (logFn) logFn('SELF REVIVED (HP=' + status.selfHp + ')');
    }
    const leftSet = new Set((status.leftPlayers || []).map(normCharId));
    for (const id of status.deadPlayers || []) {
        const nid = normCharId(id);
        if (!nid || nid === selfNorm || leftSet.has(nid)) continue;
        if (!active.knownDeadTeammates.has(nid)) {
            active.knownDeadTeammates.add(nid);
            if (logFn) logFn('TEAMMATE DEAD char=' + id + ' (tim hidup=' + status.alivePlayers.length + '/' + status.totalPlayers + ')');
        }
    }
    if (active.wasSelfDead && message && message.state === 'battle_action' && status.aliveTeammates.length > 0 && logFn) {
        const ba = message.battleAction || {};
        const act = [ba.action, ba.skillId || ba.SENSKILLID || ba.BLSKILLID].filter(Boolean).join(' ');
        const bossHpText = (status.enemies || [])
            .filter(e => e.hp != null)
            .map(e => e.id + ':' + e.hp + (e.maxHp ? '/' + e.maxHp : ''))
            .join(',');
        logFn('SPECTATE char=' + (message.charId || '?') + (act ? ' ' + act : '') + ' | tim_hidup=' + status.alivePlayers.length + (bossHpText ? ' | bossHP=[' + bossHpText + ']' : ''));
    }
    return status;
}
function handleMidBattleLeave(active, rawCharId, logFn) {
    const id = normCharId(rawCharId);
    if (!active || !id || !active.battle || typeof active.battle.markPlayerLeft !== 'function') return;
    active.battle.markPlayerLeft(id);
    const status = typeof active.battle.getTeamStatus === 'function' ? active.battle.getTeamStatus() : null;
    if (logFn) logFn('LEAVE_BATTLE char=' + id + (status ? ' (sisa tim hidup=' + status.alivePlayers.length + ')' : ''));
}
function messageValue(raw) {
    const message = raw && raw.message ? raw.message : raw;
    if (typeof message !== 'string') return message;
    try { return JSON.parse(message); } catch (_) { return null; }
}
function readSelfHp(battle, selfId) {
    if (!battle || !battle.playersHp || typeof battle.playersHp.values !== 'function') return null;
    const selfNorm = normCharId(selfId);
    for (const entry of battle.playersHp.values()) {
        if (entry && normCharId(entry.id) === selfNorm) {
            const hp = Number(entry.hp);
            return Number.isFinite(hp) ? hp : null;
        }
    }
    return null;
}
function hasReactiveForcePacket(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.reactive_force || message.reactiveForce) return true;
    const ba = message.battleAction;
    if (!ba || typeof ba !== 'object') return false;
    if (ba.feed === true || ba.reactive_force || ba.reactiveForce) return true;
    const lists = [ba.feedback, ba.feedback_skipcheck];
    for (const rawList of lists) {
        const items = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? [rawList] : []);
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const kind = String(item.type || item.effect || '').toLowerCase();
            if (kind.includes('reactive_force') && (!item.resisted || Number(item.damage) > 0)) return true;
        }
    }
    return false;
}
function trackReactiveForce(active, message, selfId, hpBefore, hpAfter, logFn) {
    if (!active || !message || message.state !== 'battle_action') return false;
    if (normCharId(message.charId) !== normCharId(selfId)) return false;
    const ba = message.battleAction || {};
    const rawSkill = ba.skillId ?? ba.skill_id ?? '';
    const skillNum = String(rawSkill).replace(/^skill/i, '').trim();
    const usedSkill345 = skillNum ? skillNum === '345' : String(active.lastSelfSkillId || '') === '345';
    active.lastSelfSkillId = null;
    if (!usedSkill345) return false;
    const hpDrop = (hpBefore != null && hpAfter != null && hpAfter < hpBefore) ? (hpBefore - hpAfter) : 0;
    const explicit = hasReactiveForcePacket(message);
    if (!explicit && !(hpDrop > 0)) return false;
    active.reactiveForcePending = true;
    if (logFn) {
        const detail = hpDrop > 0 ? ' (HP -' + hpDrop + ' -> ' + hpAfter + ')' : ' (feedback packet)';
        logFn('REACTIVE_FORCE terdeteksi saat skill345' + detail + '; prioritas Senjutsu: Super Charges (skill3500) berikutnya');
    }
    return true;
}
function pickSkill(skills, id) { return (skills || []).find(skill => String(skill.id) === String(id)) || null; }
function normalizeSkillName(skill) { return String(skill && skill.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function pickNamedSkill(skills, names, fallbackId) {
    const wanted = names.map(name => name.toLowerCase());
    return (skills || []).find(skill => wanted.some(name => normalizeSkillName(skill).includes(name))) || pickSkill(skills, fallbackId);
}
function pickSuperChargesSkill(skills, extraSkills = []) {
    const pool = [...(skills || []), ...(extraSkills || [])];
    return pickNamedSkill(pool, ['super charges', 'super charge'], '3500');
}
function hasFullQuickmatchTeam(players) { return Array.isArray(players) && players.length >= 3; }
function isUchihaRazq(charName) { return String(charName || '').trim().toLowerCase() === 'uchiha razq'; }
function rankedSkills(skills, excludedIds = []) {
    const excluded = new Set(excludedIds.map(String));
    return [...(skills || [])]
        .filter(skill => !excluded.has(String(skill.id)) && !AVOID_SKILLS.has(String(skill.id)))
        .sort((left, right) => (Number(right.damage) || 0) - (Number(left.damage) || 0));
}
function cycleSequenceTurn(sequence, skills, head, turn, priorityLabel, fallbackLabel) {
    if (sequence.length) return { skill: sequence[turn % sequence.length], targetId: head, label: priorityLabel };
    const fallback = rankedSkills(skills);
    const skill = fallback.length ? fallback[turn % fallback.length] : null;
    return skill ? { skill, targetId: head, label: fallbackLabel } : { skill: null, targetId: head, label: 'weapon' };
}
function chooseQuickmatchTurn(charName, skills, enemyIds, turn, opts = {}) {
    const head = enemyIds && enemyIds[0];
    const isCerberus = !opts || opts.boss == null || String(opts.boss).toLowerCase() === 'cerberus';
    if (isUchihaRazq(charName)) {
        if (isCerberus && opts && opts.reactiveForcePending) {
            const superCharges = pickSuperChargesSkill(skills, opts.extraSkills);
            if (superCharges) return { skill: superCharges, targetId: head, label: 'razq_reactive_super_charges', override: true };
        }
        const sequence = [
            pickNamedSkill(skills, ['five element consuming seal', 'five elements seal'], '345'),
            pickNamedSkill(skills, ['thunder explosion'], '633'),
            pickNamedSkill(skills, ['flame armor'], '629'),
            pickNamedSkill(skills, ['electric smash'], '632'),
            pickNamedSkill(skills, ['dragon sublimation'], '3110'),
            pickNamedSkill(skills, ['dance of fujin'], '151'),
            pickNamedSkill(skills, ['advanced aphrodite s blessing', 'aphrodite s blessing'], '854'),
        ].filter(Boolean);
        return cycleSequenceTurn(sequence, skills, head, turn, 'razq_priority', 'razq_fallback');
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
    const solverSession = createSolverSession(args, account, line);
    const { solver } = solverSession;
    let socket = null;
    const report = { generatedAt: new Date().toISOString(), mode: 'public-room', account: account.username, matches: [], attempts: [], scans: [], error: null };
    const meta = { charName: account.username, energyStart: null, energyEnd: null, totalScoreStart: null, totalScoreEnd: null, rankStart: null, rankEnd: null, stopReason: null };
    const saveReport = () => fs.writeFileSync(path.join(process.cwd(), 'coop_report.json'), JSON.stringify(report, null, 2));
    try {
        // Web login binds CAPTCHA solver and PvE socket to same account session.
        await solverSession.ensure();
        const result = await loginAccount(account, solver.webLoginData);
        await solverSession.releaseIfStb();
        if (!result.ok) throw new Error('Login gagal: ' + result.error);
        meta.charName = result.charName || account.username;
        const pve = await readPveInit(result.session);
        const quest = pve && findQuestId(pve.questList, args.boss, args.level);
        if (!pve || !quest || !pve.pvpServer || !pve.pvpServer[0]) throw new Error('PvE boss Extreme tidak tersedia.');
        if (!result.skills.length) throw new Error('Skill karakter tidak terbaca; battle otomatis dihentikan.');
        const botId = normCharId(result.charId);
        meta.energyStart = Number(pve.energy);
        meta.energyEnd = Number(pve.energy);
        let latestRanking = await readPveRanking(result.session);
        const initialRankText = updateRankingMeta(meta, latestRanking, null, null);
        divider('AKUN & DECK');
        line('  QUICKMATCH ' + result.charName + ' Lv' + result.level + ' ID=' + botId + ' energy=' + pve.energy + ' skills=' + result.skills.map(s => s.id + (s.action === 'senjutsu' ? '(senjutsu)' : '')).join(','));
        if (initialRankText) line('  OK RANKING AWAL ' + initialRankText);
        const joinCost = Number(quest.energy[1]);
        if (!(joinCost > 0)) throw new Error('Biaya energy join tidak valid.');
        socket = await connectPve({ server: pve.pvpServer[0], sessionKey: result.session.sessionKey, charId: botId, handoffToken: pve.handoffToken, handoffNonce: pve.handoffNonce, ver: pve.ver });

        let rooms = null;
        let active = null;
        let fatal = null;
        let solvingCaptcha = false;
        let captchaAttempts = 0;
        let joinRejectTimer = null;
        const masterProfileCache = new Map();
        const rejectedRoomUntil = new Map();
        const rejectedMasterUntil = new Map();
        const roomKicks = new Map();
        const lowLevelRmCounts = new Map();
        const bufferedBattle = [];
        const blockRoom = (roomId, reason, ttlMs = 120000) => {
            if (!roomId) return;
            const durationMs = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : 120000;
            const until = Date.now() + durationMs;
            rejectedRoomUntil.set(String(roomId), until);
            line('  ROOM ' + roomId + ' skip ' + Math.round(durationMs / 1000) + ' dtk (' + reason + ')');
        };
        const resetActive = reason => {
            if (!active) return;
            if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
            clearBattleTimers(active);
            active.reason = active.reason || reason;
            active.done = true;
        };
        const requestRooms = () => { rooms = null; socket.getRoomSummary(); };
        const watchJoinResponse = (reason, timeoutMs) => {
            if (joinRejectTimer) clearTimeout(joinRejectTimer);
            joinRejectTimer = setTimeout(() => {
                joinRejectTimer = null;
                if (active && !active.done && !active.joinAccepted) {
                    blockRoom(active.room && active.room.id, reason, 120000);
                    resetActive(reason);
                }
            }, timeoutMs);
        };
        const roomEventDetail = data => {
            if (!data || typeof data !== 'object') return {};
            return {
                status: data.status,
                reason: data.reason || data.message || data.error,
                keys: Object.keys(data).slice(0, 12),
            };
        };
        const markBattleStarted = () => {
            if (!active || active.started) return;
            active.started = true;
            if (active.room && active.room.id) roomKicks.delete(String(active.room.id));
            divider('BATTLE #' + active.match + ' ' + String(args.boss).toUpperCase());
            line('  #' + active.match + ' START ' + String(args.boss).toUpperCase());
        };
        let currentPve = pve;
        const bindLiveSocket = sock => {
            sock.on('error', err => {
                const msg = err && err.message ? err.message : 'Socket error';
                fatal = fatal || new Error('Socket error: ' + msg);
            });
            sock.on('si_error', sp => {
                fatal = fatal || new Error('Socket.IO error: ' + JSON.stringify(sp && sp.data));
            });
            sock.on('si_disconnect', () => {
                if (!fatal) fatal = new Error('Socket.IO terputus oleh server');
            });
            sock.on('close', (code, reason) => {
                if (!fatal) fatal = new Error('Socket terputus (code=' + (code ?? '?') + (reason ? ', ' + reason : '') + ')');
            });
            sock.on('get_room_summary', data => {
                rooms = roomArray(data);
            });
            sock.on('captcha_required', () => {
                if (!active || active.done || active.joinAccepted || solvingCaptcha) return;
                active.captchaRequested = true;
                if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
                if (++captchaAttempts > 2) { fatal = new Error('CAPTCHA berulang; berhenti agar akun tidak terkunci.'); return; }
                solvingCaptcha = true;
                line('  #' + active.match + ' CAPTCHA verifikasi join...');
                solverSession.ensure().then(() => solver.solve('pve')).then(async outcome => {
                    const decision = captchaRetryDecision(outcome);
                    if (decision.action === 'stop') {
                        fatal = new Error('CAPTCHA ditolak server. fails_left=' + (decision.failsLeft == null ? 'unknown' : decision.failsLeft) + '. Selesaikan manual sebelum lanjut.');
                        return;
                    }
                    if (decision.action === 'retry') {
                        line('  CAPTCHA ditolak; fails_left=' + decision.failsLeft + '. Ulang join room.');
                        await sleep(1000);
                        if (active && !active.done) {
                            sock.joinRoom(active.room.id, '', currentPve.ver);
                            watchJoinResponse('captcha_join_timeout', 12000);
                        }
                        return;
                    }
                    // Give server verification state time to reach PvE socket before retrying join.
                    await sleep(750);
                    if (!active || active.done) return;
                    line('  #' + active.match + ' CAPTCHA OK; ulang join room=' + active.room.id);
                    sock.joinRoom(active.room.id, '', currentPve.ver);
                    watchJoinResponse('captcha_join_timeout', 12000);
                }).catch(error => {
                    resetActive('captcha_error:' + String(error.message || error).slice(0, 80));
                }).finally(async () => {
                    await solverSession.releaseIfStb();
                    solvingCaptcha = false;
                });
            });
        };
        const applyRoster = async data => {
            if (!active || active.done || active.started || !data) return false;
            const raw = data.character_array || data.characters || data.players || data.ta;
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
                const masterId = normCharId(active.master.charId);
                const cached = masterProfileCache.get(masterId);
                if (cached !== undefined) active.master.level = cached;
                else {
                    try {
                        const response = await c.amf('CharacterDAO.getCharacterProfileById', [result.session.sessionKey, masterId, true]);
                        if (active !== rosterActive || rosterActive.done || rosterActive.started) return false;
                        const profile = (response && response.body && response.body.result) || {};
                        const level = Number(profile.character_level ?? profile.characterLevel ?? profile.level);
                        masterProfileCache.set(masterId, Number.isFinite(level) ? level : null);
                        rosterActive.master.level = Number.isFinite(level) ? level : null;
                    } catch (_) {
                        if (active !== rosterActive || rosterActive.done || rosterActive.started) return false;
                        masterProfileCache.set(masterId, null);
                    }
                }
            }
            if (!active.master || !(active.master.level >= 80)) {
                const reason = active.master && active.master.level != null ? 'master_level_' + active.master.level : 'master_level_unknown';
                const masterId = active.master && normCharId(active.master.charId);
                const lowRes = recordLowLevelMaster(lowLevelRmCounts, masterId, active.room && active.room.id);
                const skipMs = lowRes.blockedMaster ? KICK_SKIP_MS : 120000;
                if (lowRes.blockedMaster && lowRes.masterId) {
                    rejectedMasterUntil.set(lowRes.masterId, Date.now() + KICK_SKIP_MS);
                    line('  #' + active.match + ' RM Lv<80 terdeteksi ' + lowRes.count + 'x (master=' + lowRes.masterId + '); blokir RM & cari room lain');
                }
                blockRoom(active.room.id, reason, skipMs);
                resetActive(reason);
                return false;
            }
            active.otherEmblems = countOtherEmblems(players, botId);
            active.emblemStatusUnknown = players.some(player => player.isEmblem == null);
            // Public rooms expose only character IDs on some PvE packets. User opted
            // to continue those rooms, while explicit non-Emblem rosters stay blocked.
            if (!active.emblemStatusUnknown && active.otherEmblems < 1 && !active.started) resetActive('emblem_player_left');
            return true;
        };
        const sendReady = () => {
            if (!active || active.done || active.started || active.ready) return;
            if (!hasFullQuickmatchTeam(active.players)) {
                if (!active.waitingFullTeam) {
                    active.waitingFullTeam = true;
                    line('  #' + active.match + ' WAIT room=' + active.room.id + ' player=' + active.players.length + '/3; tunggu room penuh sebelum READY');
                }
                return;
            }
            socket.ready(botId);
            active.readySentNs = nowNs();
            active.joinAcceptedToReadyMs = elapsedMs(active.joinAcceptedNs);
            if (active.joinAcceptedToReadyMs > 250) active.latencyWarning = 'ready lambat';
            active.ready = true;
            line('  #' + active.match + ' READY room=' + active.room.id + ' (' + active.joinAcceptedToReadyMs.toFixed(1) + ' ms)' + (active.rosterConfirmed ? '' : ' roster=menunggu') + '; tunggu host max ' + Math.round(args.hostStartTimeout / 1000) + ' dtk');
        };
        const bindLiveGameplay = sock => {
            sock.on('join_room', async data => {
                if (!active || active.done || active.started) return;
                if (active.joinAccepted) {
                    const applied = await applyRoster(data);
                    if (applied && active && !active.done && !active.started) sendReady();
                    return;
                }
                if (Number(data && data.status) !== 1 || data.room_name === 'lobby') {
                    if (isPasswordRejection(data)) {
                        const detail = roomEventDetail(data);
                        line('  #' + active.match + ' SERVER join_room password_required' + (detail.reason ? ' (' + detail.reason + ')' : '') + '; cari room lain');
                        blockRoom(active.room && active.room.id, 'password_required', KICK_SKIP_MS);
                        resetActive('password_required');
                        return;
                    }
                    // Some servers emit join rejection just before captcha_required.
                    // Hold state briefly so CAPTCHA can resend this same join command.
                    if (!active.captchaRequested && !joinRejectTimer) watchJoinResponse('join_rejected', 1500);
                    return;
                }
                if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
                active.joinAccepted = true;
                active.joinAcceptedNs = nowNs();
                await applyRoster(data);
                if (active && !active.done && !active.started) sendReady();
            });
            // `ready` packets carry only the subset of ready character IDs (or empty data on host startGame);
            // never overwrite active.players from `ready` or kick ourselves out when battle is starting.
            sock.on('ready', () => {
                if (active && !active.done && !active.started) sendReady();
            });
            sock.on('leave_room', data => {
                if (!active || active.done || !data) return;
                const left = normCharId(data.character_id ?? data.characterId ?? data.charId ?? data.id ?? '');
                if (active.started) {
                    if (left && left !== botId) handleMidBattleLeave(active, left, msg => line('  #' + active.match + ' ' + msg));
                    return;
                }
                if (!active.rosterConfirmed) return;
                if (left) active.players = active.players.filter(player => normCharId(player.charId) !== left);
                const others = active.players.filter(player => normCharId(player.charId) !== botId);
                if (active.emblemStatusUnknown) {
                    if (!others.length) resetActive('all_other_players_left');
                    return;
                }
                if (countOtherEmblems(active.players, botId) < 1) resetActive('emblem_player_left');
            });
            sock.on('kick_user', data => {
                if (!active || active.done) return;
                const detail = roomEventDetail(data);
                const kickedId = normCharId(data && (data.character_id ?? data.characterId ?? data.charId ?? data.id) || '');
                const masterId = active.master && normCharId(active.master.charId);
                if (kickedId && kickedId !== botId) {
                    if (masterId && kickedId === masterId) {
                        active.roomEvents = active.roomEvents || [];
                        active.roomEvents.push({ event: 'kick_user', ...detail, kickedId });
                        line('  #' + active.match + ' SERVER kick_user (master ' + kickedId + ' keluar)');
                        blockRoom(active.room.id, 'master_left');
                        resetActive('kick_user');
                        return;
                    }
                    active.players = (active.players || []).filter(player => normCharId(player.charId) !== kickedId);
                    line('  #' + active.match + ' PEMAIN LAIN DI-KICK char=' + kickedId + '; tetap di room ' + (active.room && active.room.id));
                    return;
                }
                active.roomEvents = active.roomEvents || [];
                active.roomEvents.push({ event: 'kick_user', ...detail });
                const kickRes = recordRoomKick(roomKicks, active.room && active.room.id, masterId);
                line('  #' + active.match + ' SERVER kick_user' + (detail.reason ? ' (' + detail.reason + ')' : '') + ' [kick ' + kickRes.count + '/' + MAX_KICKS_PER_ROOM + ' di room ' + (active.room && active.room.id) + ']');
                if (kickRes.blocked) {
                    blockRoom(active.room.id, 'kicked_2x', KICK_SKIP_MS);
                }
                resetActive('kick_user');
            });
            for (const event of ['force_lobby', 'destroy_battle']) {
                sock.on(event, data => {
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
            sock.on('battle_start', markBattleStarted);
            sock.on('battle_msg', raw => {
                const message = messageValue(raw);
                if (!message || !active || active.done) return;
                if (bufferedBattle.length < 100) {
                    const ba = message.battleAction;
                    bufferedBattle.push({
                        event: message.event,
                        state: message.state,
                        charId: message.charId,
                        ...(ba ? { action: ba.action, skillId: ba.skillId || ba.SENSKILLID || ba.BLSKILLID } : {}),
                    });
                }
                if (['join', 'init', 'start', 'start_atb'].includes(message.state)) {
                    markBattleStarted();
                    line('  #' + active.match + ' RECV ' + (message.event || '') + '/' + (message.state || ''));
                }
                if (message.state === 'battle_finish' || message.state === 'battle_win') {
                    clearBattleTimers(active);
                    const winners = idList(message.winnerIDs || message.winner_ids || message.winners).map(normCharId);
                    active.score = message.score;
                    active.reward = message.reward;
                    active.outcome = (message.state === 'battle_finish' && winners.length && !winners.includes(botId))
                        ? 'battle_lose'
                        : message.state;
                    active.done = true;
                    return;
                }
                if (message.state === 'battle_lose') { clearBattleTimers(active); active.outcome = 'battle_lose'; active.done = true; return; }
                if (message.state === 'battle_action' && normCharId(message.charId) === botId) {
                    active.myBattleActions = (active.myBattleActions || 0) + 1;
                    const ba = message.battleAction || {};
                    line('  #' + active.match + ' OK BATTLE_ACTION ' + (ba.action || '') + ' ' + (ba.skillId || ba.SENSKILLID || ba.BLSKILLID || '') + ' (char=' + message.charId + ')');
                }
                const hpBefore = readSelfHp(active.battle, botId);
                const step = active.battle.nextStep(message);
                const hpAfter = readSelfHp(active.battle, botId);
                const logBattle = msg => line('  #' + active.match + ' ' + msg);
                if (isUchihaRazq(result.charName) && String(args.boss || '').toLowerCase() === 'cerberus') {
                    trackReactiveForce(active, message, botId, hpBefore, hpAfter, logBattle);
                }
                traceBattleProgress(active, message, botId, logBattle);
                if (handleBattlePreTurnStep(sock, active, step, logBattle)) return;
                if (step.type === 'turn' && !args.captureBattle) {
                    active.commandReceivedNs = nowNs();
                    const turn = chooseQuickmatchTurn(result.charName, result.skills, active.battle.enemyIds, active.turn, {
                        boss: args.boss,
                        reactiveForcePending: Boolean(active.reactiveForcePending),
                        extraSkills: result.skills,
                    });
                    if (turn.override) active.reactiveForcePending = false;
                    else active.turn++;
                    const action = turn.skill ? (turn.skill.action || (Number(turn.skill.id) >= 3000 ? 'senjutsu' : 'skill')) : 'weapon_attack';
                    const actorId = step.charId || (active.battle && active.battle.battleCharId) || botId;
                    active.lastSelfSkillId = turn.skill ? String(turn.skill.id || turn.skill.skillId || '').replace(/^skill/i, '') : null;
                    sock.battleCommand(actorId, action, turn.skill && turn.skill.skillId, turn.targetId);
                    active.lastAction = turn.label + ':' + action + ':' + (turn.skill ? turn.skill.skillId : 'weapon_attack');
                    active.battleCommandLatencyMs = elapsedMs(active.commandReceivedNs);
                    line('  #' + active.match + ' SKILL ' + active.lastAction + ' char=' + actorId + ' (' + active.battleCommandLatencyMs.toFixed(1) + ' ms)');
                }
            });
        };
        const bindAllLive = (sock, nextPve) => {
            if (nextPve) currentPve = nextPve;
            bindLiveSocket(sock);
            bindLiveGameplay(sock);
        };
        bindAllLive(socket, pve);
        socket.auth();
        await socket.waitAuth(15000);
        if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk.');
        socket.joinLobby();
        let knownEnergy = Number(pve.energy);
        let lastEnergyCheckAt = Date.now();
        let attemptNo = 0;
        let reconnectAttempts = 0;
        const battleTimeoutMs = resolveBattleTimeoutMs(args);

        while (report.matches.length < args.maxMatches) {
            try {
                // Room scan stays socket-only; avoid slow AMF refresh on every 1.5s poll.
                if (Date.now() - lastEnergyCheckAt >= 30000) {
                    const fresh = await readPveInit(result.session);
                    if (!fresh || !Number.isFinite(fresh.energy)) { meta.stopReason = 'Gagal membaca sisa energy'; break; }
                    knownEnergy = fresh.energy;
                    meta.energyEnd = knownEnergy;
                    lastEnergyCheckAt = Date.now();
                }
                if (!Number.isFinite(knownEnergy) || knownEnergy < joinCost) {
                    divider('SELESAI');
                    meta.stopReason = 'Energy habis (' + knownEnergy + ' < ' + joinCost + ')';
                    line('  STOP: ' + meta.stopReason);
                    break;
                }
                if (fatal) throw fatal;
                requestRooms();
                const scanDeadline = Date.now() + 15000;
                while (!Array.isArray(rooms)) {
                    if (fatal) throw fatal;
                    if (Date.now() >= scanDeadline) throw new Error('room summary timeout');
                    await sleep(25);
                }
                const nowMs = Date.now();
                for (const [roomId, until] of rejectedRoomUntil) if (until <= nowMs) rejectedRoomUntil.delete(roomId);
                for (const [mId, until] of rejectedMasterUntil) if (until <= nowMs) rejectedMasterUntil.delete(mId);
                const picked = pickRoom(rooms, quest.quest, botId, new Set(rejectedRoomUntil.keys()), new Set(rejectedMasterUntil.keys()));
                const battleNo = report.matches.length + 1;
                report.scans.push({ at: new Date().toISOString(), rooms: rooms.length, candidate: picked.room && picked.room.id, rejects: picked.evaluated.filter(item => item.reason !== 'accepted') });
                if (!picked.room) {
                    reconnectAttempts = 0;
                    line('  #' + battleNo + ' REFRESH rooms=' + rooms.length + ' (' + scanSummary(picked.evaluated) + '); ulang ' + (args.roomPollMs / 1000) + ' dtk');
                    await sleep(args.roomPollMs);
                    continue;
                }
                attemptNo++;
                active = { match: battleNo, attempt: attemptNo, room: picked.room, players: picked.room.players.slice(), rosterConfirmed: picked.room.schemaComplete, started: false, ready: false, done: false, reason: null, outcome: null, startedAt: Date.now(), turn: 0, battle: new PveBattle({ charId: botId, strategy: 'B', skills: result.skills }) };
                captchaAttempts = 0;
                divider('COBA #' + attemptNo + ' (Battle #' + battleNo + ')');
                line('  #' + battleNo + ' (coba #' + attemptNo + ') JOIN room=' + active.room.id + (picked.otherEmblems == null ? ' (verifikasi roster)' : ' emblem=' + picked.room.players.filter(player => player.isEmblem).length));
                socket.joinRoom(active.room.id, '', currentPve.ver);
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
                    const battleDeadline = Date.now() + battleTimeoutMs;
                    while (!active.done && Date.now() < battleDeadline) {
                        if (fatal) throw fatal;
                        await sleep(10);
                    }
                    if (!active.done) resetActive('battle_timeout');
                }
                if (active.room && !active.outcome) socket.leaveRoom(active.room.id);
                else if (active.outcome) socket.joinLobby();
                const matchScore = extractScoreForChar(active.score, botId);
                const finalTeam = typeof active.battle.getTeamStatus === 'function' ? active.battle.getTeamStatus() : null;
                const summary = { attempt: active.attempt, match: active.match, roomId: active.room.id, otherEmblems: active.otherEmblems, emblemStatusUnknown: active.emblemStatusUnknown, rosterConfirmed: active.rosterConfirmed, rosterFields: active.rosterFields, roomEvents: active.roomEvents, ready: active.ready, outcome: active.outcome || 'retry', reason: active.reason, selfDied: Boolean(active.wasSelfDead), alivePlayersAtEnd: finalTeam ? finalTeam.alivePlayers.length : null, joinAcceptedToReadyMs: active.joinAcceptedToReadyMs, latencyWarning: active.latencyWarning, lastAction: active.lastAction, battleCommandLatencyMs: active.battleCommandLatencyMs, matchScore, score: active.score, reward: active.reward, durationMs: Date.now() - active.startedAt, battle: bufferedBattle.splice(0) };
                // Force a fresh energy read after every joined room/battle attempt.
                lastEnergyCheckAt = 0;
                reconnectAttempts = 0;
                const isDecidedBattle = summary.outcome === 'battle_finish' || summary.outcome === 'battle_win' || summary.outcome === 'battle_lose';
                if (summary.outcome === 'battle_finish' || summary.outcome === 'battle_win') {
                    line('  #' + summary.match + ' WIN ' + String(args.boss).toUpperCase() + ' (' + summary.outcome + (summary.selfDied ? '; carry tim, char sempat HP=0' : '') + ')');
                    const updatedRanking = await readPveRanking(result.session);
                    const rankText = updateRankingMeta(meta, updatedRanking, latestRanking, matchScore);
                    if (updatedRanking) { summary.totalScoreAfter = updatedRanking.score; summary.rankAfter = updatedRanking.rank; latestRanking = updatedRanking; }
                    if (rankText) line('  #' + summary.match + ' OK ' + rankText);
                }
                else if (summary.outcome === 'battle_lose') line('  #' + summary.match + ' LOSE ' + String(args.boss).toUpperCase());
                else line('  #' + summary.match + ' (coba #' + summary.attempt + ') RETRY (' + (summary.reason || summary.outcome) + ')');
                report.attempts.push(summary);
                if (isDecidedBattle) report.matches.push(summary);
                saveReport();
                line('');
                active = null;
            } catch (err) {
                if (joinRejectTimer) { clearTimeout(joinRejectTimer); joinRejectTimer = null; }
                if (active) { clearBattleTimers(active); active = null; }
                fatal = null;
                if (!isTransientSocketError(err) || reconnectAttempts >= MAX_SOCKET_RECONNECTS) throw err;
                reconnectAttempts++;
                const reconnected = await reconnectPveSession({
                    oldSocket: socket,
                    session: result.session,
                    charId: botId,
                    minEnergy: joinCost,
                    label: err.message + '; ulang ' + reconnectAttempts + '/' + MAX_SOCKET_RECONNECTS,
                    logFn: line,
                    bindSocket: (nextSock, nextPve) => {
                        socket = nextSock;
                        rooms = null;
                        fatal = null;
                        bindAllLive(nextSock, nextPve);
                    },
                });
                if (Number.isFinite(Number(reconnected.energy))) {
                    knownEnergy = Number(reconnected.energy);
                    meta.energyEnd = knownEnergy;
                    lastEnergyCheckAt = Date.now();
                }
                if (!reconnected.ok) {
                    if (reconnected.energyDepleted) {
                        divider('SELESAI');
                        meta.stopReason = reconnected.stopReason;
                        line('  STOP: ' + meta.stopReason);
                        break;
                    }
                    throw new Error(reconnected.stopReason || err.message);
                }
            }
        }
        if (!meta.stopReason && report.matches.length >= args.maxMatches) meta.stopReason = 'Target ' + args.maxMatches + ' match tercapai';
    } catch (error) {
        report.error = error.message;
        meta.stopReason = error.message;
        process.exitCode = 1;
        throw error;
    } finally {
        saveReport();
        if (socket) socket.close();
        await solverSession.close();
        await notifyCerberusSummary(args, report, meta, line);
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
function chooseCerberusTurn(skills, enemyIds, turn, charName = '', opts = {}) {
    const head = enemyIds && enemyIds[0];
    const isCerberus = !opts || opts.boss == null || String(opts.boss).toLowerCase() === 'cerberus';
    if (isUchihaRazq(charName)) {
        if (isCerberus && opts && opts.reactiveForcePending) {
            const superCharges = pickSuperChargesSkill(skills, opts.extraSkills);
            if (superCharges) return { skill: superCharges, targetId: head, label: 'razq_host_reactive_super_charges', override: true };
        }
        const pool = opts && opts.extraSkills ? [...(skills || []), ...opts.extraSkills] : skills;
        const sequence = [
            pickNamedSkill(pool, ['kinjutsu evasion', 'evasion'], '39'),
            pickNamedSkill(pool, ['five element consuming seal', 'five elements seal'], '345'),
            pickNamedSkill(pool, ['thunder explosion'], '633'),
            pickNamedSkill(pool, ['flame armor'], '629'),
            pickNamedSkill(pool, ['electric smash'], '632'),
            pickNamedSkill(pool, ['advanced aphrodite s blessing', 'aphrodite s blessing'], '854'),
            pickNamedSkill(pool, ['dragon sublimation'], '3110'),
            pickNamedSkill(pool, ['dance of fujin'], '151'),
        ].filter(Boolean);
        return cycleSequenceTurn(sequence, pool, head, turn, 'razq_host_priority', 'razq_host_fallback');
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
    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'cerberus_host_' + new Date().toISOString().replace(/[:.]/g, '-') + '.log');
    const stamp = () => new Date().toISOString();
    const say = message => { line(message); try { fs.appendFileSync(logFile, stamp() + ' ' + message + '\n'); } catch (_) {} };
    const trace = (tag, data) => { try { fs.appendFileSync(logFile, stamp() + ' [raw] ' + tag + ' ' + JSON.stringify(data).slice(0, 1500) + '\n'); } catch (_) {} };
    const report = { generatedAt: stamp(), mode: 'host-room', boss: args.boss, level: args.level, minLevel: args.minLevel, account: account.username, matches: [], attempts: [], error: null };
    const meta = { charName: account.username, energyStart: null, energyEnd: null, totalScoreStart: null, totalScoreEnd: null, rankStart: null, rankEnd: null, stopReason: null };
    const reportFile = path.join(process.cwd(), 'cerberus_host_report.json');
    const saveReport = () => { try { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); } catch (_) {} };
    const solverSession = createSolverSession(args, account, say);
    const { solver } = solverSession;
    const battleTimeoutMs = resolveBattleTimeoutMs(args);
    const profileCache = new Map();
    let socket = null;
    try {
        say('  LOG ' + logFile);
        await solverSession.ensure();
        const result = await loginAccount(account, solver.webLoginData);
        await solverSession.releaseIfStb();
        if (!result.ok) throw new Error('Login gagal: ' + result.error);
        meta.charName = result.charName || account.username;
        const hostLevel = evaluateLevel(result.level, args.minLevel);
        if (!hostLevel.ok) throw new Error('Level host tidak memenuhi syarat (' + hostLevel.reason + ').');
        const pve = await readPveInit(result.session);
        const quest = pve && findQuestId(pve.questList, args.boss, args.level);
        if (!pve || !quest || !pve.pvpServer || !pve.pvpServer[0]) throw new Error('PvE boss tidak tersedia.');
        const hostCost = Number(quest.energy[0]);
        const hostId = normCharId(result.charId);
        meta.energyStart = Number(pve.energy);
        meta.energyEnd = Number(pve.energy);
        let latestRanking = await readPveRanking(result.session);
        const initialRankText = updateRankingMeta(meta, latestRanking, null, null);
        divider('AKUN & DECK HOST');
        say('  HOST ' + result.charName + ' Lv' + result.level + ' energy=' + pve.energy + ' biaya_room=' + hostCost + ' quest=' + quest.quest);
        say('  DECK ' + describeDeck(result.equipped));
        if (initialRankText) say('  OK RANKING AWAL ' + initialRankText);
        if (!(pve.energy >= hostCost)) throw new Error('Energy host kurang (' + pve.energy + ' < ' + hostCost + ').');
        socket = await connectPve({ server: pve.pvpServer[0], sessionKey: result.session.sessionKey, charId: hostId, handoffToken: pve.handoffToken, handoffNonce: pve.handoffNonce, ver: pve.ver });
        let active = null;
        let fatal = null;
        let solvingCaptcha = false;
        let captchaAttempts = 0;
        let createRejectTimer = null;
        const clearCreateTimer = () => { if (createRejectTimer) { clearTimeout(createRejectTimer); createRejectTimer = null; } };
        let currentHostPve = pve;
        const finish = (reason, outcome) => { if (!active || active.done) return; clearBattleTimers(active); active.reason = active.reason || reason; if (outcome) active.outcome = outcome; active.done = true; };
        const sendCreate = () => socket.createRoom({ password: '', mode: 3, quest: quest.quest, ver: currentHostPve.ver });

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

        const bindHostSocket = sock => {
            sock.on('error', err => { const msg = err && err.message ? err.message : 'Socket error'; fatal = fatal || new Error('Socket error: ' + msg); });
            sock.on('si_error', sp => { fatal = fatal || new Error('Socket.IO error: ' + JSON.stringify(sp && sp.data)); });
            sock.on('si_disconnect', () => { if (!fatal) fatal = new Error('Socket.IO terputus oleh server'); });
            sock.on('close', (code, reason) => { if (!fatal) fatal = new Error('Socket terputus (code=' + (code ?? '?') + (reason ? ', ' + reason : '') + ')'); });
            sock.on('captcha_required', () => {
                if (!active || solvingCaptcha || active.done) return;
                clearCreateTimer();
                if (++captchaAttempts > 2) { fatal = new Error('CAPTCHA berulang; berhenti agar akun tidak terkunci.'); return; }
                solvingCaptcha = true;
                say('  CAPTCHA verifikasi create room...');
                solverSession.ensure().then(() => solver.solve('pve')).then(async outcome => {
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
                }).catch(error => finish('captcha_error:' + String(error.message || error).slice(0, 80))).finally(async () => {
                    await solverSession.releaseIfStb();
                    solvingCaptcha = false;
                });
            });
            sock.on('join_room', data => {
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
            sock.on('get_room_summary', data => {
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
            sock.on('ready', onReadyList);
            sock.on('cancel_ready', onReadyList);
            sock.on('reset_ready', () => { if (active && !active.started) active.readyIds.clear(); });
            sock.on('leave_room', data => {
                trace('leave_room', data);
                if (!active || !data) return;
                const id = normCharId(data.character_id ?? data.characterId ?? data.charId ?? data.id ?? '');
                if (id && id !== hostId) {
                    if (active.started) {
                        handleMidBattleLeave(active, id, msg => say('  ' + msg));
                    } else {
                        active.players.delete(id);
                        active.readyIds.delete(id);
                        active.pendingKicks.delete(id);
                        say('  LEAVE char=' + id);
                    }
                }
            });
            sock.on('kick_user', data => {
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
            for (const event of ['force_lobby', 'destroy_battle']) sock.on(event, data => { trace(event, data); if (active && !active.done) finish(event + (data && (data.reason || data.message) ? ':' + (data.reason || data.message) : '')); });
            const markBattleStarted = () => { if (active && !active.battleStarted) { active.battleStarted = true; active.battleStartedAt = Date.now(); divider('BATTLE #' + (report.matches.length + 1) + ' ' + String(args.boss).toUpperCase()); say('  START CERBERUS (battle masuk)'); } };
            sock.on('battle_start', markBattleStarted);
            sock.on('battle_msg', raw => {
                const message = messageValue(raw);
                if (!active || !message) return;
                trace('battle_msg', message);
                if (['join', 'init', 'start', 'start_atb'].includes(message.state)) markBattleStarted();
                active.battleStates.push(message.state || message.event);
                if (active.battleStates.length > 400) active.battleStates.shift();
                if (message.state === 'battle_finish' || message.state === 'battle_win') {
                    clearBattleTimers(active);
                    const winners = idList(message.winnerIDs || message.winner_ids || message.winners).map(normCharId);
                    const outcome = winners.length ? (winners.includes(hostId) ? 'win' : 'lose') : (message.state === 'battle_win' ? 'win' : 'finish_unknown');
                    active.score = message.score; active.reward = message.reward;
                    finish('battle_' + message.state, outcome);
                    return;
                }
                if (message.state === 'battle_lose') { clearBattleTimers(active); finish('battle_lose', 'lose'); return; }
                const hpBefore = readSelfHp(active.battle, hostId);
                const step = active.battle.nextStep(message);
                const hpAfter = readSelfHp(active.battle, hostId);
                const logHostBattle = msg => say('  ' + msg);
                if (isUchihaRazq(result.charName) && String(args.boss || '').toLowerCase() === 'cerberus') {
                    trackReactiveForce(active, message, hostId, hpBefore, hpAfter, logHostBattle);
                }
                traceBattleProgress(active, message, hostId, logHostBattle);
                if (handleBattlePreTurnStep(sock, active, step, logHostBattle)) return;
                if (step.type === 'turn') {
                    const turn = chooseCerberusTurn(result.equipped, active.battle.enemyIds, active.turn, result.charName, {
                        boss: args.boss,
                        reactiveForcePending: Boolean(active.reactiveForcePending),
                        extraSkills: result.skills,
                    });
                    if (turn.override) active.reactiveForcePending = false;
                    else active.turn++;
                    const action = turn.skill ? (turn.skill.action || (Number(turn.skill.id) >= 3000 ? 'senjutsu' : 'skill')) : 'weapon_attack';
                    const actorId = step.charId || (active.battle && active.battle.battleCharId) || hostId;
                    active.lastSelfSkillId = turn.skill ? String(turn.skill.id || turn.skill.skillId || '').replace(/^skill/i, '') : null;
                    sock.battleCommand(actorId, action, turn.skill && turn.skill.skillId, turn.targetId);
                    active.actions.push(turn.label + ':' + (turn.skill ? turn.skill.skillId : 'weapon_attack'));
                    say('  TURN ' + active.turn + (turn.override ? ' (PRIORITAS)' : '') + ' ' + turn.label + ' ' + (turn.skill ? turn.skill.skillId : 'weapon_attack') + ' char=' + actorId + ' -> ' + turn.targetId);
                }
            });
        };

        bindHostSocket(socket);
        socket.auth();
        await socket.waitAuth(15000);
        if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk.');
        socket.joinLobby();
        say('  PVE AUTH OK');
        let roomNo = 0;
        let reconnectAttempts = 0;
        while (report.matches.length < args.maxMatches) {
            try {
                if (fatal) throw fatal;
                const energyNow = (await readPveInit(result.session) || {}).energy;
                if (Number.isFinite(Number(energyNow))) meta.energyEnd = Number(energyNow);
                if (!(energyNow >= hostCost)) {
                    divider('SELESAI');
                    meta.stopReason = 'Energy habis (' + energyNow + ' < ' + hostCost + ')';
                    say('  STOP: ' + meta.stopReason);
                    break;
                }
                captchaAttempts = 0;
                active = { roomId: null, createdAt: null, players: new Map(), readyIds: new Set(), pendingKicks: new Set(), missing: 0, started: false, startSentAt: null, battleStarted: false, battleStartedAt: null, done: false, outcome: null, reason: null, turn: 0, actions: [], battleStates: [], battle: new PveBattle({ charId: hostId, strategy: 'B', skills: result.equipped }) };
                const matchStartedAt = Date.now();
                const battleNo = report.matches.length + 1;
                divider('HOST ROOM #' + (roomNo + 1) + ' (Battle #' + battleNo + ')');
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
                const matchScore = extractScoreForChar(active.score, hostId);
                const finalTeam = typeof active.battle.getTeamStatus === 'function' ? active.battle.getTeamStatus() : null;
                const summary = { attempt: roomNo, match: battleNo, roomId: active.roomId, outcome: active.outcome || 'retry', reason: active.reason, battleStarted: active.battleStarted, selfDied: Boolean(active.wasSelfDead), alivePlayersAtEnd: finalTeam ? finalTeam.alivePlayers.length : null, players: [...active.players.entries()].map(([id, p]) => ({ id, name: p.name, level: p.level, status: p.status })), actions: active.actions, matchScore, score: active.score, reward: active.reward, energyBefore: energyNow, energyAfter: after && after.energy, durationMs: Date.now() - matchStartedAt, battleStates: active.battleStates.slice(-60) };
                if (after && Number.isFinite(Number(after.energy))) meta.energyEnd = Number(after.energy);
                if (active.outcome === 'win') {
                    say('  #' + battleNo + ' WIN CERBERUS' + (summary.selfDied ? ' (carry tim, char sempat HP=0)' : ''));
                    const updatedRanking = await readPveRanking(result.session);
                    const rankText = updateRankingMeta(meta, updatedRanking, latestRanking, matchScore);
                    if (updatedRanking) { summary.totalScoreAfter = updatedRanking.score; summary.rankAfter = updatedRanking.rank; latestRanking = updatedRanking; }
                    if (rankText) say('  #' + battleNo + ' OK ' + rankText);
                }
                else if (active.outcome === 'lose') say('  #' + battleNo + ' LOSE CERBERUS');
                else say('  #' + battleNo + ' (room #' + roomNo + ') RETRY (' + (active.reason || active.outcome) + ')');
                report.attempts.push(summary);
                if (active.outcome === 'win' || active.outcome === 'lose') report.matches.push(summary);
                saveReport();
                reconnectAttempts = 0;
                line('');
                active = null;
                await sleep(1500);
            } catch (err) {
                clearCreateTimer();
                if (active) { clearBattleTimers(active); active = null; }
                fatal = null;
                if (!isTransientSocketError(err) || reconnectAttempts >= MAX_SOCKET_RECONNECTS) throw err;
                reconnectAttempts++;
                const reconnected = await reconnectPveSession({
                    oldSocket: socket,
                    session: result.session,
                    charId: hostId,
                    minEnergy: hostCost,
                    label: err.message + '; ulang ' + reconnectAttempts + '/' + MAX_SOCKET_RECONNECTS,
                    logFn: say,
                    bindSocket: (nextSock, nextPve) => {
                        socket = nextSock;
                        if (nextPve) currentHostPve = nextPve;
                        fatal = null;
                        bindHostSocket(nextSock);
                    },
                });
                if (Number.isFinite(Number(reconnected.energy))) meta.energyEnd = Number(reconnected.energy);
                if (!reconnected.ok) {
                    if (reconnected.energyDepleted) {
                        divider('SELESAI');
                        meta.stopReason = reconnected.stopReason;
                        say('  STOP: ' + meta.stopReason);
                        break;
                    }
                    throw new Error(reconnected.stopReason || err.message);
                }
            }
        }
        if (!meta.stopReason && report.matches.length >= args.maxMatches) meta.stopReason = 'Target ' + args.maxMatches + ' match tercapai';
        say('  SELESAI: ' + report.matches.length + ' match battle. Log: ' + logFile);
    } catch (error) {
        report.error = error.message;
        meta.stopReason = error.message;
        process.exitCode = 1;
        throw error;
    } finally {
        saveReport();
        if (socket) socket.close();
        await solverSession.close();
        await notifyCerberusSummary(args, report, meta, say);
    }
}

(async () => {
    if (process.argv.includes('--selftest')) return;
    const args = parseArgs(process.argv.slice(2));
    const accounts = parseAccountsFile(args.accounts, 1);
    let releaseLock = () => {};
    try {
        try {
            releaseLock = acquireRunLock(accounts[0], args.lock);
        } catch (err) {
            if (err && String(err.message || '').startsWith('SKIP:')) {
                line(err.message);
                return;
            }
            throw err;
        }
        const shouldRun = await checkPreRunEnergyGate(args, accounts[0]);
        if (!shouldRun) return;
        if (args.dryRun) await runDryRun(args, accounts[0]);
        else if (args.hostRoom) await runHostRoom(args, accounts[0]);
        else await runLive(args, accounts[0]);
    } finally {
        releaseLock();
    }
})().catch(error => { line('STOP: ' + error.message); process.exitCode = 1; });

module.exports = { parseArgs, parseAccountsFile, resolveMinStartEnergy, resolveBattleTimeoutMs, acquireRunLock, isTransientSocketError, parsePveRankingResponse, extractScoreForChar, findQuestId, normalizePlayer, normalizeRoom, pickRoom, scanSummary, countOtherEmblems, hasFullQuickmatchTeam, chooseMinotaurTurn, chooseQuickmatchTurn, chooseCerberusTurn, captchaRetryDecision, buildSkillDeck, describeDeck, normCharId, idList, evaluateLevel, traceBattleProgress, handleMidBattleLeave, hasReactiveForcePacket, trackReactiveForce, pickSuperChargesSkill, recordRoomKick, recordLowLevelMaster, isPasswordRejection, runDryRun, runLive, runHostRoom };
