# Ninja Saga Bot - NSCC (MagnetScript)

> **Automated Ninja Saga Task, Leveling & Multi-Account Automation Tool**  
> Developed & Maintained by **MagnetScript (Razki)**

---

## ⚡ Fitur Utama

- **Reliable Networking**: Transport AMF3 & JSON via subprocess `curl.exe` dengan streaming stdin data biner untuk bypass socket timeout di Windows.
- **Auto Leveling (`ns_level.js`)**:
  - Misi level tertinggi yang terbuka otomatis.
  - Exam otomatis: Chunin (Lv 20), Jounin (Lv 40), Special Jounin (Lv 60), Sennin (Lv 80 - 12 mode hard).
  - Mode retry cerdas: Jika jatah reward XP 0, cooldown otomatis 10-20 menit.
- **Event Battle (`ns_event.js`)**:
  - Kage Apprenticeship & Tengu Goblin (otomatis konsumsi Energy).
  - Halloween Event (otomatis konsumsi Heart).
- **Training TP & SS (`ns_train.js`)**:
  - TP Missions (`msn170` - `msn174`): 10 TP + 2.000 XP + 2.000 Gold per misi.
  - SS Missions (`msn279` - `msn283`): 30 SS + 10.000 XP + 10.000 Gold per misi.
- **Hunting House & Boss Room (`ns_hunt.js`)**:
  - 10 Room boss (Rank C sampai Rank S).
  - Melewati room jika daily limit server tercapai.
- **Pengecekan Status (`ns_state.js`)**:
  - Cek Level, XP, Gold, status misi, dan jatah reward karakter.
- **Preset Loadout Switcher (`ns_loadout.js`)**:
  - Simpan dan ganti preset Skill & Gear (PvP / PvE / Hunting).
- **Multi-Account Manager (`ns_multi_manager.js`)**:
  - Eksekusi massal farming akun dari file daftar akun dengan proteksi anti-spam delay.
- **Account Inspector (`ns_account_inspector.js`)**:
  - Scan multi-akun untuk memeriksa status Level, Gold, Tokens, Ninja Rank, dan inventori.

---

## 🚀 Cara Penggunaan

### 1. Prasyarat
- **Node.js LTS** (v18+ / v20+): [Download Node.js](https://nodejs.org/)
- **Windows OS** dengan `curl.exe` terpasang (bawaan Windows 10/11)

### 2. Menjalankan Menu Interaktif
Jalankan file batch:
```cmd
nscc.bat
```
Masukkan username & password akun Ninja Saga kamu (hanya disimpan di sesi memori, tidak disimpan ke file).

### 3. Menjalankan Mandiri via Terminal (CLI)

```cmd
:: Set credential sesi
set NS_USER=akun_anda
set NS_PASS=password_anda

:: Leveling hingga level 80 dengan interval 10 detik
node ns_level.js 80 10

:: Hanya misi tanpa event/hunting
node ns_level.js 60 8 --only-mission

:: Jalankan event kage / halloween
node ns_event.js all 15

:: Training TP & SS
node ns_train.js tp 5 15
node ns_train.js ss 5 15

:: Hunting House semua room
node ns_hunt.js

:: Cek Status Akun
node ns_state.js
```

---

## 🛡️ Catatan & Keamanan
- Gunakan dengan bijak. Otomasi game memiliki risiko pemblokiran akun.
- Disarankan menggunakan akun sekunder / farming.
- Jangan mengunggah file `accounts.txt` atau kredensial akun ke repository publik.

---

*Copyright &copy; 2026 MagnetScript (Razki)*
