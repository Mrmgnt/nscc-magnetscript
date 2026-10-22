#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_crypto.js — keluarga fungsi obfuscate NinjaSaga (port 1:1 dari AS3).
 * Sumber: as_code/.../Mission.as (_msa/_msd), as_code/.../Main.as (_msb/_ub/_ud/getHash/updateSequence),
 *         as_out/NinjaSaga.as (_msc, _uc), as_code/.../Character.as (_ua, _uc field crypto)
 *
 * Semua fungsi bekerja pada "byte string" (charCode 0..255).
 * Pakai --test untuk self-test round-trip.
 */
'use strict';
const crypto = require('crypto');
const SALT = 'Vmn34aAciYK00Hen26nT01';

const rotl = (x, k) => (((x << k) | (x >> (8 - k))) & 0xFF);
const bytes = s => Array.from(String(s), ch => ch.charCodeAt(0) & 0xFF);
const str = a => a.map(b => String.fromCharCode(b & 0xFF)).join('');
const hexOf = a => a.map(b => (b & 0xFF).toString(16).padStart(2, '0')).join('');

// Mission._msa : +sk[(i+5)%len], rotl 3
function msa(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    return str(a.map((c, i) => rotl((c + k[(i + 5) % k.length]) & 0xFF, 3)));
}
// NinjaSaga._msc : balik lalu XOR sk[3i%len] ^ (5i & 0xFF)
function msc(s, sk) {
    const rev = bytes(s).reverse();
    if (!sk.length) return str(rev);
    const k = bytes(sk);
    return str(rev.map((c, i) => ((c ^ k[(3 * i) % k.length] ^ ((5 * i) & 0xFF)) & 0xFF)));
}
// Main._msb : -sk[len-1-i%len]-L, rotl 4, L bertambah char asli
function msb(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    let L = a.length & 0xFF;
    return str(a.map((c, i) => {
        let x = (c - k[k.length - 1 - (i % k.length)] - L) & 0xFF;
        x = rotl(x, 4);
        L = (L + c) & 0xFF;
        return x;
    }));
}
// Mission._msd / Main._ud : hex per karakter
const msd = s => hexOf(bytes(s));

// _msk = _msd(_msb(_msc(_msa(s, sk), sk), sk))
const msk = (s, sk) => msd(msb(msc(msa(s, sk), sk), sk));

// Character._ua : +sk[(i+7)%len], rotl 6
function ua(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    return str(a.map((c, i) => rotl((c + k[(i + 7) % k.length]) & 0xFF, 6)));
}
// NinjaSaga._uc : balik lalu XOR sk[4i%len] ^ (7i & 0xFF)
function uc(s, sk) {
    const rev = bytes(s).reverse();
    if (!sk.length) return str(rev);
    const k = bytes(sk);
    return str(rev.map((c, i) => ((c ^ k[(4 * i) % k.length] ^ ((7 * i) & 0xFF)) & 0xFF)));
}
// Main._ub : -sk[len-1-i%len]-L, rotl 7
function ub(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    let L = a.length & 0xFF;
    return str(a.map((c, i) => {
        let x = (c - k[k.length - 1 - (i % k.length)] - L) & 0xFF;
        x = rotl(x, 7);
        L = (L + c) & 0xFF;
        return x;
    }));
}
const ud = s => hexOf(bytes(s));
// Main._urk = _ud(_ub(_uc(_ua(p, sk), sk), sk))
const urk = (p, sk) => ud(ub(uc(ua(p, sk), sk), sk));

const sha1 = s => crypto.createHash('sha1').update(String(s), 'binary').digest('hex');

/** Bikin helper bertanda tangan untuk satu session. */
function mk(sessionKey) {
    let seq = 0;
    return {
        sessionKey,
        getHash: s => sha1(s + SALT + sessionKey),
        getArrayHash: arr => sha1(arr.toString() + SALT + sessionKey),
        updateSequence: () => { seq += 1; return sha1(String(seq) + SALT + sessionKey); },
        get seq() { return seq; },
        msk: s => msk(s, sessionKey),
        urk: p => urk(p, sessionKey),
    };
}

// Mission._fa : +sk[(i+11)%len], rotl 1
function fa(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    return str(a.map((c, i) => rotl((c + k[(i + 11) % k.length]) & 0xFF, 1)));
}
// NinjaSaga._fc : balik lalu XOR sk[6i%len] ^ (11i & 0xFF)
function fc(s, sk) {
    const rev = bytes(s).reverse();
    if (!sk.length) return str(rev);
    const k = bytes(sk);
    return str(rev.map((c, i) => ((c ^ k[(6 * i) % k.length] ^ ((11 * i) & 0xFF)) & 0xFF)));
}
// Main._fb : -sk[len-1-i%len]-L, rotl 3, L bertambah char asli
function fb(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    let L = a.length & 0xFF;
    return str(a.map((c, i) => {
        let x = (c - k[k.length - 1 - (i % k.length)] - L) & 0xFF;
        x = rotl(x, 3);
        L = (L + c) & 0xFF;
        return x;
    }));
}
// Mission._fd : hex per karakter
const fd = s => hexOf(bytes(s));
// _frk = _fd(_fb(_fc(_fa(s, sk), sk), sk))  (jalur SS Training / grade lain)
const frk = (s, sk) => fd(fb(fc(fa(s, sk), sk), sk));

// ---- _zrb (token event: _zd(_zc2(_zb2(_za2(p,k),k),k))) ----
// Main._za2 : x = (c + k[i%len]) & 0xFF ; rot kanan 3  ((x>>3)|(x<<5))
function za2(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    return str(a.map((c, i) => { const x = (c + k[i % k.length]) & 0xFF; return ((x >> 3) | (x << 5)) & 0xFF; }));
}
// NinjaSaga._zb2 : xor k[3i%len] ^ (i & 0xFF) lalu balik urutan
function zb2(s, sk) {
    if (!sk.length) return String(s).split('').reverse().join('');
    const a = bytes(s), k = bytes(sk);
    const mid = a.map((c, i) => (c ^ k[(3 * i) % k.length] ^ (i & 0xFF)) & 0xFF);
    return str(mid.reverse());
}
// Main._zc2 : (c - k[(i+2)%len]) & 0xFF lalu tukar nibble
function zc2(s, sk) {
    if (!sk.length) return s;
    const a = bytes(s), k = bytes(sk);
    return str(a.map((c, i) => { const x = (c - k[(i + 2) % k.length]) & 0xFF; return (((x & 0x0F) << 4) | ((x & 0xF0) >> 4)) & 0xFF; }));
}
const zrb = (p, sk) => hexOf(bytes(zc2(zb2(za2(p, sk), sk), sk)));

// Battle._br : 14 byte acak + XOR tabel, hasil hex (nonce ikut dikirim)
const BR_T = [46, 71, 115, 53, 90, 36, 126, 50, 73, 58, 44, 110, 61, 75, 116, 91];
function br(src) {
    const rnd = crypto.randomBytes(14);
    const a = bytes(src);
    let acc = 0;
    const out = a.map((c, i) => {
        const x = (BR_T[(i + acc) % 16] ^ rnd[(i + 3) % 14]) & 0xFF;
        let v = (c ^ x) & 0xFF;
        v = (v + BR_T[(i * 5) % 16]) & 0xFF;
        acc = (acc + v + i * 9) & 0xFF;
        return v;
    });
    return Buffer.concat([rnd, Buffer.from(out)]).toString('hex');
}

// ---- Hunting House (EudemonGarden) token chain, port dari Main.as + OldHuntingHouse.as ----
// _qa: ror2(char) ^ key[i%len]
function qa(s, key) {
    if (!key.length) return s;
    let o = '', t = 0;
    for (let i = 0; i < s.length; i++) {
        t = (((s.charCodeAt(i) << 2) | (s.charCodeAt(i) >> 6)) & 0xFF) ^ key.charCodeAt(i % key.length);
        o += String.fromCharCode(t & 0xFF);
    }
    return o;
}
// _qa2: rol3((char - key[i%len]) & 0xFF)
function qa2(s, key) {
    if (!key.length) return s;
    let o = '', t = 0;
    for (let i = 0; i < s.length; i++) {
        t = (((s.charCodeAt(i) - key.charCodeAt(i % key.length)) & 0xFF) << 3 | ((s.charCodeAt(i) - key.charCodeAt(i % key.length)) & 0xFF) >> 5) & 0xFF;
        o += String.fromCharCode(t);
    }
    return o;
}
// _qb: balik string, lalu (char + key[(3i+1)%len]) & 0xFF, nibble swap
function qb(s, key) {
    const rev = s.split('').reverse().join('');
    if (!key.length) return rev;
    let o = '', t = 0;
    for (let i = 0; i < rev.length; i++) {
        t = (rev.charCodeAt(i) + key.charCodeAt((i * 3 + 1) % key.length)) & 0xFF;
        t = (((t & 0x0F) << 4) | ((t & 0xF0) >> 4)) & 0xFF;
        o += String.fromCharCode(t);
    }
    return o;
}
// _qb2: xor key[2i%len], lalu balik
function qb2(s, key) {
    if (!key.length) return s.split('').reverse().join('');
    let o = '';
    for (let i = 0; i < s.length; i++) o += String.fromCharCode((s.charCodeAt(i) ^ key.charCodeAt((2 * i) % key.length)) & 0xFF);
    return o.split('').reverse().join('');
}
// _qc: xor key[(i+9)%len] ^ i ^ prev, lalu ror3
function qc(s, key) {
    if (!key.length) return s;
    let o = '', prev = key.charCodeAt(0) & 0xFF, t = 0;
    for (let i = 0; i < s.length; i++) {
        t = (s.charCodeAt(i) ^ key.charCodeAt((i + 9) % key.length) ^ (i & 0xFF) ^ prev) & 0xFF;
        t = ((t >> 3) | (t << 5)) & 0xFF;
        o += String.fromCharCode(t);
        prev = t;
    }
    return o;
}
// _qc2: (char + key[(i+5)%len] + i) & 0xFF, nibble swap
function qc2(s, key) {
    if (!key.length) return s;
    let o = '', t = 0;
    for (let i = 0; i < s.length; i++) {
        t = (s.charCodeAt(i) + key.charCodeAt((i + 5) % key.length) + (i & 0xFF)) & 0xFF;
        t = (((t & 0x0F) << 4) | ((t & 0xF0) >> 4)) & 0xFF;
        o += String.fromCharCode(t);
    }
    return o;
}
// _qd: hex
function qd(s) {
    let o = '';
    for (let i = 0; i < s.length; i++) {
        const h = s.charCodeAt(i).toString(16);
        o += h.length < 2 ? '0' + h : h;
    }
    return o;
}
function tokenBoss(v, key) { return qd(qc(qb(qa(v, key), key), key)); }
function tokenLog(v, key) { return qd(qc2(qb2(qa2(v, key), key), key)); }

module.exports = { SALT, sha1, msa, msc, msb, msd, msk, ua, uc, ub, ud, urk, fa, fc, fb, fd, frk, mk, rotl, bytes, str, za2, zb2, zc2, zrb, br, qa, qa2, qb, qb2, qc, qc2, qd, tokenBoss, tokenLog };

if (require.main === module && process.argv.includes('--test')) {
    let fail = 0;
    const eq = (l, g, w) => { const ok = g === w; if (!ok) fail++; console.log((ok ? '  OK   ' : '  FAIL ') + l + (ok ? '' : '\n        got  ' + g + '\n        want ' + w)); };
    const sk = 'gs_abcdefghijklmnop';
    console.log('  uji ns_crypto.js');
    eq('rotl(0x81,1)', rotl(0x81, 1), 0x03);
    eq('msa deterministik', msa('msn138|123', sk), msa('msn138|123', sk));
    eq('msa beda dengan input', String(msa('msn138', sk) !== 'msn138'), 'true');
    eq('msd hex panjang', msd('AB').length, 4);
    eq('msk panjang hex', msk('isGraphic|msn138|123', sk).length % 2, 0);
    eq('msk beda sk -> beda hasil', String(msk('x', sk) !== msk('x', 'gs_zzz')), 'true');
    eq('urk panjang hex genap', urk('a|b', sk).length % 2, 0);
    const s1 = mk(sk);
    eq('updateSequence pertama', s1.updateSequence(), sha1('1' + SALT + sk));
    eq('updateSequence kedua', s1.updateSequence(), sha1('2' + SALT + sk));
    eq('getHash', s1.getHash('msn138'), sha1('msn138' + SALT + sk));
    eq('getArrayHash', s1.getArrayHash([sk, '00084542', 49]), sha1([sk, '00084542', 49].toString() + SALT + sk));
    eq('sk kosong -> msa identitas', msa('abc', ''), 'abc');
    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
