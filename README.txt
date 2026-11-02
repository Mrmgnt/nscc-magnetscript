NINJASAGA BOT - NSCC
cc: MagnetScript(Razki)
==========================================================

CARA PAKAI (Windows)
1. Install Node.js LTS sekali saja: https://nodejs.org/en/download
   (pilih Windows Installer .msi, next-next-finish)
2. Extract semua file ini ke satu folder, misal C:\nscc
3. Klik dua kali nscc.bat
4. Masukkan username + password NinjaSaga
5. Pilih menu 0-15

MENU UTAMA (nscc.bat)
1. Jatah Harian Lengkap (TP + SS + Eudemon Dragon + Claim HH)
   - Pilihan 1: Jatah Harian Murni (Claim Tiket HH + TP + SS + Eudemon Dragon)
     tanpa battle Hunting House & tanpa grinding level
   - Pilihan 2: Jatah Harian + Battle Boss Hunting House
   - Pilihan 3: Jatah Harian + Auto Leveling / Ujian / Grade S

2. TP Training + SS Training
   - TP : msn170-msn174, 10 TP + 2.000 XP + 2.000 gold per misi
   - SS : msn279-msn283, 30 SS + 10.000 XP + 10.000 gold per misi

3. Eudemon Dragon Saja (Boss Hunt Auto Cepat)
   - Otomatis cek sisa kuota per room dari server:
     * Akun Emblem     : 3x lawan per room per hari
     * Akun Non-Emblem : 1x lawan per room per hari
   - Room dengan sisa kuota 0x otomatis di-skip instan.

4. Hunting House Saja
   - Auto Claim Daily Hunting Passport (item509: +5 Free / +10 Emblem)
   - Bisa pilih Claim + Battle Boss Hunting House, atau Claim Saja (Tanpa Battle)

5. Menu Gabungan Hunting House & Eudemon Dragon
   - Pilih mode: Paket Harian (Eudemon + Claim HH), Keduanya Full Battle,
     Eudemon Saja, Hunting House Saja, Claim Saja, atau Cek Status.

6. Misi Grade S (Auto Stamina Runner: Stage 1-5, Lv 80+)
7. Auto Leveling + Ujian Hard (Chunin / Jounin / Sp. Jounin / Sennin)
8. Murni Grinding Misi Grade Level (C / B / A / S)
9. Cek Daftar Misi & Status Selesai (Per Grade)
10. Multi-Account & Multi-Character Runner (accounts.txt)
    - Mendukung multi-akun & multi-karakter (misal Akun 1 Emblem punya >1
      karakter dengan slot "all" atau "1,2", dan Akun 2 & 3 Non-Emblem 1 karakter).
    - Tersedia paket Jatah Harian Full Multi-Akun (TP + SS + Eudemon Dragon
      + Claim Hunting House Tanpa Battle).

MANUAL (kalau mau jalankan per script dari CMD)
  set NS_USER=username
  set NS_PASS=password
  node ns_daily.js --pure
  node ns_hunt.js eudemon 10 4
  node ns_hunt.js house 10 4
  node ns_hunt.js claim
  node ns_hunt.js status
  node ns_train.js tp 5 20
  node ns_train.js ss 5 20
  node ns_multi_manager.js daily
  node ns_state.js

cc: MagnetScript(Razki)
