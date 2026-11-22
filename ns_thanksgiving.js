#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');
const CONFIG_FILE = path.join(__dirname, 'thanksgiving_event_config.json');
const REPORT_FILE = path.join(__dirname, 'thanksgiving_report.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadConfig(file = CONFIG_FILE) {
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.enemies = Array.isArray(config.enemies) ? config.enemies : [];
    return config;
}
function findNumber(value, keys) {
    if (!value || typeof value !== 'object') return null;
    for (const key of keys) if (value[key] !== undefined && Number.isFinite(Number(value[key]))) return Number(value[key]);
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
function isConfigured(action) { return Boolean(action && action.service && Array.isArray(action.params)); }
function renderParam(value, context) { return typeof value === 'string' ? value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => context[key] === undefined ? '' : String(context[key])) : value; }
async function callAction(action, context) {
    if (!isConfigured(action)) throw new Error('Protokol Thanksgiving belum diisi. Jalankan capture lalu isi thanksgiving_event_config.json.');
    return c.amf(action.service, action.params.map(param => renderParam(param, context)));
}
async function getContext(user, pass, slotOrId) {
    const session = await c.login(user, pass);
    if (!session.ok) throw new Error(session.message || 'Login gagal.');
    const charsResponse = await c.amf('CharacterDAO.getCharactersList', [session.sessionKey]);
    const chars = charsResponse && charsResponse.body && Array.isArray(charsResponse.body.result) ? charsResponse.body.result : [];
    const selected = c.getSelectedChar(chars, slotOrId);
    if (!selected) throw new Error('Karakter tidak ditemukan.');
    return { sessionKey: session.sessionKey, charId: String(selected[0]), charName: String(selected[1] || ''), slotOrId };
}
async function getStatus(context, config) {
    const response = await callAction(config.status, context);
    if (!response || response.fault || !response.body) throw new Error('Status Thanksgiving gagal.');
    return { raw: response.body.result || response.body, ...parseStatus(response.body.result || response.body) };
}
async function runBattle(context, config) {
    if (!config.enemies.length || config.enemies.some(enemy => !enemy.id)) throw new Error('ID lima musuh belum diisi pada thanksgiving_event_config.json.');
    let status = await getStatus(context, config);
    let battles = 0;
    const rewards = [];
    while (status.heart !== null && status.heart > 0) {
        const enemy = config.enemies[battles % config.enemies.length];
        const response = await callAction(config.battle, { ...context, enemyId: enemy.id, enemyName: enemy.name, battleIndex: battles + 1 });
        if (!response || response.fault || !response.body) throw new Error('Battle gagal pada ' + enemy.name);
        battles++;
        rewards.push(response.body.result || response.body);
        status = await getStatus(context, config);
        console.log('Battle ' + battles + ': ' + enemy.name + ' | Heart: ' + status.heart + '/' + (status.heartMax === null ? '?' : status.heartMax));
        await sleep(500);
    }
    return { battles, status, rewards };
}
async function runMiniGame(context, config) {
    if (!isConfigured(config.minigame)) throw new Error('Protokol mini-game belum diisi.');
    let status = await getStatus(context, config);
    let minigames = 0;
    let werewolves = 0;
    const rewards = [];
    while (status.ammo !== null && status.ammo > 0) {
        const response = await callAction(config.minigame, { ...context, minigameIndex: minigames + 1 });
        if (!response || response.fault || !response.body) throw new Error('Mini-game gagal.');
        minigames++;
        rewards.push(response.body.result || response.body);
        status = await getStatus(context, config);
        console.log('Mini-game ' + minigames + ' | Ammo: ' + status.ammo);
        await sleep(500);
    }
    while (isConfigured(config.werewolf) && status.werewolf !== null && status.werewolf > 0) {
        const response = await callAction(config.werewolf, { ...context, werewolfIndex: werewolves + 1 });
        if (!response || response.fault || !response.body) throw new Error('Misi werewolf gagal.');
        werewolves++;
        rewards.push(response.body.result || response.body);
        status = await getStatus(context, config);
        console.log('Werewolf ' + werewolves + ' | Sisa: ' + status.werewolf);
        await sleep(500);
    }
    return { minigames, werewolves, status, rewards };
}
function appendReport(entry) {
    let report = [];
    try { report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')); } catch (_) { }
    report.push(entry);
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report.slice(-200), null, 2));
}
async function runForAccount(user, pass, slotOrId, mode, config = loadConfig()) {
    const startedAt = new Date().toISOString();
    try {
        const context = await getContext(user, pass, slotOrId);
        let result;
        if (mode === 'status') result = await getStatus(context, config);
        else if (mode === 'battle') result = await runBattle(context, config);
        else if (mode === 'minigame') result = await runMiniGame(context, config);
        else if (mode === 'full') result = { battle: await runBattle(context, config), minigame: await runMiniGame(context, config) };
        else throw new Error('Mode tidak dikenal: ' + mode);
        const entry = { ok: true, startedAt, endedAt: new Date().toISOString(), user, charId: context.charId, charName: context.charName, mode, result };
        appendReport(entry);
        return entry;
    } catch (error) {
        const entry = { ok: false, startedAt, endedAt: new Date().toISOString(), user, slotOrId, mode, error: error.message };
        appendReport(entry);
        return entry;
    }
}
async function main() {
    const mode = (process.argv[2] || 'status').toLowerCase();
    if (!['status', 'battle', 'minigame', 'full'].includes(mode)) throw new Error('Pakai: status | battle | minigame | full');
    const user = process.env.NS_USER;
    const pass = process.env.NS_PASS;
    const slot = process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT || '1';
    if (!user || !pass) throw new Error('Butuh NS_USER dan NS_PASS.');
    const result = await runForAccount(user, pass, slot, mode);
    if (!result.ok) throw new Error(result.error);
    console.log(JSON.stringify(result.result, null, 2));
}
if (require.main === module) main().catch(error => { console.error('FATAL ' + error.message); process.exitCode = 1; });
module.exports = { loadConfig, parseStatus, isConfigured, renderParam, runBattle, runMiniGame, runForAccount };
