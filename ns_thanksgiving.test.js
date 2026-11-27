'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { parseStatus, renderParam, isConfigured, loadConfig, parseCliArgs, summarizeBattleReward, parseMaterialCounts, normalizeSkillSet, checkWerewolfMaterialSpace, summarizeMiniGameRewards, diffMaterialProgress, claimGunBlastingSkill, buildBattleEnemyQueue, formatTime } = require('./ns_thanksgiving.js');
const { decodeAmfPacket, parseHttpMessage, dechunkHttpBody } = require('./lib/amf_decoder.js');
const { readZipEntries, groupRawSessionEntries } = require('./lib/saz_reader.js');
const { decodeSazFile, decodeJsonlCapture, inspectCryptoParam } = require('./tools/import_thanksgiving_saz.js');
const { parseArgs } = require('./tools/capture_thanksgiving_amf.js');
const { SALT, sha1, ucEncode } = require('./nscrypt.js');

function u16be(n) { const b = Buffer.allocUnsafe(2); b.writeUInt16BE(n, 0); return b; }
function u32be(n) { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n, 0); return b; }

function encodeAmf0Value(val) {
    if (val === null || val === undefined) return Buffer.from([0x05]);
    if (typeof val === 'boolean') return Buffer.from([0x01, val ? 1 : 0]);
    if (typeof val === 'number') {
        const b = Buffer.allocUnsafe(9);
        b[0] = 0x00;
        b.writeDoubleBE(val, 1);
        return b;
    }
    if (typeof val === 'string') {
        const s = Buffer.from(val, 'utf8');
        return Buffer.concat([Buffer.from([0x02]), u16be(s.length), s]);
    }
    if (Array.isArray(val)) {
        return Buffer.concat([Buffer.from([0x0A]), u32be(val.length), ...val.map(encodeAmf0Value)]);
    }
    if (typeof val === 'object') {
        const parts = [Buffer.from([0x03])];
        for (const [k, v] of Object.entries(val)) {
            const kb = Buffer.from(k, 'utf8');
            parts.push(u16be(kb.length), kb, encodeAmf0Value(v));
        }
        parts.push(u16be(0), Buffer.from([0x09]));
        return Buffer.concat(parts);
    }
    return Buffer.from([0x05]);
}

function buildAmf0Packet(targetUri, responseUri, body) {
    const t = Buffer.from(targetUri, 'utf8');
    const r = Buffer.from(responseUri, 'utf8');
    return Buffer.concat([
        u16be(0), u16be(0), u16be(1),
        u16be(t.length), t,
        u16be(r.length), r,
        Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]),
        encodeAmf0Value(body)
    ]);
}

function buildZipBuffer(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const method = entry.deflate ? 8 : 0;
        const compressed = entry.deflate ? zlib.deflateRawSync(raw) : raw;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034B50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);

        localParts.push(local, nameBuf, compressed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014B50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(raw.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBuf);

        offset += local.length + nameBuf.length + compressed.length;
    }

    const cdBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054B50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...localParts, cdBuf, eocd]);
}

// 1. Test existing ns_thanksgiving helpers & config placeholder integrity
assert.deepStrictEqual(
    parseStatus({ remain_heart: '8', heart_max: 8, remain_ammo: 4, werewolf_count: 2 }),
    { heart: 8, heartMax: 8, ammo: 4, werewolf: 2 }
);
assert.strictEqual(parseStatus({ result: { heart: 0 } }).heart, 0);
assert.strictEqual(renderParam('{sessionKey}:{enemyId}', { sessionKey: 'key', enemyId: 'enemy1' }), 'key:enemy1');
assert.strictEqual(isConfigured({ service: 'Event.status', params: [] }), true);
assert.strictEqual(isConfigured({ service: '', params: [] }), false);

const cfg = loadConfig();
assert.strictEqual(cfg.enemies.length, 5);
assert.deepStrictEqual(
    cfg.enemies.map(e => e.name),
    ['Giant Rainbow Turkey', 'Monster Pumpkin', 'Cranberry Fairy', 'Human Face Yam', 'Giant Corn Humanoid']
);
assert.deepStrictEqual(
    cfg.enemies.map(e => e.id),
    ['enemy477', 'enemy478', 'enemy479', 'enemy480', 'enemy481']
);
assert.strictEqual(cfg.status.service, 'Thanksgiving2015.getBattleStatus');
assert.strictEqual(cfg.miniGameStatus.service, 'Thanksgiving2015.getMiniGameStatus');
assert.strictEqual(cfg.battle.service, 'Thanksgiving2015.startBattle');
assert.strictEqual(cfg.battle.rewardService, 'ItemDAO.getBossReward');
assert.strictEqual(cfg.minigame.service, 'Thanksgiving2015.startMiniGame');
assert.strictEqual(cfg.minigame.finishService, 'Thanksgiving2015.finishMiniGame');
assert.deepStrictEqual(parseCliArgs(['node', 'ns_thanksgiving.js', 'full', '1', '1']), {
    mode: 'full',
    subMode: '1',
    maxBattles: 1,
    maxMiniGames: 1,
    enemyId: '',
    force: false,
    loop: false,
    intervalMin: 15
});
assert.deepStrictEqual(parseCliArgs(['node', 'ns_thanksgiving.js', 'minigame', '--max-minigame', '2', '--force']), {
    mode: 'minigame',
    subMode: 'full',
    maxBattles: null,
    maxMiniGames: 2,
    enemyId: '',
    force: true,
    loop: false,
    intervalMin: 15
});
assert.deepStrictEqual(parseCliArgs(['node', 'ns_thanksgiving.js', 'loop', 'full']), {
    mode: 'loop',
    subMode: 'full',
    maxBattles: null,
    maxMiniGames: null,
    enemyId: '',
    force: false,
    loop: true,
    intervalMin: 15
});
assert.deepStrictEqual(
    summarizeBattleReward({ reward: ['xp_30000', 'gold_30000', 'item918', 'item925'], reward_get: ['item918', 'item925'] }, cfg),
    {
        xp: 30000,
        gold: 30000,
        items: ['Thanksgiving Limited (item918)', 'Turkey Coin (item925)'],
        rawReward: ['xp_30000', 'gold_30000', 'item918', 'item925'],
        rewardGet: ['item918', 'item925']
    }
);
assert.strictEqual(formatTime(125), '2m 5s');
assert.strictEqual(formatTime(45), '45s');

// 2. Test AMF0 packet decoding (request + response + reference)
const reqPktBuf = buildAmf0Packet('SampleService.doAction', '/1', ['gs_test123', 42, true, { a: 'x', b: null }]);
const decodedReq = decodeAmfPacket(reqPktBuf);
assert.strictEqual(decodedReq.messages.length, 1);
assert.strictEqual(decodedReq.messages[0].targetUri, 'SampleService.doAction');
assert.deepStrictEqual(decodedReq.messages[0].body, ['gs_test123', 42, true, { a: 'x', b: null }]);

// Test AMF0 0x11 -> AMF3 integer, string ref, and object
const amf3Packet = Buffer.concat([
    u16be(0), u16be(0), u16be(1),
    u16be(11), Buffer.from('/1/onResult'),
    u16be(0), Buffer.from(''),
    Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]),
    Buffer.from([
        0x11,       // AMF0 AVMPlusObject -> AMF3
        0x09, 0x05, 0x01, // AMF3 dense array len=2, no assoc
        0x04, 0x07,       // AMF3 int 7
        0x06, 0x07, 0x61, 0x62, 0x63 // AMF3 string len=3 "abc"
    ])
]);
const decodedAmf3 = decodeAmfPacket(amf3Packet);
assert.deepStrictEqual(decodedAmf3.messages[0].body, [7, 'abc']);

// 3. Test HTTP parser with chunked + gzip
const gzPayload = gzipCompress(buildAmf0Packet('/1/onResult', '', { status: 1, remain_heart: 6 }));
const chunkedBody = Buffer.concat([
    Buffer.from(gzPayload.length.toString(16) + '\r\n', 'ascii'),
    gzPayload,
    Buffer.from('\r\n0\r\n\r\n', 'ascii')
]);
const rawHttpRes = Buffer.concat([
    Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: application/x-amf\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip\r\n\r\n', 'latin1'),
    chunkedBody
]);
const parsedHttp = parseHttpMessage(rawHttpRes);
assert.strictEqual(parsedHttp.statusCode, 200);
assert.deepStrictEqual(decodeAmfPacket(parsedHttp.body).messages[0].body, { status: 1, remain_heart: 6 });

function gzipCompress(buf) {
    return zlib.gzipSync(buf);
}

assert.strictEqual(dechunkHttpBody(Buffer.from('3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n')).toString('utf8'), 'abcde');

// 4. Test ZIP / .saz reader + analyzer + crypto hint detection
const sk = 'gs_demoSessionKey99';
const loginResPkt = buildAmf0Packet('/1/onResult', '', { status: 1, result: ['100', 2, 50, sk] });
const loginReqPkt = buildAmf0Packet('SystemService.snsLogin', '/1', ['100', 'web']);

const sigHash = sha1('enemy901' + SALT + sk);
const ucSample = ucEncode('turkey|5');
const eventReqPkt = buildAmf0Packet('EventDemo.battle', '/2', [sk, 'enemy901', sigHash, ucSample]);
const eventResPkt = buildAmf0Packet('/2/onResult', '', { status: 1, remain_heart: 7, remain_ammo: 3, werewolf_count: 1, reward: ['xp_500'] });

const makeHttpReq = body => Buffer.concat([
    Buffer.from(`POST https://amf.ninjasaga.cc/ HTTP/1.1\r\nHost: amf.ninjasaga.cc\r\nContent-Type: application/x-amf\r\nContent-Length: ${body.length}\r\n\r\n`, 'latin1'),
    body
]);
const makeHttpRes = body => Buffer.concat([
    Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: application/x-amf\r\nContent-Length: ${body.length}\r\n\r\n`, 'latin1'),
    body
]);

const zipBuf = buildZipBuffer([
    { name: 'raw/001_c.txt', data: makeHttpReq(loginReqPkt), deflate: false },
    { name: 'raw/001_s.txt', data: makeHttpRes(loginResPkt), deflate: true },
    { name: 'raw/002_c.txt', data: makeHttpReq(eventReqPkt), deflate: true },
    { name: 'raw/002_s.txt', data: makeHttpRes(eventResPkt), deflate: false }
]);

const zipEntries = readZipEntries(zipBuf);
const sessions = groupRawSessionEntries(zipEntries.values());
assert.strictEqual(sessions.length, 2);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nscc-saz-test-'));
try {
    const tmpSaz = path.join(tmpDir, 'sample.saz');
    fs.writeFileSync(tmpSaz, zipBuf);
    const sazReport = decodeSazFile(tmpSaz);
    assert.strictEqual(sazReport.totalAmfCalls, 2);
    assert.strictEqual(sazReport.eventCallCount, 1);
    assert.deepStrictEqual(sazReport.services, ['EventDemo.battle']);
    const eventCall = sazReport.calls[1];
    assert.strictEqual(eventCall.cryptoHints.length, 2);
    assert.ok(eventCall.cryptoHints[0].matchedFormulas.includes('sha1(param[1] + SALT + sessionKey)'));
    assert.deepStrictEqual(eventCall.cryptoHints[1], { paramIndex: 3, type: 'ucEncode_hex', decoded: 'turkey|5' });
    assert.ok(eventCall.interestingFields.some(f => f.field === 'remain_heart' && f.value === 7));

    const tmpJsonl = path.join(tmpDir, 'sample.jsonl');
    fs.writeFileSync(tmpJsonl, [
        JSON.stringify({ kind: 'request', requestId: 'r1', url: 'https://amf.ninjasaga.cc/', bodyBase64: eventReqPkt.toString('base64') }),
        JSON.stringify({ kind: 'response', requestId: 'r1', url: 'https://amf.ninjasaga.cc/', status: 200, bodyBase64: eventResPkt.toString('base64') })
    ].join('\n'));
    const jsonlReport = decodeJsonlCapture(tmpJsonl);
    assert.strictEqual(jsonlReport.totalAmfCalls, 1);
    assert.strictEqual(jsonlReport.calls[0].service, 'EventDemo.battle');
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// 5. Test capture CLI arg parsing & inspectCryptoParam direct
assert.deepStrictEqual(parseArgs(['--port', '9000', '--duration', '120', '--no-system-proxy', '--import', 'a.saz']), {
    port: 9000,
    durationSec: 120,
    useSystemProxy: false,
    importPath: 'a.saz'
});
assert.strictEqual(inspectCryptoParam('plain', 0, ['plain'], sk), null);

// 6. Test Werewolf material capacity guard, reward summary, inventory delta & Gun Blasting eligibility
const fullFreeNoWolf = checkWerewolfMaterialSpace({
    accountType: 1,
    materialMaxSlots: 20,
    materialKinds: 23,
    materialsInitial: { '634': 10, '904': 50 }
});
assert.strictEqual(fullFreeNoWolf.ok, false);
assert.strictEqual(fullFreeNoWolf.blocked, true);
assert.strictEqual(fullFreeNoWolf.full, true);
assert.deepStrictEqual(fullFreeNoWolf.missingIds, ['923', '924']);

const fullFreeCanStack = checkWerewolfMaterialSpace({
    accountType: 1,
    materialMaxSlots: 20,
    materialKinds: 23,
    materialsInitial: { '923': 5, '924': 6 }
});
assert.strictEqual(fullFreeCanStack.ok, true);
assert.strictEqual(fullFreeCanStack.blocked, false);

const mgSummary = summarizeMiniGameRewards([
    { status: 1, result: { win: 1, stage_cleared: 3 }, update_inventory: { showPopup: true, add_item_id: ['item924_1'] } },
    { status: 1, result: { win: 1, stage_cleared: 3 }, update_inventory: { showPopup: true, add_item_id: ['item923_1'] } },
    { status: 1, result: { win: 1, stage_cleared: 3 }, update_inventory: { showPopup: false, add_item_id: [] } }
]);
assert.deepStrictEqual(mgSummary, {
    dropCounts: { item923: 1, item924: 1 },
    emptyCount: 1,
    totalDrops: 2
});

const deltaVerified = diffMaterialProgress({ '923': 8, '924': 9 }, { '923': 9, '924': 10 }, mgSummary.dropCounts);
assert.strictEqual(deltaVerified.verified, true);
assert.deepStrictEqual(deltaVerified.delta, { '923': 1, '924': 1 });
assert.strictEqual(deltaVerified.readyForGunBlasting, false);

const deltaReady = diffMaterialProgress({ '923': 39, '924': 29 }, { '923': 40, '924': 30 }, { item923: 1, item924: 1 });
assert.strictEqual(deltaReady.readyForGunBlasting, true);
assert.ok(normalizeSkillSet(['skill39', '596']).has('skill596'));

(async () => {
    const owned = new Set(['skill39', 'skill596']);
    const already = await claimGunBlastingSkill({ sessionKey: 'gs_test' }, { '923': 45, '924': 35 }, owned);
    assert.deepStrictEqual(already, { claimed: false, alreadyOwned: true, reason: 'already_owned' });

    const notReady = await claimGunBlastingSkill({ sessionKey: 'gs_test' }, { '923': 8, '924': 10 }, new Set(['skill39']));
    assert.deepStrictEqual(notReady, { claimed: false, reason: 'insufficient_materials' });

    // 7. Test shuffled no-duplicate Thanksgiving boss queue (3 hearts, 5 hearts, 8 hearts Emblem)
    assert.deepStrictEqual(buildBattleEnemyQueue(cfg.enemies, 0), []);
    const q5 = buildBattleEnemyQueue(cfg.enemies, 5);
    assert.strictEqual(q5.length, 5);
    assert.strictEqual(new Set(q5.map(e => e.id)).size, 5);

    const q3 = buildBattleEnemyQueue(cfg.enemies, 3);
    assert.strictEqual(q3.length, 3);
    assert.strictEqual(new Set(q3.map(e => e.id)).size, 3);

    // Emblem 8 hearts: first 5 unique, next 3 unique, and no back-to-back duplicate on boundary (index 4 -> 5)
    for (let trial = 0; trial < 30; trial++) {
        const q8 = buildBattleEnemyQueue(cfg.enemies, 8);
        assert.strictEqual(q8.length, 8);
        assert.strictEqual(new Set(q8.slice(0, 5).map(e => e.id)).size, 5);
        assert.strictEqual(new Set(q8.slice(5, 8).map(e => e.id)).size, 3);
        assert.notStrictEqual(q8[4].id, q8[5].id);
    }

    // Deterministic RNG check: actually shuffles order instead of fixed 477..481
    let seed = 0.2;
    const fakeRng = () => { seed = (seed * 7 + 0.13) % 1; return seed; };
    const qDet = buildBattleEnemyQueue(cfg.enemies, 5, fakeRng).map(e => e.id);
    assert.strictEqual(new Set(qDet).size, 5);
    assert.notDeepStrictEqual(qDet, cfg.enemies.map(e => e.id));

    console.log('ns_thanksgiving.test.js OK');
})();
