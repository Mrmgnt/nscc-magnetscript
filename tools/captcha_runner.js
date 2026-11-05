'use strict';
const fs = require('fs');
const path = require('path');
const { decodePNG } = require('../lib/png_decoder');
const { detectSliderTarget, detectSpeckledShape } = require('../lib/ns_captcha_solver');
const { getLabels, LOGS_DIR } = require('./captcha_inventory');

const TOLERANCE_PX = 3;

/**
 * Runs detector against all labeled artifacts in captcha_labels.json.
 * @param {object} [opts]
 * @returns {{ total: number, passed: number, failed: number, accuracy: number, results: Array }}
 */
function runOfflineTests(opts = {}) {
    const labels = opts.labels || getLabels();
    const tolerance = opts.tolerance != null ? opts.tolerance : TOLERANCE_PX;
    const ids = Object.keys(labels);

    const results = [];
    let passed = 0;

    for (const id of ids) {
        const lbl = labels[id];
        if (lbl.type === 'slider') {
            const bgFile = path.join(LOGS_DIR, `verify_rejected_${id}_background.png`);
            const pcFile = path.join(LOGS_DIR, `verify_rejected_${id}_piece.png`);

            if (!fs.existsSync(bgFile) || !fs.existsSync(pcFile)) {
                results.push({
                    id,
                    type: lbl.type,
                    expectedX: lbl.expectedX,
                    detectedX: null,
                    diff: null,
                    pass: false,
                    error: 'Files not found'
                });
                continue;
            }

            const bg = decodePNG(fs.readFileSync(bgFile));
            const pc = decodePNG(fs.readFileSync(pcFile));

            const target = detectSliderTarget(bg.rgba, pc.rgba, {
                bgW: bg.width,
                bgH: bg.height,
                pcW: pc.width,
                pcH: pc.height,
                xMin: 0,
                xMax: bg.width - pc.width,
                yRange: [0, 0],
                returnPosition: true
            });

            const diff = Math.abs(target.x - lbl.expectedX);
            const isPass = diff <= tolerance;
            if (isPass) passed++;

            results.push({
                id,
                type: lbl.type,
                targetIndex: lbl.targetIndex,
                expectedX: lbl.expectedX,
                detectedX: target.x,
                diff,
                tolerance,
                pass: isPass,
                score: target.score,
                confidence: lbl.confidence,
                notes: lbl.notes
            });
        }
    }

    const total = results.length;
    const accuracy = total > 0 ? Number(((passed / total) * 100).toFixed(1)) : 0;

    return {
        total,
        passed,
        failed: total - passed,
        accuracy,
        tolerance,
        results
    };
}

module.exports = {
    runOfflineTests,
    TOLERANCE_PX
};

if (require.main === module) {
    console.log('--- Menjalankan Captcha Regression Test Offline ---');
    const report = runOfflineTests();
    console.log(`Hasil: ${report.passed}/${report.total} LULUS (${report.accuracy}% akurasi, toleransi <= ${report.tolerance}px)`);
    console.log('----------------------------------------------------');
    report.results.forEach(r => {
        const mark = r.pass ? '✓ PASS' : '✗ FAIL';
        console.log(`[${mark}] ID: ${r.id} | Exp: ${r.expectedX} | Got: ${r.detectedX} | Diff: ${r.diff}px | Conf: ${r.confidence || '-'}`);
        if (r.notes) console.log(`        Notes: ${r.notes}`);
    });
    console.log('----------------------------------------------------');
    process.exit(report.failed === 0 ? 0 : 1);
}

