#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_loadout.js — Ninja Saga Loadout & Preset Switcher (Skill & Gear)
 *
 * Fitur:
 *   - Simpan kombinasi skill & perlengkapan (weapon, back item, outfit/body set)
 *   - Terapkan preset (PvP, Boss Hunting, Daily Farming, Training) ke karakter
 *   - Backup & kelola preset lokal di file loadouts.json
 *
 * Penggunaan CLI:
 *   node ns_loadout.js                     -> Menu interaktif
 *   node ns_loadout.js list                -> Lihat daftar preset tersimpan
 *   node ns_loadout.js current             -> Cek loadout aktif karakter saat ini
 *   node ns_loadout.js save <nama_preset>  -> Simpan loadout aktif karakter
 *   node ns_loadout.js apply <nama_preset> -> Pasang preset ke karakter
 *   node ns_loadout.js delete <nama_preset>-> Hapus preset
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const c = require('./nsclient.js');

const LOADOUT_FILE = path.join(__dirname, 'loadouts.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);

function loadPresets() {
    if (!fs.existsSync(LOADOUT_FILE)) return {};
    try {
        const raw = fs.readFileSync(LOADOUT_FILE, 'utf8');
        return JSON.parse(raw) || {};
    } catch (_) {
        return {};
    }
}

function savePresets(presets) {
    fs.writeFileSync(LOADOUT_FILE, JSON.stringify(presets, null, 2), 'utf8');
}

async function loginClient() {
    const user = process.env.NS_USER;
    const pass = process.env.NS_PASS;
    if (!user || !pass) {
        line('ERROR: Kredensial belum diset di environment NS_USER / NS_PASS.');
        process.exit(1);
    }
    const s = await c.login(user, pass);
    if (!s.ok) {
        line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')');
        process.exit(2);
    }
    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const row = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!row) {
        line('ERROR: Tidak dapat mengambil karakter.');
        process.exit(3);
    }
    const charId = row[0];

    let charObj = null;
    for (let i = 1; i <= 6; i++) {
        const r = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
        if (r.body && r.body.gk) {
            charObj = r.body.result;
            break;
        }
        await sleep(3000);
    }
    if (!charObj) {
        line('ERROR: Gagal membaca data karakter dari server.');
        process.exit(4);
    }
    return { s, charId, charObj };
}

function displayLoadout(title, data) {
    console.log('\n==========================================================');
    console.log('  ' + title);
    console.log('==========================================================');
    console.log('  Karakter   : ' + (data.char_name || data.character_name || '-'));
    console.log('  Level      : ' + (data.character_level || '-'));
    console.log('  Weapon     : ' + (data.weapon || data.character_equipped_weapon || '(default)'));
    console.log('  Back Item  : ' + (data.back_item || data.character_equipped_back_item || '(none)'));
    console.log('  Outfit     : ' + (data.body_set || data.character_body_set || '(default)'));
    console.log('  Skills     :');
    const skills = data.skills || data.character_skills || [];
    if (Array.isArray(skills) && skills.length > 0) {
        skills.forEach((sk, idx) => {
            const sid = typeof sk === 'object' ? (sk.skill_id || sk.id || JSON.stringify(sk)) : sk;
            console.log(`    [Slot ${idx + 1}] ${sid}`);
        });
    } else {
        console.log('    (tidak ada skill terpasang)');
    }
    console.log('==========================================================\n');
}

async function listCommand() {
    const presets = loadPresets();
    const names = Object.keys(presets);
    console.log('\n==========================================================');
    console.log('           DAFTAR PRESET LOADOUT (loadouts.json)');
    console.log('==========================================================');
    if (names.length === 0) {
        console.log('  Belum ada preset yang disimpan.');
        console.log('  Gunakan "node ns_loadout.js save <nama>" untuk menyimpan.');
    } else {
        names.forEach((name, i) => {
            const p = presets[name];
            const skillCount = Array.isArray(p.skills) ? p.skills.length : 0;
            console.log(`  ${i + 1}. [${name}]`);
            console.log(`     Karakter : ${p.char_name || '-'} | Wpn: ${p.weapon || '-'} | Back: ${p.back_item || '-'}`);
            console.log(`     Skill (${skillCount}) : ${(p.skills || []).join(', ')}`);
            console.log(`     Disimpan : ${p.created_at || '-'}`);
        });
    }
    console.log('==========================================================\n');
}

async function currentCommand() {
    line('Mengambil status loadout saat ini dari server...');
    const { charObj } = await loginClient();
    displayLoadout('LOADOUT AKTIF SAAT INI', charObj);
}

async function saveCommand(presetName) {
    if (!presetName) {
        line('ERROR: Harap tentukan nama preset. Contoh: node ns_loadout.js save pvp');
        return;
    }
    line(`Mengambil data karakter untuk preset "${presetName}"...`);
    const { charId, charObj } = await loginClient();

    const presets = loadPresets();
    presets[presetName] = {
        name: presetName,
        char_id: charId,
        char_name: charObj.character_name,
        skills: Array.isArray(charObj.character_skills) ? [...charObj.character_skills] : [],
        weapon: charObj.character_equipped_weapon || '',
        back_item: charObj.character_equipped_back_item || '',
        body_set: charObj.character_body_set || '',
        created_at: new Date().toISOString()
    };
    savePresets(presets);
    line(`SUCCESS: Preset "${presetName}" berhasil disimpan ke ${LOADOUT_FILE}`);
    displayLoadout(`PRESET TERSIMPAN: [${presetName}]`, presets[presetName]);
}

async function applyCommand(presetName) {
    if (!presetName) {
        line('ERROR: Harap tentukan nama preset. Contoh: node ns_loadout.js apply pvp');
        return;
    }
    const presets = loadPresets();
    const preset = presets[presetName];
    if (!preset) {
        line(`ERROR: Preset "${presetName}" tidak ditemukan di ${LOADOUT_FILE}`);
        line('Ketik "node ns_loadout.js list" untuk melihat daftar preset yang ada.');
        return;
    }

    line(`Menerapkan preset "${presetName}" ke karakter di server...`);
    const { s, charId, charObj } = await loginClient();

    const updatedObj = Object.assign({}, charObj);
    if (preset.skills) updatedObj.character_skills = preset.skills;
    if (preset.weapon) updatedObj.character_equipped_weapon = preset.weapon;
    if (preset.back_item) updatedObj.character_equipped_back_item = preset.back_item;
    if (preset.body_set) updatedObj.character_body_set = preset.body_set;

    // Simpan ke server
    let saved = false;
    try {
        const res = await c.amf('CharacterDAO.saveCharacter', [s.sessionKey, updatedObj]);
        if (res.body && Number(res.body.status) === 1) {
            saved = true;
        }
    } catch (_) { }

    if (!saved) {
        // Coba alternatif via updateCharacter
        try {
            const h = require('./ns_crypto.js');
            const arr = [s.sessionKey, charId, charObj.character_level, 0, 0, [], 0, 0, 0, 0, ''];
            const res2 = await c.amf('CharacterService.updateCharacter', [
                s.sessionKey, charId, charObj.character_level, 0, 0, preset.skills || [],
                0, 0, 0, h.getArrayHash(arr), h.updateSequence(), 0, '', '1', '', 0, '', '', '', ''
            ]);
            if (res2.body && Number(res2.body.status) === 1) {
                saved = true;
            }
        } catch (_) { }
    }

    line(`Preset "${presetName}" selesai dikirim ke server.`);
    displayLoadout(`LOADOUT TERBARU: [${presetName}]`, preset);
}

async function deleteCommand(presetName) {
    if (!presetName) {
        line('ERROR: Tentukan nama preset yang ingin dihapus.');
        return;
    }
    const presets = loadPresets();
    if (!presets[presetName]) {
        line(`ERROR: Preset "${presetName}" tidak ditemukan.`);
        return;
    }
    delete presets[presetName];
    savePresets(presets);
    line(`SUCCESS: Preset "${presetName}" berhasil dihapus.`);
}

async function interactiveMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q => new Promise(res => rl.question(q, res));

    while (true) {
        console.log('\n==========================================================');
        console.log('         NINJA SAGA PRESET & LOADOUT MANAGER');
        console.log('         cc: MagnetScript(Razki)');
        console.log('==========================================================');
        console.log('  1. Cek loadout aktif karakter saat ini');
        console.log('  2. Lihat daftar preset yang tersimpan');
        console.log('  3. Simpan loadout aktif menjadi preset baru');
        console.log('  4. Pasang preset ke karakter');
        console.log('  5. Hapus preset tersimpan');
        console.log('  0. Kembali / Keluar');
        console.log('==========================================================');
        const ans = (await ask('Pilih (0-5) : ')).trim();

        if (ans === '1') {
            await currentCommand();
        } else if (ans === '2') {
            await listCommand();
        } else if (ans === '3') {
            const name = (await ask('Masukkan nama preset baru : ')).trim();
            if (name) await saveCommand(name);
        } else if (ans === '4') {
            await listCommand();
            const name = (await ask('Masukkan nama preset yang ingin dipasang : ')).trim();
            if (name) await applyCommand(name);
        } else if (ans === '5') {
            await listCommand();
            const name = (await ask('Masukkan nama preset yang ingin dihapus : ')).trim();
            if (name) await deleteCommand(name);
        } else if (ans === '0') {
            rl.close();
            break;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// CLI Dispatcher
// ═══════════════════════════════════════════════════════════════
const cmd = (process.argv[2] || '').toLowerCase();
const arg = process.argv[3] || '';

(async () => {
    switch (cmd) {
        case 'list':
            await listCommand();
            break;
        case 'current':
        case 'show':
            await currentCommand();
            break;
        case 'save':
            await saveCommand(arg);
            break;
        case 'apply':
        case 'equip':
            await applyCommand(arg);
            break;
        case 'delete':
        case 'del':
        case 'rm':
            await deleteCommand(arg);
            break;
        default:
            await interactiveMenu();
            break;
    }
    process.exit(0);
})().catch(err => {
    line('FATAL ERROR: ' + (err.message || err));
    process.exit(1);
});
