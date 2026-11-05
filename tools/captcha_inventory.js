'use strict';
const fs = require('fs');
const path = require('path');
const { decodePNG } = require('../lib/png_decoder');

const LOGS_DIR = path.join(__dirname, '..', 'logs', 'captcha_fail');
const LABELS_FILE = path.join(LOGS_DIR, 'captcha_labels.json');

/**
 * Scan logs/captcha_fail and build a unified inventory of all captcha artifacts.
 */
function getInventory() {
    if (!fs.existsSync(LOGS_DIR)) return [];
    const files = fs.readdirSync(LOGS_DIR);
    const jsons = files.filter(f => f.endsWith('.json') && f !== 'captcha_labels.json').sort();
    const inventory = [];

    const labels = getLabels();

    for (const j of jsons) {
        const m = j.match(/^(?:verify|rotate)_(?:rejected|failed)_(\d+)\.json$/);
        const id = m ? m[1] : j.replace('.json', '');
        const prefix = j.replace('.json', '');
        const bg = files.find(f => f.startsWith(prefix + '_background'));
        const pc = files.find(f => f.startsWith(prefix + '_piece'));
        const screenshots = files.filter(f => {
            if (!f.endsWith('.png') || f.includes('_background') || f.includes('_piece')) return false;
            const sm = f.match(/^(?:verify|rotate)_(?:rejected|failed)_(\d+)\.png$/);
            return sm && Math.abs(Number(sm[1]) - Number(id)) < 1500;
        });

        let data = {};
        try {
            data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, j), 'utf8'));
        } catch (_) {}

        const item = {
            id,
            file: j,
            type: data.type || (j.startsWith('rotate') ? 'rotate' : 'unknown'),
            bg: bg || null,
            pc: pc || null,
            screenshot: screenshots[0] || null,
            start_angle: data.start_angle,
            step: data.step,
            rejectedX: data.details && data.details.target && data.details.target.x != null ? data.details.target.x : null,
            rejectedAngle: data.details && data.details.target != null && typeof data.details.target === 'number' ? data.details.target : null,
            details: data.details || null,
            label: labels[id] || null
        };

        // For slider, compute candidate boxes and metrics if images exist
        if (item.type === 'slider' && item.bg && item.pc) {
            try {
                item.candidates = extractSliderCandidates(path.join(LOGS_DIR, item.bg), path.join(LOGS_DIR, item.pc));
            } catch (_) {
                item.candidates = [];
            }
        }

        inventory.push(item);
    }

    return inventory;
}

/**
 * Extract slider candidate positions and calculate boundary & border continuity metrics.
 */
function extractSliderCandidates(bgPath, pcPath) {
    const bg = decodePNG(fs.readFileSync(bgPath));
    const pc = decodePNG(fs.readFileSync(pcPath));

    let top = -1, bottom = -1;
    for (let y = 0; y < pc.height; y++) {
        for (let x = 0; x < pc.width; x++) {
            if (pc.rgba[(y * pc.width + x) * 4 + 3] > 32) {
                if (top === -1) top = y;
                bottom = y;
                break;
            }
        }
    }
    const pcW = 50, pcH = bottom - top + 1;

    // Scan boundary gradient for each x
    const scores = [];
    for (let x = 0; x <= bg.width - pcW; x++) {
        let boundary = 0, checkerCount = 0;
        if (x > 0 && x + pcW < bg.width) {
            for (let y = top; y <= bottom; y++) {
                const l1 = (y * bg.width + x - 1) * 4, l2 = (y * bg.width + x) * 4;
                const r1 = (y * bg.width + x + pcW - 1) * 4, r2 = (y * bg.width + x + pcW) * 4;
                for (let c = 0; c < 3; c++) boundary += Math.abs(bg.rgba[l1 + c] - bg.rgba[l2 + c]) + Math.abs(bg.rgba[r1 + c] - bg.rgba[r2 + c]);
            }
            for (let px = x; px < x + pcW; px++) {
                const t1 = ((top - 1) * bg.width + px) * 4, t2 = (top * bg.width + px) * 4;
                const b1 = (bottom * bg.width + px) * 4, b2 = ((bottom + 1) * bg.width + px) * 4;
                for (let c = 0; c < 3; c++) boundary += Math.abs(bg.rgba[t1 + c] - bg.rgba[t2 + c]) + Math.abs(bg.rgba[b1 + c] - bg.rgba[b2 + c]);
            }
        }
        for (let y = top; y <= bottom; y++) {
            for (let px = x; px < x + pcW; px++) {
                const idx = (y * bg.width + px) * 4;
                const r = bg.rgba[idx], g = bg.rgba[idx + 1], b = bg.rgba[idx + 2];
                const lum = (r + g + b) / 3;
                const chroma = Math.max(r, g, b) - Math.min(r, g, b);
                if (lum >= 60 && lum <= 210 && chroma < 40) checkerCount++;
            }
        }
        scores.push({ x, boundary, checkerRatio: checkerCount / (pcW * pcH) });
    }

    // Find local peaks
    const peaks = [];
    for (let i = 1; i < scores.length - 1; i++) {
        if (scores[i].boundary > scores[i - 1].boundary && scores[i].boundary >= scores[i + 1].boundary) {
            peaks.push(scores[i]);
        }
    }
    peaks.sort((a, b) => b.boundary - a.boundary);
    const maxB = peaks[0] ? peaks[0].boundary : 1;
    const filtered = [];
    for (const p of peaks) {
        if (p.boundary < maxB * 0.40) continue;
        if (!filtered.some(f => Math.abs(f.x - p.x) < 30)) {
            filtered.push(p);
        }
    }
    filtered.sort((a, b) => a.x - b.x);

    return filtered.map((cand, idx) => {
        let borderDiff = 0, count = 0;
        for (let px = 0; px < pcW; px++) {
            const pcT = (top * pc.width + px) * 4, bgT = ((top - 1) * bg.width + cand.x + px) * 4;
            const pcB = (bottom * pc.width + px) * 4, bgB = ((bottom + 1) * bg.width + cand.x + px) * 4;
            for (let c = 0; c < 3; c++) {
                borderDiff += Math.abs(pc.rgba[pcT + c] - bg.rgba[bgT + c]);
                borderDiff += Math.abs(pc.rgba[pcB + c] - bg.rgba[bgB + c]);
            }
            count += 2;
        }
        for (let py = top; py <= bottom; py++) {
            if (cand.x > 0) {
                const pcL = (py * pc.width) * 4, bgL = (py * bg.width + cand.x - 1) * 4;
                for (let c = 0; c < 3; c++) borderDiff += Math.abs(pc.rgba[pcL + c] - bg.rgba[bgL + c]);
                count++;
            }
            if (cand.x + pcW < bg.width) {
                const pcR = (py * pc.width + pcW - 1) * 4, bgR = (py * bg.width + cand.x + pcW) * 4;
                for (let c = 0; c < 3; c++) borderDiff += Math.abs(pc.rgba[pcR + c] - bg.rgba[bgR + c]);
                count++;
            }
        }
        return {
            index: idx + 1,
            x: cand.x,
            y: top,
            width: pcW,
            height: pcH,
            boundary: cand.boundary,
            checkerRatio: Number(cand.checkerRatio.toFixed(2)),
            borderMismatch: Number((borderDiff / (count * 3)).toFixed(2))
        };
    });
}

function getLabels() {
    if (!fs.existsSync(LABELS_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8'));
    } catch (_) {
        return {};
    }
}

function saveLabels(labels) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(LABELS_FILE, JSON.stringify(labels, null, 2), 'utf8');
}

module.exports = {
    LOGS_DIR,
    LABELS_FILE,
    getInventory,
    getLabels,
    saveLabels,
    extractSliderCandidates
};

