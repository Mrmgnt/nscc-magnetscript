'use strict';
/**
 * lib/ns_pve_node_websocket.js - Minimal pure-Node RFC 6455 WebSocket client.
 * Zero external dependencies; works on Node.js v18/v20/v24+ (ARM64 STB & Linux).
 */
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BIN = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xA;

function encodeClientFrame(opcode, data) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data || ''), 'utf8');
    const len = payload.length;
    let headerLen = 2;
    if (len >= 126 && len < 65536) headerLen = 4;
    else if (len >= 65536) headerLen = 10;
    const mask = crypto.randomBytes(4);
    const frame = Buffer.allocUnsafe(headerLen + 4 + len);
    frame[0] = 0x80 | (opcode & 0x0F);
    if (len < 126) {
        frame[1] = 0x80 | len;
    } else if (len < 65536) {
        frame[1] = 0x80 | 126;
        frame.writeUInt16BE(len, 2);
    } else {
        frame[1] = 0x80 | 127;
        frame.writeBigUInt64BE(BigInt(len), 2);
    }
    mask.copy(frame, headerLen);
    for (let i = 0; i < len; i++) {
        frame[headerLen + 4 + i] = payload[i] ^ mask[i & 3];
    }
    return frame;
}

class NodeWebSocket {
    constructor(url) {
        this.url = String(url);
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        this.binaryType = 'arraybuffer';
        this.readyState = 0; // CONNECTING
        this._socket = null;
        this._buffer = Buffer.alloc(0);
        this._fragments = [];
        this._fragOpcode = null;
        this._closedEmitted = false;
        this._closing = false;
        this._connect();
    }

    _connect() {
        let parsed;
        try { parsed = new URL(this.url); } catch (e) { this._fail(e); return; }
        const isWss = parsed.protocol === 'wss:';
        const host = parsed.hostname;
        const port = Number(parsed.port) || (isWss ? 443 : 80);
        const pathAndQuery = (parsed.pathname || '/') + (parsed.search || '');
        const key = crypto.randomBytes(16).toString('base64');
        const expectedAccept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

        const upgradeReq = (socket) => {
            this._socket = socket;
            socket.on('error', err => this._fail(err));
            socket.on('close', () => {
                this._emitClose(this._closeCode || 1006, this._closeReason || '');
            });

            let headerBuf = Buffer.alloc(0);
            let upgraded = false;
            const onData = chunk => {
                if (!upgraded) {
                    headerBuf = Buffer.concat([headerBuf, chunk]);
                    const sep = headerBuf.indexOf('\r\n\r\n');
                    if (sep < 0) {
                        if (headerBuf.length > 16384) this._fail(new Error('WebSocket handshake header too large'));
                        return;
                    }
                    const head = headerBuf.slice(0, sep).toString('latin1');
                    const rest = headerBuf.slice(sep + 4);
                    const lines = head.split('\r\n');
                    const statusMatch = (lines[0] || '').match(/^HTTP\/\d\.\d\s+(\d+)/);
                    const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
                    const headers = {};
                    for (let i = 1; i < lines.length; i++) {
                        const idx = lines[i].indexOf(':');
                        if (idx > 0) headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
                    }
                    if (statusCode !== 101 || headers['sec-websocket-accept'] !== expectedAccept) {
                        this._fail(new Error('WebSocket handshake gagal (HTTP ' + statusCode + ')'));
                        try { socket.destroy(); } catch (_) {}
                        return;
                    }
                    upgraded = true;
                    this.readyState = 1; // OPEN
                    if (this.onopen) this.onopen();
                    if (rest.length) this._onFrameBytes(rest);
                    return;
                }
                this._onFrameBytes(chunk);
            };
            socket.on('data', onData);
            const hostHeader = ((isWss && port === 443) || (!isWss && port === 80)) ? host : `${host}:${port}`;
            const reqText = [
                `GET ${pathAndQuery} HTTP/1.1`,
                `Host: ${hostHeader}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                'Origin: https://ninjasaga.cc',
                '', ''
            ].join('\r\n');
            socket.write(reqText);
        };

        const proxyEnv = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
        if (proxyEnv) {
            try {
                const pUrl = new URL(proxyEnv);
                const proxyClient = pUrl.protocol === 'https:' ? https : http;
                const req = proxyClient.request({
                    host: pUrl.hostname,
                    port: Number(pUrl.port) || (pUrl.protocol === 'https:' ? 443 : 80),
                    method: 'CONNECT',
                    path: `${host}:${port}`,
                    rejectUnauthorized: process.env.NS_TLS_INSECURE !== '1',
                });
                req.on('connect', (res, sock) => {
                    if (res.statusCode !== 200) {
                        this._fail(new Error('Proxy CONNECT gagal: ' + res.statusCode));
                        try { sock.destroy(); } catch (_) {}
                        return;
                    }
                    if (isWss) {
                        const tlsSock = tls.connect({ socket: sock, servername: host, rejectUnauthorized: process.env.NS_TLS_INSECURE !== '1' }, () => upgradeReq(tlsSock));
                        tlsSock.on('error', err => this._fail(err));
                    } else {
                        upgradeReq(sock);
                    }
                });
                req.on('error', err => this._fail(err));
                req.end();
                return;
            } catch (_) {}
        }

        if (isWss) {
            const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: process.env.NS_TLS_INSECURE !== '1' }, () => upgradeReq(sock));
            sock.on('error', err => this._fail(err));
        } else {
            const sock = net.connect({ host, port }, () => upgradeReq(sock));
            sock.on('error', err => this._fail(err));
        }
    }

    _onFrameBytes(chunk) {
        this._buffer = Buffer.concat([this._buffer, chunk]);
        while (this._buffer.length >= 2) {
            const b0 = this._buffer[0];
            const b1 = this._buffer[1];
            const fin = (b0 & 0x80) !== 0;
            const opcode = b0 & 0x0F;
            const masked = (b1 & 0x80) !== 0;
            let len = b1 & 0x7F;
            let offset = 2;
            if (len === 126) {
                if (this._buffer.length < 4) return;
                len = this._buffer.readUInt16BE(2);
                offset = 4;
            } else if (len === 127) {
                if (this._buffer.length < 10) return;
                len = Number(this._buffer.readBigUInt64BE(2));
                offset = 10;
            }
            const maskLen = masked ? 4 : 0;
            if (this._buffer.length < offset + maskLen + len) return;
            const maskKey = masked ? this._buffer.slice(offset, offset + 4) : null;
            let payload = this._buffer.slice(offset + maskLen, offset + maskLen + len);
            if (masked && maskKey) {
                payload = Buffer.from(payload);
                for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
            }
            this._buffer = this._buffer.slice(offset + maskLen + len);

            if (opcode === OP_PING) {
                if (this.readyState === 1 && this._socket && !this._socket.destroyed) {
                    try { this._socket.write(encodeClientFrame(OP_PONG, payload)); } catch (_) {}
                }
                continue;
            }
            if (opcode === OP_PONG) continue;
            if (opcode === OP_CLOSE) {
                let code = 1000, reason = '';
                if (payload.length >= 2) {
                    code = payload.readUInt16BE(0);
                    reason = payload.slice(2).toString('utf8');
                }
                this._closeCode = code;
                this._closeReason = reason;
                if (!this._closing && this._socket && !this._socket.destroyed) {
                    this._closing = true;
                    const reply = Buffer.allocUnsafe(2);
                    reply.writeUInt16BE(code, 0);
                    try { this._socket.write(encodeClientFrame(OP_CLOSE, reply)); } catch (_) {}
                }
                try { this._socket && this._socket.end(); } catch (_) {}
                this._emitClose(code, reason);
                return;
            }

            if (opcode === OP_CONT) {
                this._fragments.push(payload);
            } else {
                this._fragOpcode = opcode;
                this._fragments = [payload];
            }
            if (fin) {
                const full = this._fragments.length === 1 ? this._fragments[0] : Buffer.concat(this._fragments);
                const fullOpcode = this._fragOpcode;
                this._fragments = [];
                this._fragOpcode = null;
                if (this.onmessage) {
                    const data = fullOpcode === OP_TEXT ? full.toString('utf8') : full;
                    this.onmessage({ data });
                }
            }
        }
    }

    _fail(err) {
        if (this.onerror) this.onerror({ message: err && err.message || 'WebSocket error', error: err });
        this._emitClose(1006, (err && err.message) || '');
    }

    _emitClose(code, reason) {
        if (this._closedEmitted) return;
        this._closedEmitted = true;
        this.readyState = 3; // CLOSED
        if (this.onclose) this.onclose({ code, reason });
    }

    send(data) {
        if (this.readyState !== 1 || !this._socket || this._socket.destroyed) return;
        this._socket.write(encodeClientFrame(OP_TEXT, data));
    }

    close(code = 1000, reason = '') {
        if (this._closing || this.readyState === 3) return;
        this._closing = true;
        this._closeCode = code;
        this._closeReason = reason;
        if (this.readyState === 1 && this._socket && !this._socket.destroyed) {
            const rBuf = Buffer.from(String(reason || ''), 'utf8');
            const p = Buffer.allocUnsafe(2 + rBuf.length);
            p.writeUInt16BE(code, 0);
            rBuf.copy(p, 2);
            try { this._socket.write(encodeClientFrame(OP_CLOSE, p)); } catch (_) {}
        }
        setTimeout(() => { try { this._socket && this._socket.destroy(); } catch (_) {} }, 250).unref();
    }
}

module.exports = { NodeWebSocket, encodeClientFrame };

if (require.main === module && process.argv.includes('--selftest')) {
    const server = http.createServer();
    server.on('upgrade', (req, socket) => {
        const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
        socket.write([
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
            '', ''
        ].join('\r\n'));

        const sendServerFrame = (opcode, payload, fin = true) => {
            const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
            let hdr;
            if (buf.length < 126) { hdr = Buffer.from([(fin ? 0x80 : 0) | opcode, buf.length]); }
            else if (buf.length < 65536) { hdr = Buffer.allocUnsafe(4); hdr[0] = (fin ? 0x80 : 0) | opcode; hdr[1] = 126; hdr.writeUInt16BE(buf.length, 2); }
            else { hdr = Buffer.allocUnsafe(10); hdr[0] = (fin ? 0x80 : 0) | opcode; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(buf.length), 2); }
            socket.write(Buffer.concat([hdr, buf]));
        };

        // Send fragmented > 70KB message + ping
        const big = 'A'.repeat(70000);
        sendServerFrame(OP_TEXT, big.slice(0, 35000), false);
        sendServerFrame(OP_PING, 'hi');
        sendServerFrame(OP_CONT, big.slice(35000), true);
        setTimeout(() => {
            const cls = Buffer.allocUnsafe(6);
            cls.writeUInt16BE(1000, 0);
            cls.write('done', 2);
            sendServerFrame(OP_CLOSE, cls, true);
        }, 50);
    });
    server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const ws = new NodeWebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=3&transport=websocket`);
        let gotLen = 0;
        ws.onmessage = ev => { gotLen = ev.data.length; };
        ws.onclose = ev => {
            server.close();
            if (gotLen !== 70000 || ev.code !== 1000 || ev.reason !== 'done') {
                console.error('FAIL', { gotLen, ev });
                process.exit(1);
            }
            console.log('OK: NodeWebSocket RFC6455 loopback (fragmented 70KB + ping/pong + close)');
            process.exit(0);
        };
    });
}

