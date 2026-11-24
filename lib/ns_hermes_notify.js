'use strict';
/**
 * lib/ns_hermes_notify.js - Lightweight WhatsApp report sender via Hermes webhook.
 * Pure Node built-in modules only (works on ARM64 STB Node 20 and Windows).
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const DEFAULT_URL = 'https://injection-less-landscape-frederick.trycloudflare.com/webhooks/agent-task-reports';
const DEFAULT_SECRET = 'cYZaWn5phbHs5B6lMwNl_LgZ1TqpUlRb6HT_jClvLGQ';

function formatNumber(n) {
    return Number.isFinite(Number(n)) ? Number(n).toLocaleString('id-ID') : String(n ?? '-');
}

function formatCerberusReport(report, meta = {}) {
    const matches = Array.isArray(report && report.matches) ? report.matches : [];
    const attempts = Array.isArray(report && report.attempts) ? report.attempts : null;
    const wins = matches.filter(m => m && (m.outcome === 'win' || m.outcome === 'battle_win' || m.outcome === 'battle_finish')).length;
    const loses = matches.filter(m => m && (m.outcome === 'lose' || m.outcome === 'battle_lose')).length;
    const retries = attempts ? attempts.filter(m => m && m.outcome === 'retry').length : matches.filter(m => m && m.outcome === 'retry').length;
    const hasError = Boolean(report && report.error);
    const status = hasError ? '❌ FAILED' : (wins > 0 || matches.length > 0 ? '✅ SUCCESS' : '⚠️ WARNING');
    const modeLabel = report && report.mode === 'host-room' ? 'Host Room (18-2)' : 'Quickmatch (18-1)';
    const energyStart = meta.energyStart != null ? formatNumber(meta.energyStart) : '-';
    const energyEnd = meta.energyEnd != null ? formatNumber(meta.energyEnd) : '-';
    const stopReason = (report && report.error) || meta.stopReason || 'Selesai / Energy habis';

    const rewards = [];
    for (const m of matches) {
        if (!m || !m.reward || typeof m.reward !== 'object') continue;
        for (const list of Object.values(m.reward)) {
            if (Array.isArray(list)) rewards.push(...list.map(String));
        }
    }

    const rankLine = meta.rankStart != null || meta.rankEnd != null
        ? `• Ranking: #${meta.rankStart ?? meta.rankEnd} -> #${meta.rankEnd ?? meta.rankStart}`
        : null;
    const scoreLine = meta.totalScoreStart != null || meta.totalScoreEnd != null
        ? (() => {
            const delta = meta.totalScoreStart != null && meta.totalScoreEnd != null ? Number(meta.totalScoreEnd) - Number(meta.totalScoreStart) : 0;
            return `• Total Score: ${formatNumber(meta.totalScoreStart ?? meta.totalScoreEnd)} -> ${formatNumber(meta.totalScoreEnd ?? meta.totalScoreStart)}${delta > 0 ? ` (+${formatNumber(delta)})` : ''}`;
        })()
        : null;

    const lines = [
        `Bot Cerberus (${modeLabel}) selesai.`,
        `• Karakter: ${meta.charName || report.account || '-'} (${report.account || '-'})`,
        `• Match: ${matches.length} total (Menang: ${wins}, Kalah: ${loses}, Retry: ${retries})`,
        `• Energy: ${energyStart} -> ${energyEnd}`,
        scoreLine,
        rankLine,
        rewards.length ? `• Reward: ${rewards.slice(0, 8).join(', ')}${rewards.length > 8 ? ` (+${rewards.length - 8} lainnya)` : ''}` : null,
        `• Status akhir: ${stopReason}`,
    ].filter(Boolean);

    const now = new Date();
    const pad = v => String(v).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    return {
        source_agent: 'NSCC-Bot',
        project_name: 'nscc-magnetscript',
        task_title: `Cerberus ${modeLabel} - ${meta.charName || report.account || 'Bot'}`,
        status,
        summary: lines.join('\n'),
        files_changed: [report && report.mode === 'host-room' ? 'cerberus_host_report.json' : 'coop_report.json'],
        git_status: 'not_needed',
        git_branch: 'main',
        komodo_build: 'not_needed',
        clickup_status: status,
        timestamp,
    };
}

function sendHermesReport(payload, opts = {}) {
    const notifyUrl = opts.url || process.env.HERMES_NOTIFY_URL || DEFAULT_URL;
    const secret = opts.secret || process.env.HERMES_NOTIFY_SECRET || DEFAULT_SECRET;
    const timeoutMs = Number(opts.timeoutMs) || 10000;
    const bodyStr = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

    let parsedUrl;
    try {
        parsedUrl = new URL(notifyUrl);
    } catch (err) {
        return Promise.resolve({ ok: false, error: err.message });
    }
    const client = parsedUrl.protocol === 'http:' ? http : https;

    return new Promise(resolve => {
        const req = client.request(parsedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'X-Hub-Signature-256': signature,
                'User-Agent': 'Hermes-Agent-Notifier/1.0',
            },
            timeout: timeoutMs,
        }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 300) });
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error('Hermes webhook timeout'));
        });
        req.on('error', err => {
            resolve({ ok: false, error: err.message });
        });
        req.write(bodyStr);
        req.end();
    });
}

module.exports = { sendHermesReport, formatCerberusReport, DEFAULT_URL, DEFAULT_SECRET };

