#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_thanksgiving.js — Bot Auto Event Thanksgiving 2026 Ninja Saga
 *
 * Fitur:
 *   1. Status Event: Cek sisa Heart (Battle) & Bullet (Mini-game Werewolf) beserta timer refill.
 *   2. Auto Battle (Thanksgiving2015.startBattle + ItemDAO.getBossReward):
 *      - Rotasi 5 musuh event (enemy477..enemy481: Giant Rainbow Turkey .. Giant Corn Humanoid).
 *      - Klaim reward resmi server (item918..item922, item925 Turkey Coin, +30k XP, +30k Gold).
 *   3. Auto Mini-game Werewolf (Thanksgiving2015.startMiniGame + Thanksgiving2015.finishMiniGame):
 *      - Menembak Werewolf stage 1-3 (resultStatus=0, currStage=3), klaim Wolf Teeth/Gunpowder.
 *   4. Dukungan Single Account (--max N / argumen limit), Full Cycle, & Scheduler Loop.
 *
 * Penggunaan CLI:
 *   node ns_thanksgiving.js status
 *   node ns_thanksgiving.js battle [maxBattles]
 *   node ns_thanksgiving.js minigame [maxRuns]
 *   node ns_thanksgiving.js full [maxBattles] [maxMiniGames]
 *   node ns_thanksgiving.js loop [battle|minigame|full]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');

const CONFIG_FILE = path.join(__dirname, 'thanksgiving_event_config.json');
const REPORT_FILE = path.join(__dirname, 'thanksgiving_report.json');
const JSON_EMPTY = '{"battles":[]}';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ts = () => '[' + new Date().toTimeString().slice(0, 8) + '] ';
const line = msg => console.log(ts() + msg);

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function loadConfig(file = CONFIG_FILE) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.enemies = Array.isArray(config.enemies) ? config.enemies : [];
    return config;
}

function findNumber(value, keys) {
    if (!value || typeof value !== 'object') return null;
    for (const key of keys) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== '' && Number.isFinite(Number(value[key]))) {
            return Number(value[key]);
        }
    }
    for (const child of Object.values(value)) {
        const found = child && typeof child === 'object' ? findNumber(child, keys) : null;
        if (found !== null) return found;
    }
    return null;
}

function parseStatus(result) {
    return {
        heart: findNumber(result, ['remain_heart', 'remaining_heart', 'heart', 'heart_remain']),
        heartMax: findNumber(result, ['heart_max', 'max_heart']),
        ammo: findNumber(result, ['remain_ammo', 'remaining_ammo', 'ammo', 'ammo_remain']),
        werewolf: findNumber(result, ['remain_werewolf', 'remaining_werewolf', 'werewolf_remain', 'werewolf_count'])
    };
}

function isConfigured(action) {
    return Boolean(action && action.service && Array.isArray(action.params));
}

function renderParam(value, context) {
    if (typeof value !== 'string') return value;
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => (context[key] === undefined ? '' : String(context[key])));
}

async function callAction(action, context) {
    if (!isConfigured(action)) {
        throw new Error('Protokol Thanksgiving belum diisi. Isi thanksgiving_event_config.json terlebih dahulu.');
    }
    return c.amf(action.service, action.params.map(param => renderParam(param, context)));
}

async function amfWithRetry(service, params, options = {}) {
    const retries = options.retries || 3;
    const onZ9f = options.onZ9f;
    let lastRes = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
        lastRes = await c.amf(service, params);
        const body = (lastRes && lastRes.body) || {};
        if (body.z9f != null && typeof onZ9f === 'function') {
            onZ9f(String(body.z9f));
        }
        if (Number(body.status) === 1 && !lastRes.fault) {
            return { ok: true, response: lastRes, body };
        }
        const errMsg = String(body.error || (lastRes && (lastRes.netError || lastRes.parseError)) || '');
        if (/not enough|heart|bullet|ammo|energy/i.test(errMsg)) {
            return { ok: false, empty: true, error: errMsg, response: lastRes, body };
        }
        if (attempt < retries) {
            const waitMs = /please wait/i.test(errMsg) ? 3000 : 1200;
            await sleep(waitMs);
        }
    }

    const finalBody = (lastRes && lastRes.body) || {};
    const finalErr = String(finalBody.error || (lastRes && (lastRes.netError || lastRes.parseError)) || JSON.stringify(finalBody));
    return { ok: false, empty: false, error: finalErr || 'Unknown AMF error', response: lastRes, body: finalBody };
}

function parseMaterialCounts(raw) {
    const mat = {};
    for (const part of String(raw || '').split(',')) {
        const [id, val] = part.split(':');
        if (id) mat[id] = Number(val) || 0;
    }
    return mat;
}

async function getContext(user, pass, slotOrId, options = {}) {
    const session = await c.login(user, pass);
    if (!session.ok) throw new Error(session.message || 'Login gagal.');

    const charsResponse = await c.amf('CharacterDAO.getCharactersList', [session.sessionKey]);
    const chars = charsResponse && charsResponse.body && Array.isArray(charsResponse.body.result) ? charsResponse.body.result : [];
    const selected = c.getSelectedChar(chars, slotOrId);
    if (!selected) throw new Error('Karakter tidak ditemukan.');

    const charId = String(selected[0]);
    const charName = String(selected[1] || '');
    const level = Number(selected[2]) || 1;
    const context = {
        sessionKey: session.sessionKey,
        token: session.token || '',
        charId,
        charName,
        level,
        slotOrId,
        gk: '',
        ivg: '',
        ivn: '',
        materialsInitial: {}
    };

    if (options.loadCharacterData === false) {
        return context;
    }

    const chRes = await c.getCharacterByIdWithWait(session, charId, {
        maxWaitMs: 45000,
        credentials: { user, pass },
        onCooldown: sec => line(`  [Cooldown] Menunggu ${sec}s sebelum memilih karakter ${charName}...`)
    });
    if (!chRes.ok || !chRes.result || !chRes.gk) {
        throw new Error('Gagal membaca data karakter: ' + (chRes.error || 'cooldown'));
    }
    if (chRes.session && chRes.session.sessionKey) {
        context.sessionKey = chRes.session.sessionKey;
        context.token = chRes.session.token || context.token;
    }
    context.gk = chRes.gk;
    context.level = Number(chRes.result.character_level) || level;
    context.materialsInitial = parseMaterialCounts(chRes.result.character_material);

    const exRes = await c.getExtraDataWithRetry(context.sessionKey, charId, context.token, context.gk, 3);
    if (exRes.ok && exRes.result && exRes.result.z9t) {
        context.ivg = String(exRes.result.z9t);
    }

    return context;
}

async function getBattleStatus(context, config = loadConfig()) {
    const action = config.battleStatus || config.status;
    const response = await callAction(action, context);
    if (!response || response.fault || !response.body || Number(response.body.status) !== 1) {
        throw new Error('Status Battle Thanksgiving gagal: ' + JSON.stringify((response && response.body) || 'empty'));
    }
    const body = response.body;
    const res = body.result || body;
    if (body.z9f != null) context.ivn = String(body.z9f);
    const parsed = parseStatus(res);
    return {
        raw: res,
        heart: parsed.heart !== null ? parsed.heart : 0,
        heartMax: parsed.heartMax !== null ? parsed.heartMax : 5,
        refillRemain: Number(res.heart_refill_remain || 0),
        tutorial: Boolean(body.tutorial),
        z9f: body.z9f != null ? String(body.z9f) : ''
    };
}

async function getMiniGameStatus(context, config = loadConfig()) {
    const action = config.miniGameStatus || { service: 'Thanksgiving2015.getMiniGameStatus', params: ['{sessionKey}'] };
    const response = await callAction(action, context);
    if (!response || response.fault || !response.body || Number(response.body.status) !== 1) {
        throw new Error('Status Mini-game Thanksgiving gagal: ' + JSON.stringify((response && response.body) || 'empty'));
    }
    const res = response.body.result || response.body;
    const parsed = parseStatus(res);
    const bullets = parsed.ammo !== null ? parsed.ammo : (parsed.heart !== null ? parsed.heart : 0);
    return {
        raw: res,
        bullets,
        ammo: bullets,
        bulletMax: parsed.heartMax !== null ? parsed.heartMax : 5,
        refillRemain: Number(res.heart_refill_remain || 0)
    };
}

async function getStatus(context, config = loadConfig()) {
    const battle = await getBattleStatus(context, config);
    const miniGame = await getMiniGameStatus(context, config);
    return {
        raw: { battle: battle.raw, miniGame: miniGame.raw },
        heart: battle.heart,
        heartMax: battle.heartMax,
        ammo: miniGame.bullets,
        bulletMax: miniGame.bulletMax,
        werewolf: miniGame.bullets,
        battleRefillRemain: battle.refillRemain,
        miniGameRefillRemain: miniGame.refillRemain,
        battle,
        miniGame
    };
}

function summarizeBattleReward(body, config) {
    const materialNames = (config && config.materialNames) || {};
    const rewards = Array.isArray(body.reward) ? body.reward : [];
    const itemsRaw = Array.isArray(body.reward_get) ? body.reward_get : rewards;
    let xp = 0;
    let gold = 0;
    const items = [];

    for (const entry of rewards) {
        const s = String(entry);
        if (s.startsWith('xp_')) xp += parseInt(s.slice(3), 10) || 0;
        else if (s.startsWith('gold_')) gold += parseInt(s.slice(5), 10) || 0;
    }
    for (const entry of itemsRaw) {
        const s = String(entry);
        if (s.startsWith('item') || s.startsWith('skill')) {
            items.push(materialNames[s] ? `${materialNames[s]} (${s})` : s);
        }
    }
    return { xp, gold, items, rawReward: rewards, rewardGet: itemsRaw };
}

async function executeOneBattle(context, enemy, config = loadConfig(), options = {}) {
    const sk = context.sessionKey;
    const battleCfg = config.battle || {};
    const fastDelayMs = options.fastDelayMs !== undefined ? options.fastDelayMs : Number(battleCfg.fastDelayMs ?? 550);
    const enemyHash = c.getHash(sk, enemy.id);
    const startParams = Array.isArray(battleCfg.params)
        ? battleCfg.params.map(p => renderParam(p, { ...context, enemyId: enemy.id, enemyName: enemy.name, enemyHash }))
        : [sk, enemy.id, enemyHash];

    const startRes = await amfWithRetry(
        battleCfg.service || 'Thanksgiving2015.startBattle',
        startParams,
        { onZ9f: z => { context.ivn = z; } }
    );
    if (!startRes.ok) {
        return { ok: false, empty: startRes.empty, reason: `startBattle (${enemy.id}) gagal: ${startRes.error}` };
    }

    const sbId = String(startRes.body.startBattleId || startRes.body.start_battle_id || '1');
    const sisaHeart = startRes.body.remain_heart !== undefined ? Number(startRes.body.remain_heart) : null;

    if (fastDelayMs > 0) await sleep(fastDelayMs);

    const ver = '1';
    const json = JSON_EMPTY;
    const battleMethod = battleCfg.eventBattleMethod || 'token';
    const sig = c.getHash(sk, `${enemy.id}|0|${battleMethod},0`);
    const hsh = c.getHash(sk, ver + sbId + json);
    const br = k.br(`${enemy.id}~0~${sbId}`);
    const k8 = context.ivn ? k.zrb(String(context.ivg || ''), String(context.ivn)) : '';
    const rewardService = battleCfg.rewardService || 'ItemDAO.getBossReward';

    const rwRes = await amfWithRetry(
        rewardService,
        [sk, sig, enemy.id, 0, [battleMethod, 0], '', ver, sbId, json, hsh, br, k8],
        { onZ9f: z => { context.ivn = z; } }
    );
    if (!rwRes.ok) {
        return { ok: false, empty: false, reason: `${rewardService} gagal: ${rwRes.error}` };
    }

    const summary = summarizeBattleReward(rwRes.body, config);
    return { ok: true, sisaHeart, ...summary, body: rwRes.body };
}

async function executeOneMiniGame(context, config = loadConfig(), options = {}) {
    const sk = context.sessionKey;
    const miniCfg = config.minigame || {};
    const fastDelayMs = options.fastDelayMs !== undefined ? options.fastDelayMs : Number(miniCfg.fastDelayMs ?? 600);
    const resultStatus = miniCfg.resultStatus !== undefined ? Number(miniCfg.resultStatus) : 0;
    const stage = miniCfg.stage !== undefined ? Number(miniCfg.stage) : 3;

    const startParams = Array.isArray(miniCfg.params)
        ? miniCfg.params.map(p => renderParam(p, context))
        : [sk];
    const startRes = await amfWithRetry(miniCfg.service || 'Thanksgiving2015.startMiniGame', startParams);
    if (!startRes.ok) {
        return { ok: false, empty: startRes.empty, reason: `startMiniGame gagal: ${startRes.error}` };
    }

    const sisaBullets = startRes.body.remain_heart !== undefined ? Number(startRes.body.remain_heart) : null;
    if (fastDelayMs > 0) await sleep(fastDelayMs);

    const finishHash = c.getHash(sk, `${resultStatus}${stage}`);
    const finishService = miniCfg.finishService || (config.werewolf && config.werewolf.service) || 'Thanksgiving2015.finishMiniGame';
    const finishParams = Array.isArray(miniCfg.finishParams)
        ? miniCfg.finishParams.map(p => renderParam(p, { ...context, resultStatus, stage, finishHash }))
        : [sk, resultStatus, stage, finishHash];

    const finRes = await amfWithRetry(finishService, finishParams);
    if (!finRes.ok) {
        return { ok: false, empty: false, reason: `${finishService} gagal: ${finRes.error}` };
    }

    const upd = (finRes.body && finRes.body.update_inventory) || {};
    const addItems = Array.isArray(upd.add_item_id) ? upd.add_item_id : [];
    const materialNames = (config && config.materialNames) || {};
    const namedItems = addItems.map(entry => {
        const raw = String(entry);
        const [baseId, qty] = raw.split('_');
        const label = materialNames[raw] || materialNames[baseId];
        if (!label) return raw;
        return qty ? `${label} x${qty} (${baseId})` : `${label} (${baseId})`;
    });

    return {
        ok: true,
        sisaBullets,
        win: Number(finRes.body.result && finRes.body.result.win) || 1,
        stageCleared: Number(finRes.body.result && finRes.body.result.stage_cleared) || stage,
        addItems,
        items: namedItems,
        body: finRes.body
    };
}

async function runBattle(context, config = loadConfig(), options = {}) {
    if (!config.enemies.length || config.enemies.some(enemy => !enemy.id)) {
        throw new Error('ID lima musuh belum diisi pada thanksgiving_event_config.json.');
    }

    let status = await getBattleStatus(context, config);
    const maxBattles = options.maxBattles !== undefined && options.maxBattles !== null
        ? Math.max(0, Number(options.maxBattles))
        : Infinity;
    const interDelayMs = options.interDelayMs !== undefined ? options.interDelayMs : Number((config.battle && config.battle.interDelayMs) ?? 750);
    const targetEnemy = options.enemyId ? config.enemies.find(e => e.id === options.enemyId) : null;

    line(`Battle Status Awal: ${status.heart}/${status.heartMax} Heart (Refill: ${formatTime(status.refillRemain)})`);
    const limit = Math.min(status.heart, maxBattles);
    let battles = 0;
    let totalXp = 0;
    let totalGold = 0;
    const rewards = [];

    for (let i = 0; i < limit; i++) {
        const enemy = targetEnemy || config.enemies[i % config.enemies.length];
        const bRes = await executeOneBattle(context, enemy, config, options);
        if (!bRes.ok) {
            line(`  [#${i + 1}] STOP: ${bRes.reason}`);
            if (bRes.empty) break;
            break;
        }
        battles++;
        totalXp += bRes.xp;
        totalGold += bRes.gold;
        rewards.push(bRes.body);
        const curHeart = bRes.sisaHeart !== null ? bRes.sisaHeart : Math.max(0, status.heart - battles);
        const itemText = bRes.items.length ? bRes.items.join(', ') : '-';
        line(`  [Battle #${battles}/${limit}] ${enemy.name} (${enemy.id}) OK | Heart: ${curHeart}/${status.heartMax} | Item: ${itemText} | +${bRes.xp.toLocaleString('id-ID')} XP, +${bRes.gold.toLocaleString('id-ID')} Gold`);

        if (i < limit - 1 && interDelayMs > 0) await sleep(interDelayMs);
    }

    status = await getBattleStatus(context, config);
    return { battles, totalXp, totalGold, status, rewards };
}

async function runMiniGame(context, config = loadConfig(), options = {}) {
    if (!isConfigured(config.minigame)) {
        throw new Error('Protokol mini-game belum diisi.');
    }

    let status = await getMiniGameStatus(context, config);
    const maxMiniGames = options.maxMiniGames !== undefined && options.maxMiniGames !== null
        ? Math.max(0, Number(options.maxMiniGames))
        : Infinity;
    const interDelayMs = options.interDelayMs !== undefined ? options.interDelayMs : Number((config.minigame && config.minigame.interDelayMs) ?? 750);

    line(`Werewolf Mini-Game Status Awal: ${status.bullets}/${status.bulletMax} Bullet (Refill: ${formatTime(status.refillRemain)})`);
    const limit = Math.min(status.bullets, maxMiniGames);
    let minigames = 0;
    const rewards = [];

    for (let i = 0; i < limit; i++) {
        const mRes = await executeOneMiniGame(context, config, options);
        if (!mRes.ok) {
            line(`  [Werewolf #${i + 1}] STOP: ${mRes.reason}`);
            if (mRes.empty) break;
            break;
        }
        minigames++;
        rewards.push(mRes.body);
        const curBullets = mRes.sisaBullets !== null ? mRes.sisaBullets : Math.max(0, status.bullets - minigames);
        const itemText = mRes.items.length ? mRes.items.join(', ') : '0 item (RNG drop)';
        line(`  [Werewolf #${minigames}/${limit}] Stage ${mRes.stageCleared} WIN | Bullet: ${curBullets}/${status.bulletMax} | Drop: ${itemText}`);

        if (i < limit - 1 && interDelayMs > 0) await sleep(interDelayMs);
    }

    status = await getMiniGameStatus(context, config);
    return { minigames, werewolves: minigames, status, rewards };
}

function appendReport(entry) {
    let report = [];
    try { report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')); } catch (_) { }
    report.push(entry);
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report.slice(-200), null, 2));
}

async function runForAccount(user, pass, slotOrId, mode, config = loadConfig(), options = {}) {
    const startedAt = new Date().toISOString();
    try {
        const needCharData = mode === 'battle' || mode === 'full';
        const context = await getContext(user, pass, slotOrId, { loadCharacterData: needCharData });
        line(`Akun: ${user} | Karakter: ${context.charName} (Lv.${context.level}, ID: ${context.charId})`);

        let result;
        if (mode === 'status') {
            result = await getStatus(context, config);
        } else if (mode === 'battle') {
            result = await runBattle(context, config, options);
        } else if (mode === 'minigame' || mode === 'werewolf') {
            result = await runMiniGame(context, config, options);
        } else if (mode === 'full') {
            const battle = await runBattle(context, config, options);
            const minigame = await runMiniGame(context, config, options);
            result = { battle, minigame };
        } else {
            throw new Error('Mode tidak dikenal: ' + mode);
        }

        const entry = { ok: true, startedAt, endedAt: new Date().toISOString(), user, charId: context.charId, charName: context.charName, mode, result };
        appendReport(entry);
        return entry;
    } catch (error) {
        const entry = { ok: false, startedAt, endedAt: new Date().toISOString(), user, slotOrId, mode, error: error.message };
        appendReport(entry);
        return entry;
    }
}

function parseCliArgs(argv) {
    const args = argv.slice(2);
    const positional = [];
    let maxBattles = null;
    let maxMiniGames = null;
    let enemyId = '';

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if ((a === '--max' || a === '--max-battles') && args[i + 1] !== undefined) {
            const val = parseInt(args[++i], 10);
            if (!Number.isNaN(val)) maxBattles = val;
        } else if (a === '--max-minigame' && args[i + 1] !== undefined) {
            const val = parseInt(args[++i], 10);
            if (!Number.isNaN(val)) maxMiniGames = val;
        } else if (a === '--enemy' && args[i + 1] !== undefined) {
            enemyId = String(args[++i]).trim();
        } else {
            positional.push(a);
        }
    }

    const mode = (positional[0] || 'status').toLowerCase();
    if (positional[1] !== undefined && /^\d+$/.test(positional[1])) {
        const n = parseInt(positional[1], 10);
        if (mode === 'minigame' || mode === 'werewolf') maxMiniGames = n;
        else if (maxBattles === null) maxBattles = n;
    }
    if (positional[2] !== undefined && /^\d+$/.test(positional[2]) && maxMiniGames === null) {
        maxMiniGames = parseInt(positional[2], 10);
    }

    return { mode, subMode: (positional[1] || 'full').toLowerCase(), maxBattles, maxMiniGames, enemyId };
}

async function runSchedulerLoop(user, pass, slotOrId, subMode = 'full', config = loadConfig()) {
    c.enableGracefulStop('menu thanksgiving');
    const targetMode = ['battle', 'minigame', 'werewolf', 'full'].includes(subMode) ? subMode : 'full';
    let cycle = 1;

    while (true) {
        line(`=== THANKSGIVING SCHEDULER CYCLE #${cycle} (${targetMode}) ===`);
        const entry = await runForAccount(user, pass, slotOrId, targetMode, config);
        const refills = [];
        if (entry.ok && entry.result) {
            const res = entry.result;
            if (res.status && res.status.refillRemain > 0) refills.push(res.status.refillRemain);
            if (res.battle && res.battle.status && res.battle.status.refillRemain > 0) refills.push(res.battle.status.refillRemain);
            if (res.minigame && res.minigame.status && res.minigame.status.refillRemain > 0) refills.push(res.minigame.status.refillRemain);
        }
        const waitSec = refills.length ? Math.min(...refills) : 1800;
        line(`[SCHEDULER] Menunggu refill berikutnya: ${formatTime(waitSec)} (${waitSec}s). Tekan Q / Ctrl+C untuk berhenti.`);
        let remain = waitSec;
        while (remain > 0) {
            const step = Math.min(30, remain);
            await sleep(step * 1000);
            remain -= step;
            if (remain > 0) line(`[STANDBY] Sisa waktu refill: ${formatTime(remain)}...`);
        }
        cycle++;
    }
}

function releaseTerminalInput() {
    if (process.stdin.isTTY && process.stdin.setRawMode) {
        try {
            process.stdin.setRawMode(false);
        } catch (_) { }
    }
    try {
        process.stdin.pause();
    } catch (_) { }
}

async function main() {
    c.enableGracefulStop('menu event');
    const parsed = parseCliArgs(process.argv);
    const { mode, subMode, maxBattles, maxMiniGames, enemyId } = parsed;

    if (!['status', 'battle', 'minigame', 'werewolf', 'full', 'loop'].includes(mode)) {
        throw new Error('Pakai: status | battle [max] | minigame [max] | full [maxBattle] [maxMini] | loop [mode]');
    }

    const user = process.env.NS_USER;
    const pass = process.env.NS_PASS;
    const slot = process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT || '1';
    if (!user || !pass) throw new Error('Butuh NS_USER dan NS_PASS.');

    const config = loadConfig();
    if (mode === 'loop') {
        await runSchedulerLoop(user, pass, slot, subMode, config);
        return;
    }

    const result = await runForAccount(user, pass, slot, mode, config, { maxBattles, maxMiniGames, enemyId });
    if (!result.ok) throw new Error(result.error);

    if (mode === 'status') {
        const s = result.result;
        console.log('\n======================================================================');
        console.log('                  STATUS EVENT THANKSGIVING 2026');
        console.log('======================================================================');
        console.log(` Karakter       : ${result.charName} (${result.charId})`);
        console.log(` Battle Heart   : ${s.heart}/${s.heartMax} (Refill: ${formatTime(s.battleRefillRemain)})`);
        console.log(` Werewolf Bullet: ${s.ammo}/${s.bulletMax} (Refill: ${formatTime(s.miniGameRefillRemain)})`);
        console.log('======================================================================\n');
    } else {
        console.log(JSON.stringify({ ok: true, mode, charName: result.charName, battles: result.result.battles ?? result.result.battle?.battles ?? 0, minigames: result.result.minigames ?? result.result.minigame?.minigames ?? 0 }, null, 2));
    }
}

if (require.main === module) {
    main()
        .then(() => {
            releaseTerminalInput();
            process.exit(0);
        })
        .catch(error => {
            console.error('FATAL ' + error.message);
            releaseTerminalInput();
            process.exit(1);
        });
}

module.exports = {
    loadConfig,
    parseStatus,
    isConfigured,
    renderParam,
    parseCliArgs,
    summarizeBattleReward,
    getContext,
    getBattleStatus,
    getMiniGameStatus,
    getStatus,
    executeOneBattle,
    executeOneMiniGame,
    runBattle,
    runMiniGame,
    runForAccount,
    formatTime,
    releaseTerminalInput,
    main
};
