'use strict';
const { spawn } = require('child_process');
const path = require('path');

class WindowsWebSocket {
    constructor(url) {
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        this.closed = false;
        this._closeFired = false;
        this._closeInfo = null;
        this._lastError = '';
        this._stdout = '';
        this.child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'ns_pve_windows_websocket.ps1'), '-Url', url], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.child.stdout.setEncoding('utf8');
        this.child.stdout.on('data', chunk => this._read(chunk));
        this.child.stderr.setEncoding('utf8');
        this.child.stderr.on('data', chunk => this._error(String(chunk).trim()));
        this.child.on('error', error => this._error(error.message));
        this.child.on('close', exitCode => {
            if (this._closeFired) return;
            this._closeFired = true;
            const info = this._closeInfo || { code: exitCode === 0 ? 1000 : 1006, reason: this._lastError || '' };
            if (this.onclose) this.onclose(info);
        });
    }

    _read(chunk) {
        this._stdout += chunk;
        let newline;
        while ((newline = this._stdout.indexOf('\n')) >= 0) {
            const line = this._stdout.slice(0, newline).trim();
            this._stdout = this._stdout.slice(newline + 1);
            if (!line) continue;
            try {
                const event = JSON.parse(line);
                if (event.type === 'open' && this.onopen) this.onopen();
                else if (event.type === 'message' && this.onmessage) this.onmessage({ data: Buffer.from(event.data, 'base64').toString('utf8') });
                else if (event.type === 'error') this._error(event.message || 'Windows WebSocket error');
                else if (event.type === 'close') this._closeInfo = { code: Number(event.code) || 1000, reason: String(event.reason || '') };
            } catch (error) { this._error(error.message); }
        }
    }

    _error(message) {
        if (message) this._lastError = message;
        if (!this.closed && this.onerror) this.onerror({ message, error: new Error(message) });
    }
    send(data) {
        if (this.closed || !this.child || !this.child.stdin.writable) return;
        this.child.stdin.write(JSON.stringify({ type: 'send', data: Buffer.from(String(data), 'utf8').toString('base64') }) + '\n');
    }
    close() {
        if (this.closed) return;
        this.closed = true;
        try { this.child.stdin.write(JSON.stringify({ type: 'close' }) + '\n'); } catch (_) {}
        setTimeout(() => { try { this.child.kill(); } catch (_) {} }, 1000).unref();
    }
}

module.exports = { WindowsWebSocket };