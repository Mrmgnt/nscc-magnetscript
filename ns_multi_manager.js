#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_multi_manager.js — Ninja Saga Multi-Account & Multi-Character Runner
 *
 * Fitur:
 *   - Membaca daftar akun dari accounts.txt dengan format:
 *       username:password:targetLevel:characterSlot
 *   - Mendukung slot "all" / "*" (auto-detect semua karakter di akun) atau "1,2" (multi-slot).
 *   - Mode PARALEL PER AKUN (default 3 akun berbeda jalan bersamaan):
 *       * Akun berbeda berjalan paralel sehingga total waktu terpangkas drastis.
 *       * Karakter di dalam akun yang SAMA tetap dijalankan berurutan (serial) dengan
 *         penjaga cooldown 21s agar aman dari "Session validation failed".
 *   - Full Auto Claim Daily Login terintegrasi (Absen 5 Hari, Daily Calendar, Free Scratch, Claim Token Harian).
 *   - Full Automate Scheduler Loop 15 Menit untuk Event Mission (Battle + Werewolf Mini-game) & Misi Energi:
 *       * Ketika energi/Heart/Bullet habis di seluruh akun, otomatis menunggu 15 menit lalu me-run ulang!
 *       * Pada mode Harian + Full Event Loop, putaran #1 menjalankan Full Login + Daily + Event,
 *         putaran #2 dst. fokus ke Full Event (Battle + Wolf), dan otomatis mengulang Daily saat ganti hari.
 *   - Laporan ringkasan disimpan ke multi_manager_report.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const c = require('./nsclient.js');
const { getLocalDateStr } = require('./lib/ns_mission_history.js');

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const REPORT_FILE = path.join(__dirname, 'multi_manager_report.json');
const DEFAULT_CONCURRENCY = Number(process.env.NS_MULTI_CONCURRENCY || 3);
const DEFAULT_DELAY_SEC = 1;
const DEFAULT_LOOP_INTERVAL_MIN = 15;
const MIN_LAUNCH_GAP_MS = 2300; // Jeda anti rate-limit IP antar peluncuran login child process
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);

function formatSec(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

const activeChildren = new Set();
process.on('exit', () => {
    for (const ch of activeChildren) {
        try { ch.kill(); } catch (_) { }
    }
});

function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        console.log('\n[!] File "accounts.txt" belum ditemukan!');
        console.log('    Salin file "accounts.example.txt" menjadi "accounts.txt"');
        console.log('    Format: username:password:targetLevel:characterSlot\n');
        return [];
    }
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    const accounts = [];
    const lines = raw.split(/\r?\n/);
    for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (!trimmed.includes(':')) continue;
        const parts = trimmed.split(':').map(s => s.trim());
        const user = parts[0] || '';
        const pass = parts[1] || '';
        const targetLevel = parts[2] ? parseInt(parts[2], 10) : 60;
        const slotRaw = parts[3] || 'all';
        if (!user || !pass) continue;

        const normTarget = isNaN(targetLevel) ? 60 : targetLevel;
        if (slotRaw.includes(',')) {
            const subSlots = slotRaw.split(',').map(s => s.trim()).filter(Boolean);
            for (const sl of subSlots) {
                accounts.push({ user, pass, targetLevel: normTarget, slot: sl });
            }
        } else {
            accounts.push({ user, pass, targetLevel: normTarget, slot: slotRaw });
        }
    }
    return accounts;
}

/**
 * Deteksi & resolusi karakter per akun secara paralel antar akun unik.
 */
async function expandAccountsIfNeeded(rawAccounts, concurrency = DEFAULT_CONCURRENCY) {
    const expanded = [];
    const seenKeys = new Set();
    const accountCache = new Map();

    const userRowCount = new Map();
    const uniqueCreds = [];
    const seenCreds = new Set();

    for (const acc of rawAccounts) {
        const uk = acc.user.toLowerCase();
        userRowCount.set(uk, (userRowCount.get(uk) || 0) + 1);
        const sl = String(acc.slot || '').trim().toLowerCase();
        const needsDetect = (sl === '' || sl === 'all' || sl === '*' || !/^\d+$/.test(sl));
        if (!needsDetect) continue;
        const credKey = `${uk}:${acc.pass}`;
        if (!seenCreds.has(credKey)) {
            seenCreds.add(credKey);
            uniqueCreds.push({ key: credKey, user: acc.user, pass: acc.pass });
        }
    }

    async function fetchAccountChars(user, pass, key) {
        if (accountCache.has(key)) return accountCache.get(key);
        const s = await c.login(user, pass);
        if (!s.ok) {
            const errInfo = { ok: false, error: s.message || s.stage };
            accountCache.set(key, errInfo);
            return errInfo;
        }

        let chars = [];
        for (let t = 1; t <= 3; t++) {
            const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
            if (rl && rl.body && Array.isArray(rl.body.result)) {
                chars = rl.body.result;
                break;
            }
            if (t < 3) await sleep(800);
        }

        const isEmblem = Boolean(s.isEmblem || Number(s.accountType) === 2);
        const entry = { ok: true, isEmblem, chars };
        accountCache.set(key, entry);
        return entry;
    }

    if (uniqueCreds.length > 0) {
        const detectWorkers = Math.max(1, Math.min(2, concurrency || 1, uniqueCreds.length));
        line(`Mendeteksi daftar karakter pada ${uniqueCreds.length} akun multi-slot...`);
        let credIdx = 0;
        await Promise.all(Array.from({ length: detectWorkers }, async (_, wIdx) => {
            if (wIdx > 0) await sleep(wIdx * 1800);
            while (credIdx < uniqueCreds.length) {
                const cur = uniqueCreds[credIdx++];
                if (!cur) break;
                try {
                    await fetchAccountChars(cur.user, cur.pass, cur.key);
                } catch (err) {
                    accountCache.set(cur.key, { ok: false, error: err.message });
                }
            }
        }));

        for (const cur of uniqueCreds) {
            const info = accountCache.get(cur.key);
            if (info && info.ok && info.chars.length > 0) {
                const slotsSummary = info.chars.map((ch, idx) => `Slot ${idx + 1}: ${ch[1] || ('Char_' + ch[0])} (Lv ${ch[2] || 1})`).join(' | ');
                line(`  -> ${cur.user}${info.isEmblem ? ' [EMBLEM]' : ' [FREE]'}: ${slotsSummary}`);
            }
        }
        await sleep(1800);
    }

    for (const acc of rawAccounts) {
        const sl = String(acc.slot || '').trim().toLowerCase();
        const isAll = (sl === '' || sl === 'all' || sl === '*');
        const credKey = `${acc.user.toLowerCase()}:${acc.pass}`;

        // Jika slot berupa angka eksplisit (misal "1") dan belum perlu pre-login, langsung jadwalkan hemat 1x login!
        if (!isAll && /^\d+$/.test(sl) && !accountCache.has(credKey)) {
            const dedup = `${acc.user.toLowerCase()}:slot:${sl}`;
            if (!seenKeys.has(dedup)) {
                seenKeys.add(dedup);
                expanded.push({
                    user: acc.user,
                    pass: acc.pass,
                    targetLevel: acc.targetLevel,
                    slot: sl
                });
            }
            continue;
        }

        try {
            const info = accountCache.get(credKey) || await fetchAccountChars(acc.user, acc.pass, credKey);
            if (!info.ok) {
                line(`  [!] Login gagal untuk ${acc.user}: ${info.error}. Tetap dijadwalkan slot ${isAll ? '1' : acc.slot}.`);
                const fallbackSlot = isAll ? '1' : String(acc.slot || '1');
                const dedup = `${acc.user.toLowerCase()}:slot:${fallbackSlot}`;
                if (!seenKeys.has(dedup)) {
                    seenKeys.add(dedup);
                    expanded.push({ ...acc, slot: fallbackSlot });
                }
                continue;
            }

            if (info.chars.length === 0) {
                line(`  [!] Tidak ada karakter ditemukan di ${acc.user}.`);
                continue;
            }

            if (isAll) {
                info.chars.forEach((ch, idx) => {
                    const cId = String(ch[0]);
                    const dedup = `${acc.user.toLowerCase()}:${cId}`;
                    if (seenKeys.has(dedup)) return;
                    seenKeys.add(dedup);
                    expanded.push({
                        user: acc.user,
                        pass: acc.pass,
                        targetLevel: acc.targetLevel,
                        isEmblem: info.isEmblem,
                        slot: String(idx + 1),
                        charId: cId,
                        charName: String(ch[1] || ('Char_' + cId)),
                        charLevel: Number(ch[2]) || 1
                    });
                });
            } else {
                const picked = c.getSelectedChar(info.chars, acc.slot);
                if (!picked) {
                    line(`  [SKIP] Akun ${acc.user}: slot/karakter "${acc.slot}" tidak tersedia (total karakter: ${info.chars.length}).`);
                    continue;
                }
                const slotIdx = info.chars.indexOf(picked) + 1;
                const cId = String(picked[0]);
                const dedup = `${acc.user.toLowerCase()}:${cId}`;
                if (seenKeys.has(dedup)) continue;
                seenKeys.add(dedup);

                if (info.isEmblem && info.chars.length > 1 && userRowCount.get(acc.user.toLowerCase()) === 1) {
                    line(`  [i] Akun ${acc.user} [EMBLEM] punya ${info.chars.length} karakter; konfigurasi slot=${acc.slot} hanya menjalankan Slot ${slotIdx} (gunakan "all" di accounts.txt untuk semua karakter).`);
                }

                expanded.push({
                    user: acc.user,
                    pass: acc.pass,
                    targetLevel: acc.targetLevel,
                    isEmblem: info.isEmblem,
                    slot: String(slotIdx),
                    charId: cId,
                    charName: String(picked[1] || ('Char_' + cId)),
                    charLevel: Number(picked[2]) || 1
                });
            }
        } catch (err) {
            line(`  [!] Gagal cek karakter ${acc.user}: ${err.message}. Fallback ke slot ${isAll ? '1' : acc.slot}.`);
            expanded.push({ ...acc, slot: isAll ? '1' : acc.slot });
        }
    }
    return expanded;
}

function pipeWithPrefix(stream, prefix, isErr = false) {
    let remainder = '';
    stream.on('data', chunk => {
        const text = remainder + chunk.toString('utf8');
        const parts = text.split(/\r?\n/);
        remainder = parts.pop() || '';
        for (const p of parts) {
            if (!p.trim()) continue;
            if (isErr && /tput|tcsetattr|Inappropriate ioctl/i.test(p)) continue;
            console.log(`${prefix} ${p}`);
        }
    });
    stream.on('end', () => {
        if (remainder.trim()) {
            console.log(`${prefix} ${remainder}`);
            remainder = '';
        }
    });
}

function runScriptForAccount(scriptName, args, acc, opts = {}) {
    return new Promise(resolve => {
        const prefix = opts.prefix || '';
        const childEnv = Object.assign({}, process.env);
        delete childEnv.NS_CHAR_ID;
        delete childEnv.NS_CHAR_NAME;
        delete childEnv.NS_CHAR_LEVEL;
        delete childEnv.NS_CHAR_GENDER;
        delete childEnv.NS_CHAR_SLOT;

        childEnv.NS_USER = acc.user;
        childEnv.NS_PASS = acc.pass;
        childEnv.NS_CHAR_SLOT = String(acc.slot || '1');
        childEnv.NS_TARGET_LEVEL = String(acc.targetLevel || 60);
        if (acc.charId) childEnv.NS_CHAR_ID = String(acc.charId);
        if (acc.charName) childEnv.NS_CHAR_NAME = String(acc.charName);
        if (acc.charLevel) childEnv.NS_CHAR_LEVEL = String(acc.charLevel);

        const scriptPath = path.join(__dirname, scriptName);
        const usePipe = Boolean(prefix);
        const child = spawn(process.execPath, [scriptPath, ...args], {
            cwd: __dirname,
            env: childEnv,
            stdio: usePipe ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            windowsHide: true
        });
        activeChildren.add(child);

        if (usePipe) {
            pipeWithPrefix(child.stdout, prefix, false);
            pipeWithPrefix(child.stderr, prefix, true);
        }

        child.on('close', code => {
            activeChildren.delete(child);
            resolve({ ok: code === 0, code });
        });

        child.on('error', err => {
            activeChildren.delete(child);
            resolve({ ok: false, error: err.message });
        });
    });
}

/**
 * Susun antrean secara bergiliran per akun (round-robin) untuk mode 1-worker (serial).
 */
function interleaveAccounts(list) {
    const groups = new Map();
    for (const acc of list) {
        const key = String(acc.user || '').toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(acc);
    }
    const queues = Array.from(groups.values());
    const ordered = [];
    let added = true;
    while (added) {
        added = false;
        for (const q of queues) {
            if (q.length > 0) {
                ordered.push(q.shift());
                added = true;
            }
        }
    }
    return ordered;
}

/**
 * Kelompokkan karakter per akun unik, urutkan dari akun dengan slot terbanyak
 * supaya akun multi-karakter (Emblem) langsung mulai paling awal saat paralel.
 */
function groupQueuesByAccount(list) {
    const groups = new Map();
    for (const acc of list) {
        const key = String(acc.user || '').toLowerCase();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(acc);
    }
    return Array.from(groups.values()).sort((a, b) => b.length - a.length);
}

const DEFAULT_AUTO_LOOP_ACTIONS = new Set([
    'auto_all_event',
    'daily_thanksgiving_full_loop',
    'thanksgiving_full_loop',
    'thanksgiving_battle_loop',
    'thanksgiving_minigame_loop'
]);

function normalizeLoopBaseAction(action) {
    if (action === 'auto_all_event' || action === 'daily_thanksgiving_full_loop') return 'daily_thanksgiving_full';
    if (action === 'thanksgiving_full_loop') return 'thanksgiving_full';
    if (action === 'thanksgiving_battle_loop') return 'thanksgiving_battle';
    if (action === 'thanksgiving_minigame_loop') return 'thanksgiving_minigame';
    return action;
}

function getFollowupEventAction(baseAction) {
    if (baseAction === 'daily_thanksgiving_full' || baseAction === 'auto_all_event') return 'thanksgiving_full';
    if (baseAction === 'daily_thanksgiving_battle' || baseAction === 'daily_thanksgiving' || baseAction === 'daily_tg_battle') return 'thanksgiving_battle';
    if (baseAction === 'daily_thanksgiving_minigame') return 'thanksgiving_minigame';
    return baseAction;
}

function isDailyPlusEventAction(baseAction) {
    return [
        'daily_thanksgiving_full',
        'daily_tg_full',
        'daily_thanksgiving_battle',
        'daily_thanksgiving',
        'daily_tg_battle',
        'daily_thanksgiving_minigame'
    ].includes(baseAction);
}

function buildScriptArgs(action, acc, extraArgs) {
    if (extraArgs && extraArgs.length > 0) return extraArgs;
    const base = normalizeLoopBaseAction(action);
    if (base === 'daily_login' || base === 'login_claim') return [];
    if (base === 'daily' || base === 'daily_pure') return ['--pure'];
    if (base === 'daily_hh') return ['--pure', '--with-hh-battle'];
    if (base === 'daily_level' || base === 'full') return acc.targetLevel ? ['--level', String(acc.targetLevel)] : [];
    if (base === 'daily_thanksgiving_battle' || base === 'daily_thanksgiving' || base === 'daily_tg_battle') return ['--pure', '--with-thanksgiving-battle'];
    if (base === 'daily_thanksgiving_minigame') return ['--pure', '--with-thanksgiving-minigame'];
    if (base === 'daily_thanksgiving_full' || base === 'daily_tg_full') return ['--pure', '--with-thanksgiving-full'];
    if (base === 'eudemon' || base === 'dragon') return ['eudemon', '10', '10.5'];
    if (base === 'house' || base === 'hunting') return ['house', '10', '10.5'];
    if (base === 'claim') return ['claim'];
    if (base === 'hunt_daily') return ['daily', '10', '10.5'];
    if (base === 'hunt' || base === 'both') return ['both', '10', '10.5'];
    if (base === 'train') return ['all', '5', '3'];
    if (base === 'grades') return ['1-4', '11'];
    if (base === 'level') return [String(acc.targetLevel || 60), '3'];
    if (base === 'thanksgiving_battle') return ['battle'];
    if (base === 'thanksgiving_minigame') return ['minigame'];
    if (base === 'thanksgiving_full') return ['full'];
    return ['--pure'];
}

function resolveActionMeta(action) {
    const base = normalizeLoopBaseAction(action);
    switch (base) {
        case 'daily_login':
        case 'login_claim':
            return { targetScript: 'ns_daily_login.js', actionLabel: 'FULL AUTO CLAIM LOGIN HARIAN (ABSEN + CALENDAR + SCRATCH + TOKEN)' };
        case 'daily':
        case 'daily_pure':
            return { targetScript: 'ns_daily.js', actionLabel: 'JATAH HARIAN FULL (ABSEN+CALENDAR+SCRATCH+TOKEN + TP/SS + EUDEMON + CLAIM HH)' };
        case 'daily_hh':
            return { targetScript: 'ns_daily.js', actionLabel: 'JATAH HARIAN FULL + BATTLE BOSS HUNTING HOUSE' };
        case 'daily_level':
        case 'full':
            return { targetScript: 'ns_daily.js', actionLabel: 'JATAH HARIAN LENGKAP + AUTO LEVELING / GRADE S' };
        case 'daily_thanksgiving_battle':
        case 'daily_thanksgiving':
        case 'daily_tg_battle':
            return { targetScript: 'ns_daily.js', actionLabel: 'JATAH HARIAN FULL + THANKSGIVING BATTLE (TANPA BATTLE HH)' };
        case 'daily_thanksgiving_minigame':
            return { targetScript: 'ns_daily.js', actionLabel: 'JATAH HARIAN FULL + THANKSGIVING WEREWOLF MINI-GAME' };
        case 'daily_thanksgiving_full':
        case 'daily_tg_full':
            return { targetScript: 'ns_daily.js', actionLabel: 'JATAH HARIAN FULL + FULL EVENT MISSION (BATTLE + WEREWOLF MINI-GAME)' };
        case 'eudemon':
        case 'dragon':
            return { targetScript: 'ns_hunt.js', actionLabel: 'EUDEMON DRAGON SAJA (AUTO 3X EMBLEM / 1X FREE)' };
        case 'house':
        case 'hunting':
            return { targetScript: 'ns_hunt.js', actionLabel: 'HUNTING HOUSE SAJA (AUTO CLAIM + BATTLE BOSS)' };
        case 'claim':
            return { targetScript: 'ns_hunt.js', actionLabel: 'CLAIM DAILY HUNTING HOUSE PASSPORT SAJA (TANPA BATTLE)' };
        case 'hunt_daily':
            return { targetScript: 'ns_hunt.js', actionLabel: 'EUDEMON DRAGON + CLAIM HUNTING HOUSE (TANPA BATTLE HH)' };
        case 'hunt':
        case 'both':
            return { targetScript: 'ns_hunt.js', actionLabel: 'HUNTING HOUSE + EUDEMON DRAGON (BATTLE SEMUA)' };
        case 'train':
            return { targetScript: 'ns_train.js', actionLabel: 'TRAINING TP & SS SAJA' };
        case 'grades':
            return { targetScript: 'ns_grade_s.js', actionLabel: 'MISI GRADE S (AUTO STAMINA RUNNER)' };
        case 'level':
            return { targetScript: 'ns_level.js', actionLabel: 'AUTO GRINDING LEVEL + UJIAN HARD' };
        case 'thanksgiving_battle':
            return { targetScript: 'ns_thanksgiving.js', actionLabel: 'THANKSGIVING BATTLE (HABISKAN HEART)' };
        case 'thanksgiving_minigame':
            return { targetScript: 'ns_thanksgiving.js', actionLabel: 'THANKSGIVING MINI-GAME (HABISKAN AMMO WEREWOLF)' };
        case 'thanksgiving_full':
            return { targetScript: 'ns_thanksgiving.js', actionLabel: 'FULL EVENT MISSION THANKSGIVING (BATTLE + WEREWOLF MINI-GAME)' };
        default:
            return { targetScript: 'ns_daily.js', actionLabel: 'JATAH HARIAN FULL (ABSEN+CALENDAR+SCRATCH+TOKEN + TP/SS + EUDEMON + CLAIM HH)' };
    }
}

async function runBulk(action, extraArgs = [], delaySec = DEFAULT_DELAY_SEC, concurrency = DEFAULT_CONCURRENCY, options = {}) {
    const normConcurrency = Math.max(1, parseInt(concurrency, 10) || DEFAULT_CONCURRENCY);
    let expanded = options.preExpanded || null;
    if (!expanded) {
        const rawAccounts = options.rawAccounts || loadAccounts();
        if (rawAccounts.length === 0) return { total: 0, success: 0, failed: 0, details: [] };
        expanded = await expandAccountsIfNeeded(rawAccounts, normConcurrency);
    }
    if (!expanded || expanded.length === 0) return { total: 0, success: 0, failed: 0, details: [] };

    const baseAction = normalizeLoopBaseAction(action);
    const accountQueues = groupQueuesByAccount(expanded);
    const effectiveConcurrency = Math.min(normConcurrency, accountQueues.length);
    const { targetScript, actionLabel } = resolveActionMeta(baseAction);
    const runTaskFn = options.runScriptFn || runScriptForAccount;

    console.log('\n==========================================================');
    console.log('      NINJA SAGA MULTI-ACCOUNT & MULTI-CHAR RUNNER');
    console.log('                cc: MagnetScript(Razki)');
    console.log('==========================================================');
    if (options.cycleNumber) {
        console.log(`  Putaran Auto-Loop     : #${options.cycleNumber} (Cek ulang tiap ${options.intervalMin || DEFAULT_LOOP_INTERVAL_MIN} menit)`);
    }
    console.log(`  Total Karakter Antrean: ${expanded.length} (${accountQueues.length} akun unik)`);
    console.log(`  Mode Farming          : ${actionLabel}`);
    console.log(`  Script Target         : ${targetScript}`);
    console.log(`  Mode Eksekusi         : ${effectiveConcurrency > 1 ? `PARALEL ${effectiveConcurrency} AKUN SEKALIGUS (slot se-akun tetap serial aman)` : 'SEKUENSIAL (1 per 1)'}`);
    console.log(`  Jeda Antar Slot Akun  : ${delaySec} detik`);
    console.log('==========================================================\n');

    const results = [];
    const startTime = Date.now();
    const lastCooldownAnchor = new Map();
    const ACCOUNT_COOLDOWN_MS = 21000;
    const endAnchorActions = new Set(['level', 'daily_level', 'full']);
    let startedCounter = 0;
    let nextLaunchAllowedAt = 0;
    let launchChain = Promise.resolve();

    function acquireLaunchSlot() {
        const p = launchChain.then(async () => {
            const nowMs = Date.now();
            if (nowMs < nextLaunchAllowedAt) {
                await sleep(nextLaunchAllowedAt - nowMs);
            }
            nextLaunchAllowedAt = Date.now() + MIN_LAUNCH_GAP_MS;
        });
        launchChain = p.catch(() => { });
        return p;
    }

    async function executeOneCharacter(acc, idxLabel, isParallelMode) {
        const userKey = acc.user.toLowerCase();
        const prevAnchor = lastCooldownAnchor.get(userKey);
        if (prevAnchor) {
            const elapsed = Date.now() - prevAnchor;
            if (elapsed < ACCOUNT_COOLDOWN_MS) {
                const needWaitMs = ACCOUNT_COOLDOWN_MS - elapsed;
                line(`${idxLabel} [Cooldown] Menunggu sisa ${(needWaitMs / 1000).toFixed(1)}s untuk slot berikutnya di akun ${acc.user}...`);
                await sleep(needWaitMs);
            } else if (delaySec > 0) {
                await sleep(delaySec * 1000);
            }
        }

        if (isParallelMode) {
            await acquireLaunchSlot();
        }

        const scriptArgs = buildScriptArgs(baseAction, acc, extraArgs);
        const charDesc = acc.charName ? `${acc.charName} (Lv ${acc.charLevel}, Slot ${acc.slot})` : `Slot ${acc.slot}`;
        const prefix = isParallelMode ? `[${acc.user}#${acc.slot}]` : '';
        line(`${idxLabel} Memulai: ${acc.user} | Karakter: ${charDesc} | Target: Lv ${acc.targetLevel} ...`);

        const accStart = Date.now();
        let res;
        try {
            res = await runTaskFn(targetScript, scriptArgs, acc, { prefix });
        } catch (e) {
            res = { ok: false, error: e.message };
        }

        if (!res.ok) {
            const retryWaitSec = options.retryWaitSec !== undefined ? options.retryWaitSec : 21;
            line(`${idxLabel} [RETRY] ${acc.user} (${charDesc}) gagal (exit: ${res.code || res.error}). Mencoba ulang setelah ${retryWaitSec}s...`);
            if (retryWaitSec > 0) await sleep(retryWaitSec * 1000);
            if (isParallelMode) {
                await acquireLaunchSlot();
            }
            try {
                res = await runTaskFn(targetScript, scriptArgs, acc, { prefix });
            } catch (e) {
                res = { ok: false, error: e.message };
            }
        }

        const accEnd = Date.now();
        const accDuration = Math.round((accEnd - accStart) / 1000);
        const anchorMs = endAnchorActions.has(baseAction) ? accEnd : Math.min(accEnd, accStart + 3500);
        lastCooldownAnchor.set(userKey, anchorMs);

        if (res.ok) {
            line(`${idxLabel} SELESAI: ${acc.user} (${charDesc}) (durasi: ${accDuration}s)`);
            results.push({ user: acc.user, slot: acc.slot, charName: acc.charName || '', targetLevel: acc.targetLevel, status: 'SUCCESS', duration: accDuration });
        } else {
            line(`${idxLabel} GAGAL: ${acc.user} (${charDesc}) (exit: ${res.code || res.error})`);
            results.push({ user: acc.user, slot: acc.slot, charName: acc.charName || '', targetLevel: acc.targetLevel, status: 'FAILED', code: res.code, error: res.error, duration: accDuration });
        }
    }

    if (effectiveConcurrency <= 1) {
        const accounts = interleaveAccounts(expanded);
        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            const idxLabel = `[${i + 1}/${accounts.length}]`;
            await executeOneCharacter(acc, idxLabel, false);

            if (i < accounts.length - 1 && delaySec > 0) {
                const nextAcc = accounts[i + 1];
                const nextPrevAnchor = lastCooldownAnchor.get(nextAcc.user.toLowerCase());
                const nextNeedMs = nextPrevAnchor ? Math.max(0, ACCOUNT_COOLDOWN_MS - (Date.now() - nextPrevAnchor)) : 0;
                if (nextNeedMs === 0 && nextAcc.user.toLowerCase() !== acc.user.toLowerCase()) {
                    await sleep(delaySec * 1000);
                }
            }
        }
    } else {
        let queueCursor = 0;
        const workers = Array.from({ length: effectiveConcurrency }, async (_, workerIdx) => {
            if (workerIdx > 0) await sleep(workerIdx * 250);
            while (queueCursor < accountQueues.length) {
                const myQueue = accountQueues[queueCursor++];
                if (!myQueue || !myQueue.length) continue;
                for (let sIdx = 0; sIdx < myQueue.length; sIdx++) {
                    const acc = myQueue[sIdx];
                    startedCounter++;
                    const idxLabel = `[#${startedCounter}/${expanded.length}]`;
                    await executeOneCharacter(acc, idxLabel, true);
                }
            }
        });
        await Promise.all(workers);
    }

    const totalDuration = Math.round((Date.now() - startTime) / 1000);
    const successCount = results.filter(r => r.status === 'SUCCESS').length;
    const failCount = results.filter(r => r.status === 'FAILED').length;

    const summaryPayload = {
        action: baseAction,
        actionLabel,
        cycleNumber: options.cycleNumber || 1,
        concurrency: effectiveConcurrency,
        timestamp: new Date().toISOString(),
        total: expanded.length,
        success: successCount,
        failed: failCount,
        total_duration_sec: totalDuration,
        details: results
    };

    if (!options.skipReportWrite) {
        try {
            fs.writeFileSync(REPORT_FILE, JSON.stringify(summaryPayload, null, 2), 'utf8');
        } catch (_) { }
    }

    console.log('\n==========================================================');
    console.log(`        LAPORAN RINGKASAN MULTI-ACCOUNT${options.cycleNumber ? ` (PUTARAN #${options.cycleNumber})` : ''}`);
    console.log('==========================================================');
    console.log(`  Total Karakter Dikerjakan : ${expanded.length}`);
    console.log(`  Mode Paralel              : ${effectiveConcurrency} akun sekaligus`);
    console.log(`  Sukses                     : ${successCount}`);
    console.log(`  Gagal                      : ${failCount}`);
    console.log(`  Total Waktu                : ${totalDuration} detik`);
    console.log(`  Log Tersimpan Di           : ${REPORT_FILE}`);
    console.log('----------------------------------------------------------');
    results.forEach((r, idx) => {
        const st = r.status === 'SUCCESS' ? '✓ OK  ' : '✗ GAGAL';
        const cLabel = r.charName ? `Slot ${r.slot} (${r.charName})` : `Slot ${r.slot}`;
        console.log(`  ${idx + 1}. [${st}] ${r.user.padEnd(16)} ${cLabel.padEnd(22)} (${r.duration}s)`);
    });
    console.log('==========================================================\n');

    return summaryPayload;
}

/**
 * Mode Full Automate Loop (Standby 15 menit lalu run ulang semua akun secara otomatis).
 */
async function runBulkLoop(action, extraArgs = [], delaySec = DEFAULT_DELAY_SEC, concurrency = DEFAULT_CONCURRENCY, options = {}) {
    const intervalMin = Number.isFinite(Number(options.intervalMin)) && Number(options.intervalMin) > 0
        ? Number(options.intervalMin)
        : DEFAULT_LOOP_INTERVAL_MIN;
    const waitSec = Math.max(60, Math.round(intervalMin * 60));
    const sleepFn = options.sleep || sleep;
    const getDateFn = options.getDateStr || getLocalDateStr;
    const maxCycles = options.maxCycles || Infinity;
    const normConcurrency = Math.max(1, parseInt(concurrency, 10) || DEFAULT_CONCURRENCY);

    let expanded = options.preExpanded || null;
    if (!expanded) {
        const rawAccounts = options.rawAccounts || loadAccounts();
        if (rawAccounts.length === 0) return [];
        expanded = await expandAccountsIfNeeded(rawAccounts, normConcurrency);
    }
    if (!expanded || expanded.length === 0) return [];

    const baseAction = normalizeLoopBaseAction(action);
    const smartDailyEvent = isDailyPlusEventAction(baseAction);
    const followupAction = getFollowupEventAction(baseAction);

    line(`>>> MULTI-ACCOUNT FULL AUTOMATE LOOP DIAKTIFKAN (Interval Standby: ${intervalMin} menit) <<<`);
    if (smartDailyEvent) {
        line('  Alur Pintar: Putaran #1 menjalankan Full Daily Login + Jatah Harian + Full Event (Battle & Wolf),');
        line('               Putaran #2 dst. menjalankan Full Event (Battle & Wolf) tiap 15 menit (+ ulangi Daily saat ganti hari).');
    } else {
        line('  Alur Loop  : Menjalankan seluruh akun di accounts.txt, lalu menunggu 15 menit saat energi/kuota habis untuk run lagi.');
    }
    line('  Kontrol    : Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti kembali ke menu.\n');

    let lastDailyDate = '';
    let cycle = 1;
    const cycleSummaries = [];

    while (cycle <= maxCycles) {
        const todayStr = getDateFn();
        const shouldRunFullDaily = smartDailyEvent && (cycle === 1 || todayStr !== lastDailyDate);
        const currentAction = shouldRunFullDaily ? baseAction : (smartDailyEvent ? followupAction : baseAction);

        if (smartDailyEvent && cycle > 1 && shouldRunFullDaily) {
            line(`[AUTO-LOOP] Pergantian tanggal terdeteksi (${todayStr})! Mengulang Full Daily Login + Jatah Harian + Event...`);
        }

        const summary = await runBulk(currentAction, extraArgs, delaySec, normConcurrency, {
            ...options,
            preExpanded: expanded,
            cycleNumber: cycle,
            intervalMin
        });
        cycleSummaries.push(summary);
        if (shouldRunFullDaily) {
            lastDailyDate = todayStr;
        }

        if (cycle >= maxCycles) break;

        line(`[SCHEDULER MULTI-AKUN] Putaran #${cycle} tuntas. Energi/Heart & Bullet Werewolf habis -> Standby ${intervalMin} menit (${formatSec(waitSec)}) sebelum Putaran #${cycle + 1}...`);
        line('[SCHEDULER MULTI-AKUN] Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti.');
        let remain = waitSec;
        while (remain > 0) {
            const step = Math.min(30, remain);
            await sleepFn(step * 1000);
            remain -= step;
            if (remain > 0) {
                line(`[STANDBY MULTI-AKUN] Putaran #${cycle + 1} dimulai dalam ${formatSec(remain)}...`);
            }
        }
        cycle++;
    }

    return cycleSummaries;
}

async function interactiveMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    const accounts = loadAccounts();
    console.log('\n======================================================================');
    console.log('        NINJA SAGA MULTI-ACCOUNT & MULTI-CHARACTER RUNNER');
    console.log('                    cc: MagnetScript(Razki)');
    console.log('======================================================================');
    console.log(`  File Akun: ${ACCOUNTS_FILE} (${accounts.length} baris konfigurasi terdeteksi)`);
    console.log('  Tips Slot: Gunakan "all" di kolom slot untuk jalankan semua karakter');
    console.log('             pada akun Emblem/Multi-Char, atau "1,2" / baris terpisah.');
    console.log('  Auto Login: Semua paket Harian otomatis klaim Absen + Calendar +');
    console.log('              Free Scratch Card + Claim Token Harian!');
    console.log('----------------------------------------------------------------------');
    console.log('  [ PAKET JATAH HARIAN + AUTO LOGIN CLAIM MULTI-AKUN ]');
    console.log('  1. Jatah Harian Full (Absen+Calendar+Scratch+Token + TP/SS + Eudemon + Claim HH)');
    console.log('  2. Jatah Harian Full + Battle Boss Hunting House');
    console.log('  3. Jatah Harian Lengkap + Auto Leveling / Grade S (Sesuai accounts.txt)');
    console.log('  4. Jatah Harian Full + Thanksgiving Battle (Tanpa Battle HH)');
    console.log('  5. FULL AUTOMATE SEMUA: Harian + Full Event Battle & Wolf [AUTO-LOOP 15 MENIT]');
    console.log(' 15. Klaim Login Harian Saja (Absen + Daily Calendar + Scratch + Token Harian)');
    console.log('');
    console.log('  [ FARMING SPESIFIK MULTI-AKUN ]');
    console.log('  6. Eudemon Dragon Saja (Auto 3x Emblem / 1x Free per Room)');
    console.log('  7. Hunting House Saja (Auto Claim Daily Passport + Battle Boss)');
    console.log('  8. Claim Daily Hunting House Saja (Tanpa Battle - Ambil 5/10 Tiket)');
    console.log('  9. Training TP & SS Saja');
    console.log('');
    console.log('  [ EVENT THANKSGIVING 2026 & WOLF MINI-GAME ]');
    console.log(' 10. Farming Battle Thanksgiving (Sampai Heart Habis / Loop 15m)');
    console.log(' 11. Farming Wolf Mini-game Thanksgiving (Sampai Bullet Habis / Loop 15m)');
    console.log(' 12. FULL EVENT MISSION: Battle + Wolf Mini-game [AUTO-LOOP 15 MENIT]');
    console.log('');
    console.log('  [ MISI & LEVELING MULTI-AKUN ]');
    console.log(' 13. Misi Grade S Saja (Auto Stamina Runner - Stage 1-4 / Loop 15m)');
    console.log(' 14. Auto Grinding Level + Ujian Saja (Target level di accounts.txt)');
    console.log('  0. Kembali ke Menu Utama');
    console.log('======================================================================');

    const choice = (await ask('Pilih menu [0-15, Enter = 5 (Full Automate)] : ')).trim() || '5';
    if (choice === '0') {
        rl.close();
        return;
    }

    const choiceMap = {
        '1': 'daily_pure',
        '2': 'daily_hh',
        '3': 'daily_level',
        '4': 'daily_thanksgiving_battle',
        '5': 'auto_all_event',
        '6': 'eudemon',
        '7': 'house',
        '8': 'claim',
        '9': 'train',
        '10': 'thanksgiving_battle',
        '11': 'thanksgiving_minigame',
        '12': 'thanksgiving_full_loop',
        '13': 'grades',
        '14': 'level',
        '15': 'daily_login'
    };

    const selectedAction = choiceMap[choice];
    if (!selectedAction) {
        rl.close();
        console.log('Pilihan tidak valid.');
        return;
    }

    let useLoop = DEFAULT_AUTO_LOOP_ACTIONS.has(selectedAction);
    let intervalMin = DEFAULT_LOOP_INTERVAL_MIN;

    if (['10', '11', '13', '4'].includes(choice)) {
        const loopAns = (await ask('Aktifkan Auto-Loop tunggu 15 menit saat energi/kuota habis? [Y/n, Enter = Y] : ')).trim().toLowerCase();
        useLoop = loopAns === '' || loopAns === 'y' || loopAns === 'yes';
    }

    if (useLoop) {
        const rawInt = (await ask(`Interval cek ulang saat energi habis dalam menit (default = ${DEFAULT_LOOP_INTERVAL_MIN} menit) : `)).trim();
        const parsedInt = Number(rawInt);
        if (Number.isFinite(parsedInt) && parsedInt > 0) {
            intervalMin = parsedInt;
        }
    }

    const rawConc = (await ask(`Jumlah akun paralel sekaligus (default = ${DEFAULT_CONCURRENCY}, 1 = sekuensial) : `)).trim();
    const parsedConc = parseInt(rawConc, 10);
    const concurrency = Number.isNaN(parsedConc) ? DEFAULT_CONCURRENCY : Math.max(1, parsedConc);

    const rawDelay = (await ask(`Jeda antar karakter di akun sama dalam detik (default = ${DEFAULT_DELAY_SEC}) : `)).trim();
    const parsedDelay = parseInt(rawDelay, 10);
    const delay = Number.isNaN(parsedDelay) ? DEFAULT_DELAY_SEC : Math.max(0, parsedDelay);

    rl.close();
    c.enableGracefulStop('menu multi-account');

    if (useLoop) {
        await runBulkLoop(selectedAction, [], delay, concurrency, { intervalMin });
    } else {
        await runBulk(selectedAction, [], delay, concurrency);
    }
}

// ═══════════════════════════════════════════════════════════════
// CLI Dispatcher
// ═══════════════════════════════════════════════════════════════
function parseMultiCliArgs(rawArgs) {
    let action = '';
    let delaySec = DEFAULT_DELAY_SEC;
    let concurrency = DEFAULT_CONCURRENCY;
    let loopFlag = null;
    let intervalMin = DEFAULT_LOOP_INTERVAL_MIN;
    const cleanArgs = [];

    for (let i = 0; i < rawArgs.length; i++) {
        const a = rawArgs[i];
        if (a === '--delay' && rawArgs[i + 1] !== undefined) {
            const parsed = parseInt(rawArgs[++i], 10);
            delaySec = Number.isNaN(parsed) ? DEFAULT_DELAY_SEC : Math.max(0, parsed);
        } else if ((a === '--parallel' || a === '--concurrency' || a === '-p') && rawArgs[i + 1] !== undefined) {
            const parsed = parseInt(rawArgs[++i], 10);
            concurrency = Number.isNaN(parsed) ? DEFAULT_CONCURRENCY : Math.max(1, parsed);
        } else if ((a === '--interval' || a === '--interval-min') && rawArgs[i + 1] !== undefined) {
            const parsed = Number(rawArgs[++i]);
            if (Number.isFinite(parsed) && parsed > 0) intervalMin = parsed;
        } else if (a === '--loop') {
            loopFlag = true;
        } else if (a === '--once' || a === '--no-loop') {
            loopFlag = false;
        } else if (a === '--serial') {
            concurrency = 1;
        } else if (!action) {
            action = a.toLowerCase();
        } else {
            cleanArgs.push(a);
        }
    }

    const useLoop = loopFlag !== null ? loopFlag : DEFAULT_AUTO_LOOP_ACTIONS.has(action);
    return { action, delaySec, concurrency, useLoop, intervalMin, cleanArgs };
}

if (require.main === module) {
    (async () => {
        const parsed = parseMultiCliArgs(process.argv.slice(2));
        if (parsed.action) {
            c.enableGracefulStop('menu multi-account');
            if (parsed.useLoop) {
                await runBulkLoop(parsed.action, parsed.cleanArgs, parsed.delaySec, parsed.concurrency, {
                    intervalMin: parsed.intervalMin
                });
            } else {
                await runBulk(parsed.action, parsed.cleanArgs, parsed.delaySec, parsed.concurrency);
            }
        } else {
            await interactiveMenu();
        }
        process.exit(0);
    })().catch(err => {
        line('FATAL ERROR: ' + (err.message || err));
        process.exit(1);
    });
}

module.exports = {
    loadAccounts,
    expandAccountsIfNeeded,
    interleaveAccounts,
    groupQueuesByAccount,
    normalizeLoopBaseAction,
    getFollowupEventAction,
    isDailyPlusEventAction,
    buildScriptArgs,
    resolveActionMeta,
    parseMultiCliArgs,
    runBulk,
    runBulkLoop
};
