#!/usr/bin/env node
/**
 * lib/amf_decoder.js — Decoder lengkap AMF0 & AMF3 + parser HTTP/chunked/gzip
 * untuk inspeksi dan decoding capture traffic AMF Ninja Saga (Fiddler .saz, HAR, proxy).
 */
'use strict';

const zlib = require('zlib');

function createDecoderState(buf) {
    return {
        buf,
        pos: 0,
        amf0Refs: [],
        amf3Strings: [],
        amf3Objects: [],
        amf3Traits: [],
        warnings: []
    };
}

function ensureBytes(state, needed, label) {
    if (state.pos + needed > state.buf.length) {
        throw new Error(`EOF saat membaca ${label} di offset ${state.pos} (butuh ${needed}, sisa ${state.buf.length - state.pos})`);
    }
}

function readU8(state, label = 'u8') {
    ensureBytes(state, 1, label);
    return state.buf[state.pos++];
}

function readU16(state, label = 'u16') {
    ensureBytes(state, 2, label);
    const val = state.buf.readUInt16BE(state.pos);
    state.pos += 2;
    return val;
}

function readS16(state, label = 's16') {
    ensureBytes(state, 2, label);
    const val = state.buf.readInt16BE(state.pos);
    state.pos += 2;
    return val;
}

function readU32(state, label = 'u32') {
    ensureBytes(state, 4, label);
    const val = state.buf.readUInt32BE(state.pos);
    state.pos += 4;
    return val;
}

function readS32(state, label = 's32') {
    ensureBytes(state, 4, label);
    const val = state.buf.readInt32BE(state.pos);
    state.pos += 4;
    return val;
}

function readDouble(state, label = 'double') {
    ensureBytes(state, 8, label);
    const val = state.buf.readDoubleBE(state.pos);
    state.pos += 8;
    return val;
}

function readUtf8(state, len, label = 'utf8') {
    if (len === 0) return '';
    ensureBytes(state, len, label);
    const str = state.buf.toString('utf8', state.pos, state.pos + len);
    state.pos += len;
    return str;
}

function readAmf3U29(state) {
    let result = 0;
    for (let i = 0; i < 4; i++) {
        const b = readU8(state, 'amf3-u29');
        if (i < 3) {
            result = (result << 7) | (b & 0x7F);
            if ((b & 0x80) === 0) return result;
        } else {
            result = (result << 8) | b;
            return result;
        }
    }
    return result;
}

function readAmf3String(state) {
    const ref = readAmf3U29(state);
    if ((ref & 1) === 0) {
        const idx = ref >> 1;
        return state.amf3Strings[idx] !== undefined ? state.amf3Strings[idx] : `<amf3-str-ref:${idx}>`;
    }
    const len = ref >> 1;
    const str = readUtf8(state, len, 'amf3-string');
    if (len > 0) state.amf3Strings.push(str);
    return str;
}

function readAmf3Value(state) {
    const marker = readU8(state, 'amf3-marker');
    switch (marker) {
        case 0x00: // undefined
            return undefined;
        case 0x01: // null
            return null;
        case 0x02: // false
            return false;
        case 0x03: // true
            return true;
        case 0x04: { // integer
            const u = readAmf3U29(state);
            return (u & 0x10000000) ? (u - 0x20000000) : u;
        }
        case 0x05: // double
            return readDouble(state, 'amf3-double');
        case 0x06: // string
            return readAmf3String(state);
        case 0x07: // XMLDoc
        case 0x0B: { // XML
            const ref = readAmf3U29(state);
            if ((ref & 1) === 0) return state.amf3Objects[ref >> 1];
            const xml = readUtf8(state, ref >> 1, 'amf3-xml');
            state.amf3Objects.push(xml);
            return xml;
        }
        case 0x08: { // Date
            const ref = readAmf3U29(state);
            if ((ref & 1) === 0) return state.amf3Objects[ref >> 1];
            const ms = readDouble(state, 'amf3-date');
            const iso = Number.isFinite(ms) ? new Date(ms).toISOString() : String(ms);
            state.amf3Objects.push(iso);
            return iso;
        }
        case 0x09: { // Array
            const ref = readAmf3U29(state);
            if ((ref & 1) === 0) return state.amf3Objects[ref >> 1];
            const denseLen = ref >> 1;
            const assoc = {};
            let hasAssoc = false;
            const arr = [];
            // Register container placeholder first
            const objSlot = state.amf3Objects.length;
            state.amf3Objects.push(arr);
            while (true) {
                const key = readAmf3String(state);
                if (key === '') break;
                hasAssoc = true;
                assoc[key] = readAmf3Value(state);
            }
            for (let i = 0; i < denseLen; i++) {
                arr.push(readAmf3Value(state));
            }
            if (hasAssoc) {
                if (denseLen === 0) {
                    state.amf3Objects[objSlot] = assoc;
                    return assoc;
                }
                for (let i = 0; i < arr.length; i++) assoc[String(i)] = arr[i];
                state.amf3Objects[objSlot] = assoc;
                return assoc;
            }
            return arr;
        }
        case 0x0A: { // Object
            const ref = readAmf3U29(state);
            if ((ref & 1) === 0) return state.amf3Objects[ref >> 1];
            let traits;
            if ((ref & 2) === 0) {
                traits = state.amf3Traits[ref >> 2];
            } else {
                const externalizable = (ref & 4) !== 0;
                const dynamic = (ref & 8) !== 0;
                const sealedCount = ref >> 4;
                const className = readAmf3String(state);
                const sealedNames = [];
                for (let i = 0; i < sealedCount; i++) {
                    sealedNames.push(readAmf3String(state));
                }
                traits = { className, externalizable, dynamic, sealedNames };
                state.amf3Traits.push(traits);
            }
            const obj = {};
            if (traits.className) obj.__className = traits.className;
            state.amf3Objects.push(obj);
            if (traits.externalizable) {
                obj.__externalizable = true;
                state.warnings.push(`AMF3 externalizable object (${traits.className || 'anon'}) tidak dapat didecode penuh.`);
                return obj;
            }
            for (const name of traits.sealedNames) {
                obj[name] = readAmf3Value(state);
            }
            if (traits.dynamic) {
                while (true) {
                    const key = readAmf3String(state);
                    if (key === '') break;
                    obj[key] = readAmf3Value(state);
                }
            }
            return obj;
        }
        case 0x0C: { // ByteArray
            const ref = readAmf3U29(state);
            if ((ref & 1) === 0) return state.amf3Objects[ref >> 1];
            const len = ref >> 1;
            ensureBytes(state, len, 'amf3-bytearray');
            const raw = state.buf.subarray(state.pos, state.pos + len);
            state.pos += len;
            const out = { __type: 'ByteArray', length: len, base64: raw.toString('base64') };
            state.amf3Objects.push(out);
            return out;
        }
        default:
            state.warnings.push(`Unknown AMF3 marker 0x${marker.toString(16)} at offset ${state.pos - 1}`);
            return `<amf3-marker:0x${marker.toString(16)}>`;
    }
}

function readAmf0Properties(state, target) {
    while (state.pos + 2 <= state.buf.length) {
        const keyLen = readU16(state, 'amf0-obj-key-len');
        if (keyLen === 0) {
            const endMarker = readU8(state, 'amf0-obj-end');
            if (endMarker === 0x09) break;
            state.warnings.push(`Expected 0x09 object-end marker after empty key, got 0x${endMarker.toString(16)}`);
            break;
        }
        const key = readUtf8(state, keyLen, 'amf0-obj-key');
        target[key] = readAmf0Value(state);
    }
    return target;
}

function readAmf0Value(state) {
    const marker = readU8(state, 'amf0-marker');
    switch (marker) {
        case 0x00: // Number
            return readDouble(state, 'amf0-number');
        case 0x01: // Boolean
            return readU8(state, 'amf0-bool') !== 0;
        case 0x02: { // String
            const len = readU16(state, 'amf0-str-len');
            return readUtf8(state, len, 'amf0-str');
        }
        case 0x03: { // Object
            const obj = {};
            state.amf0Refs.push(obj);
            return readAmf0Properties(state, obj);
        }
        case 0x04: // MovieClip
            return '<movieclip>';
        case 0x05: // Null
        case 0x06: // Undefined
        case 0x0D: // Unsupported
            return null;
        case 0x07: { // Reference
            const idx = readU16(state, 'amf0-ref');
            return state.amf0Refs[idx] !== undefined ? state.amf0Refs[idx] : `<amf0-ref:${idx}>`;
        }
        case 0x08: { // ECMA Array
            readU32(state, 'amf0-ecma-count');
            const obj = {};
            state.amf0Refs.push(obj);
            return readAmf0Properties(state, obj);
        }
        case 0x0A: { // Strict Array
            const count = readU32(state, 'amf0-array-count');
            const arr = [];
            state.amf0Refs.push(arr);
            for (let i = 0; i < count; i++) {
                arr.push(readAmf0Value(state));
            }
            return arr;
        }
        case 0x0B: { // Date
            const ms = readDouble(state, 'amf0-date-ms');
            readS16(state, 'amf0-date-tz');
            return Number.isFinite(ms) ? new Date(ms).toISOString() : String(ms);
        }
        case 0x0C: { // Long String
            const len = readU32(state, 'amf0-long-str-len');
            return readUtf8(state, len, 'amf0-long-str');
        }
        case 0x0F: { // XML Document
            const len = readU32(state, 'amf0-xml-len');
            return readUtf8(state, len, 'amf0-xml');
        }
        case 0x10: { // Typed Object
            const clsLen = readU16(state, 'amf0-typed-cls-len');
            const className = readUtf8(state, clsLen, 'amf0-typed-cls');
            const obj = className ? { __className: className } : {};
            state.amf0Refs.push(obj);
            return readAmf0Properties(state, obj);
        }
        case 0x11: // AVMPlusObject (AMF3)
            return readAmf3Value(state);
        default:
            state.warnings.push(`Unknown AMF0 marker 0x${marker.toString(16)} at offset ${state.pos - 1}`);
            return `<amf0-marker:0x${marker.toString(16)}>`;
    }
}

function decodeAmfPacket(buf) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    if (buf.length < 6) {
        throw new Error(`Buffer AMF terlalu pendek (${buf.length} bytes)`);
    }
    const state = createDecoderState(buf);
    const version = readU16(state, 'amf-version');
    const headerCount = readU16(state, 'amf-header-count');
    const headers = [];
    for (let i = 0; i < headerCount; i++) {
        const nameLen = readU16(state, 'amf-hdr-name-len');
        const name = readUtf8(state, nameLen, 'amf-hdr-name');
        const mustUnderstand = readU8(state, 'amf-hdr-must-understand') !== 0;
        const length = readS32(state, 'amf-hdr-length');
        state.amf0Refs = [];
        state.amf3Strings = [];
        state.amf3Objects = [];
        state.amf3Traits = [];
        const value = readAmf0Value(state);
        headers.push({ name, mustUnderstand, length, value });
    }
    const messageCount = readU16(state, 'amf-message-count');
    const messages = [];
    for (let i = 0; i < messageCount; i++) {
        const targetLen = readU16(state, 'amf-msg-target-len');
        const targetUri = readUtf8(state, targetLen, 'amf-msg-target');
        const respLen = readU16(state, 'amf-msg-resp-len');
        const responseUri = readUtf8(state, respLen, 'amf-msg-resp');
        const length = readS32(state, 'amf-msg-length');
        state.amf0Refs = [];
        state.amf3Strings = [];
        state.amf3Objects = [];
        state.amf3Traits = [];
        const body = readAmf0Value(state);
        messages.push({ targetUri, responseUri, length, body });
    }
    return {
        version,
        headers,
        messages,
        warnings: state.warnings,
        bytesRead: state.pos,
        totalBytes: buf.length
    };
}

function findHeaderSplit(buf) {
    const crlf = buf.indexOf('\r\n\r\n');
    if (crlf !== -1) return { headerEnd: crlf, bodyStart: crlf + 4 };
    const lf = buf.indexOf('\n\n');
    if (lf !== -1) return { headerEnd: lf, bodyStart: lf + 2 };
    return null;
}

function dechunkHttpBody(buf) {
    const chunks = [];
    let pos = 0;
    while (pos < buf.length) {
        let lineEnd = buf.indexOf('\r\n', pos);
        let sepLen = 2;
        if (lineEnd === -1) {
            lineEnd = buf.indexOf('\n', pos);
            sepLen = 1;
        }
        if (lineEnd === -1) break;
        const sizeLine = buf.toString('ascii', pos, lineEnd).split(';')[0].trim();
        const chunkSize = parseInt(sizeLine, 16);
        if (!Number.isFinite(chunkSize) || chunkSize < 0) break;
        pos = lineEnd + sepLen;
        if (chunkSize === 0) break;
        const sliceEnd = Math.min(buf.length, pos + chunkSize);
        chunks.push(buf.subarray(pos, sliceEnd));
        pos = sliceEnd;
        if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
        else if (buf[pos] === 0x0a) pos += 1;
    }
    return Buffer.concat(chunks);
}

function decompressHttpBody(buf, encoding) {
    if (!buf.length) return buf;
    const enc = String(encoding || '').toLowerCase().trim();
    if (!enc || enc === 'identity') return buf;
    try {
        if (enc.includes('gzip')) return zlib.gunzipSync(buf);
        if (enc.includes('deflate')) return zlib.inflateSync(buf);
        if (enc.includes('br') && typeof zlib.brotliDecompressSync === 'function') return zlib.brotliDecompressSync(buf);
    } catch (_) {
        return buf;
    }
    return buf;
}

function parseHttpMessage(rawBuf) {
    const buf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
    const split = findHeaderSplit(buf);
    if (!split) return null;
    const headerText = buf.toString('latin1', 0, split.headerEnd);
    const lines = headerText.split(/\r?\n/);
    const startLine = lines[0] || '';
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
        const idx = lines[i].indexOf(':');
        if (idx === -1) continue;
        const key = lines[i].slice(0, idx).trim().toLowerCase();
        const val = lines[i].slice(idx + 1).trim();
        headers[key] = headers[key] ? `${headers[key]}, ${val}` : val;
    }

    let body = buf.subarray(split.bodyStart);
    if (String(headers['transfer-encoding'] || '').toLowerCase().includes('chunked')) {
        body = dechunkHttpBody(body);
    }
    body = decompressHttpBody(body, headers['content-encoding']);

    const reqMatch = startLine.match(/^([A-Z]+)\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/i);
    const resMatch = startLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)(?:\s+(.*))?$/i);
    return {
        kind: resMatch ? 'response' : (reqMatch ? 'request' : 'unknown'),
        startLine,
        method: reqMatch ? reqMatch[1].toUpperCase() : undefined,
        url: reqMatch ? reqMatch[2] : undefined,
        statusCode: resMatch ? Number(resMatch[1]) : undefined,
        statusText: resMatch ? (resMatch[2] || '') : undefined,
        headers,
        body
    };
}

module.exports = {
    decodeAmfPacket,
    parseHttpMessage,
    dechunkHttpBody,
    decompressHttpBody
};
