'use strict';
/**
 * lib/ns_energy_scheduler.js - penjadwal rotasi host & energy untuk Co-op Minotaur.
 *
 * - Memilih host dummy berikutnya secara round-robin yang energy >= hostCost.
 * - Melacak energy tiap akun (host & main) sebelum & sesudah match.
 * - Stop bila: energy akun utama < joinCost, atau tidak ada dummy >= hostCost,
 *   atau batas --max-matches tercapai.
 *
 * Catatan: biaya energy host/join dibaca dari quest_list (getPvEServerInit),
 * bukan hardcode (lihat pve_protocol.md #2).
 */
class EnergyScheduler {
    constructor(opts) {
        const unique = new Map();
        for (const account of opts.accounts || []) {
            const key = String(account.username).toLowerCase();
            if (!unique.has(key)) unique.set(key, account);
        }
        this.accounts = [...unique.values()];
        this.accounts.sort((left, right) => Number(right.role === 'host') - Number(left.role === 'host'));
        this.hostCost = opts.hostCost || 25;
        this.joinCost = opts.joinCost || 5;
        this.maxMatches = opts.maxMatches || Infinity;
        this.onEnergyEmpty = opts.onEnergyEmpty || 'stop'; // 'stop' | 'wait'
        this.regrowPerHour = opts.regrowPerHour || 10;
        this.hostCursor = 0;
        this.matches = 0;
        this.hosts = this.accounts;
        this.mains = this.accounts;
    }

    energyOf(a) { return Number.isFinite(a.energy) && a.energy >= 0 ? a.energy : 0; }

    // Pilih dummy host berikutnya (round-robin) dengan energy cukup.
    pickHost() {
        if (!this.hosts.length) return null;
        const n = this.hosts.length;
        for (let i = 0; i < n; i++) {
            const idx = (this.hostCursor + i) % n;
            const h = this.hosts[idx];
            const joiners = this.accounts.filter(account => account !== h);
            if (this.energyOf(h) >= this.hostCost && joiners.length === 2 && joiners.every(account => this.energyOf(account) >= this.joinCost)) {
                this.hostCursor = (idx + 1) % n;
                return h;
            }
        }
        return null;
    }

    // Akun utama masih bisa join?
    mainsCanJoin() { return this.mains.every(m => this.energyOf(m) >= this.joinCost); }

    // Semua host habis?
    hostsExhausted() { return !this.hosts.some(h => this.energyOf(h) >= this.hostCost); }

    // Alasan berhenti (null = lanjut).
    stopReason() {
        if (this.accounts.length !== 3) return 'need_three_unique_accounts';
        if (this.matches >= this.maxMatches) return 'max_matches';
        if (!this.mainsCanJoin()) return 'mains_energy_empty';
        if (this.hostsExhausted()) {
            return this.onEnergyEmpty === 'wait' ? 'wait_regrow' : 'hosts_energy_empty';
        }
        return null;
    }

    // Konsumsi energy setelah match: host -hostCost, tiap main -joinCost.
    consumeEnergy(hostAccount, joiners) {
        if (!this.accounts.includes(hostAccount) || !Array.isArray(joiners) || joiners.length !== 2 || new Set([hostAccount, ...joiners]).size !== 3 || joiners.some(account => !this.accounts.includes(account))) throw new Error('Peserta match harus tiga akun unik');
        if (this.energyOf(hostAccount) < this.hostCost || joiners.some(account => this.energyOf(account) < this.joinCost)) throw new Error('Energy tidak cukup');
        hostAccount.energy = Math.max(0, this.energyOf(hostAccount) - this.hostCost);
        for (const j of (joiners || [])) j.energy = Math.max(0, this.energyOf(j) - this.joinCost);
        this.matches += 1;
    }

    // Rencana rotasi (untuk --dry-run): daftar host per match sampai stop.
    plan() {
        const plan = [];
        const snapshot = this.accounts.map(a => Object.assign({}, a));
        const tmp = new EnergyScheduler({ accounts: snapshot, hostCost: this.hostCost, joinCost: this.joinCost, maxMatches: this.maxMatches, onEnergyEmpty: this.onEnergyEmpty });
        while (!tmp.stopReason()) {
            const h = tmp.pickHost();
            if (!h) break;
            const joiners = tmp.accounts.filter(account => account !== h);
            plan.push({ match: tmp.matches + 1, host: h.username, joiners: joiners.map(account => account.username), hostEnergyBefore: tmp.energyOf(h) });
            tmp.consumeEnergy(h, joiners);
        }
        return plan;
    }
}

module.exports = { EnergyScheduler };

if (require.main === module && process.argv.includes('--selftest')) {
    let fail = 0;
    const eq = (l, g, w) => { const ok = g === w; if (!ok) fail++; console.log((ok ? '  OK   ' : '  FAIL ') + l + (ok ? '' : ' got=' + JSON.stringify(g) + ' want=' + JSON.stringify(w))); };
    console.log('  selftest lib/ns_energy_scheduler.js');

    // Tiga akun unik; role hanya prioritas awal.
    const accts = [
        { role: 'host', username: 'd1', energy: 100, maxEnergy: 100 },
        { role: 'main', username: 'm1', energy: 100, maxEnergy: 100 },
        { role: 'main', username: 'm2', energy: 100, maxEnergy: 100 },
        { role: 'main', username: 'm1', energy: 100, maxEnergy: 100 },
    ];
    const s = new EnergyScheduler({ accounts: accts, hostCost: 25, joinCost: 5, maxMatches: 3 });
    const plan = s.plan();
    eq('dedupe -> 3 matches', plan.length, 3);
    eq('round robin first host', plan[0].host, 'd1');
    eq('round robin second host', plan[1].host, 'm1');
    eq('joiners exclude host', JSON.stringify(plan[0].joiners), '["m1","m2"]');

    // mains habis di 20 match (100/5)
    const s2 = new EnergyScheduler({ accounts: accts.map(a => Object.assign({}, a)), hostCost: 25, joinCost: 5, maxMatches: 3 });
    const p2 = s2.plan();
    eq('maxMatches cap', p2.length, 3);

    // Kurang dari tiga akun unik -> stop.
    const s3 = new EnergyScheduler({ accounts: [{ role: 'host', username: 'd1', energy: 10, maxEnergy: 100 }, { role: 'main', username: 'm1', energy: 100, maxEnergy: 100 }], hostCost: 25, joinCost: 5 });
    eq('host exhausted -> no plan', s3.plan().length, 0);
    eq('stopReason unique accounts', s3.stopReason(), 'need_three_unique_accounts');

    console.log(fail === 0 ? '  SEMUA LULUS' : '  GAGAL: ' + fail);
    process.exit(fail === 0 ? 0 : 1);
}
