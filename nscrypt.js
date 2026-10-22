#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * nscrypt.js — primitif tanda tangan NinjaSaga (hasil decompile client live)
 * Tanpa dependency selain crypto bawaan Node.
 *
 * Port 1:1 dari:
 *   client_library.swf → ninjasaga/linkage/ClientLibrary.as, com/utils/Sha1Encrypt.as
 *   code_library.swf   → ninjasaga/Character.as (_uc:909), ninjasaga/linkage/CodeLibrary.as
 *
 * Uji: node nscrypt.js --test
 */
'use strict';

const crypto = require('crypto');

const SALT = 'Vmn34aAciYK00Hen26nT01';        // ClientLibrary._s
const CODEC = '85224034668';                  // CodeLibrary.codec
const UC_KEY = [58, 126, 44, 73, 50, 36, 46, 110, 75, 53, 91, 116, 61, 115, 90, 71];

const sha1 = s => crypto.createHash('sha1').update(String(s), 'binary').digest('hex');

// ClientLibrary
const getHash = (sessionKey, s) => sha1(s + SALT + sessionKey);
const getArrayHash = (sessionKey, arr) => sha1(arr.toString() + SALT + sessionKey);
const getLoginHash = (x, s) => sha1(s + SALT);
const encrypt = s => sha1(s);

// Character._uc — sisi encode (sama seperti client)
function ucEncode(text) {
    const rnd = crypto.randomBytes(12);
    const buf = Buffer.from(text, 'utf8');
    for (let i = 0; i < buf.length; i++) {
        const x = (UC_KEY[i % 16] ^ rnd[i % 12]) + i * 7;
        buf[i] = buf[i] ^ (x & 0xFF);
        buf[i] = (buf[i] + UC_KEY[(i + 5) % 16]) & 0xFF;
    }
    return Buffer.concat([rnd, buf]).toString('hex');
}

// Kebalikan dari ucEncode — hanya untuk menguji diri sendiri, bukan bagian dari client.
function ucDecode(hex) {
    const all = Buffer.from(hex, 'hex');
    const rnd = all.slice(0, 12);
    const buf = Buffer.from(all.slice(12));
    for (let i = 0; i < buf.length; i++) {
        const x = (UC_KEY[i % 16] ^ rnd[i % 12]) + i * 7;
        buf[i] = (buf[i] - UC_KEY[(i + 5) % 16]) & 0xFF;
        buf[i] = buf[i] ^ (x & 0xFF);
    }
    return buf.toString('utf8');
}

module.exports = { SALT, CODEC, sha1, getHash, getArrayHash, getLoginHash, encrypt, ucEncode, ucDecode };

if (require.main === module && process.argv.includes('--test')) {
    let fail = 0;
    const check = (label, got, want) => {
        const ok = got === want;
        if (!ok) fail++;
        console.log((ok ? '  OK   ' : '  FAIL ') + label + (ok ? '' : '\n        got  ' + got + '\n        want ' + want));
    };

    console.log('  uji nscrypt.js');
    check('sha1("abc")', sha1('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
    check('getHash("sess","abc")', getHash('sess', 'abc'), sha1('abc' + SALT + 'sess'));
    check('getArrayHash toString', getArrayHash('s', [1, 2, 'msn138']), sha1('1,2,msn138' + SALT + 's'));
    check('getLoginHash', getLoginHash('ignored', 'xyz'), sha1('xyz' + SALT));
    check('constant codec', CODEC, '85224034668');

    for (const t of ['msn138', '123|500|250|msn138|987', 'teks dengan spasi & simbol !@#']) {
        const enc = ucEncode(t);
        const round = ucDecode(enc);
        check('uc round-trip ' + JSON.stringify(t).slice(0, 28), round, t);
    }
    const a = ucEncode('x'), b = ucEncode('x');
    check('uc pakai prefix acak (2 hasil beda)', String(a !== b), 'true');

    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
