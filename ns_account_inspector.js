#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_account_inspector.js — Ninja Saga Multi-Account Asset & Inventory Scanner
 *
 * Fitur:
 *   - Memindai seluruh akun di accounts.txt secara otomatis
 *   - Mengumpulkan data: Nama, Level, XP, Gold, Saga Tokens, Rank Ninja,
 *     Bloodline/Talent, Event Currency (Heart/Energy), dan Gear yang terpasang
 *   - Menyajikan data dalam tabel ringkas di terminal
 *   - Mendukung ekspor laporan ke format JSON (account_audit.json) dan CSV (account_audit.csv)
 *
 * Penggunaan:
 *   node ns_account_inspector.js            -> Pindai semua akun di accounts.txt
 *   node ns_account_inspector.js --me       -> Pindai akun aktif saat ini (NS_USER / NS_PASS)
 *   node ns_account_inspector.js --json     -> Simpan hasil ke account_audit.json
 *   node ns_account_inspector.js --csv      -> Simpan hasil ke account_audit.csv
 *   node ns_account_inspector.js --delay 5  -> Jeda 5 detik antar akun
 */
'use strict';

const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const JSON_OUT = path.join(__dirname, 'account_audit.json');
const CSV_OUT = path.join(__dirname, 'account_audit.csv');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);

const RANK_NAMES = {
    0: 'Academy Student',
    1: 'Genin',
    2: 'Chunin',
    3: 'Special Jounin',
    4: 'Jounin',
    5: 'Sennin'
};

function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        return [];
    }
    const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
    const accounts = [];
    const lines = raw.split(/\r?\n/);
    for (const l of lines) {
        const trimmed = l.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        let user = '', pass = '';
        if (trimmed.includes(':')) {
            const idx = trimmed.indexOf(':');
            user = trimmed.slice(0, idx).trim();
            pass = trimmed.slice(idx + 1).trim();
        } else if (trimmed.includes(',')) {
            const idx = trimmed.indexOf(',');
            user = trimmed.slice(0, idx).trim();
            pass = trimmed.slice(idx + 1).trim();
        }
        if (user && pass) {
            accounts.push({ user, pass });
        }
    }
    return accounts;
}

async function inspectAccount(username, password) {
    const s = await c.login(username, password);
    if (!s.ok) {
        return {
            username,
            status: 'LOGIN_FAILED',
            error: s.stage + ' (' + (s.message || s.body || 'HTTP ' + s.http) + ')'
        };
    }

    const tokens = (s.accountFlag !== undefined && s.accountFlag !== null) ? Number(s.accountFlag) : 0;
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const rawList = (rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    if (rawList.length === 0) {
        return [{
            username,
            playerId: s.playerId,
            tokens,
            status: 'NO_CHARACTER'
        }];
    }

    const charRows = [];
    for (const chItem of rawList) {
        const charId = chItem[0];
        let charObj = null;
        for (let i = 1; i <= 6; i++) {
            const r = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
            if (r.body && r.body.gk) {
                charObj = r.body.result;
                break;
            }
            await sleep(2000);
        }

        if (!charObj) {
            charRows.push({
                username,
                playerId: s.playerId,
                charId,
                tokens,
                status: 'CHAR_LOAD_FAILED'
            });
            continue;
        }

        // Ekstraksi currency event
        const cur = {};
        String(charObj.character_common_currency || '').split(',').forEach(p => {
            const [a, b] = p.split(':');
            if (a) cur[a] = +b;
        });
        const mat = {};
        String(charObj.character_material || '').split(',').forEach(p => {
            const [a, b] = p.split(':');
            if (a) mat[a] = +b;
        });

        const rankNumber = Number(charObj.character_rank) || 0;
        const rankTitle = RANK_NAMES[rankNumber] || ('Rank ' + rankNumber);

        charRows.push({
            username,
            playerId: s.playerId,
            charId,
            charName: charObj.character_name || '-',
            level: Number(charObj.character_level) || 1,
            xp: Number(charObj.character_xp) || 0,
            gold: Number(charObj.character_gold) || 0,
            tokens,
            rank: rankTitle,
            bloodline: charObj.character_bloodline || '(none)',
            weapon: charObj.character_equipped_weapon || '(default)',
            backItem: charObj.character_equipped_back_item || '(none)',
            bodySet: charObj.character_body_set || '(default)',
            halloweenHeart: mat[1027] !== undefined ? mat[1027] : (cur[1027] !== undefined ? cur[1027] : 0),
            status: 'OK'
        });
    }

    return charRows;
}

function printTable(rows) {
    console.log('\n' + '='.repeat(105));
    console.log('                            NINJA SAGA ACCOUNT AUDIT REPORT');
    console.log('                               cc: MagnetScript(Razki)');
    console.log('='.repeat(105));

    const head = [
        'No'.padEnd(4),
        'Akun / User'.padEnd(16),
        'Karakter'.padEnd(14),
        'Lv'.padEnd(4),
        'Rank'.padEnd(15),
        'Gold'.padEnd(14),
        'Tokens'.padEnd(9),
        'Bloodline'.padEnd(12),
        'Heart'.padEnd(6),
        'Status'
    ].join(' | ');

    console.log(head);
    console.log('-'.repeat(105));

    rows.forEach((r, idx) => {
        const no = String(idx + 1).padEnd(4);
        const user = String(r.username || '-').slice(0, 16).padEnd(16);
        const charName = String(r.charName || '-').slice(0, 14).padEnd(14);
        const lv = String(r.level || '-').padEnd(4);
        const rank = String(r.rank || '-').slice(0, 15).padEnd(15);
        const gold = (r.gold !== undefined ? r.gold.toLocaleString() : '-').padEnd(14);
        const tok = (r.tokens !== undefined ? r.tokens.toLocaleString() : '-').padEnd(9);
        const bl = String(r.bloodline || '-').slice(0, 12).padEnd(12);
        const hrt = String(r.halloweenHeart !== undefined ? r.halloweenHeart : '-').padEnd(6);
        const st = r.status === 'OK' ? '✓ OK' : ('✗ ' + (r.error || r.status));

        console.log([no, user, charName, lv, rank, gold, tok, bl, hrt, st].join(' | '));
    });
    console.log('='.repeat(105) + '\n');
}

function exportCsv(rows) {
    const headers = ['No', 'Username', 'PlayerId', 'CharacterName', 'Level', 'XP', 'Gold', 'Tokens', 'Rank', 'Bloodline', 'Weapon', 'BackItem', 'HalloweenHeart', 'Status'];
    const lines = [headers.join(',')];

    rows.forEach((r, idx) => {
        const lineData = [
            idx + 1,
            `"${r.username || ''}"`,
            r.playerId || '',
            `"${r.charName || ''}"`,
            r.level || '',
            r.xp || '',
            r.gold || 0,
            r.tokens || 0,
            `"${r.rank || ''}"`,
            `"${r.bloodline || ''}"`,
            `"${r.weapon || ''}"`,
            `"${r.backItem || ''}"`,
            r.halloweenHeart || 0,
            `"${r.status || ''}"`
        ];
        lines.push(lineData.join(','));
    });

    fs.writeFileSync(CSV_OUT, lines.join('\n'), 'utf8');
    line(`Laporan CSV berhasil disimpan ke: ${CSV_OUT}`);
}

function exportJson(rows) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
        generated_at: new Date().toISOString(),
        total_accounts: rows.length,
        accounts: rows
    }, null, 2), 'utf8');
    line(`Laporan JSON berhasil disimpan ke: ${JSON_OUT}`);
}

// ═══════════════════════════════════════════════════════════════
// CLI Dispatcher
// ═══════════════════════════════════════════════════════════════
const args = process.argv.slice(2);
const isMe = args.includes('--me');
const doJson = args.includes('--json');
const doCsv = args.includes('--csv');
let delaySec = 5;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--delay' && args[i + 1]) {
        delaySec = parseInt(args[i + 1], 10) || 5;
    }
}

(async () => {
    const list = [];
    if (isMe) {
        const u = process.env.NS_USER;
        const p = process.env.NS_PASS;
        if (!u || !p) {
            line('ERROR: Mode --me memerlukan NS_USER dan NS_PASS di environment.');
            process.exit(1);
        }
        list.push({ user: u, pass: p });
    } else {
        const loaded = loadAccounts();
        if (loaded.length === 0) {
            console.log('\n[!] File "accounts.txt" belum ditemukan atau kosong!');
            console.log('    Salin "accounts.example.txt" menjadi "accounts.txt"');
            console.log('    lalu isi daftar akun dengan format: username:password');
            console.log('    Atau gunakan "node ns_account_inspector.js --me" untuk akun aktif.\n');
            process.exit(0);
        }
        list.push(...loaded);
    }

    line(`Memulai audit untuk ${list.length} akun...`);
    const results = [];

    for (let i = 0; i < list.length; i++) {
        const acc = list[i];
        line(`[${i + 1}/${list.length}] Memindai akun: ${acc.user} ...`);
        try {
            const data = await inspectAccount(acc.user, acc.pass);
            if (Array.isArray(data)) {
                results.push(...data);
            } else {
                results.push(data);
            }
        } catch (e) {
            results.push({ username: acc.user, status: 'ERROR', error: e.message });
        }

        if (i < list.length - 1) {
            await sleep(delaySec * 1000);
        }
    }

    printTable(results);

    if (doJson || (!doCsv && !isMe)) {
        exportJson(results);
    }
    if (doCsv) {
        exportCsv(results);
    }

    process.exit(0);
})().catch(err => {
    line('FATAL ERROR: ' + (err.message || err));
    process.exit(1);
});
