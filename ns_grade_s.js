#!/usr/bin/env node
/**
 * ns_grade_s.js — Auto Farm Misi Grade S (Stamina Runner)
 * Ninja Saga CC — cc: MagnetScript(Razki)
 *
 * Misi Grade S (Stage 1 s/d 5) menggunakan sistem stamina (-12 Stamina / Battle).
 * Memberikan XP dan Gold sangat masif:
 *   - Stage 1 (Lv 80+) : XP 82.700  | Gold 5.000 | -12 Stamina
 *   - Stage 2 (Lv 81+) : XP 88.600  | Gold 5.300 | -12 Stamina  <- Misi di Story Genin
 *   - Stage 3 (Lv 82+) : XP 92.580  | Gold 5.500 | -12 Stamina
 *   - Stage 4 (Lv 83+) : XP 95.430  | Gold 5.600 | -12 Stamina
 *   - Stage 5 (Lv 84+) : XP 100.000 | Gold 5.900 | -12 Stamina
 *
 * Penggunaan:
 *   node ns_grade_s.js                   -> Auto pilih stage tertinggi & habiskan stamina
 *   node ns_grade_s.js 2                 -> Pilih Stage 2 saja
 *   node ns_grade_s.js 2 10              -> Pilih Stage 2, jeda battle 10 detik
 *   node ns_grade_s.js auto 8 5          -> Auto stage, jeda 8s, maks 5 battle
 */
'use strict';

const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const { ucEncode } = require('./nscrypt.js');

const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
function kv(s) {
    let o = '';
    for (const ch of String(s)) {
        const i = 'GhKmNpRtVwYzJqSx'.indexOf(ch);
        o += i < 0 ? ch : '0123456789abcdef'.charAt(i);
    }
    return o;
}

const STAGES = [
    { num: 1, id: 'msn274', mid: '274', reqLv: 80, staminaCost: 12, xp: 82700, gold: 5000, name: 'Stage 1' },
    { num: 2, id: 'msn275', mid: '275', reqLv: 81, staminaCost: 12, xp: 88600, gold: 5300, name: 'Stage 2 (Story Genin)' },
    { num: 3, id: 'msn276', mid: '276', reqLv: 82, staminaCost: 12, xp: 92580, gold: 5500, name: 'Stage 3' },
    { num: 4, id: 'msn277', mid: '277', reqLv: 83, staminaCost: 12, xp: 95430, gold: 5600, name: 'Stage 4' },
    { num: 5, id: 'msn278', mid: '278', reqLv: 84, staminaCost: 12, xp: 100000, gold: 5900, name: 'Stage 5' }
];

const args = process.argv.slice(2);
let stageTarget = 0; // 0 = auto stage tertinggi
if (args[0] && args[0].toLowerCase() !== 'auto') {
    stageTarget = parseInt(args[0], 10) || 0;
}
const jedaSec = Math.max(5, parseInt(args[1], 10) || 8);
const maxBattles = parseInt(args[2], 10) || 0;

async function main() {
    c.enableGracefulStop('menu bot');
    const user = process.env.NS_USER;
    const pass = process.env.NS_PASS;
    if (!user || !pass) {
        console.log('[!] Diperlukan NS_USER dan NS_PASS di environment.');
        process.exit(1);
    }

    line('Menghubungkan ke server Ninja Saga...');
    const s = await c.login(user, pass);
    if (!s.ok) {
        line('LOGIN GAGAL: ' + s.stage + ' (' + (s.message || s.body || 'status ' + s.http) + ')');
        process.exit(2);
    }

    const rl = await c.amf('CharacterDAO.getCharactersList', [s.sessionKey]);
    const chars = (rl && rl.body && Array.isArray(rl.body.result)) ? rl.body.result : [];
    const charRow = c.getSelectedChar(chars, process.env.NS_CHAR_ID || process.env.NS_CHAR_SLOT);
    if (!charRow) {
        line('ERROR: Tidak ada karakter ditemukan.');
        process.exit(3);
    }

    const charId = charRow[0];
    let h = k.mk(s.sessionKey);

    // Ambil data detail karakter
    let charObj = null;
    let gk = '';
    for (let i = 1; i <= 6; i++) {
        const r = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
        const b = r.body || {};
        if (b.gk) {
            gk = String(b.gk);
            charObj = b.result || {};
            break;
        }
        await sleep(2500);
    }

    if (!charObj) {
        line('ERROR: Gagal membaca data karakter.');
        process.exit(4);
    }

    const charName = charObj.character_name || charRow[1];
    let curLevel = Number(charObj.character_level) || 1;
    let curXp = Number(charObj.character_xp) || 0;
    let curGold = Number(charObj.character_gold) || 0;
    let curStamina = (charObj.character_stamina !== undefined && charObj.character_stamina !== null)
        ? Number(charObj.character_stamina) : 75;

    console.log('\n======================================================================');
    console.log('              MISI GRADE S - AUTO STAMINA GRINDER');
    console.log('======================================================================');
    console.log(` Akun      : ${user}`);
    console.log(` Karakter  : ${charName} (ID: ${charId})`);
    console.log(` Level     : ${curLevel} | Gold: ${curGold.toLocaleString()} | XP: ${curXp.toLocaleString()}`);
    console.log(` Stamina   : ${curStamina} / 75 (Biaya: 12 stamina / battle)`);
    console.log('======================================================================\n');

    // Validasi level untuk Grade S
    if (curLevel < 80) {
        line(`[!] Karakter "${charName}" masih Level ${curLevel}.`);
        line('    Misi Grade S membutuhkan minimal Level 80 (Sennin).');
        line('    Silakan naikkan level terlebih dahulu menggunakan menu Auto Leveling (Menu 6 / 7).');
        process.exit(0);
    }

    // Tentukan Stage yang akan dimainkan
    let chosenStage = null;
    if (stageTarget >= 1 && stageTarget <= 5) {
        chosenStage = STAGES[stageTarget - 1];
        if (curLevel < chosenStage.reqLv) {
            line(`[!] Level tidak cukup untuk Stage ${chosenStage.num} (Butuh Lv ${chosenStage.reqLv}, Level saat ini: ${curLevel}).`);
            process.exit(0);
        }
    } else {
        // Auto: pilih stage tertinggi yang memenuhi syarat level
        const available = STAGES.filter(st => curLevel >= st.reqLv);
        chosenStage = available[available.length - 1];
    }

    line(`Target Stage  : ${chosenStage.name} [ID: ${chosenStage.id}]`);
    line(`Syarat Level  : Min Lv ${chosenStage.reqLv} (Karakter kamu: Lv ${curLevel})`);
    line(`Potensi Reward: +${chosenStage.xp.toLocaleString()} XP | +${chosenStage.gold.toLocaleString()} Gold per battle`);

    if (curStamina < chosenStage.staminaCost) {
        line(`\n[!] Stamina tidak cukup untuk memulai battle (Stamina: ${curStamina}, Butuh: ${chosenStage.staminaCost}).`);
        line('    Silakan tunggu regenerasi stamina atau refill ramen terlebih dahulu.');
        process.exit(0);
    }

    const estimatedBattles = Math.floor(curStamina / chosenStage.staminaCost);
    const planBattles = maxBattles > 0 ? Math.min(estimatedBattles, maxBattles) : estimatedBattles;
    line(`Estimasi Kuota: ~${estimatedBattles}x pertempuran (Rencana eksekusi: ${planBattles}x battle)\n`);

    // Ambil kunci tanda tangan extraData 1x
    let extraKeys = null;
    for (let i = 1; i <= 3; i++) {
        const res = await c.amf('CharacterDAO.getExtraData', [s.sessionKey, charId, s.token, gk]);
        const b = (res && res.body) || {};
        if (b.result) {
            const ex = b.result;
            const kq0 = kv(String(ex.isGraphic)), kq1 = kv(String(ex.statistic_battle));
            const dvx = String(ex.m7v), egv = String(ex.q7t);
            const pet = Array.isArray(ex.player_pet) && ex.player_pet.length ? ex.player_pet[0] : null;
            if (kq0 && kq1 && dvx) {
                extraKeys = { kq0, kq1, dvx, egv, pet };
                break;
            }
        }
        await sleep(2000);
    }

    if (!extraKeys) {
        line('ERROR: Gagal memperoleh kunci tanda tangan extraData dari server.');
        process.exit(5);
    }

    const { kq0, kq1, dvx, egv, pet } = extraKeys;
    const mid = chosenStage.mid;

    let battleSuccess = 0;
    let totalXpGained = 0;
    let totalGoldGained = 0;
    const startXp = curXp;
    const startGold = curGold;
    const startLevel = curLevel;

    line(`>>> MEMULAI GRINDING GRADE S (Jeda: ${jedaSec}s) <<<`);
    line('Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti dan kembali ke menu.\n');

    while (true) {
        if (maxBattles > 0 && battleSuccess >= maxBattles) {
            line(`[i] Batas maksimal battle yang ditentukan (${maxBattles}x) telah tercapai.`);
            break;
        }

        const battleNo = battleSuccess + 1;
        const t0 = now();

        // 1. startMission
        process.stdout.write(`[${new Date().toTimeString().slice(0, 8)}] Battle #${battleNo}: Mengirim request start mission... `);
        const mulai = await c.amf('CharacterService.startMission', [
            s.sessionKey, mid,
            h.msk(kq0 + '|' + mid + '|' + t0),
            h.getHash(mid),
            t0,
            h.msk(dvx + '|' + mid + '|' + t0)
        ]);

        const mb = mulai.body || {};
        if (Number(mb.status) !== 1) {
            const errMsg = JSON.stringify(mb);
            console.log('GAGAL!');
            if (/stamina|not enough/i.test(errMsg) || Number(mb.error) === 106) {
                line(`[i] Stamina karakter sudah habis / di bawah ${chosenStage.staminaCost}. Selesai!`);
            } else if (Number(mb.error) === 108) {
                line('[i] Level karakter terlalu tinggi untuk misi ini.');
            } else {
                line(`[!] Server menolak start mission: ${errMsg.slice(0, 160)}`);
            }
            break;
        }

        const sbid = mb.startBattleId;
        const cfn = mb.csf ? String(mb.csf) : '';
        console.log(`Battle ID: ${sbid}. Simulasi battle (${jedaSec}s)...`);

        await sleep(jedaSec * 1000);

        // 2. updateCharacter
        const bfl = JSON.stringify({ battles: [] });
        const arr = [s.sessionKey, charId, curLevel, 0, 0, [], pet ? pet.id : 0, pet ? pet.level : 0, mid, 0, ''];
        const upd = await c.amf('CharacterService.updateCharacter', [
            s.sessionKey, charId, curLevel, 0, 0, [],
            pet ? pet.id : 0, pet ? pet.level : 0, mid,
            h.getArrayHash(arr), h.updateSequence(), 0, '',
            '1', h.urk(kq1 + '|' + cfn), sbid, bfl, h.getHash('1' + sbid + bfl),
            ucEncode(charId + '|0|0|' + mid + '|' + sbid), h.urk(egv + '|' + cfn)
        ]);

        const ub = upd.body || {};
        if (Number(ub.status) === 1) {
            battleSuccess++;
            totalXpGained += chosenStage.xp;
            totalGoldGained += chosenStage.gold;
            curStamina = Math.max(0, curStamina - chosenStage.staminaCost);

            line(`  ✓ Battle #${battleSuccess} SELESAI! (+${chosenStage.xp.toLocaleString()} XP | +${chosenStage.gold.toLocaleString()} Gold) Est. Sisa Stamina: ~${curStamina}`);
        } else {
            line(`  ✗ Gagal update reward battle: ${JSON.stringify(ub).slice(0, 160)}`);
            break;
        }

        // Jeda singkat antar battle
        await sleep(2000);
    }

    // Refresh data karakter terakhir
    for (let i = 1; i <= 3; i++) {
        const rEnd = await c.amf('CharacterDAO.getCharacterById', [s.sessionKey, charId]);
        if (rEnd && rEnd.body && rEnd.body.result) {
            const rx = rEnd.body.result;
            curLevel = Number(rx.character_level) || curLevel;
            curXp = Number(rx.character_xp) || curXp;
            curGold = Number(rx.character_gold) || curGold;
            if (rx.character_stamina !== undefined) curStamina = Number(rx.character_stamina);
            break;
        }
        await sleep(2000);
    }

    console.log('\n======================================================================');
    console.log('                   RINGKASAN FARMING GRADE S');
    console.log('======================================================================');
    console.log(` Stage Dikerjakan : ${chosenStage.name} [ID: ${chosenStage.id}]`);
    console.log(` Battle Selesai   : ${battleSuccess} kali`);
    console.log(` Total XP Didapat : +${totalXpGained.toLocaleString()} XP (Total: ${curXp.toLocaleString()})`);
    console.log(` Total Gold Masuk : +${totalGoldGained.toLocaleString()} Gold (Total: ${curGold.toLocaleString()})`);
    console.log(` Level Karakter   : Lv ${startLevel} -> Lv ${curLevel}`);
    console.log(` Sisa Stamina     : ${curStamina} / 75`);
    console.log('======================================================================\n');
}

main().catch(err => {
    line('FATAL: ' + err.message);
    process.exit(1);
});
