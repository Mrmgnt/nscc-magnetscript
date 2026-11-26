'use strict';

const fs = require('fs');
const path = require('path');

const ITEM_NAMES = {
    'item509': 'Hunting Passport',
    'item899': 'Ramen (+10 Energy)',
    'item900': 'Advanced Ramen (Full Energy)',
    'item901': 'Gan of Fire God',
    'item902': 'Gan of Steel',
    'item1026': 'Crystal of Kari',
    'item1027': 'Heart of Kari',
    'item1140': 'Janken Eternal Candy',
    'item1141': '9th Anniversary Fukubukuro',
    'item1142': 'Heavenly Dango',
    'item1143': '9th Friendship Box',
    'item1144': 'Fire Stone Fragment',
    'item1145': 'Wind Stone Fragment',
    'item1146': 'Water Stone Fragment',
    'item1147': 'Lightning Stone Fragment',
    'item1148': 'Earth Stone Fragment',
    'item1149': 'Halloween Fukubukuro',
    'ramen': 'Ramen (+Energi)',
    'fire_magatama': 'Fire Magatama',
    'steel_magatama': 'Steel Magatama',
    'water_magatama': 'Water Magatama',
    'wind_magatama': 'Wind Magatama',
    'earth_magatama': 'Earth Magatama',
    'lightning_magatama': 'Lightning Magatama',
    'hp_potion': 'HP Healing Potion',
    'cp_potion': 'CP Chakra Potion'
};

function getLocalDateStr(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function normalizeItemId(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^item_(\d+)$/i);
    if (m) return `item${m[1]}`;
    return s;
}

function formatItemName(raw) {
    const s = normalizeItemId(raw);
    if (!s) return '';
    if (ITEM_NAMES[s]) return ITEM_NAMES[s];
    if (ITEM_NAMES[s.toLowerCase()]) return ITEM_NAMES[s.toLowerCase()];
    if (/token/i.test(s)) return 'Saga Token';
    if (/ramen/i.test(s)) return 'Ramen (+Energi)';
    if (/magatama/i.test(s)) return `Magatama (${s})`;
    if (/potion/i.test(s)) return `Healing Potion (${s})`;
    return s;
}

/**
 * Parse satu entry hadiah (string seperti "item509_2", "item_899_3", "token_10", "gold_5000", atau object).
 */
function parseRewardEntry(entry) {
    if (entry === null || entry === undefined || entry === false || entry === '') {
        return null;
    }

    if (typeof entry === 'object' && !Array.isArray(entry)) {
        const rawId = String(
            entry.item_id ?? entry.itemId ?? entry.id ?? entry.type ?? entry.reward ?? entry.name ?? ''
        ).trim();
        const rawQty = entry.qty ?? entry.amount ?? entry.count ?? entry.quantity ?? entry.value ?? entry.tokens ?? entry.token;
        const numQty = rawQty !== undefined && rawQty !== null && rawQty !== '' ? Number(rawQty) : NaN;

        if (!rawId && Number.isFinite(entry.tokens)) {
            const q = Number(entry.tokens);
            if (q <= 0) return null;
            return { kind: 'token', qty: q, label: `${q} Token`, raw: `token_${q}` };
        }
        if (!rawId && Number.isFinite(entry.token)) {
            const q = Number(entry.token);
            if (q <= 0) return null;
            return { kind: 'token', qty: q, label: `${q} Token`, raw: `token_${q}` };
        }
        if (/^tokens?$/i.test(rawId) || /saga.?token/i.test(rawId)) {
            const q = Number.isFinite(numQty) ? numQty : 10;
            if (q <= 0) return null;
            return { kind: 'token', qty: q, label: `${q} Token`, raw: `${rawId}_${q}` };
        }
        if (!rawId) return null;
        const normId = normalizeItemId(rawId);
        const q = Number.isFinite(numQty) && numQty > 0 ? numQty : 1;
        const baseLabel = formatItemName(normId);
        return {
            kind: 'item',
            itemId: normId,
            qty: q,
            label: q > 1 ? `${baseLabel} x${q}` : baseLabel,
            raw: q > 1 ? `${normId}_${q}` : normId
        };
    }

    const s = String(entry).trim();
    if (!s) return null;

    // XP / Gold string dari array reward seperti "xp_30000", "xp82700_1", "gold_5000", "gold5000_1"
    const xpTupleMatch = s.match(/^xp(\d+)_1$/i);
    if (xpTupleMatch) {
        return { kind: 'xp', qty: Number(xpTupleMatch[1]) || 0, label: `+${xpTupleMatch[1]} XP`, raw: s };
    }
    const xpMatch = s.match(/^xp_?(\d+)$/i);
    if (xpMatch) {
        return { kind: 'xp', qty: Number(xpMatch[1]) || 0, label: `+${xpMatch[1]} XP`, raw: s };
    }
    const goldTupleMatch = s.match(/^gold(\d+)_1$/i);
    if (goldTupleMatch) {
        return { kind: 'gold', qty: Number(goldTupleMatch[1]) || 0, label: `+${Number(goldTupleMatch[1]).toLocaleString()} Gold`, raw: s };
    }
    const goldMatch = s.match(/^gold_?(\d+)$/i);
    if (goldMatch) {
        return { kind: 'gold', qty: Number(goldMatch[1]) || 0, label: `+${Number(goldMatch[1]).toLocaleString()} Gold`, raw: s };
    }

    // Token format: "token_10", "token:10", "token10", "tokens_5", "10_token", "10 token", "token"
    if (/token/i.test(s)) {
        const mNum = s.match(/(\d+)/);
        const qty = mNum ? Number(mNum[1]) : 10;
        if (qty <= 0) return null;
        return { kind: 'token', qty, label: `${qty} Token`, raw: s };
    }

    // Item format "item_899_3" atau "item_899"
    const itemUnderQty = s.match(/^item_(\d+)[_:](\d+)$/i);
    if (itemUnderQty) {
        const itemId = `item${itemUnderQty[1]}`;
        const qty = Number(itemUnderQty[2]) || 0;
        if (qty <= 0) return null;
        const baseLabel = formatItemName(itemId);
        return {
            kind: 'item',
            itemId,
            qty,
            label: qty > 1 ? `${baseLabel} x${qty}` : baseLabel,
            raw: s
        };
    }

    const normDirect = normalizeItemId(s);
    if (ITEM_NAMES[normDirect] || ITEM_NAMES[normDirect.toLowerCase()]) {
        const label = formatItemName(normDirect);
        return { kind: 'item', itemId: normDirect, qty: 1, label, raw: s };
    }

    // Item dengan suffix jumlah seperti "item509_2", "item509:2", atau "ramen_3"
    const qtyMatch = s.match(/^([a-zA-Z0-9-]+)[_:](\d+)$/);
    if (qtyMatch) {
        const baseId = normalizeItemId(qtyMatch[1]);
        const qty = Number(qtyMatch[2]) || 0;
        if (qty <= 0) return null;
        const baseLabel = formatItemName(baseId);
        return {
            kind: 'item',
            itemId: baseId,
            qty,
            label: qty > 1 ? `${baseLabel} x${qty}` : baseLabel,
            raw: s
        };
    }

    return { kind: 'item', itemId: normDirect, qty: 1, label: formatItemName(normDirect), raw: s };
}

function collectRawEntries(container, out) {
    if (container === null || container === undefined || container === false || container === '') return;

    if (Array.isArray(container)) {
        for (const item of container) {
            if (typeof item === 'string' && /[,;|]/.test(item)) {
                for (const part of item.split(/[,;|]/)) {
                    const tr = part.trim();
                    if (tr) out.push(tr);
                }
            } else {
                out.push(item);
            }
        }
        return;
    }

    if (typeof container === 'object') {
        if ('item_id' in container || 'itemId' in container || 'id' in container || 'type' in container) {
            out.push(container);
            return;
        }
        for (const [key, val] of Object.entries(container)) {
            if (val === null || val === undefined || val === false || val === '') continue;
            if (typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val.trim()))) {
                const n = Number(val);
                if (n > 0) out.push(`${key}:${n}`);
            } else if (Array.isArray(val) || typeof val === 'object') {
                collectRawEntries(val, out);
            } else {
                out.push(`${key}:${val}`);
            }
        }
        return;
    }

    if (typeof container === 'string') {
        for (const part of container.split(/[,;|]/)) {
            const tr = part.trim();
            if (tr) out.push(tr);
        }
    }
}

/**
 * Ekstrak hadiah dari SLevelMission.finishMission (Mission.getSGradeResponse di code_library.swf):
 *   add_item_id = [spinItemRaw, "xp<N>_1", "gold<M>_1", ...extraItems]
 *   update_inventory.token = saldo token karakter terbaru (bukan delta!)
 *   reward_list = daftar isi roda spin
 */
function parseSGradeFinishReward(fb, options = {}) {
    const body = fb && typeof fb === 'object' ? fb : {};
    const inv = body.update_inventory && typeof body.update_inventory === 'object' ? body.update_inventory : {};
    const addArr = Array.isArray(inv.add_item_id) ? inv.add_item_id : [];

    const spinRaw = addArr.length > 0 ? String(addArr[0] || '').trim() : '';
    const xpRaw = addArr.length > 1 ? String(addArr[1] || '').trim() : '';
    const goldRaw = addArr.length > 2 ? String(addArr[2] || '').trim() : '';
    const extraArr = addArr.length > 3 ? addArr.slice(3) : [];

    const items = [];
    const extraItems = [];
    const rawItems = [];
    const itemCounts = {};
    let spinTokens = 0;
    let spinGold = 0;
    let spinRewardLabel = '-';

    if (spinRaw && spinRaw !== 'item1') {
        const sp = parseRewardEntry(spinRaw);
        if (sp) {
            if (sp.kind === 'token') {
                spinTokens += sp.qty;
                spinRewardLabel = `${sp.qty} Saga Token`;
                items.push(sp.label);
                rawItems.push(sp.raw);
            } else if (sp.kind === 'gold') {
                spinGold += sp.qty;
                spinRewardLabel = `+${sp.qty.toLocaleString()} Gold`;
                items.push(sp.label);
                rawItems.push(sp.raw);
            } else if (sp.kind === 'item') {
                spinRewardLabel = sp.label;
                items.push(sp.label);
                rawItems.push(sp.raw);
                const baseName = sp.label.replace(/\s+x\d+$/, '');
                itemCounts[baseName] = (itemCounts[baseName] || 0) + sp.qty;
            }
        }
    }

    for (const ex of extraArr) {
        const parsedEx = parseRewardEntry(ex);
        if (!parsedEx) continue;
        if (parsedEx.kind === 'token') {
            spinTokens += parsedEx.qty;
            items.push(parsedEx.label);
            extraItems.push(parsedEx.label);
            rawItems.push(parsedEx.raw);
        } else if (parsedEx.kind === 'item') {
            items.push(parsedEx.label);
            extraItems.push(parsedEx.label);
            rawItems.push(parsedEx.raw);
            const baseName = parsedEx.label.replace(/\s+x\d+$/, '');
            itemCounts[baseName] = (itemCounts[baseName] || 0) + parsedEx.qty;
        }
    }

    const parsedXpEntry = xpRaw ? parseRewardEntry(xpRaw) : null;
    const parsedGoldEntry = goldRaw ? parseRewardEntry(goldRaw) : null;

    const newTokenBalance = (inv.token !== undefined && inv.token !== null && inv.token !== '')
        ? Number(inv.token)
        : ((inv.totalToken !== undefined && inv.totalToken !== null && inv.totalToken !== '') ? Number(inv.totalToken) : null);

    let balanceTokenDelta = 0;
    if (newTokenBalance !== null && Number.isFinite(newTokenBalance) &&
        options.prevTokenBalance !== undefined && options.prevTokenBalance !== null) {
        balanceTokenDelta = Math.max(0, newTokenBalance - Number(options.prevTokenBalance));
    }

    const tokenGained = Math.max(spinTokens, balanceTokenDelta);
    if (tokenGained > 0 && !items.some(it => /token/i.test(it))) {
        items.push(`${tokenGained} Token`);
        if (spinRewardLabel === '-') spinRewardLabel = `${tokenGained} Saga Token`;
    }

    const wheelList = [];
    if (Array.isArray(body.reward_list)) {
        for (const chunk of body.reward_list) {
            for (const part of String(chunk || '').split(',')) {
                const p = part.trim();
                if (p) wheelList.push(p);
            }
        }
    }

    return {
        spinRewardRaw: spinRaw || '',
        spinRewardLabel,
        spinTokens,
        spinGold,
        tokenGained,
        wonToken: tokenGained > 0,
        newTokenBalance: Number.isFinite(newTokenBalance) ? newTokenBalance : null,
        addItemXp: parsedXpEntry && parsedXpEntry.kind === 'xp' ? parsedXpEntry.qty : null,
        addItemGold: parsedGoldEntry && parsedGoldEntry.kind === 'gold' ? parsedGoldEntry.qty : null,
        invXp: (inv.xp !== undefined && inv.xp !== null) ? Number(inv.xp) : null,
        invGold: (inv.gold !== undefined && inv.gold !== null) ? Number(inv.gold) : null,
        items,
        extraItems,
        rawItems,
        itemCounts,
        wheelList,
        rawRewardFields: {
            add_item_id: addArr,
            reward_list: body.reward_list || undefined,
            token_balance: Number.isFinite(newTokenBalance) ? newTokenBalance : undefined
        }
    };
}

/**
 * Ekstrak hadiah (token, item drop, xp/gold tambahan, raw field) dari balasan CharacterService.updateCharacter.
 * Catatan: inv.token / inv.totalToken adalah saldo total (bukan delta), jadi hanya dihitung sebagai selisih bila prevTokenBalance dikirim.
 */
function parseMissionRewards(ub, options = {}) {
    const body = ub && typeof ub === 'object' ? ub : {};
    const inv = body.update_inventory && typeof body.update_inventory === 'object' ? body.update_inventory : {};

    const rewardFieldNames = [
        'add_item_id', 'add_item', 'add_material', 'add_essence',
        'add_weapon', 'add_set', 'add_back_item', 'add_accessory',
        'add_skill', 'add_pet',
        'reward_items', 'reward_get', 'reward', 'prize',
        'roulette', 'roulette_reward', 'spin', 'spin_reward'
    ];

    const rawEntries = [];
    const rawRewardFields = {};

    for (const field of rewardFieldNames) {
        if (inv[field] !== undefined && inv[field] !== null && inv[field] !== '') {
            const val = inv[field];
            if (!Array.isArray(val) || val.length > 0) {
                rawRewardFields[`inv.${field}`] = val;
            }
            collectRawEntries(val, rawEntries);
        }
        if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
            const val = body[field];
            if (!Array.isArray(val) || val.length > 0) {
                rawRewardFields[field] = val;
            }
            collectRawEntries(val, rawEntries);
        }
    }

    let tokenGained = 0;
    const deltaTokenKeys = ['add_token', 'add_tokens', 'token_gained'];
    for (const tk of deltaTokenKeys) {
        const invVal = inv[tk];
        const bodyVal = body[tk];
        if (invVal !== undefined && invVal !== null && invVal !== '') {
            const n = Number(invVal);
            if (Number.isFinite(n) && n > 0) {
                tokenGained += n;
                rawRewardFields[`inv.${tk}`] = n;
            }
        } else if (bodyVal !== undefined && bodyVal !== null && bodyVal !== '') {
            const n = Number(bodyVal);
            if (Number.isFinite(n) && n > 0) {
                tokenGained += n;
                rawRewardFields[tk] = n;
            }
        }
    }

    const newBalanceRaw = inv.token ?? inv.tokens ?? inv.totalToken ?? body.totalToken;
    const newTokenBalance = (newBalanceRaw !== undefined && newBalanceRaw !== null && newBalanceRaw !== '')
        ? Number(newBalanceRaw)
        : null;
    if (newTokenBalance !== null && Number.isFinite(newTokenBalance) &&
        options.prevTokenBalance !== undefined && options.prevTokenBalance !== null) {
        const delta = Math.max(0, newTokenBalance - Number(options.prevTokenBalance));
        if (delta > tokenGained) tokenGained = delta;
    }

    const items = [];
    const rawItems = [];
    const itemCounts = {};
    let extraXp = 0;
    let extraGold = 0;

    for (const rawEntry of rawEntries) {
        const parsed = parseRewardEntry(rawEntry);
        if (!parsed) continue;
        if (parsed.kind === 'token') {
            tokenGained += parsed.qty;
            items.push(parsed.label);
            rawItems.push(parsed.raw);
        } else if (parsed.kind === 'xp') {
            extraXp += parsed.qty;
        } else if (parsed.kind === 'gold') {
            extraGold += parsed.qty;
        } else if (parsed.kind === 'item') {
            items.push(parsed.label);
            rawItems.push(parsed.raw);
            const baseName = parsed.label.replace(/\s+x\d+$/, '');
            itemCounts[baseName] = (itemCounts[baseName] || 0) + parsed.qty;
        }
    }

    if (tokenGained > 0 && !items.some(it => /token/i.test(it))) {
        items.push(`${tokenGained} Token`);
    }

    return {
        items,
        rawItems,
        itemCounts,
        tokenGained,
        wonToken: tokenGained > 0,
        newTokenBalance: Number.isFinite(newTokenBalance) ? newTokenBalance : null,
        extraXp,
        extraGold,
        rawRewardFields
    };
}

function appendMissionHistory(filePath, entry) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const nowDate = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const record = Object.assign({
        timestamp: nowDate.toISOString(),
        date: getLocalDateStr(nowDate)
    }, entry);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
    return record;
}

function readMissionHistory(filePath, options = {}) {
    const limit = Math.max(1, Number(options.limit) || 30);
    const filterAccount = options.account ? String(options.account).trim().toLowerCase() : '';
    const filterCharId = options.charId ? String(options.charId).trim() : '';
    const filterDate = options.date ? String(options.date).trim() : '';
    const todayStr = getLocalDateStr();

    const entries = [];
    if (fs.existsSync(filePath)) {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
        for (const ln of lines) {
            const trimmed = ln.trim();
            if (!trimmed) continue;
            try {
                const obj = JSON.parse(trimmed);
                if (filterAccount && String(obj.account || '').toLowerCase() !== filterAccount) continue;
                if (filterCharId && String(obj.charId || '') !== filterCharId) continue;
                if (filterDate && String(obj.date || '') !== filterDate) continue;
                entries.push(obj);
            } catch (_) { /* abaikan baris rusak */ }
        }
    }

    const totals = {
        missions: 0,
        xp: 0,
        gold: 0,
        tokens: 0,
        tokenMatches: 0,
        itemTotals: {},
        byMission: {}
    };
    const today = {
        missions: 0,
        xp: 0,
        gold: 0,
        tokens: 0,
        tokenMatches: 0
    };

    for (const e of entries) {
        const xp = Number(e.xp) || 0;
        const gold = Number(e.gold) || 0;
        const tokens = Number(e.tokens) || 0;

        totals.missions++;
        totals.xp += xp;
        totals.gold += gold;
        totals.tokens += tokens;
        if (tokens > 0) totals.tokenMatches++;

        if (e.date === todayStr) {
            today.missions++;
            today.xp += xp;
            today.gold += gold;
            today.tokens += tokens;
            if (tokens > 0) today.tokenMatches++;
        }

        const mKey = e.missionId || e.missionName || 'unknown';
        if (!totals.byMission[mKey]) {
            totals.byMission[mKey] = {
                missionId: e.missionId || '',
                missionName: e.missionName || mKey,
                count: 0,
                xp: 0,
                gold: 0,
                tokens: 0,
                tokenMatches: 0
            };
        }
        const mStat = totals.byMission[mKey];
        mStat.count++;
        mStat.xp += xp;
        mStat.gold += gold;
        mStat.tokens += tokens;
        if (tokens > 0) mStat.tokenMatches++;

        if (Array.isArray(e.items)) {
            for (const itemLabel of e.items) {
                const s = String(itemLabel || '').trim();
                if (!s || /token/i.test(s) || /gold$/i.test(s)) continue;
                const mQty = s.match(/^(.*?)\s+x(\d+)$/);
                const base = mQty ? mQty[1] : s;
                const qty = mQty ? (Number(mQty[2]) || 1) : 1;
                totals.itemTotals[base] = (totals.itemTotals[base] || 0) + qty;
            }
        }
    }

    return {
        entries,
        recent: entries.slice(-limit),
        totals,
        today,
        todayDate: todayStr
    };
}

function formatSessionHistoryLines(entries, maxLines = 25) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const slice = entries.length > maxLines ? entries.slice(-maxLines) : entries;
    const lines = [];
    if (entries.length > maxLines) {
        lines.push(`  (Menampilkan ${slice.length} dari ${entries.length} misi sesi ini)`);
    }
    for (const e of slice) {
        const timeStr = e.timestamp ? new Date(e.timestamp).toTimeString().slice(0, 8) : '--:--:--';
        const tokPart = e.tokens > 0 ? `+${e.tokens} Token ★` : '-';
        let spinPart = '-';
        if (e.spinReward && e.spinReward !== '-') {
            spinPart = e.spinReward;
        } else if (e.spinRewardRaw === 'item1') {
            spinPart = 'Tidak Roll (item1)';
        }
        const extraList = Array.isArray(e.extraItems) && e.extraItems.length
            ? e.extraItems
            : (Array.isArray(e.items)
                ? e.items.filter(x => !/^\d+\s*Token$/i.test(x) && x !== e.spinReward)
                : []);
        const dropPart = extraList.length ? ` | Drop: ${extraList.map(formatItemName).join(', ')}` : '';
        let scratchPart = '';
        if (e.scratch && e.scratch.checked) {
            if (e.scratch.scratched) {
                scratchPart = ` | Scratch: GRATIS -> ${e.scratch.rewardLabel || '-'}`;
            } else if (e.scratch.bango) {
                scratchPart = ` | Scratch: bango (skip: butuh ${e.scratch.tokenCost || 5} Token)`;
            } else {
                scratchPart = ' | Scratch: tidak trigger (bango=false)';
            }
        }
        lines.push(
            `  #${String(e.battleNo || '-').padEnd(3)} [${timeStr}] ${(e.missionName || e.missionId).padEnd(28)} -> XP +${Number(e.xp || 0).toLocaleString()} | Gold +${Number(e.gold || 0).toLocaleString()} | Token: ${tokPart} | Spin: ${spinPart}${dropPart}${scratchPart}`
        );
    }
    return lines;
}

/**
 * Parse respons RouletteService.scratchCardAtfer20Level (daily_login_4.swf).
 */
function parseScratchCardReward(res) {
    const b = res || {};
    const rewardType = String(b.reward_type || '').trim().toUpperCase();
    const rewardAmount = b.reward_amount !== undefined && b.reward_amount !== null ? String(b.reward_amount).trim() : '';
    const numAmt = Number(rewardAmount);
    const out = {
        status: Number(b.status || 0),
        rewardType,
        rewardAmount,
        rewardLabel: rewardType ? `${rewardType}${rewardAmount ? ' ' + rewardAmount : ''}` : '-',
        tokens: 0,
        gold: 0,
        xp: 0,
        tp: 0,
        sp: 0,
        itemName: '',
        raw: b
    };

    if (!rewardType) return out;
    if (rewardType === 'TOKEN') {
        out.tokens = Number.isFinite(numAmt) ? numAmt : 0;
        out.rewardLabel = `+${out.tokens} Saga Token ★`;
    } else if (rewardType === 'GOLD') {
        out.gold = Number.isFinite(numAmt) ? numAmt : 0;
        out.rewardLabel = `+${out.gold.toLocaleString()} Gold`;
    } else if (rewardType === 'XP%') {
        out.rewardLabel = `+${rewardAmount}% XP`;
    } else if (rewardType === 'XP') {
        out.xp = Number.isFinite(numAmt) ? numAmt : 0;
        out.rewardLabel = `+${out.xp.toLocaleString()} XP`;
    } else if (rewardType === 'TP') {
        out.tp = Number.isFinite(numAmt) ? numAmt : 0;
        out.rewardLabel = `+${out.tp} TP`;
    } else if (rewardType === 'SP') {
        out.sp = Number.isFinite(numAmt) ? numAmt : 0;
        out.rewardLabel = `+${out.sp} SP`;
    } else {
        out.itemName = formatItemName(rewardAmount);
        out.rewardLabel = `${rewardType}: ${out.itemName || rewardAmount || '-'}`;
    }
    return out;
}

module.exports = {
    ITEM_NAMES,
    getLocalDateStr,
    normalizeItemId,
    formatItemName,
    parseRewardEntry,
    parseSGradeFinishReward,
    parseMissionRewards,
    parseScratchCardReward,
    appendMissionHistory,
    readMissionHistory,
    formatSessionHistoryLines
};
