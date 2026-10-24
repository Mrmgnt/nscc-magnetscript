#!/usr/bin/env node
/**
 * ns_select_char.js — Login & Scan/Pilih Karakter Ninja Saga
 * cc: MagnetScript(Razki)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const c = require('./nsclient.js');

const ENV_FILE = path.join(__dirname, '.char_env.bat');

function cleanEnv() {
    try { if (fs.existsSync(ENV_FILE)) fs.unlinkSync(ENV_FILE); } catch (_) {}
}

function readLine(promptText) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(promptText, ans => {
            rl.close();
            resolve(ans.trim());
        });
    });
}

function readPassword(promptText) {
    return new Promise(resolve => {
        process.stdout.write(promptText);
        if (!process.stdin.isTTY) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question('', ans => { rl.close(); resolve(ans.trim()); });
            return;
        }

        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        let pass = '';

        const onData = ch => {
            ch = String(ch);
            for (let i = 0; i < ch.length; i++) {
                const char = ch[i];
                if (char === '\r' || char === '\n' || char === '\u0004') {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.removeListener('data', onData);
                    process.stdout.write('\n');
                    resolve(pass.trim());
                    return;
                } else if (char === '\u0003') { // Ctrl+C
                    stdin.setRawMode(false);
                    stdin.pause();
                    process.stdout.write('\n');
                    process.exit(0);
                } else if (char === '\u0008' || char === '\x7f') { // Backspace
                    if (pass.length > 0) {
                        pass = pass.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                } else if (char >= ' ') {
                    pass += char;
                    process.stdout.write('*');
                }
            }
        };

        stdin.on('data', onData);
    });
}

async function main() {
    let user = process.env.NS_USER || '';
    let pass = process.env.NS_PASS || '';

    let s = null;
    while (!s) {
        if (!user) {
            console.log('======================================================================');
            console.log('                     NINJASAGA BOT - LOGIN');
            console.log('                     cc: MagnetScript(Razki)');
            console.log('======================================================================\n');
            user = await readLine('Username NinjaSaga : ');
            if (!user) {
                console.log('[!] Username tidak boleh kosong.\n');
                continue;
            }
        }

        if (!pass) {
            pass = await readPassword('Password NinjaSaga : ');
            if (!pass) {
                console.log('[!] Password tidak boleh kosong.\n');
                user = '';
                continue;
            }
            console.log('');
        }

        process.stdout.write('Menghubungkan ke server Ninja Saga & mengambil data karakter... ');
        const loginRes = await c.login(user, pass);
        if (!loginRes.ok) {
            console.log('GAGAL!\n');
            console.log('[!] LOGIN GAGAL: ' + loginRes.stage + ' (' + (loginRes.message || loginRes.body || 'status ' + loginRes.http) + ')');
            console.log('    Silakan periksa username dan password Anda lalu coba lagi.\n');
            user = '';
            pass = '';
            cleanEnv();
            continue;
        }

        s = loginRes;
        console.log('BERHASIL!');
    }

    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const rawList = (rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];

    if (rawList.length === 0) {
        console.log('\n[!] Akun ini belum memiliki karakter.');
        process.exit(3);
    }

    const chars = rawList.map((row, idx) => ({
        slot: idx + 1,
        id: row[0],
        name: row[1] || ('Char_' + row[0]),
        level: Number(row[2]) || 1,
        gender: row[3] === 0 ? 'Male' : (row[3] === 1 ? 'Female' : 'Unknown'),
        raw: row
    }));

    // Jika hanya 1 karakter dan tidak dipaksa pilih ulang
    if (chars.length === 1 && !process.env.NS_FORCE_SELECT) {
        const ch = chars[0];
        console.log(`\n[i] Karakter terdeteksi: ${ch.name} (Level ${ch.level} | ${ch.gender} | Slot ${ch.slot})`);
        saveSelection(ch, user, pass);
        process.exit(0);
    }

    // Jika ada lebih dari 1 karakter (atau mode ganti karakter)
    console.log('\n======================================================================');
    console.log('                       PILIH KARAKTER AKTIF');
    console.log('======================================================================');
    console.log(` Akun : ${user} (${chars.length} Karakter Tersedia)`);
    console.log('----------------------------------------------------------------------');
    chars.forEach(ch => {
        const slotStr = ` [${ch.slot}]`.padEnd(6);
        const nameStr = ch.name.padEnd(20);
        const lvStr = `Level ${ch.level}`.padEnd(12);
        const genStr = `(${ch.gender})`.padEnd(10);
        console.log(`${slotStr} ${nameStr} ${lvStr} ${genStr} [ID: ${ch.id}]`);
    });
    console.log('======================================================================');

    while (true) {
        const ans = await readLine(`\nPilih nomor karakter [1-${chars.length}] (default: 1): `);
        let selected = chars[0];
        if (ans !== '') {
            const num = parseInt(ans, 10);
            if (num >= 1 && num <= chars.length) {
                selected = chars[num - 1];
            } else {
                console.log(`[!] Pilihan tidak valid. Masukkan angka 1 sampai ${chars.length}.`);
                continue;
            }
        }
        console.log(`\n✓ Karakter aktif: ${selected.name} (Level ${selected.level} - Slot ${selected.slot})`);
        saveSelection(selected, user, pass);
        process.exit(0);
    }
}

function saveSelection(ch, user, pass) {
    const lines = [
        `set "NS_USER=${user}"`,
        `set "NS_PASS=${pass}"`,
        `set "NS_CHAR_ID=${ch.id}"`,
        `set "NS_CHAR_NAME=${ch.name}"`,
        `set "NS_CHAR_LEVEL=${ch.level}"`,
        `set "NS_CHAR_GENDER=${ch.gender}"`,
        `set "NS_CHAR_SLOT=${ch.slot}"`
    ];
    fs.writeFileSync(ENV_FILE, lines.join('\r\n') + '\r\n', 'utf8');
}

main().catch(err => {
    console.error('\nFATAL:', err.message);
    process.exit(1);
});
