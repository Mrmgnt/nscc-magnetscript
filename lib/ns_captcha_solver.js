'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    return g;
}

// Template matching SAD antara piece (opaque) dan background.
function sadScore(bg, bw, bh, pcGray, alpha, pcW, pcH, x0, y0) {
    let score = 0, count = 0;
    for (let y = 0; y < pcH; y++) {
        const by = y0 + y; if (by < 0 || by >= bh) { score += 255; count++; continue; }
        for (let x = 0; x < pcW; x++) {
            const a = alpha[y * pcW + x];
            if (a < 32) continue;
            const bx = x0 + x; if (bx < 0 || bx >= bw) { score += 255; count++; continue; }
            score += Math.abs(bg[by * bw + bx] - pcGray[y * pcW + x]);
            count++;
        }
    }
    return count ? score / count : Infinity;
}

function detectGap(bgRGBA, pcRGBA, opts) {
    const { bgW, bgH, pcW, pcH } = opts;
    const xMin = opts.xMin != null ? opts.xMin : 0;
    const xMax = opts.xMax != null ? opts.xMax : bgW - pcW;
    const bg = toGray(bgRGBA, bgW, bgH);
    const pc = toGray(pcRGBA, pcW, pcH);
    const alpha = new Uint8Array(pcW * pcH);
    for (let i = 0, p = 0; i < pcW * pcH; i++, p += 4) alpha[i] = pcRGBA[p + 3];
    const yRange = opts.yRange || [Math.max(0, Math.floor((bgH - pcH) / 2) - 8), Math.min(bgH - pcH, Math.floor((bgH - pcH) / 2) + 8)];
    let best = { x: xMin, score: Infinity };
    const step = Math.max(1, Math.floor((xMax - xMin) / 240));
    for (let y0 = yRange[0]; y0 <= yRange[1]; y0 += 2) {
        for (let x = xMin; x <= xMax; x += step) {
            const s = sadScore(bg, bgW, bgH, pc, alpha, pcW, pcH, x, y0);
            if (s < best.score) best = { x, y: y0, score: s };
        }
    }
    // refine around best
    for (let x = Math.max(xMin, best.x - 3); x <= Math.min(xMax, best.x + 3); x++) {
        const s = sadScore(bg, bgW, bgH, pc, alpha, pcW, pcH, x, best.y);
        if (s < best.score) best = { x, y: best.y, score: s };
    }
    return opts.returnPosition ? best : best.x;
}

function detectGapApprox(bgRGBA, w, h) {
    const g = toGray(bgRGBA, w, h);
    const col = new Float32Array(w);
    for (let x = 1; x < w - 1; x++) { let s = 0; for (let y = 1; y < h - 1; y++) { const i = y * w + x; s += Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]); } col[x] = s; }
    let best = -1, bestX = Math.round(w / 2);
    for (let x = 20; x < w - 20; x++) if (col[x] > best) { best = col[x]; bestX = x; }
    return bestX;
}

function sliderDelta(targetX, initialX, scaleX) {
    const delta = Number(targetX) * Number(scaleX) - Number(initialX);
    return Number.isFinite(delta) ? delta : NaN;
}

function detectShapeEdge(bgRGBA, pcRGBA, opts) {
    const { bgW, bgH, pcW, pcH } = opts;
    const gray = toGray(bgRGBA, bgW, bgH);
    const alphaAt = (x, y) => pcRGBA[(y * pcW + x) * 4 + 3];
    const boundary = [];
    for (let y = 1; y < pcH - 1; y++) for (let x = 1; x < pcW - 1; x++) {
        if (alphaAt(x, y) < 64) continue;
        if (alphaAt(x - 1, y) < 64 || alphaAt(x + 1, y) < 64 || alphaAt(x, y - 1) < 64 || alphaAt(x, y + 1) < 64) boundary.push([x, y]);
    }
    if (!boundary.length) return { x: 0, y: 0, score: -Infinity };
    const xMin = Math.max(0, opts.xMin == null ? 0 : opts.xMin);
    const xMax = Math.min(bgW - pcW, opts.xMax == null ? bgW - pcW : opts.xMax);
    const yRange = opts.yRange || [0, bgH - pcH];
    let best = { x: xMin, y: yRange[0], score: -Infinity };
    for (let y = Math.max(0, yRange[0]); y <= Math.min(bgH - pcH, yRange[1]); y++) for (let x = xMin; x <= xMax; x++) {
        let score = 0;
        for (const [edgeX, edgeY] of boundary) {
            const px = x + edgeX, py = y + edgeY, index = py * bgW + px;
            score += Math.abs(gray[index + 1] - gray[index - 1]) + Math.abs(gray[index + bgW] - gray[index - bgW]);
        }
        score /= boundary.length;
        if (score > best.score) best = { x, y, score };
    }
    return best;
}

function detectShapeTexture(bgRGBA, pcRGBA, opts) {
    const { bgW, bgH, pcW, pcH } = opts;
    const gray = toGray(bgRGBA, bgW, bgH);
    const gradient = new Float32Array(bgW * bgH);
    for (let y = 1; y < bgH - 1; y++) for (let x = 1; x < bgW - 1; x++) {
        const index = y * bgW + x;
        gradient[index] = Math.abs(gray[index + 1] - gray[index - 1]) + Math.abs(gray[index + bgW] - gray[index - bgW]);
    }
    const inside = [], outside = [];
    for (let y = 1; y < pcH - 1; y += 2) for (let x = 1; x < pcW - 1; x += 2) {
        const alpha = pcRGBA[(y * pcW + x) * 4 + 3];
        (alpha >= 64 ? inside : outside).push([x, y]);
    }
    if (!inside.length || !outside.length) return { x: 0, y: 0, score: -Infinity };
    const xMin = Math.max(0, opts.xMin == null ? 0 : opts.xMin);
    const xMax = Math.min(bgW - pcW, opts.xMax == null ? bgW - pcW : opts.xMax);
    const yRange = opts.yRange || [0, bgH - pcH];
    let best = { x: xMin, y: yRange[0], score: -Infinity };
    for (let y = Math.max(0, yRange[0]); y <= Math.min(bgH - pcH, yRange[1]); y++) for (let x = xMin; x <= xMax; x++) {
        let insideScore = 0, outsideScore = 0;
        for (const [px, py] of inside) insideScore += gradient[(y + py) * bgW + x + px];
        for (const [px, py] of outside) outsideScore += gradient[(y + py) * bgW + x + px];
        const score = insideScore / inside.length - outsideScore / outside.length;
        if (score > best.score) best = { x, y, score };
    }
    return best;
}

function detectSpeckledShape(bgRGBA, pcRGBA, opts) {
    const { bgW, bgH, pcW, pcH } = opts;
    let mask = new Uint8Array(bgW * bgH);
    for (let y = 1; y < bgH - 1; y++) for (let x = 1; x < bgW - 1; x++) {
        const index = (y * bgW + x) * 4;
        const red = bgRGBA[index], green = bgRGBA[index + 1], blue = bgRGBA[index + 2];
        const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
        const luminance = (red + green + blue) / 3;
        if (chroma < 18 && luminance > 25 && luminance < 235) mask[y * bgW + x] = 1;
    }
    const dilation = 2;
    for (let pass = 0; pass < dilation; pass++) {
        const expanded = mask.slice();
        for (let y = 1; y < bgH - 1; y++) for (let x = 1; x < bgW - 1; x++) if (mask[y * bgW + x]) {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expanded[(y + dy) * bgW + x + dx] = 1;
        }
        mask = expanded;
    }
    const seen = new Uint8Array(mask.length), candidates = [];
    for (let start = 0; start < mask.length; start++) {
        if (!mask[start] || seen[start]) continue;
        const queue = [start]; seen[start] = 1;
        let minX = bgW, minY = bgH, maxX = 0, maxY = 0, count = 0;
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const index = queue[cursor], y = Math.floor(index / bgW), x = index - y * bgW;
            count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            for (const next of [index - 1, index + 1, index - bgW, index + bgW]) if (next >= 0 && next < mask.length && mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
        }
        const width = maxX - minX + 1, height = maxY - minY + 1;
        if (count < 400 || width < pcW * 0.75 || width > pcW * 1.6 || height < pcH * 0.75 || height > pcH * 1.6) continue;
        const sizeError = Math.abs(width - (pcW + dilation * 2)) + Math.abs(height - (pcH + dilation * 2));
        const component = new Set(queue);
        let intersection = 0, union = 0;
        for (let py = 0; py < pcH; py++) for (let px = 0; px < pcW; px++) {
            const pieceMask = pcRGBA[(py * pcW + px) * 4 + 3] >= 64;
            const targetX = minX + Math.round(px / Math.max(1, pcW - 1) * (width - 1));
            const targetY = minY + Math.round(py / Math.max(1, pcH - 1) * (height - 1));
            const targetMask = component.has(targetY * bgW + targetX);
            if (pieceMask && targetMask) intersection++;
            if (pieceMask || targetMask) union++;
        }
        const shapeScore = union ? intersection / union : 0;
        candidates.push({ x: minX + dilation, y: minY + dilation, score: shapeScore, sizeError, count });
    }
    if (candidates.length) {
        const best = candidates.sort((left, right) => right.score - left.score || left.sizeError - right.sizeError)[0];
        if (best.score >= 0.60) return best;
    }
    let magentaBorder = 0;
    for (let x = 0; x < bgW; x++) for (const y of [0, bgH - 1]) {
        const index = (y * bgW + x) * 4;
        if (bgRGBA[index] > 100 && bgRGBA[index + 1] < 90 && bgRGBA[index + 2] > 45) magentaBorder++;
    }
    if (magentaBorder > bgW * 0.25) return detectGap(bgRGBA, pcRGBA, { ...opts, returnPosition: true });
    const edgeTarget = detectShapeEdge(bgRGBA, pcRGBA, opts);
    if (Number.isFinite(edgeTarget.score) && edgeTarget.score >= 60) return edgeTarget;
    return detectShapeTexture(bgRGBA, pcRGBA, opts);
}

function detectSliderTarget(bgRGBA, pcRGBA, opts) {
    const { bgW, pcW, pcH } = opts;
    const alphaRows = [];
    for (let y = 0; y < pcH; y++) for (let x = 0; x < pcW; x++) if (pcRGBA[(y * pcW + x) * 4 + 3] >= 64) { alphaRows.push(y); break; }
    if (!alphaRows.length) return { x: 0, y: 0, score: Infinity };
    const top = Math.min(...alphaRows), bottom = Math.max(...alphaRows);
    const windows = [];
    for (let offsetX = 0; offsetX <= bgW - pcW; offsetX++) {
        let checker = 0, pattern = 0, luminance = 0, count = 0;
        for (let y = top; y <= bottom; y++) for (let x = 0; x < pcW; x++) {
            const index = (y * bgW + offsetX + x) * 4;
            const red = bgRGBA[index], green = bgRGBA[index + 1], blue = bgRGBA[index + 2];
            const value = (red + green + blue) / 3;
            const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
            if (value >= 70 && value <= 205 && spread <= 45) {
                checker++;
                if (x >= 4) {
                    const previous = index - 16;
                    pattern += Math.abs(red - bgRGBA[previous]) + Math.abs(green - bgRGBA[previous + 1]) + Math.abs(blue - bgRGBA[previous + 2]);
                }
                if (y >= top + 4) {
                    const previous = index - bgW * 16;
                    pattern += Math.abs(red - bgRGBA[previous]) + Math.abs(green - bgRGBA[previous + 1]) + Math.abs(blue - bgRGBA[previous + 2]);
                }
            }
            luminance += value; count++;
        }
        let boundary = 0;
        if (offsetX > 0 && offsetX + pcW < bgW) {
            for (let y = top; y <= bottom; y++) {
                const left = (y * bgW + offsetX - 1) * 4, inside = left + 4;
                const rightInside = (y * bgW + offsetX + pcW - 1) * 4, right = rightInside + 4;
                for (let channel = 0; channel < 3; channel++) boundary += Math.abs(bgRGBA[left + channel] - bgRGBA[inside + channel]) + Math.abs(bgRGBA[rightInside + channel] - bgRGBA[right + channel]);
            }
            if (top > 0 && bottom + 1 < opts.bgH) for (let x = offsetX; x < offsetX + pcW; x++) {
                const above = ((top - 1) * bgW + x) * 4, insideTop = above + bgW * 4;
                const insideBottom = (bottom * bgW + x) * 4, below = insideBottom + bgW * 4;
                for (let channel = 0; channel < 3; channel++) boundary += Math.abs(bgRGBA[above + channel] - bgRGBA[insideTop + channel]) + Math.abs(bgRGBA[insideBottom + channel] - bgRGBA[below + channel]);
            }
        }
        windows.push({ x: offsetX, boundary, checker: checker / count, pattern: pattern / count, luminance: luminance / count });
    }
    const candidates = [];
    const remaining = windows.slice();
    while (candidates.length < 10 && remaining.length) {
        remaining.sort((left, right) => right.boundary - left.boundary || right.pattern - left.pattern || right.checker - left.checker || left.luminance - right.luminance);
        const candidate = remaining.shift(); candidates.push(candidate);
        for (let index = remaining.length - 1; index >= 0; index--) if (Math.abs(remaining[index].x - candidate.x) <= pcW * 0.7) remaining.splice(index, 1);
    }
    for (const candidate of candidates) {
        let refined = candidate.x, bestEdge = -Infinity;
        for (let x = Math.max(1, candidate.x - Math.floor(pcW / 2)); x <= Math.min(bgW - pcW - 1, candidate.x + Math.floor(pcW / 2)); x++) {
            let edge = 0;
            for (let y = top; y <= bottom; y++) {
                const left = (y * bgW + x - 1) * 4, inside = left + 4;
                const rightInside = (y * bgW + x + pcW - 1) * 4, right = rightInside + 4;
                for (let channel = 0; channel < 3; channel++) edge += Math.abs(bgRGBA[left + channel] - bgRGBA[inside + channel]) + Math.abs(bgRGBA[rightInside + channel] - bgRGBA[right + channel]);
            }
            if (edge > bestEdge) { bestEdge = edge; refined = x; }
        }
        candidate.x = refined;
    }
    const histogram = (pixels, width, points) => {
        const bins = new Float64Array(64);
        for (const [x, y] of points) {
            const index = (y * width + x) * 4;
            bins[(pixels[index] >> 6) * 16 + (pixels[index + 1] >> 6) * 4 + (pixels[index + 2] >> 6)]++;
        }
        for (let index = 0; index < bins.length; index++) bins[index] /= Math.max(1, points.length);
        return bins;
    };
    const piecePoints = [];
    for (let y = top; y <= bottom; y++) for (let x = 0; x < pcW; x++) piecePoints.push([x, y]);
    const pieceHistogram = histogram(pcRGBA, pcW, piecePoints);
    const strongestBoundary = Math.max(...candidates.map(candidate => candidate.boundary));
    const eligibleCandidates = candidates.filter(candidate => candidate.boundary >= strongestBoundary * 0.40);
    let best = { x: eligibleCandidates[0].x, y: 0, score: Infinity };
    const candidateScores = [];
    for (const candidate of eligibleCandidates) {
        const ring = [];
        for (let y = Math.max(0, top - 5); y <= Math.min(opts.bgH - 1, bottom + 5); y++) for (let x = Math.max(0, candidate.x - 5); x <= Math.min(bgW - 1, candidate.x + pcW + 4); x++) {
            if (x < candidate.x || x >= candidate.x + pcW || y < top || y > bottom) ring.push([x, y]);
        }
        const ringHistogram = histogram(bgRGBA, bgW, ring);
        let histScore = 0;
        for (let index = 0; index < pieceHistogram.length; index++) histScore += Math.abs(pieceHistogram[index] - ringHistogram[index]);

        let borderDiff = 0, borderCount = 0;
        for (let px = 0; px < pcW; px++) {
            const pcTopIdx = (top * pcW + px) * 4, bgTopIdx = ((top - 1) * bgW + candidate.x + px) * 4;
            const pcBotIdx = (bottom * pcW + px) * 4, bgBotIdx = ((bottom + 1) * bgW + candidate.x + px) * 4;
            for (let c = 0; c < 3; c++) {
                borderDiff += Math.abs(pcRGBA[pcTopIdx + c] - bgRGBA[bgTopIdx + c]);
                borderDiff += Math.abs(pcRGBA[pcBotIdx + c] - bgRGBA[bgBotIdx + c]);
            }
            borderCount += 2;
        }
        for (let py = top; py <= bottom; py++) {
            if (candidate.x > 0) {
                const pcLeftIdx = (py * pcW) * 4, bgLeftIdx = (py * bgW + candidate.x - 1) * 4;
                for (let c = 0; c < 3; c++) borderDiff += Math.abs(pcRGBA[pcLeftIdx + c] - bgRGBA[bgLeftIdx + c]);
                borderCount++;
            }
            if (candidate.x + pcW < bgW) {
                const pcRightIdx = (py * pcW + pcW - 1) * 4, bgRightIdx = (py * bgW + candidate.x + pcW) * 4;
                for (let c = 0; c < 3; c++) borderDiff += Math.abs(pcRGBA[pcRightIdx + c] - bgRGBA[bgRightIdx + c]);
                borderCount++;
            }
        }
        const borderMismatch = borderCount ? (borderDiff / (borderCount * 3)) : 255;
        const compositeScore = borderMismatch + 75 * histScore;

        candidateScores.push({
            x: candidate.x,
            score: compositeScore,
            borderMismatch: Number(borderMismatch.toFixed(2)),
            histScore: Number(histScore.toFixed(3)),
            boundary: candidate.boundary,
            pattern: candidate.pattern,
            checker: candidate.checker
        });
        if (compositeScore < best.score) {
            best = {
                x: candidate.x,
                y: 0,
                score: compositeScore,
                borderMismatch: Number(borderMismatch.toFixed(2)),
                histScore: Number(histScore.toFixed(3))
            };
        }
    }
    best.candidates = candidateScores.sort((left, right) => left.x - right.x);
    return best;
}

// Realistic slider captcha synthetic: textured bg + a visible gap (notch) + piece = notch copy
function makeSyntheticTestCase(bgW, bgH, pcW, pcH, gapX) {
    const bg = Buffer.alloc(bgW * bgH * 4);
    let seed = 987654321;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    // textured background with distinct local features
    for (let y = 0; y < bgH; y++) for (let x = 0; x < bgW; x++) {
        const i = (y * bgW + x) * 4;
        const f = Math.sin(x * 0.35) * Math.cos(y * 0.28) + 0.5 * Math.sin((x + y) * 0.11);
        const v = Math.floor(60 + 90 * f + 50 * rnd());
        bg[i] = v; bg[i + 1] = Math.floor(v * 0.85 + 20 * rnd()); bg[i + 2] = Math.floor(v * 0.7 + 20 * rnd()); bg[i + 3] = 255;
    }
    const gy = Math.floor((bgH - pcH) / 2);
    // carve a bright gap (visible boundary) in background
    for (let y = 0; y < pcH; y++) for (let x = 0; x < pcW; x++) {
        const bx = gapX + x; if (bx < 0 || bx >= bgW) continue;
        const i = ((gy + y) * bgW + bx) * 4;
        // inside gap: flat dark, boundary bright
        const edge = x < 2 || y < 2 || x >= pcW - 2 || y >= pcH - 2;
        if (edge) { bg[i] = 235; bg[i + 1] = 235; bg[i + 2] = 235; bg[i + 3] = 255; }
        else { bg[i] = 20; bg[i + 1] = 24; bg[i + 2] = 30; bg[i + 3] = 255; }
    }
    // piece = the gap (dark interior + bright border)
    const pc = Buffer.alloc(pcW * pcH * 4);
    for (let y = 0; y < pcH; y++) for (let x = 0; x < pcW; x++) {
        const i = (y * pcW + x) * 4;
        const edge = x < 2 || y < 2 || x >= pcW - 2 || y >= pcH - 2;
        if (edge) { pc[i] = 235; pc[i + 1] = 235; pc[i + 2] = 235; pc[i + 3] = 255; }
        else { pc[i] = 20; pc[i + 1] = 24; pc[i + 2] = 30; pc[i + 3] = 255; }
    }
    return { bg, pc, opts: { bgW, bgH, pcW, pcH, xMin: 0, xMax: bgW - pcW, yRange: [gy - 2, gy + 2] } };
}

function loadImageRGBA(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.rgba' || ext === '.raw') {
        const buf = fs.readFileSync(file);
        const nl = buf.indexOf(0x0a);
        const header = JSON.parse(buf.slice(0, nl).toString('utf8'));
        return { width: header.width, height: header.height, rgba: buf.slice(nl + 1) };
    }
    if (ext === '.png') {
        const { decodePNG } = require('./png_decoder');
        return decodePNG(fs.readFileSync(file));
    }
    throw new Error('format ' + ext + ' belum didukung untuk --test-image; pakai --selftest, file .rgba atau .png');
}

class CaptchaSolver {
    constructor(opts = {}) {
        this.opts = opts;
        this.page = null;
        this.browser = null;
        this.closed = false;
    }
    async open() {
        if (this.closed) throw new Error('Captcha solver ditutup');
        const { chromium } = require('playwright-core');
        this.browser = await chromium.launch({ channel: 'msedge', headless: false, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
        const context = await this.browser.newContext({ viewport: { width: 1100, height: 780 } });
        await context.addInitScript(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (_) {} });
        this.page = await context.newPage();
        this.page.on('response', async response => {
            let payload = null;
            let decoded = null;
            try {
                const contentType = String(response.headers()['content-type'] || '');
                if (/json/i.test(contentType)) {
                    payload = await response.json();
                    decoded = await response.frame().evaluate(async body =>
                        typeof window._cc_unseal === 'function' ? window._cc_unseal(body) : body,
                    payload);
                    const responseData = decoded && typeof decoded === 'object' ? decoded : payload;
                    if (/\/login(?:[/?#]|$)/i.test(response.url())) {
                        this.loginFailure = {
                            status: response.status(),
                            message: responseData && typeof responseData.message === 'string' ? responseData.message.slice(0, 160) : '',
                        };
                    }
                    if (responseData && responseData.success === true && responseData.player_id && responseData.token && responseData.signature && responseData.hash_time) {
                        this.webLoginData = responseData;
                    }
                }
            } catch (_) {}

            if (!/captcha/i.test(response.url()) || !/verify/i.test(response.url())) return;
            try {
                if (!payload) payload = await response.json();
                if (!decoded) {
                    decoded = await response.frame().evaluate(async body =>
                        typeof window._cc_unseal === 'function' ? window._cc_unseal(body) : body,
                    payload);
                }
                this.verification = {
                    success: response.ok() && decoded && decoded.success === true,
                    status: response.status(),
                    keys: decoded && typeof decoded === 'object' ? Object.keys(decoded).slice(0, 12) : [],
                    message: decoded && typeof decoded.message === 'string' ? decoded.message.slice(0, 120) : '',
                    failCount: decoded && Number.isFinite(Number(decoded.fail_count)) ? Number(decoded.fail_count) : undefined,
                    failsLeft: decoded && Number.isFinite(Number(decoded.fails_left)) ? Number(decoded.fails_left) : undefined,
                };
            } catch (_) { this.verification = { success: false, status: response.status(), keys: [] }; }
        });        await this.page.goto(this.opts.site || 'https://ninjasaga.cc/?minimal&air', { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (this.opts.username && this.opts.password) {
            const deadline = Date.now() + 20000;
            let accountFrame = null;
            while (!accountFrame && Date.now() < deadline) {
                accountFrame = this.page.frames().find(frame => /\/account(?:[/?]|$)/i.test(frame.url()));
                if (!accountFrame) await this.page.waitForTimeout(200);
            }
            if (!accountFrame) {
                const framePaths = this.page.frames().map(frame => {
                    try {
                        const url = new URL(frame.url());
                        return url.origin + url.pathname;
                    } catch (_) { return 'unknown'; }
                });
                throw new Error('Frame login web tidak ditemukan; frame=' + framePaths.join(', '));
            }
            const loginForm = accountFrame.locator('form').filter({ has: accountFrame.getByRole('button', { name: 'Login', exact: true }) });
            const username = loginForm.locator('input[name="username"]');
            const password = loginForm.locator('input[name="password"]');
            const usernameVisible = await username.isVisible();
            if (usernameVisible) {
                await username.fill(this.opts.username);
                await password.fill(this.opts.password);
                await loginForm.getByRole('button', { name: 'Login', exact: true }).click();
                await username.waitFor({ state: 'hidden', timeout: 20000 });
                const loginDeadline = Date.now() + 10000;
                while (!this.webLoginData && Date.now() < loginDeadline) await this.page.waitForTimeout(100);
            }
            if (!this.webLoginData || this.webLoginData.success !== true) throw new Error('Response login web tidak tersedia; login=' + JSON.stringify(this.loginFailure || {}));
        }
    }
    async solve(ctx = 'pve') {
        const log = message => { if (this.opts.log) this.opts.log('  captcha: ' + message); };
        const snapshot = async label => {
            try {
                const directory = path.join(process.cwd(), 'logs', 'captcha_fail');
                fs.mkdirSync(directory, { recursive: true });
                await this.page.screenshot({ path: path.join(directory, label + '_' + Date.now() + '.png') });
            } catch (_) {}
        };
        const dumpChallenge = async (label, challenge, details = {}) => {
            try {
                const directory = path.join(process.cwd(), 'logs', 'captcha_fail');
                fs.mkdirSync(directory, { recursive: true });
                const stamp = Date.now();
                const saveDataImage = (name, source) => {
                    const match = String(source || '').match(/^data:image\/(\w+);base64,(.*)$/s);
                    if (match) fs.writeFileSync(path.join(directory, label + '_' + stamp + '_' + name + '.' + match[1]), Buffer.from(match[2], 'base64'));
                };
                saveDataImage('background', challenge.background);
                saveDataImage('piece', challenge.piece);
                const dom = await frame.evaluate(ch => {
                    const keys = ch.type === 'rotate' ? ['rotate_img', 'rotate_left', 'rotate_right'] : ch.type === 'slider' ? ['slider_piece', 'slider_thumb'] : ['drag_piece', 'drag_area'];
                    const result = {};
                    for (const key of keys) {
                        const descriptor = ch.da[key];
                        if (!descriptor) continue;
                        const element = document.querySelector('[' + descriptor.attr + '="' + descriptor.val + '"]');
                        if (!element) continue;
                        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
                        result[key] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, transform: style.transform, left: style.left, top: style.top };
                    }
                    return result;
                }, challenge);
                const safeDetails = { ...details };
                if (safeDetails.images) safeDetails.images = {
                    scaleX: safeDetails.images.scaleX, scaleY: safeDetails.images.scaleY,
                    initialX: safeDetails.images.initialX, initialY: safeDetails.images.initialY,
                    trackWidth: safeDetails.images.trackWidth,
                    background: safeDetails.images.background && { width: safeDetails.images.background.width, height: safeDetails.images.background.height },
                    piece: safeDetails.images.piece && { width: safeDetails.images.piece.width, height: safeDetails.images.piece.height },
                };
                fs.writeFileSync(path.join(directory, label + '_' + stamp + '.json'), JSON.stringify({
                    type: challenge.type,
                    start_x: challenge.start_x, start_y: challenge.start_y,
                    max_x: challenge.max_x, max_y: challenge.max_y,
                    start_angle: challenge.start_angle, step: challenge.step,
                    track_w: challenge.track_w, dom, details: safeDetails,
                }, null, 2));
            } catch (_) {}
        };
        if (this.closed) return false;
        if (!this.page) await this.open();
        let frame;
        const deadline = Date.now() + 20000;
        while (!frame && Date.now() < deadline && !this.closed) {
            for (const candidate of this.page.frames()) {
                if (!/\/account(?:[/?]|$)/i.test(candidate.url())) continue;
                const ready = await candidate.evaluate(() => {
                    if (typeof window._cc_unseal !== 'function') return false;
                    window.__nsccCaptchaChallenge = null;
                    if (!window.__nsccCaptchaHooked) {
                        window.__nsccCaptchaHooked = true;
                        const original = window._cc_unseal;
                        window._cc_unseal = async function () {
                            const result = await original.apply(this, arguments);
                            if (result && result.challenge) window.__nsccCaptchaChallenge = result.challenge;
                            return result;
                        };
                    }
                    return true;
                });
                if (ready) { frame = candidate; break; }
            }
            if (!frame) await this.page.waitForTimeout(200);
        }
        if (!frame) { log('account frame/_cc_unseal tidak ditemukan'); await snapshot('no_frame'); return false; }
        this.verification = null;
        await frame.evaluate(context => window.postMessage({ action: 'show_captcha', ctx: context }, location.origin), ctx);
        const waitForStageResult = async challengeId => {
            let nextChallenge = null;
            const verifyDeadline = Date.now() + 10000;
            while (!this.verification && !nextChallenge && Date.now() < verifyDeadline && !this.closed) {
                nextChallenge = await frame.evaluate(id => {
                    const current = window.__nsccCaptchaChallenge;
                    return current && current.challenge_id !== id ? current : null;
                }, challengeId);
                if (nextChallenge && !this.verification) await this.page.waitForTimeout(350);
                if (!nextChallenge) await this.page.waitForTimeout(100);
            }
            return nextChallenge;
        };
        const humanClick = async locator => {
            const box = await locator.boundingBox();
            if (!box) throw new Error('Tombol captcha tidak terlihat');
            const targetX = box.x + box.width * (0.42 + Math.random() * 0.16);
            const targetY = box.y + box.height * (0.42 + Math.random() * 0.16);
            const startX = targetX + 25 + Math.random() * 35;
            const startY = targetY + 12 + Math.random() * 24;
            await this.page.mouse.move(startX, startY);
            await this.page.waitForTimeout(60 + Math.floor(Math.random() * 80));
            await this.page.mouse.move(targetX, targetY, { steps: 7 + Math.floor(Math.random() * 6) });
            await this.page.waitForTimeout(70 + Math.floor(Math.random() * 90));
            await this.page.mouse.down();
            await this.page.waitForTimeout(55 + Math.floor(Math.random() * 65));
            await this.page.mouse.up();
        };
        const seen = new Set();
        for (let attempt = 0; attempt < 20; attempt++) {
            let challenge;
            const challengeDeadline = Date.now() + 15000;
            while (!challenge && Date.now() < challengeDeadline && !this.closed) {
                const candidate = await frame.evaluate(() => window.__nsccCaptchaChallenge || null);
                if (candidate && !seen.has(candidate.challenge_id)) challenge = candidate;
                else await this.page.waitForTimeout(200);
            }
            if (!challenge) {
                const pageText = await frame.evaluate(() => document.body && document.body.innerText || '').catch(() => '');
                const lock = String(pageText).match(/Too many failed captchas[\s\S]{0,120}?Unlocks in\s*([^\n]+)/i);
                if (lock) throw new Error('Captcha akun terkunci; unlock dalam ' + lock[1].trim());
                log('challenge tidak diterima'); await snapshot('no_challenge'); return false;
            }
            const challengeSeenAt = Date.now();
            seen.add(challenge.challenge_id);
            log('challenge type=' + challenge.type + ' attempt=' + (attempt + 1));
            if (challenge.type === 'rotate') {
                const rotation = await frame.evaluate(async ch => {
                    const load = source => new Promise((resolve, reject) => {
                        const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source;
                    });
                    const [background, piece] = await Promise.all([load(ch.background), load(ch.piece)]);
                    const width = background.naturalWidth, height = background.naturalHeight;
                    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                    const context = canvas.getContext('2d'); context.drawImage(background, 0, 0, width, height);
                    const bg = context.getImageData(0, 0, width, height).data;
                    let best = { angle: 0, score: -Infinity };
                    const step = Math.max(1, Number(ch.step) || 10);
                    const start = ((Number(ch.start_angle) % 360) + 360) % 360;
                    const candidates = Math.ceil(360 / step);
                    for (let candidate = 0; candidate < candidates; candidate++) {
                        const angle = (start + candidate * step) % 360;
                        context.clearRect(0, 0, width, height);
                        context.save(); context.translate(width / 2, height / 2); context.rotate(angle * Math.PI / 180);
                        context.drawImage(piece, -piece.naturalWidth / 2, -piece.naturalHeight / 2); context.restore();
                        const pixels = context.getImageData(0, 0, width, height).data;
                        let intersection = 0, union = 0;
                        for (let index = 0; index < pixels.length; index += 4) {
                            const pieceMask = pixels[index + 3] > 96;
                            const targetMask = (bg[index] + bg[index + 1] + bg[index + 2]) / 3 < 28;
                            if (pieceMask && targetMask) intersection++;
                            if (pieceMask || targetMask) union++;
                        }
                        const score = union ? intersection / union : -Infinity;
                        if (score > best.score) best = { angle, score };
                    }
                    return best;
                }, challenge);
                const step = Math.max(1, Number(challenge.step) || 10);
                const start = ((Number(challenge.start_angle) % 360) + 360) % 360;
                const target = ((rotation.angle % 360) + 360) % 360;
                const rightSteps = Math.round(((target - start + 360) % 360) / step);
                const leftSteps = Math.round(((start - target + 360) % 360) / step);
                const useRight = rightSteps <= leftSteps;
                const clicks = useRight ? rightSteps : leftSteps;
                const descriptor = challenge.da[useRight ? 'rotate_right' : 'rotate_left'];
                const button = frame.locator('[' + descriptor.attr + '="' + descriptor.val + '"]');
                log('rotate start=' + start + ' target=' + target + ' clicks=' + clicks + ' score=' + rotation.score.toFixed(2));
                const buttonBox = await button.boundingBox();
                if (!buttonBox) throw new Error('Tombol rotate tidak terlihat');
                if (clicks > 0) await humanClick(button);
                for (let click = 1; click < clicks; click++) {
                    const x = buttonBox.x + buttonBox.width / 2 + (Math.random() - 0.5) * 1.5;
                    const y = buttonBox.y + buttonBox.height / 2 + (Math.random() - 0.5) * 1.5;
                    await this.page.mouse.move(x, y, { steps: 2 });
                    await this.page.mouse.down();
                    await this.page.waitForTimeout(45 + Math.floor(Math.random() * 45));
                    await this.page.mouse.up();
                    await this.page.waitForTimeout(110 + Math.floor(Math.random() * 120));
                }
                const internal = await frame.evaluate(() => ({
                    angle: typeof cc_rotate_angle === 'undefined' ? null : cc_rotate_angle,
                    mouseTrail: typeof cc_mouse_trail === 'undefined' ? null : cc_mouse_trail.length,
                    localTrail: typeof cc_local_trail === 'undefined' ? null : cc_local_trail.length,
                    endpoint: typeof captcha_ep_verify === 'undefined' ? null : captcha_ep_verify,
                    env: typeof cc_env_check === 'undefined' ? null : cc_env_check(),
                }));
                log('rotate internal=' + internal.angle + ' trails=' + internal.mouseTrail + '/' + internal.localTrail + ' env=' + internal.env + ' endpoint=' + internal.endpoint);
                if (internal.env === false) { log('environment captcha ditolak client; submit dibatalkan'); return false; }
                const verify = challenge.da.verify_btn;
                if (verify) {
                    const wait = 7000 - (Date.now() - challengeSeenAt);
                    if (wait > 0) await this.page.waitForTimeout(wait);
                    const submit = frame.locator('[' + verify.attr + '="' + verify.val + '"]');
                    await humanClick(submit);
                }
                const nextChallenge = await waitForStageResult(challenge.challenge_id);
                if (this.verification && this.verification.success) { log('verify success'); return true; }
                if (this.verification) {
                    log('rotate ditolak status=' + this.verification.status + ' message=' + this.verification.message + ' fails_left=' + this.verification.failsLeft);
                    await dumpChallenge('rotate_rejected', challenge, { rotation, start, target, clicks, useRight });
                    await snapshot('rotate_rejected');
                    return false;
                }
                if (nextChallenge) { log('stage selesai; lanjut challenge type=' + nextChallenge.type); continue; }
                log(this.verification ? 'rotate ditolak' : 'rotate response timeout');
                await dumpChallenge('rotate_failed', challenge, { rotation, start, target, clicks, useRight });
                await snapshot('rotate_failed');
                return false;
            }
            if (!['slider', 'drag_shape'].includes(challenge.type)) {
                if (this.opts.log) this.opts.log('Captcha ' + challenge.type + ' belum didukung; berhenti tanpa menebak jawaban.');
                return false;
            }
            const images = await frame.evaluate(ch => {
                const slider = ch.type === 'slider';
                const background = document.querySelector('img.' + ch.cls[slider ? 'slider_bg' : 'drag_bg']);
                const descriptor = ch.da[slider ? 'slider_piece' : 'drag_piece'];
                const piece = document.querySelector('[' + descriptor.attr + '="' + descriptor.val + '"]');
                const read = image => {
                    if (!image || !image.complete || !image.naturalWidth) throw new Error('Gambar captcha belum siap');
                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
                    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
                    return { width: canvas.width, height: canvas.height, rgba: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data) };
                };
                const bgData = read(background), pieceData = read(piece);
                const bgRect = background.getBoundingClientRect(), pieceRect = piece.getBoundingClientRect();
                const track = slider && document.querySelector('.' + ch.cls.slider_track);
                return { background: bgData, piece: pieceData, scaleX: bgRect.width / bgData.width, scaleY: bgRect.height / bgData.height, initialX: pieceRect.left - bgRect.left, initialY: pieceRect.top - bgRect.top, trackWidth: track ? track.getBoundingClientRect().width : 0 };
            }, challenge);
            const slider = challenge.type === 'slider';
            const targetOptions = {
                bgW: images.background.width, bgH: images.background.height, pcW: images.piece.width, pcH: images.piece.height,
                xMin: 0, xMax: images.background.width - images.piece.width,
                yRange: slider ? [0, 0] : [0, images.background.height - images.piece.height], returnPosition: true,
            };
            const target = slider
                ? detectSliderTarget(Buffer.from(images.background.rgba), Buffer.from(images.piece.rgba), targetOptions)
                : detectSpeckledShape(Buffer.from(images.background.rgba), Buffer.from(images.piece.rgba), targetOptions);
            const descriptor = challenge.da[slider ? 'slider_thumb' : 'drag_piece'];
            const handle = await frame.$('[' + descriptor.attr + '="' + descriptor.val + '"]');
            const box = handle && await handle.boundingBox();
            if (!box || !Number.isFinite(target.score)) { log('handle/target tidak valid'); await snapshot('bad_target'); return false; }
            const deltaX = slider ? sliderDelta(target.x, images.initialX, images.scaleX) : target.x * images.scaleX - images.initialX;
            const deltaY = slider ? 0 : target.y * images.scaleY - images.initialY;
            if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) { log('delta drag tidak valid'); await snapshot('bad_delta'); return false; }
            log('drag delta=' + deltaX.toFixed(1) + ',' + deltaY.toFixed(1) + ' score=' + target.score.toFixed(2));
            this.verification = null;
            await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await this.page.mouse.down();
            try {
                let mouseX = box.x + box.width / 2 + deltaX;
                let mouseY = box.y + box.height / 2 + deltaY;
                for (let step = 1; step <= 32; step++) {
                    const progress = 1 - Math.pow(1 - step / 32, 3);
                    const jitter = step === 32 ? 0 : Math.sin(step * 1.7) * 0.8;
                    await this.page.mouse.move(box.x + box.width / 2 + deltaX * progress, box.y + box.height / 2 + deltaY * progress + jitter);
                    await this.page.waitForTimeout(22 + Math.floor(Math.random() * 18));
                }
                for (let correction = 0; correction < 3; correction++) {
                    const actual = await frame.evaluate(({ ch, sliderMode }) => {
                        const descriptor = ch.da[sliderMode ? 'slider_piece' : 'drag_piece'];
                        const piece = document.querySelector('[' + descriptor.attr + '="' + descriptor.val + '"]');
                        const background = document.querySelector('img.' + ch.cls[sliderMode ? 'slider_bg' : 'drag_bg']);
                        if (!piece || !background) return null;
                        const pieceRect = piece.getBoundingClientRect(), bgRect = background.getBoundingClientRect();
                        return { x: pieceRect.left - bgRect.left, y: pieceRect.top - bgRect.top };
                    }, { ch: challenge, sliderMode: slider });
                    if (!actual) break;
                    const errorX = target.x * images.scaleX - actual.x;
                    const errorY = slider ? 0 : target.y * images.scaleY - actual.y;
                    if (Math.abs(errorX) < 0.35 && Math.abs(errorY) < 0.35) break;
                    mouseX += errorX; mouseY += errorY;
                    await this.page.mouse.move(mouseX, mouseY, { steps: 4 });
                    await this.page.waitForTimeout(80);
                }
            } finally { await this.page.mouse.up(); }
            const position = await frame.evaluate(({ ch, sliderMode }) => {
                const descriptor = ch.da[sliderMode ? 'slider_piece' : 'drag_piece'];
                const piece = document.querySelector('[' + descriptor.attr + '="' + descriptor.val + '"]');
                const background = document.querySelector('img.' + ch.cls[sliderMode ? 'slider_bg' : 'drag_bg']);
                if (!piece || !background) return null;
                const pieceRect = piece.getBoundingClientRect(), bgRect = background.getBoundingClientRect();
                return { x: pieceRect.left - bgRect.left, y: pieceRect.top - bgRect.top };
            }, { ch: challenge, sliderMode: slider });
            const internal = await frame.evaluate(({ sliderMode, x, y }) => {
                if (sliderMode) cc_slider_x = x;
                else { cc_drag_x = x; cc_drag_y = y; }
                return {
                    x: sliderMode ? cc_slider_x : cc_drag_x,
                    y: sliderMode ? 0 : cc_drag_y,
                    mouseTrail: typeof cc_mouse_trail === 'undefined' ? null : cc_mouse_trail.length,
                    localTrail: typeof cc_local_trail === 'undefined' ? null : cc_local_trail.length,
                };
            }, { sliderMode: slider, x: target.x, y: target.y });
            log('answer internal=' + internal.x + ',' + internal.y + ' trails=' + internal.mouseTrail + '/' + internal.localTrail);
            if (position) log('piece position=' + position.x.toFixed(1) + ',' + position.y.toFixed(1) + ' target=' + (target.x * images.scaleX).toFixed(1) + ',' + (target.y * images.scaleY).toFixed(1));
            const verify = challenge.da.verify_btn;
            if (verify) {
                const button = frame.locator('[' + verify.attr + '="' + verify.val + '"]');
                if (await button.isVisible()) {
                    const wait = 7000 - (Date.now() - challengeSeenAt);
                    if (wait > 0) await this.page.waitForTimeout(wait);
                    await humanClick(button);
                }
            }
            const nextChallenge = await waitForStageResult(challenge.challenge_id);
            if (this.verification && this.verification.success) { log('verify success'); return true; }
            if (this.verification) {
                log('verify ditolak status=' + this.verification.status + ' message=' + this.verification.message + ' fails_left=' + this.verification.failsLeft);
                await dumpChallenge('verify_rejected', challenge, { target, images, deltaX, deltaY, position });
                await snapshot('verify_rejected');
                return false;
            }
            if (nextChallenge) {
                log('stage selesai; lanjut challenge type=' + nextChallenge.type);
                continue;
            }
            log(this.verification ? 'verify ditolak' : 'verify response timeout');
            await dumpChallenge('verify_failed', challenge, { target, images, deltaX, deltaY, position });
            await snapshot('verify_failed');
            if (!this.verification) return false;
        }
        return false;
    }
    async close() {
        this.closed = true;
        try { if (this.browser) await this.browser.close(); } catch (_) {}
        this.browser = this.page = null;
    }
}
module.exports = { detectGap, detectGapApprox, detectShapeEdge, detectShapeTexture, detectSpeckledShape, detectSliderTarget, sliderDelta, toGray, makeSyntheticTestCase, loadImageRGBA, CaptchaSolver };

if (require.main === module) {
    const argv = process.argv.slice(2);
    const getArg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
    if (argv.includes('--selftest')) {
        let fail = 0;
        const cases = [[600, 300, 80, 60, 120], [600, 300, 80, 60, 380], [400, 200, 60, 50, 200], [600, 300, 80, 60, 290]];
        console.log('  selftest deteksi gap (sintetis)');
        for (const [bw, bh, pw, ph, gapX] of cases) {
            const t = makeSyntheticTestCase(bw, bh, pw, ph, gapX);
            const got = detectGap(t.bg, t.pc, t.opts);
            const ok = Math.abs(got - gapX) <= 3;
            if (!ok) fail++;
            console.log((ok ? '  OK   ' : '  FAIL ') + `gap ${gapX} -> ${got}`);
        }
        const delta = sliderDelta(140, 241.5, 263 / 380);
        const deltaOk = Math.abs(delta - (-144.60526315789474)) < 1e-9;
        if (!deltaOk) fail++;
        console.log((deltaOk ? '  OK   ' : '  FAIL ') + 'slider native-to-display delta = ' + delta);
        console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
        process.exit(fail === 0 ? 0 : 1);
    }
    const file = getArg('--test-image');
    if (file) {
        const img = loadImageRGBA(file);
        const x = detectGapApprox(img.rgba, img.width, img.height);
        console.log('perkiraan gap x =', x);
        process.exit(0);
    }
    console.log('Pakai: node lib/ns_captcha_solver.js --selftest | --test-image <file.rgba>');
}
