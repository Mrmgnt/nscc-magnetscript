'use strict';
/**
 * lib/pve_crypto.js - PVE socket command encryption (port 1:1 from decompiled AS3).
 * Sumber: network_library.swf -> ninjasaga/Socket.as, ninjasaga/net/Client.as,
 *         com/pnwrain/flashsocket/Yeast.as, com/worlize/websocket/WebSocketFrame.as,
 *         NinjaSaga.as (emuMix), Main.as (uiScale/uiNudge/uiKern/uiHue),
 *         StateInventory.as (slotCode/slotTag/slotShift), bitemycode/loader/LoaderQueue.as.
 *
 * Semua aritmetika 32-bit signed (|0). Tanpa dependency.
 */
const imul = (a, b) => Math.imul(a, b) | 0;                       // pollTick / maskStep
const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) | 0;

// ---- StateInventory ----
const SLOT_TAG = 'Qm7Kx2Lp9Vd4Rt8Zw';
function slotCode(n) { let h = (n >>> 0).toString(16); while (h.length < 8) h = '0' + h; return h; }

// ---- Main.uiNudge -> StateInventory.slotShift ----
function uiNudge(s) {
    let p0 = s[0] | 0, p1 = s[1] | 0, p2 = s[2] | 0, p3 = s[3] | 0;
    p0 = (p0 + p1) | 0;
    p3 = ((p3 ^ p0) << 16) | ((p3 ^ p0) >>> 16);
    p2 = (p2 + p3) | 0;
    p1 = (p1 ^ p2) | 0;
    p1 = ((p1 << 12) | (p1 >>> 20)) | 0;
    p0 = (p0 + imul(p1, -1640531535)) | 0;
    p3 = ((p3 ^ p0) << 8) | ((p3 ^ p0) >>> 24);
    p2 = (p2 + imul(p3, -2048144789)) | 0;
    p1 = (p1 ^ p2) | 0;
    p1 = ((p1 << 7) | (p1 >>> 25)) | 0;
    s[0] = p0; s[1] = p1; s[2] = p2; s[3] = p3;
}

// ---- LoaderQueue.pace ----
function pace(s, ch) {
    s[0] = (s[0] + imul((ch + 1), -1028477387)) | 0;
    s[3] = (s[3] ^ ch) | 0;
    uiNudge(s);
}

// ---- Main.uiScale (used in pkr) ----
function uiScale(p1, p2) {
    const n = p2.length;
    if (n === 0) return p1;
    let rev = ''; for (let i = p1.length - 1; i >= 0; i--) rev += p1.charAt(i);
    let out = ''; let c8 = rev.length & 0xFF; let acc = 0;
    for (let i = 0; i < rev.length; i++) {
        acc = (rev.charCodeAt(i) + p2.charCodeAt((3 * i + 1) % n) + c8) & 0xFF;
        acc = ((acc << 3) | (acc >>> 5)) & 0xFF;
        c8 = (c8 + rev.charCodeAt(i)) & 0xFF;
        out += String.fromCharCode(acc);
    }
    return out;
}

// ---- NinjaSaga.emuMix (used in pkr) ----
function emuMix(p1, p2) {
    const n = p2.length;
    if (n === 0) return p1;
    let out = ''; let acc = 0;
    for (let i = 0; i < p1.length; i++) {
        acc = (p1.charCodeAt(i) ^ p2.charCodeAt((i * i + 5) % n) ^ (7 * i & 0xFF)) & 0xFF;
        acc = ((acc >> 1) | (acc << 7)) & 0xFF;
        out += String.fromCharCode(acc);
    }
    return out;
}

// ---- Socket.pk1 (used in pkr) ----
function pk1(p1, p2) {
    const n = p2.length;
    if (n === 0) return p1;
    let out = ''; let acc = 0;
    for (let i = 0; i < p1.length; i++) {
        acc = ((((acc = (p1.charCodeAt(i) ^ p2.charCodeAt((i + 7) % n)) & 0xFF) << 2 | acc >>> 6) & 0xFF) + (i * 5 & 0xFF)) & 0xFF;
        out += String.fromCharCode(acc);
    }
    return out;
}

// ---- Socket.pk2 (hex) ----
function pk2(p1) { let o = ''; for (let i = 0; i < p1.length; i++) { let h = p1.charCodeAt(i).toString(16); if (h.length < 2) h = '0' + h; o += h; } return o; }

// ---- Socket.pkr ----
function pkr(ht, nn) {
    if (!ht || !nn || !ht.length || !nn.length) return '';
    let x = pk1(ht, nn);
    x = uiScale(x, nn);
    x = emuMix(x, nn);
    return pk2(x);
}

// ---- Yeast.spin ----
function yeastSpin(a, b) {
    if (!a || !a.length || !b || !b.length) return null;
    const s = [668265263, -1028477387, -2048144789, -1640531535];
    for (let i = 0; i < a.length; i++) pace(s, a.charCodeAt(i));
    pace(s, 90);
    const tag = SLOT_TAG;
    for (let i = 0; i < tag.length; i++) pace(s, tag.charCodeAt(i));
    for (let i = 0; i < b.length; i++) pace(s, b.charCodeAt(i));
    const theme = 'hN3cY6gB1sJ5fT0uE';
    for (let i = 0; i < theme.length; i++) pace(s, theme.charCodeAt(i));
    for (let i = 0; i < 8; i++) uiNudge(s);
    return s;
}

// ---- LoaderQueue.frame (command encryption) ----
function frame(data, key, seq) {
    const k = [(key[0] ^ seq) | 0, (key[1] + imul(seq, -1640531535)) | 0, (key[2] ^ (((seq << 13) | (seq >>> 19)) | 0)) | 0, (key[3] + seq) | 0];
    for (let i = 0; i < 6; i++) uiNudge(k);
    const k0 = key[0] | 0;
    let h = slotCode((seq ^ (((k0 << 7) | (k0 >>> 25)) | 0)) | 0);
    for (let i = 0; i < data.length; i++) {
        const b = data[i] & 0xFF;
        const x = (b ^ (k[0] ^ (k[2] >>> 11) ^ (((k[3] << 5) | (k[3] >>> 27)) | 0))) & 0xFF;
        h += (x < 16 ? '0' : '') + x.toString(16);
        k[1] = (k[1] ^ imul((b + 257), -2048144789)) | 0;
        uiNudge(k);
    }
    k[1] = (k[1] ^ data.length) | 0;
    for (let i = 0; i < 4; i++) uiNudge(k);
    return h + slotCode((k[0] ^ k[2]) | 0);
}

// ---- encCmd / em ----
class PveCrypto {
    constructor() { this._sk = null; this._sq = 0; }
    setKey(sk) { this._sk = sk; this._sq = 0; }
    hasKey() { return Array.isArray(this._sk) && this._sk.length === 4; }
    encCmd(payload) {
        if (this._sk == null) return payload;
        const json = JSON.stringify(payload);
        const bytes = Buffer.from(json, 'utf8');
        ++this._sq;
        return { _z: frame(bytes, this._sk, this._sq) };
    }
}

module.exports = { imul, rotl, uiNudge, uiScale, emuMix, pk1, pk2, pkr, yeastSpin, frame, slotCode, pace, PveCrypto, SLOT_TAG };

if (require.main === module && process.argv.includes('--test')) {
    let fail = 0;
    const eq = (l, g, w) => { const ok = g === w; if (!ok) fail++; console.log((ok ? '  OK   ' : '  FAIL ') + l + (ok ? '' : '\n        got  ' + g + '\n        want ' + w)); };
    console.log('  uji lib/pve_crypto.js');
    eq('imul identity small', imul(7, 3), 21);
    eq('imul sign', imul(-1028477387, 5), Math.imul(-1028477387, 5) | 0);
    eq('slotCode pad', slotCode(0x1a), '0000001a');
    eq('pk2 hex', pk2('AB'), '4142');
    eq('uiScale rotates current byte', uiScale('\x01', '\x00').charCodeAt(0), 16);
    eq('emuMix rotates current byte', emuMix('\x01', '\x00').charCodeAt(0), 128);
    // pkr determinism
    eq('pkr determinism', pkr('tok', 'nonce') === pkr('tok', 'nonce'), true);
    eq('pkr length hex', pkr('tok', 'nonce').length % 2, 0);
    // yeast spin produces 4 ints, deterministic
    const s1 = yeastSpin('abc', 'def'); const s2 = yeastSpin('abc', 'def');
    eq('yeastSpin deterministic', JSON.stringify(s1) === JSON.stringify(s2), true);
    eq('yeastSpin 4 ints', s1.length, 4);
    // frame deterministic for same key/seq
    const k = yeastSpin('abc', 'def');
    const f1 = frame(Buffer.from('{"a":1}'), k, 1);
    const f2 = frame(Buffer.from('{"a":1}'), k, 1);
    eq('frame deterministic', f1 === f2, true);
    eq('frame is hex', /^[0-9a-f]+$/.test(f1), true);
    // encCmd: plain before key, wrapped after
    const c = new PveCrypto();
    eq('encCmd plain (no key)', JSON.stringify(c.encCmd({ x: 1 })), '{"x":1}');
    c.setKey(k);
    const enc = c.encCmd({ x: 1 });
    eq('encCmd wrapped', Object.keys(enc).length === 1 && typeof enc._z === 'string', true);
    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
