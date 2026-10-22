#!/usr/bin/env node
/** cc: MagnetScript(Razki) */
/**
 * ns_cheat.js — Cheat damage player + HP infinite untuk NinjaSaga
 *
 * Cara kerja:
 *   - Mencari proses Ninja Saga (ninja_saga.exe / flashplayer.exe / plugin-container.exe)
 *   - Scan memori cepat via VirtualQueryEx + ReadProcessMemory:
 *       Pattern asli  : A2 25 E8 07 A3 A2 46 (damage normal ~2000)
 *       Pattern patch : A2 25 A9 A2 A3 A2 46 (damage besar ~42000)
 *   - Patch HANYA byte damage player via WriteProcessMemory
 *   - Musuh di Arena / PvP / Clan Battle TIDAK disentuh
 *
 * Mode:
 *   node ns_cheat.js damage    — aktifkan damage besar player (~42k)
 *   node ns_cheat.js restore   — kembalikan semua patch ke nilai normal
 *   node ns_cheat.js status    — cek apakah patch aktif di memori
 *   node ns_cheat.js all       — aktifkan damage + panduan HP Cheat Engine
 *   node ns_cheat.js hp        — panduan HP tidak habis di Cheat Engine
 */
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const line = s => console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + s);

// Pattern scan untuk lokasi data battle (damage calculation)
const DAMAGE_PATTERN_ORIG  = [0xA2, 0x25, 0xE8, 0x07, 0xA3, 0xA2, 0x46]; // damage normal (2000)
const DAMAGE_PATTERN_PATCH = [0xA2, 0x25, 0xA9, 0xA2, 0xA3, 0xA2, 0x46]; // damage besar (~42k)

// ═══════════════════════════════════════════════════════════════
// HELPER: Cari proses Ninja Saga / Flash Player
// ═══════════════════════════════════════════════════════════════

function cariProses() {
    const target = ['ninja_saga', 'ninjasaga', 'ninja saga', 'flashplayer', 'plugin-container', 'plugin_host', 'pepperflashplayer'];
    try {
        const out = execSync('tasklist /FO CSV /NH 2>nul', { encoding: 'utf8' });
        for (const baris of out.split('\n')) {
            const kol = baris.trim().split(',').map(k => k.replace(/"/g, ''));
            if (!kol[0]) continue;
            const nama = kol[0].toLowerCase();
            if (target.some(t => nama.includes(t))) {
                return { nama: kol[0], pid: Number(kol[1]) };
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Cari Cheat Engine
// ═══════════════════════════════════════════════════════════════

function cariCheatEngine() {
    const paths = [
        'C:\\Program Files\\Cheat Engine\\cheatengine-x86_64.exe',
        'C:\\Program Files\\Cheat Engine\\cheatengine-i386.exe',
        'C:\\Program Files\\Cheat Engine\\Cheat Engine.exe',
        'C:\\Program Files (x86)\\Cheat Engine\\cheatengine-i386.exe',
        'C:\\Program Files (x86)\\Cheat Engine\\Cheat Engine.exe',
        'C:\\Program Files\\Cheat Engine 7.5\\cheatengine-x86_64.exe',
        'C:\\Program Files\\Cheat Engine 7.4\\cheatengine-x86_64.exe',
    ];
    for (const p of paths) if (fs.existsSync(p)) return p;
    try {
        const r = execSync('where cheatengine-x86_64.exe 2>nul', { encoding: 'utf8' });
        if (r.trim()) return r.trim().split('\n')[0].trim();
    } catch (_) { }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// Fast Memory Engine via C# & PowerShell
// ═══════════════════════════════════════════════════════════════

const CS_MEM_SCANNER = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class FastMem {
    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORY_BASIC_INFORMATION {
        public IntPtr BaseAddress;
        public IntPtr AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State;
        public uint Protect;
        public uint Type;
    }

    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] public static extern int VirtualQueryEx(IntPtr hProc, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, int size);
    [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr hProc, IntPtr addr, byte[] buf, int size, out int read);
    [DllImport("kernel32.dll")] public static extern bool WriteProcessMemory(IntPtr hProc, IntPtr addr, byte[] buf, int size, out int written);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern bool VirtualProtectEx(IntPtr hProc, IntPtr addr, int size, uint newProtect, out uint oldProtect);

    public static string ScanAndPatch(int pid, byte[] patternOrig, byte[] patternPatch) {
        IntPtr hProc = OpenProcess(0x0010 | 0x0020 | 0x0008, false, pid);
        if (hProc == IntPtr.Zero) hProc = OpenProcess(0x1F0FFF, false, pid);
        if (hProc == IntPtr.Zero) return "ERROR: Gagal OpenProcess (perlu Run as Administrator)";

        long addr = 0;
        long maxAddr = 0x7FFFFFFF;
        int mbiSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
        int found = 0;
        int patched = 0;
        List<string> logs = new List<string>();

        while (addr < maxAddr) {
            MEMORY_BASIC_INFORMATION mbi;
            if (VirtualQueryEx(hProc, (IntPtr)addr, out mbi, mbiSize) == 0) break;

            long regionSize = mbi.RegionSize.ToInt64();
            if (regionSize <= 0) break;

            bool isCommitted = (mbi.State == 0x1000);
            bool isAccessible = (mbi.Protect == 0x04 || mbi.Protect == 0x20 || mbi.Protect == 0x40);

            if (isCommitted && isAccessible && regionSize < 50 * 1024 * 1024) {
                byte[] buffer = new byte[regionSize];
                int bytesRead = 0;
                if (ReadProcessMemory(hProc, (IntPtr)addr, buffer, (int)regionSize, out bytesRead) && bytesRead >= patternOrig.Length) {
                    for (int i = 0; i <= bytesRead - patternOrig.Length; i++) {
                        bool match = true;
                        for (int j = 0; j < patternOrig.Length; j++) {
                            if (buffer[i + j] != patternOrig[j]) { match = false; break; }
                        }
                        if (match) {
                            found++;
                            IntPtr targetAddr = (IntPtr)(addr + i);
                            uint oldProtect;
                            VirtualProtectEx(hProc, targetAddr, patternPatch.Length, 0x40, out oldProtect);
                            int written = 0;
                            if (WriteProcessMemory(hProc, targetAddr, patternPatch, patternPatch.Length, out written) && written == patternPatch.Length) {
                                patched++;
                                logs.Add("PATCH @ 0x" + targetAddr.ToString("X8"));
                            }
                            VirtualProtectEx(hProc, targetAddr, patternPatch.Length, oldProtect, out oldProtect);
                        }
                    }
                }
            }
            addr += regionSize;
        }

        CloseHandle(hProc);
        logs.Add("SELESAI: ditemukan=" + found + " dipatch=" + patched);
        return string.Join("\\n", logs);
    }

    public static int CountPattern(int pid, byte[] pattern) {
        IntPtr hProc = OpenProcess(0x0010, false, pid);
        if (hProc == IntPtr.Zero) hProc = OpenProcess(0x1F0FFF, false, pid);
        if (hProc == IntPtr.Zero) return -1;

        long addr = 0;
        long maxAddr = 0x7FFFFFFF;
        int mbiSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
        int count = 0;

        while (addr < maxAddr) {
            MEMORY_BASIC_INFORMATION mbi;
            if (VirtualQueryEx(hProc, (IntPtr)addr, out mbi, mbiSize) == 0) break;

            long regionSize = mbi.RegionSize.ToInt64();
            if (regionSize <= 0) break;

            bool isCommitted = (mbi.State == 0x1000);
            bool isAccessible = (mbi.Protect == 0x04 || mbi.Protect == 0x20 || mbi.Protect == 0x40);

            if (isCommitted && isAccessible && regionSize < 50 * 1024 * 1024) {
                byte[] buffer = new byte[regionSize];
                int bytesRead = 0;
                if (ReadProcessMemory(hProc, (IntPtr)addr, buffer, (int)regionSize, out bytesRead) && bytesRead >= pattern.Length) {
                    for (int i = 0; i <= bytesRead - pattern.Length; i++) {
                        bool match = true;
                        for (int j = 0; j < pattern.Length; j++) {
                            if (buffer[i + j] != pattern[j]) { match = false; break; }
                        }
                        if (match) count++;
                    }
                }
            }
            addr += regionSize;
        }

        CloseHandle(hProc);
        return count;
    }
}
`;

function jalankanPatcher(pid, patternOrig, patternPatch, label) {
    const origBytes = patternOrig.join(',');
    const patchBytes = patternPatch.join(',');

    const psScript = `
Add-Type -TypeDefinition @'
${CS_MEM_SCANNER}
'@ -Language CSharp
$res = [FastMem]::ScanAndPatch(${pid}, [byte[]](${origBytes}), [byte[]](${patchBytes}))
Write-Output $res
`;

    line('  Scanning & Patching memori (' + label + ')...');
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        encoding: 'utf8', timeout: 45000
    });
    const stdout = (r.stdout || '').trim();
    if (stdout) {
        for (const baris of stdout.split('\n')) {
            const b = baris.trim();
            if (b) line('  ' + b);
        }
    }
    if (r.stderr && r.stderr.trim()) line('  STDERR: ' + r.stderr.trim().slice(0, 150));
    return stdout.includes('dipatch=') && !stdout.includes('dipatch=0');
}

function cekJumlah(pid, pattern) {
    const bytes = pattern.join(',');
    const psScript = `
Add-Type -TypeDefinition @'
${CS_MEM_SCANNER}
'@ -Language CSharp
$c = [FastMem]::CountPattern(${pid}, [byte[]](${bytes}))
Write-Output $c
`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        encoding: 'utf8', timeout: 30000
    });
    const num = Number((r.stdout || '').trim());
    return isNaN(num) ? -1 : num;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

const mode = (process.argv[2] || 'status').toLowerCase();
line('ns_cheat.js — Cheat damage/HP NinjaSaga (player only)');
line('mode: ' + mode);
line('');

if (mode === 'help' || mode === '--help') {
    console.log('Pakai:');
    console.log('  node ns_cheat.js damage    — aktifkan damage player besar (~42000)');
    console.log('  node ns_cheat.js restore   — kembalikan damage ke normal');
    console.log('  node ns_cheat.js status    — cek status patch memori');
    console.log('  node ns_cheat.js hp        — panduan HP player tidak habis di Cheat Engine');
    console.log('  node ns_cheat.js all       — aktifkan damage + tampilkan panduan HP');
    console.log('');
    console.log('CATATAN PENTING:');
    console.log('  * Patch ini HANYA mempengaruhi damage player di battle PvE');
    console.log('  * Musuh di Arena / PvP / Clan Battle TIDAK terpengaruh');
    console.log('  * Jalankan saat game Ninja Saga (ninja_saga.exe) sedang terbuka');
    process.exit(0);
}

const proses = cariProses();
if (!proses) {
    line('ERROR: Proses game Ninja Saga tidak ditemukan!');
    line('Pastikan game Ninja Saga (ninja_saga.exe) sudah terbuka dan login ke karakter, lalu jalankan lagi.');
    line('');
    line('Proses yang dicari: ninja_saga.exe, flashplayer.exe, plugin-container.exe');
    process.exit(1);
}
line('Proses game ditemukan : ' + proses.nama + ' (PID: ' + proses.pid + ')');
const cePath = cariCheatEngine();
if (cePath) line('Cheat Engine terdeteksi: ' + cePath);
line('');

if (mode === 'status') {
    line('Memeriksa status patch memori PID ' + proses.pid + '...');
    const cntPatch = cekJumlah(proses.pid, DAMAGE_PATTERN_PATCH);
    const cntOrig = cekJumlah(proses.pid, DAMAGE_PATTERN_ORIG);

    if (cntPatch > 0) {
        line('STATUS CHEAT DAMAGE: AKTIF (' + cntPatch + ' lokasi berhasil dipatch ~42000 damage)');
    } else if (cntOrig > 0) {
        line('STATUS CHEAT DAMAGE: NORMAL (' + cntOrig + ' lokasi terdeteksi, damage normal ~2000)');
    } else {
        line('STATUS CHEAT DAMAGE: BELUM SIAP (pastikan Anda sudah masuk ke dalam Desa / Battle)');
    }
    line('');
    line('Pilihan perintah:');
    line('  node ns_cheat.js damage   -> aktifkan damage besar');
    line('  node ns_cheat.js restore  -> kembalikan damage normal');
    process.exit(0);
}

if (mode === 'damage' || mode === 'all') {
    line('=== PATCH DAMAGE BESAR PLAYER ===');
    line('  Pattern asli  : A2 25 E8 07 A3 A2 46 (damage ~2000)');
    line('  Pattern patch : A2 25 A9 A2 A3 A2 46 (damage ~42000)');
    line('  Target proses : ' + proses.nama + ' (PID ' + proses.pid + ')');
    line('');

    const ok = jalankanPatcher(proses.pid, DAMAGE_PATTERN_ORIG, DAMAGE_PATTERN_PATCH, 'DAMAGE PLAYER');
    if (ok) {
        line('');
        line('>>> DAMAGE PLAYER BERHASIL DIPATCH KE ~42.000! <<<');
        line('    Coba masuk ke battle / misi di game, damage serangan Anda sekarang ~42.000!');
    } else {
        // Cek apakah sudah dipatch sebelumnya
        const cntPatch = cekJumlah(proses.pid, DAMAGE_PATTERN_PATCH);
        if (cntPatch > 0) {
            line('');
            line('>>> DAMAGE SUDAH AKTIF SEBELUMNYA (' + cntPatch + ' lokasi sudah dipatch ~42k)! <<<');
        } else {
            line('');
            line('GAGAL: Pattern tidak ditemukan di memori saat ini.');
            line('Tips: Masuk ke dalam karakter / battle terlebih dahulu di game Ninja Saga, lalu coba lagi.');
        }
    }
    line('');
}

if (mode === 'restore') {
    line('=== RESTORE: Kembalikan Damage ke Normal ===');
    line('  Target proses : ' + proses.nama + ' (PID ' + proses.pid + ')');
    line('');

    const ok = jalankanPatcher(proses.pid, DAMAGE_PATTERN_PATCH, DAMAGE_PATTERN_ORIG, 'RESTORE DAMAGE');
    if (ok) {
        line('');
        line('>>> DAMAGE BERHASIL DIKEMBALIKAN KE NILAI ASLI NORMAL (~2000)! <<<');
    } else {
        line('  Tidak ada patch yang aktif atau pattern normal sudah terpasang.');
    }
    line('');
}

if (mode === 'hp' || mode === 'all') {
    line('=== PANDUAN HP TIDAK HABIS (FREEZE HP) ===');
    line('  Untuk HP tidak habis, gunakan Cheat Engine yang sudah terpasang di komputer:');
    line('');
    line('  Langkah mudah di Cheat Engine:');
    line('  1. Buka Cheat Engine');
    line('  2. Klik ikon komputer (Select Process) -> pilih: ' + proses.nama + ' (PID ' + proses.pid + ')');
    line('  3. Di kotak "Value", ketik angka HP karakter Anda saat ini (contoh: 2500) -> Klik "First Scan"');
    line('  4. Masuk battle, biarkan kena serang 1x sehingga HP berkurang');
    line('  5. Ketik angka HP baru Anda -> Klik "Next Scan"');
    line('  6. Double-klik alamat yang tersisa di daftar kiri ke tabel bawah');
    line('  7. Centang kotak "Active" (Freeze) dan ubah nilainya menjadi 99999');
    line('  -> HP Anda akan terkunci di 99999 dan tidak akan habis!');
    line('');
}

line('Selesai.');
