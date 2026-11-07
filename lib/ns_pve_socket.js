'use strict';
/**
 * lib/ns_pve_socket.js - minimal Socket.IO v2 / Engine.IO v3 client for the Ninja Saga
 * PVE co-op server, on top of Node's built-in WebSocket (Node 24, no dependencies).
 *
 * Port 1:1 dari network_library.swf (com.pnwrain.flashsocket + ninjasaga.Socket).
 * Handshake:  /socket.io/?EIO=3&transport=websocket
 *
 * API (Promise-based, one instance per account):
 *   const sock = await PveSocket.connect({ server, sessionKey, charId, deviceInfo });
 *   await sock.waitAuth();            // resolves when 'auth' status==1 received
 *   sock.createRoom({ password, mode, quest, ver });
 *   sock.joinRoom(roomName, password, ver);
 *   sock.ready(charId);
 *   sock.cancelReady(charId);
 *   sock.startSetTeam();
 *   sock.updateTeam(ta, tb);
 *   sock.startGame();                 // host start (ready {data:{}})
 *   sock.leaveRoom(room);
 *   sock.getRoomSummary();
 *   sock.sendBattleMessage(obj);      // battle_msg
 *   sock.on('captcha_required', fn);  // event handlers
 *   sock.close();
 *
 * Selftest:  node lib/ns_pve_socket.js --selftest
 */
const { PveCrypto, pkr, yeastSpin } = require('./pve_crypto.js');
const { EventEmitter } = require('events');

const PACKET_OPEN = 0, PACKET_CLOSE = 1, PACKET_PING = 2, PACKET_PONG = 3, PACKET_MESSAGE = 4, PACKET_UPGRADE = 5, PACKET_NOOP = 6;
const SI_CONNECT = 0, SI_DISCONNECT = 1, SI_EVENT = 2, SI_ACK = 3, SI_ERROR = 4;

function encodeEnginePacket(type, data) {
    let s = String(type);
    if (data !== undefined && data !== null) s += data;
    return s;
}
function decodeEnginePacket(str) {
    const type = Number(str[0]);
    return { type, data: str.slice(1) };
}

// ---- Socket.IO v2 packet encoder/decoder ----
function encodeSiPacket(packet) {
    let s = '';
    s += packet.type;
    if (packet.nsp && packet.nsp !== '/') s += packet.nsp + ',';
    if (packet.id != null) s += packet.id;
    if (packet.data !== undefined && packet.data !== null) s += JSON.stringify(packet.data);
    return s;
}
function decodeSiPacket(str) {
    const type = Number(str[0]);
    let rest = str.slice(1);
    let nsp = '/';
    if (rest[0] === '/') {
        const i = rest.indexOf(',');
        if (i < 0) { nsp = rest; rest = ''; } else { nsp = rest.slice(0, i); rest = rest.slice(i + 1); }
    }
    let id = null;
    const m = rest.match(/^(\d+)/);
    if (m) { id = Number(m[1]); rest = rest.slice(m[1].length); }
    let data = undefined;
    if (rest) { try { data = JSON.parse(rest); } catch (_) { data = rest; } }
    return { type, nsp, id, data };
}

class PveSocket extends EventEmitter {
    constructor(opts) {
        super();
        this.opts = opts || {};
        this.server = this.opts.server || {};
        this.sessionKey = this.opts.sessionKey;
        this.charId = this.opts.charId;
        this.ver = this.opts.ver || '';
        this.crypto = new PveCrypto();
        this._ht = this.opts.handoffToken || '';
        this._nn = this.opts.handoffNonce || '';
        this.ws = null;
        this._authed = false;
        this._authPromise = null;
        this._authResolve = null;
        this._closed = false;
        this._manualClose = false;
        this._pingTimer = null;
        this._pingTimeoutTimer = null;
        this._writable = false;
    }

    static buildUrl(server) {
        const scheme = server.secure === false ? 'ws' : 'wss';
        const host = server.tls_host || server.ip || server.host;
        let port = server.port;
        if (server.ws_port) port = server.ws_port;
        // ws_port convention: often secure websocket port
        const s = server.secure === false ? 'ws://' : 'wss://';
        return `${s}${host}:${port}/socket.io/?EIO=3&transport=websocket`;
    }

    static connect(opts) {
        return new Promise((resolve, reject) => {
            const sock = new PveSocket(opts);
            const url = opts.url || PveSocket.buildUrl(opts.server || {});
            let settled = false;
            const ws = new WebSocket(url);
            sock.ws = ws;
            ws.binaryType = 'arraybuffer';
            ws.onopen = () => {
                sock._writable = true;
                sock.emit('open');
            };
            ws.onmessage = (ev) => sock._onWsMessage(ev);
            ws.onclose = (ev) => {
                sock._writable = false;
                sock._stopPing();
                if (!sock._manualClose) sock.emit('close', ev.code, ev.reason);
                if (!settled) { settled = true; reject(new Error('WebSocket closed before open: ' + ev.code)); }
            };
            ws.onerror = (ev) => {
                if (!settled) { settled = true; reject(new Error('WebSocket error')); }
                if (sock.listenerCount('error')) sock.emit('error', ev);
            };
            // resolve once the engine "open" packet arrives
            sock.once('engine_open', () => { if (!settled) { settled = true; resolve(sock); } });
            // safety timeout
            setTimeout(() => { if (!settled) { settled = true; reject(new Error('connect timeout')); } }, 15000);
        });
    }

    _onWsMessage(ev) {
        let raw;
        if (typeof ev.data === 'string') raw = ev.data;
        else if (ev.data instanceof ArrayBuffer) raw = Buffer.from(ev.data).toString('utf8');
        else raw = Buffer.from(ev.data).toString('utf8');
        // A single websocket frame may carry multiple engine packets.
        for (const chunk of raw.split(/[\u001e]/)) {
            if (!chunk) continue;
            this._onEnginePacket(chunk);
        }
    }

    _onEnginePacket(chunk) {
        const p = decodeEnginePacket(chunk);
        switch (p.type) {
            case PACKET_OPEN: {
                // p.data is a JSON handshake object
                let hs = {};
                try { hs = JSON.parse(p.data); } catch (_) {}
                this.sid = hs.sid;
                this._startPing(hs.pingInterval, hs.pingTimeout);
                this.emit('engine_open', hs);
                break;
            }
            case PACKET_CLOSE:
                this.close();
                break;
            case PACKET_PING:
                this._sendRaw(encodeEnginePacket(PACKET_PONG, p.data));
                break;
            case PACKET_PONG:
                this._onPong();
                break;
            case PACKET_MESSAGE: {
                const sp = decodeSiPacket(p.data);
                this._onSiPacket(sp);
                break;
            }
            case PACKET_UPGRADE:
            case PACKET_NOOP:
            default:
                break;
        }
    }

    _onSiPacket(sp) {
        switch (sp.type) {
            case SI_CONNECT:
                // server ack'd connect; no nsp so nothing extra needed
                break;
            case SI_EVENT: {
                if (Array.isArray(sp.data) && sp.data.length) {
                    const evt = sp.data[0];
                    const payload = sp.data[1];
                    this._onEvent(evt, payload);
                }
                break;
            }
            case SI_ACK:
            case SI_ERROR:
                this.emit('si_error', sp);
                break;
            default:
                break;
        }
    }

    _onEvent(evt, payload) {
        // Server membungkus semua event game dalam Socket.IO event "message":
        //   42["message",{"event":"auth","status":1,"sn":"..."}]
        // Unwrap -> nama event game = payload.event, data = payload (utuh).
        if (evt === 'message' && payload && typeof payload === 'object' && payload.event != null) {
            const inner = String(payload.event);
            this._dispatchGameEvent(inner, payload);
            return;
        }
        this._dispatchGameEvent(evt, payload);
    }

    _dispatchGameEvent(evt, payload) {
        switch (evt) {
            case 'auth':
                if (payload && payload.sn != null && this._ht && this._nn) {
                    const key = yeastSpin(pkr(this._ht, this._nn), String(payload.sn));
                    if (key) this.crypto.setKey(key);
                }
                if (payload && Number(payload.status) === 1) {
                    this._authed = true;
                    if (this._authResolve) { this._authResolve(this); this._authResolve = null; }
                }
                break;
            case 'handoff':
                if (payload && payload.token != null) this._ht = String(payload.token);
                break;
            default:
                break;
        }
        this.emit(evt, payload);
        this.emit('*', evt, payload);
    }

    _startPing(interval, timeout) {
        this._stopPing();
        const iv = interval || 25000;
        const to = timeout || 20000;
        this._pingTimer = setInterval(() => {
            this._sendRaw(encodeEnginePacket(PACKET_PING, 'probe'));
            this._pingTimeoutTimer = setTimeout(() => {
                // missed pong -> force close
                this._manualClose = true;
                try { this.ws.close(); } catch (_) {}
            }, to);
        }, iv);
    }
    _onPong() { if (this._pingTimeoutTimer) { clearTimeout(this._pingTimeoutTimer); this._pingTimeoutTimer = null; } }
    _stopPing() {
        if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
        if (this._pingTimeoutTimer) { clearTimeout(this._pingTimeoutTimer); this._pingTimeoutTimer = null; }
    }

    _sendRaw(s) {
        if (!this._writable || !this.ws) return;
        try { this.ws.send(s); } catch (_) {}
    }

    // Low-level emit with encryption (mirrors Socket.em / encCmd)
    emitCmd(event, payload) {
        let obj = payload || {};
        try { obj.dv = this.opts.deviceInfo || {}; } catch (_) {}
        const wrapped = this.crypto.encCmd(obj);
        this._sendSiEvent(event, wrapped);
    }
    _sendSiEvent(event, data) {
        this._sendRaw(encodeEnginePacket(PACKET_MESSAGE, encodeSiPacket({ type: SI_EVENT, data: [event, data] })));
    }

    // ---- high level API (mirrors ninjasaga.Socket) ----
    auth(deviceInfo) {
        // sent plain (crypto._sk is null until auth response)
        this._sendSiEvent('auth', { sessionKey: this.sessionKey, dv: deviceInfo || this.opts.deviceInfo || {} });
    }
    waitAuth(timeoutMs) {
        if (this._authed) return Promise.resolve(this);
        if (!this._authPromise) {
            this._authPromise = new Promise((res, rej) => {
                this._authResolve = res;
                const onAuth = data => {
                    clearTimeout(timer);
                    this._authResolve = null;
                    if (!data || Number(data.status) !== 1) rej(new Error('auth ditolak server'));
                    else res(this);
                };
                const timer = setTimeout(() => {
                    this.removeListener('auth', onAuth);
                    this._authResolve = null;
                    rej(new Error('auth timeout'));
                }, timeoutMs || 15000);
                this.once('auth', onAuth);
            });
        }
        return this._authPromise;
    }
    hasCommandKey() { return this.crypto.hasKey(); }
    createRoom({ password, mode, quest, ver } = {}) {
        const p = { password: password || '', mode: mode != null ? mode : 3 };
        if (quest != null && quest > -1) p.quest = quest;
        p.ver = ver || this.ver || '';
        this.emitCmd('join_room', p);
    }
    joinRoom(roomName, password, ver) {
        this.emitCmd('join_room', { room_name: roomName, password: password || '', ver: ver || this.ver || '' });
    }
    joinLobby() { this.emitCmd('join_room', { room_name: 'lobby' }); }
    ready(charId) { this.emitCmd('ready', { character_id: charId }); }
    cancelReady(charId) { this.emitCmd('cancel_ready', { character_id: charId }); }
    startSetTeam() { this.emitCmd('start_set_team', {}); }
    updateTeam(ta, tb) { this.emitCmd('updateTeam', { ta: ta || [], tb: tb || [] }); }
    startGame() { this.emitCmd('ready', { data: {} }); }
    leaveRoom(room) { this.emitCmd('leave_room', { room: room || '' }); }
    getRoomSummary() { this.emitCmd('get_room_summary', {}); }
    kickPlayer(charId) { this.emitCmd('kick_user', { character_id: charId }); }
    sendBattleMessage(msg) { this.emitCmd('battle_msg', { message: msg }); }
    // battle helpers
    battleJoin({ charId, charName, charAgility } = {}) {
        this.sendBattleMessage({ event: 'info', state: 'join', charId: String(charId || this.charId), charName: String(charName || ''), charAgility: String(charAgility || 0), charType: 'player', side: 1 });
    }
    battleInit() { this.sendBattleMessage({ event: 'info', state: 'init' }); }
    battleReady() { this.sendBattleMessage({ event: 'info', state: 'ready' }); }
    // Masuk ATB (client mengirim info/start_atb saat battle dimulai - Battle.startATB)
    startAtb() { this.sendBattleMessage({ event: 'info', state: 'start_atb', charId: String(this.charId) }); }
    // Ack setelah tween ATB selesai - Battle.tweenATBFinish.
    actionReady() { this.sendBattleMessage({ event: 'info', state: 'action', charId: String(this.charId) }); }
    // Ack setelah animasi/efek battle_action selesai.
    actionFinish(charDead) { this.sendBattleMessage({ event: 'info', state: 'action_finish', charId: String(this.charId), char_dead: Boolean(charDead) }); }
    // Perintah giliran: {event:"info", state:"battle_command", charId, targetId, battleAction}
    battleCommand(charId, action, skillId, targetId) {
        const ba = { action };
        if (skillId != null) ba.skillId = skillId;
        const msg = { event: 'info', state: 'battle_command', charId: String(charId || this.charId), battleAction: ba };
        if (targetId != null) msg.targetId = targetId;
        this.sendBattleMessage(msg);
    }
    // Sinyal menang. Bentuk dari Battle.as: {event:"info", charId, state:"battle_win"},
    // dikirim dengan key "BATTLE_HAV_WIN" (Socket.sendData gate).
    battleWin(charId) { this.sendBattleMessage({ event: 'info', state: 'battle_win', charId: String(charId || this.charId) }); }

    close() {
        this._manualClose = true;
        this._stopPing();
        try { this.ws && this.ws.close(); } catch (_) {}
        this._closed = true;
    }
}

module.exports = { PveSocket, encodeEnginePacket, decodeEnginePacket, encodeSiPacket, decodeSiPacket };

if (require.main === module && process.argv.includes('--selftest')) {
    let fail = 0;
    const eq = (l, g, w) => {
        const ok = g === w;
        if (!ok) fail++;
        console.log((ok ? '  OK   ' : '  FAIL ') + l + (ok ? '' : ' got=' + JSON.stringify(g) + ' want=' + JSON.stringify(w)));
    };

    console.log('  selftest lib/ns_pve_socket.js (offline encode/decode)');

    eq('engine open', encodeEnginePacket(0, '{"sid":"abc"}'), '0{"sid":"abc"}');
    eq('engine message type', decodeEnginePacket('42["x"]').type, PACKET_MESSAGE);

    const enc = encodeSiPacket({ type: SI_EVENT, data: ['auth', { a: 1 }] });
    eq('si event encode', enc, '2["auth",{"a":1}]');
    const dec = decodeSiPacket('2["auth",{"a":1}]');
    eq('si event decode type', dec.type, SI_EVENT);
    eq('si event decode event', dec.data[0], 'auth');
    eq('si event decode payload', dec.data[1].a, 1);

    const nsp = decodeSiPacket('2/admin,123["x",{}]');
    eq('si nsp decode', nsp.nsp, '/admin');
    eq('si id decode', nsp.id, 123);

    eq('url ws path', PveSocket.buildUrl({ ip: 'pvp.ninjasaga.cc', port: 443, secure: true }).endsWith('/socket.io/?EIO=3&transport=websocket'), true);
    eq('url scheme wss', PveSocket.buildUrl({ ip: 'h', port: 443, secure: true }).startsWith('wss://'), true);

    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
