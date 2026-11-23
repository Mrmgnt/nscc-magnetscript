# Ninja Saga Bot - NSCC (MagnetScript)

> **Automated Ninja Saga Task, Leveling & Multi-Account Automation Tool**  
> Developed & Maintained by **MagnetScript (Razki)**

---

## ⚡ Fitur Utama

- **Reliable Networking**: Transport AMF3 & JSON via subprocess `curl.exe` dengan streaming stdin data biner untuk bypass socket timeout di Windows.
- **Eudemon Dragon (`ns_hunt.js eudemon`)**:
  - 10 Room boss (Rank C sampai Rank S).
  - Otomatis mendeteksi jatah harian per room: **3x lawan untuk Akun Emblem**, **1x lawan untuk Akun Free**.
  - Eksekusi dipercepat: otomatis skip room instan jika kuota `0x` atau belum terbuka.
- **Hunting House (`ns_hunt.js house` / `claim`)**:
  - Otomatis klaim **Daily Hunting Passport (`item509`)**: +5 Tiket untuk Free User, +10 Tiket untuk Emblem User.
  - Mode **Claim Saja** (`claim`) atau **Claim + Battle Boss Hunting House** (`house` — Zone 1 s/d 6: Ginkaku & Kinkaku s/d Tsuchigumo).
- **Training TP & SS (`ns_train.js`)**:
  - TP Missions (`msn170` - `msn174`): 10 TP + 2.000 XP + 2.000 Gold per misi.
  - SS Missions (`msn279` - `msn283`): 30 SS + 10.000 XP + 10.000 Gold per misi.
- **Auto Leveling (`ns_level.js`) & Misi Grade S (`ns_grade_s.js`)**:
  - Misi level tertinggi yang terbuka otomatis.
  - Exam otomatis: Chunin (Lv 20), Jounin (Lv 40), Special Jounin (Lv 60), Sennin (Lv 80 - 12 mode hard).
  - Misi Grade S Stage 1-5 (Lv 80+, 82k-100k XP per battle).
- **Auto Thanksgiving 2026 Event (`ns_thanksgiving.js` & Scheduler)**:
  - Panel `Popup_Thanksgiving_2015_Menu` / `thanksgiving_battle` (rotasi 5 boss: `enemy477` Giant Rainbow Turkey, `enemy478` Monster Pumpkin, `enemy479` Cranberry Fairy, `enemy480` Human Face Yam, `enemy481` Giant Corn Humanoid) + Mini-game Werewolf (`Panel_thanksgiving_2015_MinigameCover` / `Popup_Thanksgiving_2015_mini_game`).
  - Klaim reward resmi server: Battle (`item918`-`item922`, `item925` Turkey Coin, +30.000 XP, +30.000 Gold) dan Mini-game Werewolf (`item923` Wolf Teeth, `item924` Gunpowder).
  - Mendukung mode `status`, `battle`, `minigame`, `full`, scheduler `loop`, serta multi-akun melalui `ns_multi_manager.js` (`thanksgiving_battle`, `thanksgiving_minigame`, `thanksgiving_full`).
- **Auto Co-op Hunting Minotaur Extreme (`ns_coop_minotaur.js`)**:
  - Tiga akun unik: host round-robin, dua akun lain join; duplikat host/main digabung.
  - Captcha slider/drag melalui Edge masih eksperimental; rotate/grid berhenti tanpa menebak.
  - Hasil dan energy server dicatat ke `coop_report.json`; tidak ada pembelian energy.
- **Multi-Account & Multi-Character Manager (`ns_multi_manager.js`)**:
  - Eksekusi massal farming seluruh akun dan karakter dari file `accounts.txt`.
  - Mendukung akun Emblem dengan banyak karakter (`slot = all` atau `1,2` atau per baris) maupun akun Free 1 karakter.
  - Paket **Jatah Harian Full Multi-Akun**: TP Training + SS Training + Eudemon Dragon (3x Emblem / 1x Free) + Claim Daily Hunting House (tanpa battle).
  - Menyimpan ringkasan eksekusi ke `multi_manager_report.json`.
- **Pengecekan Status (`ns_state.js`) & Account Inspector (`ns_account_inspector.js`)**:
  - Cek Level, XP, Gold, Saga Tokens, Ninja Rank, Tiket Hunting Passport (`item509`), status klaim harian, dan sisa kuota Eudemon Dragon.

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

### 3. Menjalankan Mandiri via Terminal (CLI)

#### Kredensial Akun Tunggal:
```cmd
set NS_USER=akun_anda
set NS_PASS=password_anda
```

#### Hunting House & Eudemon Dragon (`ns_hunt.js`):
```cmd
:: Eudemon Dragon saja (Auto 3x Emblem / 1x Free, cepat)
node ns_hunt.js eudemon 10 4

:: Hunting House saja (Auto Claim 5/10 Tiket + Battle Boss Hunting House)
node ns_hunt.js house 10 4

:: Claim Daily Hunting House Passport saja (Tanpa Battle)
node ns_hunt.js claim

:: Paket Harian (Claim Daily Hunting House + Battle Eudemon Dragon, tanpa battle HH)
node ns_hunt.js daily 10 4

:: Keduanya Lengkap (Claim HH + Battle HH + Battle Eudemon Dragon)
node ns_hunt.js both 10 4

:: Cek Status Tiket, Boss Hunting House, dan Kuota Eudemon Dragon
node ns_hunt.js status
```

#### Jatah Harian (`ns_daily.js`) & Training (`ns_train.js`):
```cmd
:: Jatah Harian Murni (Claim HH + TP + SS + Eudemon Dragon, tanpa battle HH & tanpa leveling)
node ns_daily.js --pure

:: Jatah Harian + Sekalian Battle Boss Hunting House
node ns_daily.js --pure --with-hh-battle

:: Jatah Harian Lengkap + Auto Leveling hingga level 80
node ns_daily.js --level 80

:: Training TP & SS saja
node ns_train.js tp 5 15
node ns_train.js ss 5 15
```

#### Multi-Account & Multi-Character Farming (`ns_multi_manager.js`):
Siapkan file `accounts.txt` (contoh ada di `accounts.example.txt`):
```text
# Akun 1 (Emblem, punya >1 karakter -> gunakan "all" agar semua karakter otomatis dijalankan)
akun1_emblem:password123:80:all

# Akun 2 & 3 (Non-Emblem, 1 karakter)
akun2_free:password456:80:1
akun3_free:password789:100:1
```
Jalankan aksi farming massal:
```cmd
:: Menu interaktif Multi-Account
node ns_multi_manager.js

:: Jatah Harian Full Multi-Akun (TP + SS + Eudemon Dragon + Claim HH Tanpa Battle)
node ns_multi_manager.js daily --delay 6

:: Jatah Harian Full + Battle Hunting House
node ns_multi_manager.js daily_hh --delay 6

:: Eudemon Dragon saja untuk semua akun/karakter
node ns_multi_manager.js eudemon --delay 6

:: Hunting House saja (Claim + Battle) untuk semua akun/karakter
node ns_multi_manager.js house --delay 6

:: Claim Daily Hunting House saja (Tanpa Battle) untuk semua akun/karakter
node ns_multi_manager.js claim --delay 5
```

#### Thanksgiving 2026 Event & Scheduler (`ns_thanksgiving.js` / `ns_event.js`):
```cmd
:: Cek Status Battle Heart, Werewolf Bullet & Waktu Refill
node ns_thanksgiving.js status

:: Jalankan Auto Battle (rotasi 5 musuh sampai Heart habis, atau maks N battle)
node ns_thanksgiving.js battle
node ns_thanksgiving.js battle 1

:: Jalankan Auto Mini-game Werewolf (sampai Bullet habis, atau maks N run)
node ns_thanksgiving.js minigame
node ns_thanksgiving.js minigame 1

:: Jalankan Full Event (1 Battle + 1 Mini-game Werewolf, atau habiskan semua)
node ns_thanksgiving.js full 1 1
node ns_thanksgiving.js full

:: Scheduler Loop Akun Aktif (otomatis tunggu timer refill lalu lanjut lagi)
node ns_thanksgiving.js loop full
```


#### Auto Co-op Hunting Minotaur Extreme (`ns_coop_minotaur.js`):
```cmd
:: Satu akun. Hanya membaca room list, tanpa join.
node ns_coop_minotaur.js --dry-run --accounts coop_accounts.txt

:: Join room publik Minotaur Extreme. Bot tidak membuat room atau pakai dummy.
node ns_coop_minotaur.js --max-matches 1 --headful

:: Capture battle satu room tanpa mengirim skill.
node ns_coop_minotaur.js --capture-battle --max-matches 1 --headful
```
Isi file `coop_accounts.txt` (contoh: `coop_accounts.example.txt`):
```text
main:akun:pass:1
```
Akun bot boleh Free atau Emblem. Room harus sudah memiliki sedikitnya satu player Emblem lain.
Host tidak harus Emblem. Player Emblem lain harus tetap ada sebelum battle dimulai.
Bot meninggalkan room bila kick, player Emblem lain keluar, atau host belum mulai dalam 50 detik.
Quick Match belum dipakai karena command PvE belum tervalidasi. Mode loop mengirim Seal ke head, AoE atau stun ke left hand, lalu merotasi skill terkuat.

---

*Copyright &copy; 2026 MagnetScript (Razki)*
