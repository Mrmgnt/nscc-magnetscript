'use strict';
const path = require('path');
const { getInventory, getLabels, saveLabels } = require('./captcha_inventory');
const { runOfflineTests } = require('./captcha_runner');

const args = process.argv.slice(2);
const command = args[0] || 'help';

function showHelp() {
    console.log(`
Ninja Saga Captcha Offline Review CLI Tool
===========================================
Usage:
  node tools/captcha_cli_review.js list
  node tools/captcha_cli_review.js show <id>
  node tools/captcha_cli_review.js select <id> <candidateNumber> [notes]
  node tools/captcha_cli_review.js test
  node tools/captcha_cli_review.js server [--port 3333]
`);
}

switch (command) {
    case 'list': {
        const inv = getInventory();
        const labels = getLabels();
        console.log(`\nInventory Total: ${inv.length} artifacts (Slider: ${inv.filter(i => i.type === 'slider').length}, Drag: ${inv.filter(i => i.type === 'drag_shape').length}, Rotate: ${inv.filter(i => i.type === 'rotate').length})\n`);
        console.log('ID             | Type       | Rejected Ans | Status     | Expected X / Ans');
        console.log('---------------+------------+--------------+------------+-------------------');
        inv.forEach(item => {
            const lbl = labels[item.id];
            const rej = item.rejectedX != null ? `x=${item.rejectedX}` : item.rejectedAngle != null ? `${item.rejectedAngle}°` : '-';
            const status = lbl ? '✓ LABELED' : 'PENDING';
            const exp = lbl ? (lbl.expectedX != null ? `x=${lbl.expectedX}` : lbl.expectedAnswer || '-') : '-';
            console.log(`${item.id.padEnd(14)} | ${item.type.padEnd(10)} | ${rej.padEnd(12)} | ${status.padEnd(10)} | ${exp}`);
        });
        console.log('');
        break;
    }

    case 'show': {
        const id = args[1];
        if (!id) {
            console.error('Harap berikan ID artifact, contoh: node tools/captcha_cli_review.js show 1793852615709');
            process.exit(1);
        }
        const inv = getInventory();
        const item = inv.find(i => i.id === id);
        if (!item) {
            console.error(`Artifact ID ${id} tidak ditemukan.`);
            process.exit(1);
        }
        const labels = getLabels();
        const lbl = labels[id];

        console.log(`\n--- Artifact ${id} (${item.type}) ---`);
        console.log(`File: ${item.file}`);
        console.log(`Background: ${item.bg}`);
        console.log(`Piece: ${item.pc}`);
        if (item.rejectedX != null) console.log(`Server Rejected Attempt X: ${item.rejectedX}`);
        if (item.rejectedAngle != null) console.log(`Server Rejected Attempt Angle: ${item.rejectedAngle}°`);

        if (item.candidates && item.candidates.length) {
            console.log('\nKandidat Checker Terdeteksi:');
            item.candidates.forEach(c => {
                const isSelected = lbl && lbl.targetIndex === c.index;
                const marker = isSelected ? '-> [TERPILIH]' : '  ';
                console.log(`${marker} Candidate #${c.index}: x=${c.x} (borderMismatch=${c.borderMismatch}, boundary=${c.boundary}, checker=${c.checkerRatio})`);
            });
        }
        if (lbl) {
            console.log(`\nLabel Saat Ini:`);
            console.log(JSON.stringify(lbl, null, 2));
        } else {
            console.log(`\nBelum berlabel. Gunakan: node tools/captcha_cli_review.js select ${id} <candidateIndex> "[notes]"`);
        }
        console.log('');
        break;
    }

    case 'select': {
        const id = args[1];
        const candIdx = parseInt(args[2], 10);
        const notes = args.slice(3).join(' ') || '';

        if (!id || isNaN(candIdx)) {
            console.error('Pakai: node tools/captcha_cli_review.js select <id> <candidateNumber> [notes]');
            process.exit(1);
        }

        const inv = getInventory();
        const item = inv.find(i => i.id === id);
        if (!item) {
            console.error(`Artifact ID ${id} tidak ditemukan.`);
            process.exit(1);
        }
        if (!item.candidates || !item.candidates.length) {
            console.error(`Artifact ${id} tidak memiliki kandidat otomatis.`);
            process.exit(1);
        }
        const candidate = item.candidates.find(c => c.index === candIdx);
        if (!candidate) {
            console.error(`Kandidat #${candIdx} tidak ditemukan. Pilihan yang ada: 1..${item.candidates.length}`);
            process.exit(1);
        }

        const labels = getLabels();
        labels[id] = {
            type: item.type,
            targetIndex: candidate.index,
            expectedX: candidate.x,
            confidence: 'high',
            notes: notes || `Pilihan manual candidate #${candIdx} di x=${candidate.x}`
        };

        saveLabels(labels);
        console.log(`✓ Berhasil menyimpan label untuk ID ${id}:`);
        console.log(`  Candidate #${candidate.index} -> expectedX = ${candidate.x}`);
        break;
    }

    case 'test': {
        const report = runOfflineTests();
        console.log(`\nHasil Regression Test: ${report.passed}/${report.total} (${report.accuracy}%)`);
        report.results.forEach(r => {
            const m = r.pass ? '✓ PASS' : '✗ FAIL';
            console.log(`[${m}] ID: ${r.id} | Exp: ${r.expectedX} | Got: ${r.detectedX} | Diff: ${r.diff}px`);
        });
        console.log('');
        process.exit(report.failed === 0 ? 0 : 1);
    }

    case 'server': {
        require('./captcha_review_server');
        break;
    }

    default:
        showHelp();
        break;
}

