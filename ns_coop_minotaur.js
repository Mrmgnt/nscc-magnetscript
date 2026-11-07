#!/usr/bin/env node
'use strict';
/**
 * ns_coop_minotaur.js - Orchestrator Auto Co-op Hunting (Minotaur Extreme).
 * cc: MagnetScript(Razki)
 *
 * Flow: create room (dummy host, rotate) -> captcha -> 2 main join -> ready ->
 *       start -> battle -> repeat sampai energy habis.
 *
 * CLI:
 *   node ns_coop_minotaur.js --boss minotaur --level extreme --password 1111 \
 *        [--max-matches N] [--headful] [--buy-energy] [--dry-run] \
 *        [--accounts coop_accounts.txt] [--strategy auto|A|B]
 *        [--captcha-test USERNAME]
 *
 * Selftest/uji cepat: node ns_coop_minotaur.js --selftest
 */
const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');
const { EnergyScheduler } = require('./lib/ns_energy_scheduler.js');
const { PveSocket } = require('./lib/ns_pve_socket.js');
const { PveBattle } = require('./lib/ns_pve_battle.js');

const line = s => console.log(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));


function makeCaptchaQueue() {
    let queue = Promise.resolve();
    return (solver, label, retry) => {
        queue = queue.then(async () => {
            if (!solver) throw new Error('captcha solver tidak tersedia');
            line('  captcha_required (' + label + ')');
            const solved = await solver.solve('pve');
            if (!solved) throw new Error('captcha gagal: ' + label);
            line('  captcha OK (' + label + '), kirim ulang command');
            retry();
        });
        return queue;
    };
}


// Level mapping: extreme = digit 3 pada quest id (LEVEL_INDEX[quest%10]); lihat PVE.as
const LEVEL_INDEX = { 0: 1, 1: 1, 2: 2, 3: 3 }; // display level by digit

function parseArgs(argv) {
    const a = { boss: 'minotaur', level: 'extreme', password: '1111', maxMatches: Infinity, headful: false, buyEnergy: false, dryRun: false, accounts: 'coop_accounts.txt', strategy: 'auto', captchaTest: null, preflight: null };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === '--boss') a.boss = argv[++i];
        else if (k === '--level') a.level = argv[++i];
        else if (k === '--password') a.password = argv[++i];
        else if (k === '--max-matches') {
            a.maxMatches = Number(argv[++i]);
            if (!Number.isSafeInteger(a.maxMatches) || a.maxMatches < 1) throw new Error('--max-matches harus bilangan bulat positif.');
        }
        else if (k === '--accounts') a.accounts = argv[++i];
        else if (k === '--strategy') a.strategy = argv[++i];
        else if (k === '--headful') a.headful = true;
        else if (k === '--buy-energy') a.buyEnergy = true;
        else if (k === '--dry-run') a.dryRun = true;
        else if (k === '--captcha-test') a.captchaTest = argv[++i];
        else if (k === '--preflight') a.preflight = argv[++i];
        else if (k === '--auto-kill') a.strategy = 'A';
        else if (k === '--safe-play') a.strategy = 'B';
    }
    return a;
}

async function runPreflight(args, accounts) {
    const wanted = String(args.preflight || '').trim().toLowerCase();
    const account = accounts.find(item => item.username.toLowerCase() === wanted);
    if (!account) throw new Error('Akun preflight tidak ditemukan: ' + args.preflight);
    const { CaptchaSolver } = require('./lib/ns_captcha_solver.js');
    const solver = new CaptchaSolver({ headful: true, log: line, username: account.username, password: account.password });
    try {
        await solver.open();
        const result = await loginAccount(account, solver.webLoginData);
        if (!result.ok || !result.charId) throw new Error('Login/karakter tidak tersedia: ' + account.username + ' (' + String(result.error || 'karakter kosong') + ')');
        const pve = await readPveInit(result.session);
        const available = Boolean(pve && pve.pvpServer && pve.pvpServer[0]);
        line('  PREFLIGHT ' + account.username + ': char=' + result.charName + ' Lv ' + result.level + ' | PVE=' + (available ? 'READY' : 'TIDAK TERSEDIA') + ' | status=' + String(pve && (pve.pveStatus ?? pve.status)));
        if (!available) process.exitCode = 2;
    } finally {
        await solver.close();
    }
}
async function runCaptchaTest(args, accounts) {
    const wanted = String(args.captchaTest || '').trim().toLowerCase();
    const account = accounts.find(item => item.username.toLowerCase() === wanted);
    if (!account) throw new Error('Akun captcha test tidak ditemukan: ' + args.captchaTest);
    const { CaptchaSolver } = require('./lib/ns_captcha_solver.js');
    const solver = new CaptchaSolver({ headful: true, log: line, username: account.username, password: account.password });
    let socket = null;
    try {
        await solver.open();
        const result = await loginAccount(account, solver.webLoginData);
        if (!result.ok || !result.charId) throw new Error('Login/karakter tidak tersedia: ' + account.username + ' (' + String(result.error || 'karakter kosong') + ')');
        line('  karakter: ' + result.charName + ' (Lv ' + result.level + ', slot ' + (account.slot || '1') + ')');
        const pve = await readPveInit(result.session);
        if (!pve || !pve.pvpServer || !pve.pvpServer[0]) throw new Error('PVE server tidak tersedia: ' + account.username + ' (status=' + String(pve && (pve.pveStatus ?? pve.status)) + ', level=' + result.level + ', message=' + String(pve && pve.serverMessage) + ')');
        const quest = findQuestId(pve.questList, args.boss, args.level);
        if (!quest) throw new Error('Quest captcha test tidak ditemukan.');
        socket = await PveSocket.connect({ server: pve.pvpServer[0], sessionKey: result.session.sessionKey, charId: result.charId, handoffToken: pve.handoffToken, handoffNonce: pve.handoffNonce, ver: pve.ver });
        let roomId = null, failure = null, solving = false, attempts = 0;
        const sendCreate = () => socket.createRoom({ password: args.password, mode: 3, quest: quest.quest, ver: pve.ver });
        socket.on('error', () => { failure = failure || new Error('Socket error'); });
        socket.on('si_error', () => { failure = failure || new Error('Socket.IO error'); });
        socket.on('captcha_required', () => {
            if (solving || failure) return;
            if (++attempts > 1) { failure = new Error('Captcha test dihentikan setelah satu percobaan'); return; }
            solving = true;
            line('  captcha_required (' + account.username + ')');
            solver.solve('pve').then(ok => {
                if (!ok) throw new Error('captcha gagal: ' + account.username);
                line('  captcha OK (' + account.username + '), kirim ulang create_room');
                sendCreate();
            }).catch(error => { failure = error; }).finally(() => { solving = false; });
        });
        socket.on('join_room', data => {
            if (Number(data && data.status) === 1 && data.room_name !== 'lobby') roomId = String(data.room_name || data.roomId || '');
            else if (Number(data && data.status) !== 0) failure = failure || new Error('create_room ditolak server');
        });
        socket.auth();
        await socket.waitAuth(15000);
        if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk.');
        sendCreate();
        const deadline = Date.now() + 120000;
        while (!roomId) {
            if (failure) throw failure;
            if (Date.now() >= deadline) throw new Error('captcha test timeout');
            await sleep(100);
        }
        line('  CAPTCHA TEST BERHASIL: ' + account.username + ' room=' + roomId);
        socket.leaveRoom(roomId);
        await sleep(500);
        return { username: account.username, roomId, quest: quest.quest, testedAt: new Date().toISOString() };
    } finally {
        if (socket) socket.close();
        await solver.close();
    }
}

function parseAccountsFile(file, requiredCount = 3) {
    if (!fs.existsSync(file)) throw new Error('File akun tidak ditemukan: ' + file + ' (salin dari coop_accounts.example.txt -> coop_accounts.txt)');
    const out = [];
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const s = raw.trim();
        if (!s || s.startsWith('#')) continue;
        const parts = s.split(':');
        if (parts.length < 3) continue;
        const role = parts[0].trim().toLowerCase();
        if (role !== 'host' && role !== 'main') continue;
        // Format fleksibel: role:username:password[:targetLevel][:slot]
        //   - 3 kolom  -> role:user:password
        //   - 4 kolom  -> role:user:password:slot   (kolom terakhir angka kecil = slot)
        //   - 5 kolom  -> role:user:password:targetLevel:slot
        //   - >5       -> password boleh mengandung ':' (di tengah)
        let password, targetLevel, slot;
        if (parts.length === 3) {
            password = parts[2]; slot = '1';
        } else if (parts.length === 4) {
            const last = parts[3].trim();
            if (/^\d{1,2}$/.test(last)) { password = parts[2]; slot = last; }
            else { password = parts[2] + ':' + parts[3]; slot = '1'; }
        } else if (parts.length === 5) {
            // role:user:pw:targetLevel:slot  (konvensi accounts.txt)
            password = parts[2]; targetLevel = parts[3].trim(); slot = parts[4].trim();
        } else {
            // password mengandung ':' -> slot = kolom terakhir, targetLevel = kolom ke-2 dari akhir (jika angka), sisanya password
            slot = parts[parts.length - 1].trim();
            const maybeLevel = parts[parts.length - 2].trim();
            if (/^\d{1,3}$/.test(maybeLevel)) { targetLevel = maybeLevel; password = parts.slice(2, parts.length - 2).join(':'); }
            else { password = parts.slice(2, parts.length - 1).join(':'); }
        }
        out.push({ role, username: parts[1].trim(), password, targetLevel: targetLevel ? Number(targetLevel) : undefined, slot: slot || '1' });
    }
    const unique = new Map();
    for (const account of out) {
        const key = account.username.toLowerCase();
        const existing = unique.get(key);
        if (!existing) unique.set(key, account);
        else {
            if (existing.password !== account.password || existing.slot !== account.slot) throw new Error('Duplikat akun memiliki password/slot berbeda: ' + account.username);
            if (account.role === 'host') existing.role = 'host';
        }
    }
    if (requiredCount != null && unique.size !== requiredCount) throw new Error('Butuh tepat ' + requiredCount + ' akun unik, ditemukan ' + unique.size);
    return [...unique.values()];
}

function levelSuffix(level) {
    const l = String(level).toLowerCase();
    if (l === 'extreme' || l === 'extream') return 3;
    if (l === 'hard') return 2;
    if (l === 'normal') return 1;
    return 3;
}

// Nama boss -> id musuh di quest_list.display_boss (dari data_library_en).
// quest_obj[].quest digit terakhir = level: 0/1/2/3 (extreme = 3).
const BOSS_ENEMY_ID = {
    minotaur: 'enemy501',
};
const AUTO_KILL_SKILL_PRIORITY = ['2004', '345', '632', '638', '623', '728'];

function bossMatches(group, bossLc, bossEnemy) {
    const bosses = (group.display_boss || []).map(String).join(' ').toLowerCase();
    const name = String(group.name || '').toLowerCase();
    if (bossEnemy && bosses.includes(bossEnemy.toLowerCase())) return true;
    if (bossLc && (bosses.includes(bossLc) || name.includes(bossLc))) return true;
    return false;
}

// Cari quest id Minotaur untuk level diminta dari quest_list.
function findQuestId(questList, boss, level) {
    if (!Array.isArray(questList)) return null;
    const wantSuffix = levelSuffix(level);
    const bossLc = String(boss || '').toLowerCase();
    const bossEnemy = BOSS_ENEMY_ID[bossLc] || null;
    const candidates = [];
    for (const group of questList) {
        const matchBoss = !bossLc || bossMatches(group, bossLc, bossEnemy);
        for (const qo of (group.quest_obj || [])) {
            const q = Number(qo.quest);
            if (!q) continue;
            if ((q % 10) === wantSuffix && matchBoss) candidates.push({ quest: q, energy: qo.energy, score: qo.score, level: qo.level, boss: (group.display_boss || []).join('+') });
        }
    }
    return candidates[0] || null;
}

async function loginAccount(acc, webData) {
    const s = await c.login(acc.username, acc.password, webData);
    if (!s.ok) return { ok: false, account: acc, error: s.message || s.stage };
    let charId = null, charName = null, level = null, skills = [];
    try {
        const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
        const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
        const row = c.getSelectedChar(chars, acc.slot || undefined);
        if (row) { charId = row[0]; charName = row[1]; level = Number(row[2]) || null; }
        if (charId) {
            for (let attempt = 0; attempt < 4; attempt++) {
                const detail = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
                if (detail && detail.body && detail.body.gk) {
                    const data = detail.body.result || {};
                    const owned = new Set((data.character_skills || data.character_skill || []).map(String));
                    const equipped = (data.character_equipped_skills || []).map(String);
                    const priority = AUTO_KILL_SKILL_PRIORITY.filter(id => owned.has(id));
                    const fallback = equipped.filter(id => owned.has(id) && Number(id) > 0 && Number(id) < 3000 && !priority.includes(id));
                    skills = [...priority, ...fallback].map((id, index) => ({ skillId: 'skill' + id, damage: 1000 - index, cooldown: 8, once: id === '2004' }));
                    break;
                }
                await sleep(1000);
            }
        }
    } catch (_) {}
    return { ok: true, account: acc, session: s, charId, charName, level, skills };
}

async function readPveInit(session) {
    try {
        const r = await c.amf('SystemData.getPvEServerInit', [session.sessionKey, 'en']);
        const b = r && r.body;
        if (!b) return null;
        return {
            handoffToken: b.handoff_token,
            handoffNonce: b.handoff_nonce,
            pvpServer: b.pvp_server,
            questList: b.quest_list,
            energy: Number(b.character_energy),
            remainTime: b.remain_time,
            pveStatus: b.pve_status,
            ver: b.pveServerVersion,
            status: b.status,
            serverMessage: typeof (b.message || b.result) === 'string' ? String(b.message || b.result).slice(0, 160) : null,
        };
    } catch (_) { return null; }
}

// Login unik per username (satu sesi per akun). Akun yang sama sebagai host & main
// memakai SESI & SOCKET terpisah hanya saat main (host satu socket, main socket lain),
// tapi login (AMF) cukup sekali agar tidak saling menendang ('snsLogin').
async function loginAll(accounts, log, webLogins) {
    const byUser = new Map();
    for (const a of accounts) if (!byUser.has(a.username)) byUser.set(a.username, []);
    for (const a of accounts) byUser.get(a.username).push(a.role);
    const sessions = new Map(); // username -> login result
    const uniq = [...byUser.keys()];
    const results = await Promise.all(uniq.map(u => {
        const acc = accounts.find(x => x.username === u);
        return loginAccount(acc, webLogins && webLogins.get(u.toLowerCase())).catch(e => ({ ok: false, account: acc, error: e.message }));
    }));
    uniq.forEach((u, i) => sessions.set(u, results[i]));
    for (const [u, res] of sessions) {
        const roles = byUser.get(u).join('+');
        if (!res.ok) log(`  [X] ${roles} ${u}: LOGIN GAGAL (${res.error})`);
        else log(`  [OK] ${roles.padEnd(9)} ${u.padEnd(14)} char=${res.charName}(Lv ${res.level}) skills=${res.skills.length}`);
    }
    return sessions;
}

async function runDryRun(args, accounts) {
    line('');
    line('=== DRY RUN: login semua akun + baca energy (tanpa membuat room) ===');
    const sessions = await loginAll(accounts, line);
    const schedAccounts = [];
    let quest = null;
    for (const a of accounts) {
        const r = sessions.get(a.username);
        if (!r || !r.ok) continue;
        const init = await readPveInit(r.session);
        if (!init || !Number.isFinite(init.energy)) throw new Error('Energy tidak tersedia: ' + a.username);
        const energy = init.energy;
        if (!quest && init) quest = findQuestId(init.questList, args.boss, args.level);
        if (init) line(`       ${a.role} ${a.username}: energy=${energy}${quest ? ' (quest id=' + quest.quest + ')' : ''}`);
        schedAccounts.push({ role: a.role, username: a.username, energy, maxEnergy: 100 });
    }
    if (!schedAccounts.length) { line('  Tidak ada akun yang berhasil login.'); return; }
    const hostCost = quest && quest.energy ? Number(quest.energy[0]) : 25;
    const joinCost = quest && quest.energy ? Number(quest.energy[1]) : 5;
    line('');
    line('  Quest target : ' + (quest ? ('id=' + quest.quest + ' boss=' + quest.boss + ' (energy host=' + hostCost + ', join=' + joinCost + ', score=' + JSON.stringify(quest.score) + ')') : 'tidak ditemukan di quest_list (pakai default host=25/join=5)'));
    const sched = new EnergyScheduler({ accounts: schedAccounts, hostCost, joinCost, maxMatches: args.maxMatches });
    const plan = sched.plan();
    line('');
    line(`  Rencana rotasi host (${plan.length} match):`);
    plan.forEach(p => line('    Match ' + p.match + ': host=' + p.host + ' joiners=' + p.joiners.join(', ') + ' (host energy=' + p.hostEnergyBefore + ')'));
    line('');
    line('  Rencana selesai (dry-run).');
}

function characterIds(list) {
    if (!Array.isArray(list)) return [];
    return list.map(item => {
        if (Array.isArray(item)) return item[0];
        if (item && typeof item === 'object') return item.characterId ?? item.charId ?? item.character_id ?? item.id;
        return item;
    }).filter(item => item != null).map(String);
}
async function runLive(args, accounts) {
    if (args.buyEnergy) throw new Error('--buy-energy tidak didukung; tidak ada pembelian otomatis.');
    const uniqueAccounts = [...new Map(accounts.map(account => [account.username.toLowerCase(), account])).values()];
    const requestedHost = String((process.env && process.env.NS_COOP_START_HOST) || '').toLowerCase();
    if (requestedHost) uniqueAccounts.sort((left, right) => Number(right.username.toLowerCase() === requestedHost) - Number(left.username.toLowerCase() === requestedHost));
    const { CaptchaSolver } = require('./lib/ns_captcha_solver.js');
    const solvers = new Map(uniqueAccounts.map(account => [account.username.toLowerCase(), new CaptchaSolver({ headful: true, log: line, username: account.username, password: account.password })]));
    try {
        for (const account of uniqueAccounts) {
            const solver = solvers.get(account.username.toLowerCase());
            if (typeof solver.open === 'function') await solver.open();
        }
    } catch (error) {
        await Promise.all([...solvers.values()].map(solver => typeof solver.close === 'function' ? solver.close() : Promise.resolve()));
        throw error;
    }
    const webLogins = new Map([...solvers.entries()].map(([username, solver]) => [username, solver.webLoginData]));
    const sessions = await loginAll(accounts, line, webLogins);
    const players = [];
    for (const account of uniqueAccounts) {
        const result = sessions.get(account.username);
        if (!result || !result.ok || !result.charId) throw new Error('Login/karakter tidak tersedia: ' + account.username);
        const pve = await readPveInit(result.session);
        if (!pve || !Number.isFinite(pve.energy)) throw new Error('Energy server tidak valid: ' + account.username);
        players.push({ account, username: account.username, role: account.role, session: result.session, charId: result.charId, charName: result.charName, skills: result.skills || [], pve, energy: pve.energy });
    }
    if (players.length !== 3 || new Set(players.map(player => String(player.charId))).size !== 3) throw new Error('Butuh tepat 3 akun dan karakter unik.');
    const quest = findQuestId(players[0].pve.questList, args.boss, args.level);
    if (!quest) throw new Error('Quest Minotaur/level tidak ditemukan.');
    const hostCost = Number(quest.energy && quest.energy[0]);
    const joinCost = Number(quest.energy && quest.energy[1]);
    if (!(hostCost > 0 && joinCost > 0)) throw new Error('Biaya energy server tidak valid.');
    const scheduler = new EnergyScheduler({ accounts: players, hostCost, joinCost, maxMatches: args.maxMatches });
    const captchaQueue = makeCaptchaQueue();
    const report = [];
    const roster = players.map(player => String(player.charId)).sort().join(',');
    const validationFile = path.join(process.cwd(), 'coop_validation.json');
    let validation = { roster, stage: 0 };
    try {
        const saved = JSON.parse(fs.readFileSync(validationFile, 'utf8'));
        if (saved.roster === roster && saved.quest === quest.quest) validation = saved;
    } catch (_) {}
    const allowed = validation.stage >= 3 ? Infinity : validation.stage >= 1 ? 3 : 1;
    const limit = Math.min(args.maxMatches, allowed);
    line('  Auto-kill belum menjamin hadiah. Batas validasi sesi: ' + limit);
    let failure = null;
    const saveReport = () => fs.writeFileSync(path.join(process.cwd(), 'coop_report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), boss: args.boss, level: args.level, strategy: args.strategy, validationStage: validation.stage, error: failure, matches: report }, null, 2));
    try {
        while (report.length < limit && !scheduler.stopReason()) {
            for (const player of players) {
                const fresh = await readPveInit(player.session);
                if (!fresh || !Number.isFinite(fresh.energy)) throw new Error('Refresh energy gagal: ' + player.username);
                player.pve = fresh;
                player.energy = fresh.energy;
            }
            const host = scheduler.pickHost();
            if (!host) break;
            const joiners = players.filter(player => player !== host);
            const sockets = [];
            const row = { match: report.length + 1, host: host.username, joiners: joiners.map(player => player.username), roomId: null, confirmed: false, outcome: 'pending', events: [], energyBefore: players.map(player => ({ username: player.username, energy: player.energy })) };
            report.push(row);
            const startedAt = Date.now();
            let stopped = false;
            let matchError = null;
            let pending = null;
            let outcome = null;
            let battleStarted = false;
            let roomReady = [];
            const readyConfirmed = new Set();
            const fail = message => { matchError = matchError || new Error(message); };
            const waitUntil = async (predicate, timeoutMs, label) => {
                const deadline = Date.now() + timeoutMs;
                while (!predicate()) {
                    if (matchError) throw matchError;
                    if (Date.now() >= deadline) throw new Error(label + ' timeout');
                    await sleep(100);
                }
                if (matchError) throw matchError;
            };
            const command = async (socket, send, accepted, label, retrySilent = false) => {
                pending = { socket, send, label, active: true, solving: false, attempts: 0 };
                try {
                    send();
                    if (retrySilent) {
                        const retryAt = Date.now() + 10000;
                        while (!accepted() && Date.now() < retryAt) {
                            if (matchError) throw matchError;
                            await sleep(100);
                        }
                        if (!accepted() && !pending.solving && !pending.captchaRequested) {
                            line('  ' + label + ' belum dijawab, kirim ulang sekali');
                            send();
                        }
                    }
                    await waitUntil(accepted, 120000, label);
                } finally { pending.active = false; pending = null; }
            };
            try {
                const server = host.pve.pvpServer && host.pve.pvpServer[0];
                if (!server) throw new Error('pvp_server kosong.');
                for (const player of [host, ...joiners]) {
                    const socket = await PveSocket.connect({ server, sessionKey: player.session.sessionKey, charId: player.charId, handoffToken: player.pve.handoffToken, handoffNonce: player.pve.handoffNonce, ver: player.pve.ver });
                    sockets.push(socket);
                    socket.on('*', (event, data) => {
                        let nested = null;
                        if (event === 'battle_msg' && data) {
                            nested = data.message || data;
                            if (typeof nested === 'string') { try { nested = JSON.parse(nested); } catch (_) { nested = null; } }
                        }
                        if (row.events.length < 100) row.events.push({ username: player.username, event, status: data && typeof data.status === 'number' ? data.status : undefined, keys: data && typeof data === 'object' ? Object.keys(data) : [], messageEvent: nested && nested.event, messageState: nested && nested.state });
                    });
                    socket.on('error', () => fail('Socket error: ' + player.username));
                    socket.on('si_error', () => fail('Socket.IO error: ' + player.username));
                    socket.on('close', () => { if (!stopped) fail('Socket terputus: ' + player.username); });
                    for (const event of ['version_error', 'force_lobby', 'kick_user', 'destroy_battle']) socket.on(event, () => fail(event + ': ' + player.username));
                    socket.on('captcha_required', () => {
                        const current = pending;
                        if (!current || current.socket !== socket) { fail('Captcha tanpa command aktif: ' + player.username); return; }
                        current.captchaRequested = true;
                        if (current.solving) return;
                        if (++current.attempts > 1) { fail('Captcha dihentikan setelah satu percobaan: ' + player.username); return; }
                        current.solving = true;
                        captchaQueue(solvers.get(player.username.toLowerCase()), player.username, () => {
                            if (!stopped && current.active && !matchError) current.send();
                        }).catch(error => fail(error.message)).finally(() => { current.solving = false; });
                    });
                    socket.on('join_room', data => {
                        if (!data || Number(data.status) !== 1 || data.room_name === 'lobby') {
                            if (pending && pending.socket === socket && pending.captchaRequested && Number(data && data.status) === 0) return;
                            fail('join_room ditolak: ' + player.username); return;
                        }
                        socket.joinedRoom = String(data.room_name || data.roomId || '');
                        if (!socket.joinedRoom) fail('Room ID kosong: ' + player.username);
                    });
                    socket.on('ready', data => {
                        const ready = Array.isArray(data) ? data : data && data.character_array;
                        if (Array.isArray(ready)) roomReady = characterIds(ready);
                        if (pending && pending.socket === socket && pending.label === 'ready') readyConfirmed.add(String(player.charId));
                    });
                    const battle = new PveBattle({ charId: player.charId, strategy: args.strategy, skills: player.skills || [] });
                    const finish = (event, data) => {
                        if (!battleStarted) return;
                        if (data && (data.success === false || data.status === 0)) { fail(event + ' ditolak server'); return; }
                        if (event === 'battle_finish') {
                            const winners = data && data.winnerIDs;
                            if (!Array.isArray(winners) || !players.every(member => winners.map(String).includes(String(member.charId)))) {
                                fail('battle_finish belum membuktikan kemenangan tiga karakter'); return;
                            }
                        }
                        if (!outcome || event === 'battle_finish') outcome = { event, data };
                    };
                    socket.on('battle_win', data => finish('battle_win', data));
                    socket.on('battle_finish', data => finish('battle_finish', data));
                    socket.on('battle_start', () => { battleStarted = true; });
                    socket.on('battle_msg', raw => {
                        let message = raw && raw.message ? raw.message : raw;
                        if (typeof message === 'string') { try { message = JSON.parse(message); } catch (_) { fail('battle_msg bukan JSON'); return; } }
                        if (!message) return;
                        const action = message.battleAction && message.battleAction.action;
                        const skillId = message.battleAction && (message.battleAction.skillId || message.battleAction.SENSKILLID || message.battleAction.BLSKILLID);
                        line('  battle_msg ' + player.username + ': event=' + String(message.event || '') + ' state=' + String(message.state || '') + (action ? ' action=' + action : '') + (skillId ? ' skill=' + skillId : ''));
                        if (['join', 'start', 'start_atb'].includes(message.state)) battleStarted = true;
                        if (message.state === 'battle_lose') { fail('Battle kalah'); return; }
                        if (['battle_win', 'battle_finish'].includes(message.state)) { finish(message.state, message); return; }
                        const step = battle.nextStep(message);
                        if (step.type === 'ready') socket.battleReady();
                        else if (step.type === 'startAtb') socket.startAtb();
                        else if (step.type === 'actionReady') socket.actionReady();
                        else if (step.type === 'actionFinish') {
                            socket.actionFinish(step.charDead);
                            if (step.autoWin) {
                                line('  auto_win ' + player.username + ': after valid battle_action');
                                socket.battleWin(player.charId);
                            }
                        }
                        else if (step.type === 'turn') socket.battleCommand(player.charId, step.battleAction.action, step.battleAction.skillId, step.targetId);
                    });
                    socket.auth();
                    await socket.waitAuth(15000);
                    if (!socket.hasCommandKey()) throw new Error('Command key socket tidak terbentuk: ' + player.username + ' (handoff token/nonce kosong atau tidak cocok)');
                }
                const hostSocket = sockets[0];
                await command(hostSocket, () => hostSocket.createRoom({ password: args.password, mode: 3, quest: quest.quest, ver: host.pve.ver }), () => Boolean(hostSocket.joinedRoom), 'create_room');
                row.roomId = hostSocket.joinedRoom;
                for (let index = 1; index < sockets.length; index++) {
                    const socket = sockets[index];
                    await command(socket, () => socket.joinRoom(row.roomId, args.password, host.pve.ver), () => socket.joinedRoom === row.roomId, 'join_room', true);
                    await command(socket, () => socket.ready(socket.charId), () => readyConfirmed.has(String(socket.charId)), 'ready');
                }
                await waitUntil(() => joiners.every(player => readyConfirmed.has(String(player.charId))), 15000, 'semua joiner ready');
                await command(hostSocket, () => hostSocket.startGame(), () => battleStarted, 'battle_start');
                const battleTimeout = Number((process.env && process.env.NS_COOP_BATTLE_TIMEOUT) || 180000);
                await waitUntil(() => Boolean(outcome), battleTimeout, 'battle outcome');
                row.outcome = outcome.event;
                row.score = outcome.data && outcome.data.score || null;
                row.prize = outcome.data && (outcome.data.reward || outcome.data.prize) || null;
                row.energyEstimatedAfter = players.map(player => ({ username: player.username, energy: player.energy - (player === host ? hostCost : joinCost) }));
                const expected = new Map(row.energyEstimatedAfter.map(item => [item.username, item.energy]));
                const energyDeadline = Date.now() + 20000;
                let snapshots;
                while (true) {
                    snapshots = [];
                    for (const player of players) {
                        const fresh = await readPveInit(player.session);
                        if (!fresh || !Number.isFinite(fresh.energy)) throw new Error('Refresh energy setelah battle gagal: ' + player.username);
                        snapshots.push({ player, fresh });
                    }
                    if (snapshots.every(item => item.fresh.energy === expected.get(item.player.username))) break;
                    if (Date.now() >= energyDeadline) throw new Error('Server belum mengonfirmasi biaya energy 25/5/5');
                    await sleep(1000);
                }
                scheduler.matches++;
                for (const { player, fresh } of snapshots) { player.pve = fresh; player.energy = fresh.energy; }
                row.energyAfter = players.map(player => ({ username: player.username, energy: player.energy }));
                row.confirmed = true;
                line('  Match ' + row.match + ': ' + row.outcome + ' (server), host=' + row.host);
            } catch (error) {
                row.outcome = row.confirmed ? row.outcome : 'failed';
                row.error = error.message;
                throw error;
            } finally {
                stopped = true;
                for (const socket of sockets) {
                    try { if (row.roomId) socket.leaveRoom(row.roomId); } catch (_) {}
                    socket.close();
                }
                row.duration = (Date.now() - startedAt) / 1000;
                saveReport();
            }
        }
        if (report.length === 0) throw new Error('Tidak ada match: butuh tiga akun dengan energy minimal host/join/join = 25/5/5');
        const successful = report.length > 0 && report.every(row => row.confirmed && !row.error);
        if (successful && args.strategy !== 'B') {
            validation = { roster, quest: quest.quest, stage: report.length >= 3 && new Set(report.map(row => row.host)).size === 3 ? 3 : Math.max(validation.stage, 1), verifiedAt: new Date().toISOString() };
            fs.writeFileSync(validationFile, JSON.stringify(validation, null, 2));
        }
    } catch (error) {
        failure = error.message;
        process.exitCode = 1;
        line('  STOP: ' + failure);
    } finally {
        await Promise.all([...solvers.values()].map(solver => solver.close()));
        saveReport();
    }
}
(async () => {
    if (process.argv.includes('--selftest')) {
        // uji parser tanpa jaringan
        const tmp = path.join(require('os').tmpdir(), 'coop_test_' + Date.now() + '.txt');
        fs.writeFileSync(tmp, '# c\nhost:dummy1:p@ss:1\nmain:akun1:pw2:60:1\ngarbage\nmain:akun2:pass:1\n');
        const accs = parseAccountsFile(tmp);
        fs.unlinkSync(tmp);
        let fail = 0; const eq = (l, g, w) => { const ok = g === w; if (!ok) fail++; console.log((ok ? '  OK   ' : '  FAIL ') + l + (ok ? '' : ' got=' + JSON.stringify(g))); };
        eq('parse count', accs.length, 3);
        eq('role host', accs[0].role, 'host');
        eq('4-col password', accs[0].password, 'p@ss');
        eq('4-col slot', accs[0].slot, '1');
        eq('5-col password (accounts.txt style)', accs[1].password, 'pw2');
        eq('5-col targetLevel', accs[1].targetLevel, 60);
        eq('5-col slot', accs[1].slot, '1');
        eq('3-col slot default', accs[2].slot, '1');
        eq('questId find (enemy501 extreme -> 3)', findQuestId([{ display_boss: ['enemy501'], quest_obj: [{ quest: 0, energy: [10, 5] }, { quest: 1, energy: [15, 5] }, { quest: 2, energy: [20, 5] }, { quest: 3, energy: [25, 5], score: [1800, 500] }] }, { display_boss: ['enemy533'], quest_obj: [{ quest: 13, energy: [25, 5] }] }], 'minotaur', 'extreme').quest, 3);
        console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
        process.exit(fail === 0 ? 0 : 1);
    }
    const args = parseArgs(process.argv.slice(2));
    c.enableGracefulStop('menu');
    let accounts;
    try { accounts = parseAccountsFile(args.accounts, (args.captchaTest || args.preflight) ? null : 3); }
    catch (e) { line(e.message); process.exit(1); }
    if (!accounts.length) { line('Tidak ada akun valid di ' + args.accounts); process.exit(1); }
    if (args.preflight) await runPreflight(args, accounts);
    else if (args.captchaTest) await runCaptchaTest(args, accounts);
    else if (args.dryRun) await runDryRun(args, accounts);
    else await runLive(args, accounts);
    process.exit(process.exitCode || 0);
})().catch(e => { line('FATAL: ' + (e && e.message)); process.exit(1); });
