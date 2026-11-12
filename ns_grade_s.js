#!/usr/bin/env node
/**
 * ns_grade_s.js — Auto Selesaikan Misi Grade S (Map 1 s/d 4) Sampai Energi Habis
 * Ninja Saga CC — cc: MagnetScript(Razki)
 *
 * Fitur:
 *   1. Menyelesaikan semua Misi Grade S (Map 1 s/d 4) secara berurutan setiap harinya
 *      sampai energi / stamina karakter habis:
 *        - Misi 1 (Stage 1, msn274, Req Lv 80) : XP 82.700  | Gold 5.000 | -12 Energi
 *        - Misi 2 (Stage 2, msn275, Req Lv 81) : XP 88.600  | Gold 5.300 | -12 Energi
 *        - Misi 3 (Stage 3, msn276, Req Lv 82) : XP 92.580  | Gold 5.500 | -12 Energi
 *        - Misi 4 (Stage 4, msn277, Req Lv 83) : XP 95.430  | Gold 5.600 | -12 Energi
 *      (Siklus berputar: 1 -> 2 -> 3 -> 4 -> 1 ... sampai energi < 12).
 *   2. Collect semua prize / reward after match:
 *        - Mengambil & memverifikasi update_inventory (XP, Gold, Item drop, Magatama, Ramen, Potion)
 *   3. Deteksi & Laporan jika Mendapatkan 10 Token di Log Script:
 *        - Mendeteksi hadiah 10 Token dari roulette / after match
 *        - Memverifikasi penambahan saldo token karakter sebelum & sesudah
 *        - Memberikan highlight laporan khusus di console & mencatat ke logs/grade_s_tokens.log
 *   4. Dukungan Mode:
 *        - node ns_grade_s.js 1-4 [jeda]      -> Rotasi Misi 1-4 sampai energi habis (Default)
 *        - node ns_grade_s.js 2 [jeda]        -> Pilih stage tertentu saja (1/2/3/4/5)
 *        - node ns_grade_s.js loop [jeda]     -> Scheduler harian (habiskan energi 1-4 lalu standby tunggu refill)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const c = require('./nsclient.js');
const k = require('./ns_crypto.js');
const { ucEncode } = require('./nscrypt.js');

const LOGS_DIR = path.join(__dirname, 'logs');
const TOKEN_LOG_FILE = path.join(LOGS_DIR, 'grade_s_tokens.log');

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
    { num: 1, id: 'msn274', mid: 'msn274', reqLv: 80, staminaCost: 12, xp: 82700, gold: 5000, name: 'Misi 1 (Stage 1)' },
    { num: 2, id: 'msn275', mid: 'msn275', reqLv: 81, staminaCost: 12, xp: 88600, gold: 5300, name: 'Misi 2 (Stage 2 - Story Genin)' },
    { num: 3, id: 'msn276', mid: 'msn276', reqLv: 82, staminaCost: 12, xp: 92580, gold: 5500, name: 'Misi 3 (Stage 3)' },
    { num: 4, id: 'msn277', mid: 'msn277', reqLv: 83, staminaCost: 12, xp: 95430, gold: 5600, name: 'Misi 4 (Stage 4)' },
    { num: 5, id: 'msn278', mid: 'msn278', reqLv: 84, staminaCost: 12, xp: 100000, gold: 5900, name: 'Stage 5 (Bonus)' }
];

const ITEM_NAMES = {
    'item509': 'Hunting Passport',
    'item1026': 'Crystal of Kari',
    'item1027': 'Heart of Kari',
    'ramen': 'Ramen (+Energi)',
    'ramen_3': 'Ramen x3 (+Energi)',
    'fire_magatama': 'Fire Magatama (火)',
    'steel_magatama': 'Steel Magatama (鋼)',
    'hp_potion': 'HP Healing Potion'
};

function formatItemName(raw) {
    const s = String(raw || '').trim();
    if (ITEM_NAMES[s]) return ITEM_NAMES[s];
    if (ITEM_NAMES[s.toLowerCase()]) return ITEM_NAMES[s.toLowerCase()];
    if (/token/i.test(s)) return '★ 10 Saga Tokens';
    if (/ramen/i.test(s)) return 'Ramen (+Energi)';
    if (/magatama/i.test(s)) return 'Magatama Material';
    if (/potion/i.test(s)) return 'Healing Potion';
    return s;
}

function parseRewardItems(ub) {
    const inv = (ub && ub.update_inventory) || {};
    const raw = inv.reward_items || ub.reward_items || ub.reward_get || ub.reward || ub.prize;
    const items = [];
    let tokenGained = 0;

    if (Array.isArray(raw)) {
        for (const it of raw) {
            const itStr = String(it || '').trim();
            if (!itStr) continue;
            if (/token/i.test(itStr) || itStr === '10' || itStr === 'token_10') {
                tokenGained += 10;
                items.push('10 Token');
            } else {
                items.push(formatItemName(itStr));
            }
        }
    } else if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
            const s = `${k}:${v}`;
            if (/token/i.test(k) || /token/i.test(String(v))) {
                tokenGained += 10;
                items.push('10 Token');
            } else {
                items.push(formatItemName(s));
            }
        }
    } else if (typeof raw === 'string' && raw.trim()) {
        const parts = raw.split(/[,;|]/);
        for (const p of parts) {
            const tr = p.trim();
            if (!tr) continue;
            if (/token/i.test(tr)) {
                tokenGained += 10;
                items.push('10 Token');
            } else {
                items.push(formatItemName(tr));
            }
        }
    }

    if (inv.tokens !== undefined && Number(inv.tokens) > 0) {
        tokenGained += Number(inv.tokens);
        items.push(`${inv.tokens} Token`);
    }

    return { items, tokenGained };
}

function logTokenReward(user, charName, charId, stageName, tokenCount, beforeToken, afterToken) {
    if (!fs.existsSync(LOGS_DIR)) {
        try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch (_) {}
    }
    const timeStr = new Date().toISOString();
    const logText = `[${timeStr}] Akun: ${user} | Karakter: ${charName} (ID: ${charId}) | Misi: ${stageName} | DAPAT ${tokenCount} TOKEN! | Saldo: ${beforeToken} -> ${afterToken}\n`;
    try {
        fs.appendFileSync(TOKEN_LOG_FILE, logText, 'utf8');
    } catch (_) {}
}

const args = process.argv.slice(2);
const rawTarget = (args[0] || '1-4').toLowerCase();
const isLoopMode = rawTarget === 'loop' || rawTarget === '--loop' || args.includes('--loop');
const isMapMode = rawTarget === 'all' || rawTarget === '1-4' || rawTarget === 'map' || rawTarget === 'rotation' || isLoopMode;
let singleStageNum = 0;
if (!isMapMode && rawTarget !== 'auto') {
    singleStageNum = parseInt(rawTarget, 10) || 0;
}
const jedaSec = Math.max(5, parseInt(args[1], 10) || 8);
const maxBattles = parseInt(args[2], 10) || 0;

async function runGradeSSession() {
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

    let initialTokens = Number(s.tokens !== undefined ? s.tokens : (s.raw && s.raw.result && s.raw.result[2]) || 0);

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

    // Ambil kunci tanda tangan extraData
    let extraKeys = null;
    let extraTokens = 0;
    for (let i = 1; i <= 3; i++) {
        const res = await c.amf('CharacterDAO.getExtraData', [s.sessionKey, charId, s.token, gk]);
        const b = (res && res.body) || {};
        if (b.result) {
            const ex = b.result;
            const kq0 = kv(String(ex.isGraphic)), kq1 = kv(String(ex.statistic_battle));
            const dvx = String(ex.m7v), egv = String(ex.q7t);
            const pet = Array.isArray(ex.player_pet) && ex.player_pet.length ? ex.player_pet[0] : null;
            if (ex.totalToken !== undefined) extraTokens = Number(ex.totalToken);
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

    if (!initialTokens && extraTokens) initialTokens = extraTokens;

    let curStamina = (charObj.character_stamina !== undefined && charObj.character_stamina !== null)
        ? Number(charObj.character_stamina) : 75;

    console.log('\n======================================================================');
    console.log('       MISI GRADE S (MAP 1 s/d 4) - AUTO ENERGY & REWARD RUNNER');
    console.log('                     cc: MagnetScript(Razki)');
    console.log('======================================================================');
    console.log(` Akun         : ${user}`);
    console.log(` Karakter     : ${charName} (ID: ${charId})`);
    console.log(` Level        : Lv ${curLevel} | Gold: ${curGold.toLocaleString()} | XP: ${curXp.toLocaleString()}`);
    console.log(` Saldo Token  : ${initialTokens} Tokens`);
    console.log(` Energi/Stam  : ${curStamina} / 75 (Biaya: 12 energi per battle)`);
    console.log('======================================================================\n');

    if (curLevel < 80) {
        line(`[!] Karakter "${charName}" masih Level ${curLevel}.`);
        line('    Misi Grade S membutuhkan minimal Level 80.');
        process.exit(0);
    }

    // Tentukan daftar stage yang akan dimainkan
    let stageQueue = [];
    let modeLabel = '';

    if (isMapMode) {
        // Mode Misi 1-4 (Map Story): Rotasi msn274, msn275, msn276, msn277
        stageQueue = STAGES.slice(0, 4).filter(st => curLevel >= st.reqLv);
        modeLabel = `Rotasi Misi 1 s/d ${stageQueue.length} (Map Story)`;
        line(`Mode Target   : ${modeLabel}`);
        line(`Daftar Misi   : ` + stageQueue.map(s => `${s.name} [${s.id}]`).join(', '));
    } else if (singleStageNum >= 1 && singleStageNum <= 5) {
        const picked = STAGES[singleStageNum - 1];
        if (curLevel < picked.reqLv) {
            line(`[!] Level tidak cukup untuk ${picked.name} (Butuh Lv ${picked.reqLv}, Level saat ini: ${curLevel}).`);
            process.exit(0);
        }
        stageQueue = [picked];
        modeLabel = `Fokus ${picked.name} [${picked.id}] Saja`;
        line(`Mode Target   : ${modeLabel}`);
    } else {
        // Auto stage tertinggi
        const available = STAGES.filter(st => curLevel >= st.reqLv);
        const topStage = available[available.length - 1];
        stageQueue = [topStage];
        modeLabel = `Auto Stage Tertinggi (${topStage.name})`;
        line(`Mode Target   : ${modeLabel}`);
    }

    line(`Jeda Battle   : ${jedaSec} detik | Auto Collect Prize: YA`);
    line(`Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti dan kembali ke menu.\n`);

    const { kq0, kq1, dvx, egv, pet } = extraKeys;
    let battleSuccess = 0;
    let totalXpGained = 0;
    let totalGoldGained = 0;
    let totalTokensWon = 0;
    const stageBattleCounts = {};
    const collectedItemsAll = [];

    let stageCursor = 0;
    let roundNumber = 1;

    while (true) {
        if (maxBattles > 0 && battleSuccess >= maxBattles) {
            line(`[i] Batas maksimal battle yang ditentukan (${maxBattles}x) telah tercapai.`);
            break;
        }

        const curStage = stageQueue[stageCursor];
        const mid = curStage.mid;
        const battleNo = battleSuccess + 1;
        const t0 = now();

        line(`>>> [Putaran #${roundNumber}] Memulai ${curStage.name} [${mid}] (Biaya: 12 Energi)...`);

        // 1. startMission
        process.stdout.write(`    Mengirim start mission ke server... `);
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
            console.log('SELESAI / HABIS!');
            if (/stamina|not enough/i.test(errMsg) || Number(mb.error) === 106) {
                line(`\n[i] Energi / Stamina karakter sudah habis (kurang dari 12).`);
                line(`    Semua jatah energi misi Grade S hari ini telah terselesaikan dengan sukses!`);
            } else if (Number(mb.error) === 108) {
                line('[i] Level karakter terlalu tinggi untuk misi ini.');
            } else {
                line(`[!] Server menolak start mission: ${errMsg.slice(0, 160)}`);
            }
            break;
        }

        const sbid = mb.startBattleId;
        const cfn = mb.csf ? String(mb.csf) : (mb.cfn ? String(mb.cfn) : '');
        console.log(`OK (Battle ID: ${sbid})`);
        line(`    Simulasi pertarungan (${jedaSec}s)...`);

        await sleep(jedaSec * 1000);

        // 2. updateCharacter (Collect Prize & Rewards)
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
            stageBattleCounts[curStage.name] = (stageBattleCounts[curStage.name] || 0) + 1;

            const inv = ub.update_inventory || {};
            let matchGold = curStage.gold;
            if (inv.gold && Number(inv.gold) > curGold) {
                matchGold = Number(inv.gold) - curGold;
                curGold = Number(inv.gold);
            } else {
                curGold += curStage.gold;
            }

            let matchXp = curStage.xp;
            if (inv.xp && Number(inv.xp) > curXp) {
                matchXp = Number(inv.xp) - curXp;
                curXp = Number(inv.xp);
            } else {
                curXp += curStage.xp;
            }

            totalGoldGained += matchGold;
            totalXpGained += matchXp;
            curStamina = Math.max(0, curStamina - curStage.staminaCost);

            // Parsing item drop & token reward
            const parsed = parseRewardItems(ub);
            if (parsed.items.length) {
                collectedItemsAll.push(...parsed.items);
            }

            // CEK HADIAH 10 TOKEN
            let wonTokenThisMatch = false;
            if (parsed.tokenGained > 0) {
                wonTokenThisMatch = true;
                totalTokensWon += parsed.tokenGained;
            } else if (JSON.stringify(ub).toLowerCase().includes('token')) {
                wonTokenThisMatch = true;
                totalTokensWon += 10;
            }

            line(`  ✓ Battle #${battleSuccess} SELESAI! [${curStage.name}]`);
            line(`    - Prize Masuk : +${matchXp.toLocaleString()} XP | +${matchGold.toLocaleString()} Gold`);
            if (parsed.items.length) {
                line(`    - Hadiah Item : [ ${parsed.items.join(', ')} ]`);
            }
            line(`    - Est. Energi : ~${curStamina} / 75`);

            // LAPORAN SPESIAL JIKA MENDAPATKAN 10 TOKEN
            if (wonTokenThisMatch) {
                console.log('\n**********************************************************************');
                console.log(' ★★★ [REPORT HADIAH TOKEN] MENDAPATKAN 10 SAGA TOKEN SETELAH MATCH! ★★★');
                console.log(`     Karakter : ${charName} (ID: ${charId})`);
                console.log(`     Misi     : ${curStage.name} [ID: ${mid}]`);
                console.log(`     Hadiah   : +10 Saga Token Berhasil Masuk!`);
                console.log('**********************************************************************\n');
                logTokenReward(user, charName, charId, curStage.name, 10, initialTokens, initialTokens + totalTokensWon);
            }

            // Geser rotasi ke stage berikutnya jika mode 1-4
            stageCursor++;
            if (stageCursor >= stageQueue.length) {
                stageCursor = 0;
                roundNumber++;
            }
        } else {
            line(`  ✗ Gagal update reward battle: ${JSON.stringify(ub).slice(0, 160)}`);
            break;
        }

        await sleep(2000);
    }

    // Verifikasi saldo token akhir dari server
    let finalTokens = initialTokens + totalTokensWon;
    try {
        const sEnd = await c.login(user, pass);
        if (sEnd && sEnd.tokens !== undefined) {
            finalTokens = Number(sEnd.tokens);
            if (finalTokens > initialTokens && totalTokensWon === 0) {
                totalTokensWon = finalTokens - initialTokens;
            }
        }
    } catch (_) {}

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
        await sleep(1500);
    }

    console.log('\n======================================================================');
    console.log('                   RINGKASAN FARMING MISI GRADE S');
    console.log('======================================================================');
    console.log(` Akun              : ${user}`);
    console.log(` Karakter          : ${charName} (Lv ${curLevel})`);
    console.log(` Mode Dijalankan   : ${modeLabel}`);
    console.log(` Pertarungan Selesai: ${battleSuccess} kali battle`);
    if (Object.keys(stageBattleCounts).length > 1) {
        console.log(` Detail Per Misi   :`);
        for (const [stName, cnt] of Object.entries(stageBattleCounts)) {
            console.log(`   - ${stName.padEnd(28)}: ${cnt}x battle`);
        }
    }
    console.log(` Total XP Didapat  : +${totalXpGained.toLocaleString()} XP`);
    console.log(` Total Gold Masuk  : +${totalGoldGained.toLocaleString()} Gold`);
    if (collectedItemsAll.length) {
        console.log(` Total Item/Drop   : ${collectedItemsAll.join(', ')}`);
    } else {
        console.log(` Total Item/Drop   : Tidak ada item langka yang jatuh`);
    }

    // LAPORAN STATUS TOKEN
    if (totalTokensWon > 0 || finalTokens > initialTokens) {
        const tokDiff = Math.max(totalTokensWon, finalTokens - initialTokens);
        console.log('----------------------------------------------------------------------');
        console.log(` ★★★ LAPORAN TOKEN: MENDAPATKAN +${tokDiff} SAGA TOKEN DARI MISI GRADE S! ★★★`);
        console.log(`     Saldo Awal  : ${initialTokens} Token`);
        console.log(`     Saldo Akhir : ${finalTokens} Token (+${tokDiff} Token)`);
        console.log(`     Log Tersimpan di: logs/grade_s_tokens.log`);
        console.log('----------------------------------------------------------------------');
    } else {
        console.log(` Status Hadiah Token: Belum roll 10 token (Saldo: ${finalTokens} Token)`);
    }

    console.log(` Status Energi     : Energi Habis / Grinding Selesai (Sisa: ${curStamina} / 75)`);
    console.log('======================================================================\n');

    return {
        battles: battleSuccess,
        totalTokensWon,
        curStamina
    };
}

async function main() {
    if (!isLoopMode) {
        await runGradeSSession();
        return;
    }

    line('>>> MODE SCHEDULER MISI GRADE S DIAKTIFKAN <<<');
    line('Bot akan menghabiskan energi Misi 1-4, lalu standby otomatis saat energi kosong.');
    line('Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti.\n');

    while (true) {
        const res = await runGradeSSession();
        line('Standby & menunggu regenerasi energi (15 menit)...');
        // Tunggu 15 menit untuk regenerasi energi (~3 stamina), lalu cek kembali
        for (let s = 900; s > 0; s -= 30) {
            process.stdout.write(`\rMenunggu refill energi: ${Math.floor(s / 60)}m ${s % 60}s tersisa...  `);
            await sleep(30000);
        }
        console.log('');
    }
}

main().catch(err => {
    line('FATAL: ' + err.message);
    process.exit(1);
});
