@echo off
setlocal EnableExtensions
title NinjaSaga Bot - NSCC
cd /d "%~dp0"

:: Cek Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js belum terpasang di komputer ini.
  echo.
  echo   Install dulu Node.js LTS dari: https://nodejs.org/en/download
  echo   Setelah install, tutup jendela ini lalu jalankan nscc.bat lagi.
  echo.
  pause
  exit /b 1
)

:: Jika dipanggil dari wrapper internal, langsung ke core logic
if "%~1"=="__NSCC_MENU_CORE__" goto MENU_CORE

:: ======================================================================
:: RESILIENT WRAPPER LOOP
:: Saat sedang menjalankan bot, jika user menekan Ctrl+C (atau Q/Esc),
:: CMD tidak akan menutup jendela / keluar dari script.
:: Batch akan otomatis kembali ke menu utama dengan sesi yang tetap tersimpan.
:: Hanya akan keluar jika user memilih Menu '0' (Exit code 99).
:: ======================================================================
:WRAPPER_LOOP
"%COMSPEC%" /c ""%~f0" __NSCC_MENU_CORE__"
set "WRAP_CODE=%ERRORLEVEL%"
if "%WRAP_CODE%"=="99" (
  if exist ".char_env.bat" del ".char_env.bat" >nul 2>nul
  exit /b 0
)
set "NS_RELOAD=1"
:: Bouncing back ke menu jika proses dihentikan
goto WRAPPER_LOOP

:MENU_CORE
:: Muat sesi login & karakter aktif jika sudah ada
if exist "%~dp0.char_env.bat" (
  call "%~dp0.char_env.bat"
)

if not "%NS_USER%"=="" if not "%NS_PASS%"=="" if not "%NS_CHAR_ID%"=="" (
  if "%NS_RELOAD%"=="1" goto MENU
  cls
  echo ======================================================================
  echo                     NINJASAGA BOT - NSCC
  echo                     cc: MagnetScript(Razki)
  echo ======================================================================
  echo   Ditemukan sesi tersimpan sebelumnya:
  echo     Akun     : %NS_USER%
  echo     Karakter : %NS_CHAR_NAME% (Level %NS_CHAR_LEVEL% ^| Slot %NS_CHAR_SLOT%)
  echo ======================================================================
  echo.
  echo   [ 1 ] Lanjut gunakan akun ^& karakter ini
  echo   [ 2 ] Ganti karakter lain di akun ini
  echo   [ 3 ] Login akun baru / ganti akun
  echo.
  set "SESI_OPT="
  set /p "SESI_OPT=Pilih [1/2/3, Enter = 1]: "
  if "%SESI_OPT%"=="2" goto GANTICHAR
  if "%SESI_OPT%"=="3" goto GANTI
  goto MENU
)

:LOGIN
cls
call node ns_select_char.js
if errorlevel 1 (
  echo.
  echo Login gagal atau proses dibatalkan.
  echo Tekan sembarang tombol untuk coba lagi...
  pause >nul
  goto LOGIN
)
if exist "%~dp0.char_env.bat" (
  call "%~dp0.char_env.bat"
)
timeout /t 1 >nul

:MENU
cls
echo ======================================================================
echo                     NINJASAGA BOT - NSCC
echo                     cc: MagnetScript(Razki)
echo ======================================================================
echo   Akun Aktif     : %NS_USER%
if not "%NS_CHAR_NAME%"=="" (
  echo   Karakter Aktif : %NS_CHAR_NAME% (Level %NS_CHAR_LEVEL% ^| Slot %NS_CHAR_SLOT% ^| %NS_CHAR_GENDER%)
)
echo ======================================================================
echo.
echo   [ 1 ] RUTINITAS HARIAN ^& HUNTING
echo         1. Jatah Harian Lengkap (TP + SS + Eudemon Dragon + Claim HH)
echo         2. TP Training ^& SS Training (Jalur Misi Resmi)
echo         3. Eudemon Dragon Saja (Auto 3x Emblem / 1x Free Sampai Habis)
echo         4. Hunting House Saja (Auto Claim 5/10 Tiket + Battle Boss / Claim)
echo         5. Menu Gabungan Hunting House ^& Eudemon Dragon (Semua Mode)
echo.
echo   [ 2 ] EVENT THANKSGIVING 2026
echo         6. Thanksgiving Event (Battle / Mini-game / Full)
echo         7. Capture Protokol Thanksgiving (Developer)
echo.
echo   [ 3 ] MISI ^& GRINDING LEVEL
echo         8. Misi Grade S (Auto Selesaikan Misi 1-4 Sampai Energi Habis)
echo         9. Auto Leveling + Ujian Hard (Chunin / Jounin / Sennin)
echo        10. Murni Grinding Misi Grade Level (C / B / A / S)
echo        11. Cek Daftar Misi ^& Status Selesai (Per Grade)
echo.
echo   [ 4 ] MULTI-ACCOUNT ^& TOOLS
echo        12. Multi-Account ^& Multi-Character Runner (accounts.txt)
echo        13. Dummy Farmer (Auto Register/Login Akun ^& Kirim Gift Harian)
echo        14. Test Local Feed (Multi-Threaded Dev Test)
echo.
echo   [ 5 ] INFORMASI ^& KARAKTER
echo        15. Cek Status Karakter (Level, XP, Gold, Token, Ujian, Hunting, Heart)
echo        16. Ganti Karakter Aktif (Pilih karakter lain di akun ini)
echo        17. Ganti Akun / Logout
echo        18. Auto Live PvP Duel (pvpduel.txt)
echo        19. Auto Co-op Cerberus Public Room (1 Akun)
echo.
echo         0. Keluar
echo ======================================================================
set "PILIH="
set /p "PILIH=Pilih menu [0-19]: "

if "%PILIH%"=="1" goto DAILY
if "%PILIH%"=="2" goto TRAIN
if "%PILIH%"=="3" goto EUDEMON
if "%PILIH%"=="4" goto HUNTINGHOUSE
if "%PILIH%"=="5" goto HUNT
if "%PILIH%"=="6" goto THANKSGIVING
if "%PILIH%"=="7" goto THANKSGIVING_CAPTURE
if "%PILIH%"=="8" goto GRADES
if "%PILIH%"=="9" goto LEVEL
if "%PILIH%"=="10" goto MISSIONONLY
if "%PILIH%"=="11" goto MISSIONS
if "%PILIH%"=="12" goto MULTIMANAGER
if "%PILIH%"=="13" goto DUMMYFARMER
if "%PILIH%"=="14" goto LOCALFEED
if "%PILIH%"=="15" goto STATE
if "%PILIH%"=="16" goto GANTICHAR
if "%PILIH%"=="17" goto GANTI
if "%PILIH%"=="18" goto PVPDUEL
if "%PILIH%"=="19" goto COOPCERBERUS
if "%PILIH%"=="0" goto END
goto MENU

:DAILY
cls
echo ======================================================================
echo       JATAH HARIAN LENGKAP (TP + SS + EUDEMON DRAGON + CLAIM HH)
echo ======================================================================
echo   Pilih paket rutinitas harian yang ingin dijalankan:
echo     1. Jatah Harian Murni (Claim Tiket HH + TP + SS + Eudemon Dragon)
echo        [Tanpa battle Hunting House ^& tanpa grinding misi level]
echo     2. Jatah Harian + Sekalian Battle Boss Hunting House
echo     3. Jatah Harian + Lanjut Auto Leveling / Ujian / Grade S
echo     4. Jatah Harian + Thanksgiving Battle
echo     5. Jatah Harian + Thanksgiving Mini-game
echo     6. Jatah Harian + Thanksgiving Full Event
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "DOPT="
set /p "DOPT=Pilih mode [1-6, Enter = 1]: "
if "%DOPT%"=="" set "DOPT=1"
echo.
if "%DOPT%"=="1" (
  node ns_daily.js --pure
) else if "%DOPT%"=="2" (
  node ns_daily.js --pure --with-hh-battle
) else if "%DOPT%"=="3" (
  set "TARGET="
  set /p "TARGET=Target naik level berapa? (kosong = 100, misal: 60/80/100): "
  echo.
  if "%TARGET%"=="" (
    node ns_daily.js
  ) else (
    node ns_daily.js --level %TARGET%
  )
) else if "%DOPT%"=="4" (
  node ns_daily.js --pure --with-thanksgiving-battle
) else if "%DOPT%"=="5" (
  node ns_daily.js --pure --with-thanksgiving-minigame
) else if "%DOPT%"=="6" (
  node ns_daily.js --pure --with-thanksgiving-full
) else (
  node ns_daily.js --pure
)
echo.
pause
goto MENU

:TRAIN
cls
echo ======================================================================
echo                     TP + SS TRAINING
echo ======================================================================
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
node ns_train.js all 5 15
echo.
pause
goto MENU

:EUDEMON
cls
echo ======================================================================
echo          EUDEMON DRAGON / GARDEN (AUTO 3X EMBLEM / 1X FREE)
echo ======================================================================
echo   - Otomatis mendeteksi kuota harian per room dari server:
echo       * Akun Emblem     : 3x lawan per boss per hari
echo       * Akun Non-Emblem : 1x lawan per boss per hari
echo   - Room yang jatahnya sudah habis (0x) otomatis di-skip instan.
echo   - Menyelesaikan seluruh sisa jatah di semua room sampai tuntas (0x).
echo.
echo   1. Jalankan Farming Eudemon Dragon Sekarang (Sampai Habis)
echo   2. Lihat Status Room Eudemon Dragon ^& Hunting House
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "EUD="
set /p "EUD=Pilih [1/2, Enter = 1] : "
echo.
if "%EUD%"=="2" (
  node ns_hunt.js status
) else (
  node ns_hunt.js eudemon 10 11
)
echo.
pause
goto MENU

:HUNTINGHOUSE
cls
echo ======================================================================
echo        HUNTING HOUSE (AUTO CLAIM DAILY PASSPORT + BATTLE BOSS)
echo ======================================================================
echo   - Auto Claim Daily Hunting Passport (item509):
echo       * Free User   : +5 Tiket Hunting per hari
echo       * Emblem User : +10 Tiket Hunting per hari
echo   - Battle Boss Hunting House (Zone 1-6: Ginkaku s/d Tsuchigumo)
echo     menggunakan tiket Hunting Passport yang dimiliki.
echo.
echo   1. Auto Claim Daily Passport + Battle Boss Hunting House
echo   2. Auto Fight Boss Hunting House Saja (Tanpa Claim Daily)
echo   3. Claim Daily Hunting Passport Saja (Tanpa Battle)
echo   4. Lihat Status Tiket ^& Boss Hunting House
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "HHO="
set /p "HHO=Pilih [1/2/3/4, Enter = 1] : "
echo.
if "%HHO%"=="2" (
  node ns_hunt.js fight 10 11
) else if "%HHO%"=="3" (
  node ns_hunt.js claim
) else if "%HHO%"=="4" (
  node ns_hunt.js status
) else (
  node ns_hunt.js house 10 11
)
echo.
pause
goto MENU

:HUNT
cls
echo ======================================================================
echo          MENU GABUNGAN HUNTING HOUSE ^& EUDEMON DRAGON
echo ======================================================================
echo   1. Paket Harian: Eudemon Dragon + Claim Hunting House (Tanpa Battle HH)
echo   2. Keduanya Lengkap: Claim HH + Battle Hunting House + Eudemon Dragon
echo   3. Eudemon Dragon Saja (Auto 3x Emblem / 1x Free)
echo   4. Hunting House Saja (Auto Claim + Battle Boss Hunting House)
echo   5. Claim Daily Hunting House Passport Saja (Tanpa Battle)
echo   6. Lihat Daftar Room ^& Status Tiket (Status)
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "HNT="
set /p "HNT=Pilih [1-6, Enter = 1] : "
echo.
if "%HNT%"=="2" (
  node ns_hunt.js both 10 11
) else if "%HNT%"=="3" (
  node ns_hunt.js eudemon 10 11
) else if "%HNT%"=="4" (
  node ns_hunt.js house 10 11
) else if "%HNT%"=="5" (
  node ns_hunt.js claim
) else if "%HNT%"=="6" (
  node ns_hunt.js status
) else (
  node ns_hunt.js daily 10 11
)
echo.
pause
goto MENU

:THANKSGIVING
cls
echo ======================================================================
echo                    THANKSGIVING EVENT 2026
echo                     cc: MagnetScript(Razki)
echo ======================================================================
echo   1. Cek Status Event
echo   2. Auto Battle: rotasi 5 musuh sampai Heart habis
echo   3. Auto Mini-game: habiskan Ammo termasuk Werewolf
echo   4. Full Event: Battle lalu Mini-game
echo     0. Kembali ke Menu Utama
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "TG_OPT="
set /p "TG_OPT=Pilih mode [0-4, default: 1]: "
if "%TG_OPT%"=="" set "TG_OPT=1"
if "%TG_OPT%"=="0" goto MENU
if "%TG_OPT%"=="1" node ns_thanksgiving.js status
if "%TG_OPT%"=="2" node ns_thanksgiving.js battle
if "%TG_OPT%"=="3" node ns_thanksgiving.js minigame
if "%TG_OPT%"=="4" node ns_thanksgiving.js full
echo.
pause
goto THANKSGIVING

:THANKSGIVING_CAPTURE
cls
echo ======================================================================
echo                CAPTURE PROTOKOL THANKSGIVING
echo                     cc: MagnetScript(Razki)
echo ======================================================================
echo   1. Live Capture Runtime AIR (Proxy Lokal 127.0.0.1:8888)
echo   2. Import ^& Decode Fiddler Classic (.saz / .har / .jsonl)
echo   0. Kembali ke Menu Utama
echo.
set "TGC_OPT="
set /p "TGC_OPT=Pilih mode [0-2, default: 1]: "
if "%TGC_OPT%"=="" set "TGC_OPT=1"
if "%TGC_OPT%"=="0" goto MENU
if "%TGC_OPT%"=="1" (
  node tools\capture_thanksgiving_amf.js
) else if "%TGC_OPT%"=="2" (
  set "SAZ_PATH="
  set /p "SAZ_PATH=Masukkan path file .saz/.har/.jsonl: "
  if not "%SAZ_PATH%"=="" node tools\import_thanksgiving_saz.js "%SAZ_PATH%"
)
echo.
pause
goto MENU

:GRADES
cls
echo ======================================================================
echo       MISI GRADE S (MAP MISI 1 s/d 4 - AUTO ENERGY / STAMINA RUNNER)
echo                     cc: MagnetScript(Razki)
echo ======================================================================
echo   Misi Grade S menggunakan sistem stamina / energi (-12 Stamina per battle)
echo   dan memberikan XP serta Gold masif untuk karakter Level 80+:
echo     - Misi 1 (Stage 1, Min Lv 80) : XP 82.700  ^| Gold 5.000 ^| -12 Energi
echo     - Misi 2 (Stage 2, Min Lv 81) : XP 88.600  ^| Gold 5.300 ^| -12 Energi
echo     - Misi 3 (Stage 3, Min Lv 82) : XP 92.580  ^| Gold 5.500 ^| -12 Energi
echo     - Misi 4 (Stage 4, Min Lv 83) : XP 95.430  ^| Gold 5.600 ^| -12 Energi
echo     - Stage 5 (Bonus, Min Lv 84)  : XP 100.000 ^| Gold 5.900 ^| -12 Energi
echo.
echo   Fitur:
echo     - Menyelesaikan semua Misi 1-4 secara berurutan setiap hari sampai energi habis
echo     - Mengumpulkan (collect) semua prize / drop reward after match
echo     - Counter Saga Token sesi tampil tiap battle; token hanya tercatat bila server memberi reward
echo.
echo   Pilih Mode yang ingin dimainkan:
echo     1. Selesaikan Semua Misi 1-4 Sampai Energi Habis [RECOMMENDED]
echo     2. Scheduler Harian Loop (Habiskan Misi 1-4, standby tunggu refill)
echo     3. Misi Tertentu Saja (Pilih Stage 1, 2, 3, 4, atau 5)
echo     4. Spam Satu Misi Terus (Pilih Stage 1-5, stop manual)
echo     0. Kembali ke Menu Utama
echo.
set "GS_MODE="
set /p "GS_MODE=Pilihan Mode [0-4, default: 1]: "
if "%GS_MODE%"=="" set "GS_MODE=1"
if "%GS_MODE%"=="0" goto MENU
if "%GS_MODE%"=="3" goto GRADES_PICK
if "%GS_MODE%"=="4" goto GRADES_SPAM

set "JDA="
set /p "JDA=Jeda antar battle dalam detik (default: 8s): "
if "%JDA%"=="" set "JDA=8"
echo.
if "%GS_MODE%"=="2" (
  node ns_grade_s.js loop %JDA%
) else (
  node ns_grade_s.js 1-4 %JDA%
)
echo.
pause
goto MENU

:GRADES_PICK
echo.
echo   Pilih Stage yang ingin dimainkan:
echo     1. Misi 1 (Stage 1, Min Lv 80)
echo     2. Misi 2 (Stage 2, Min Lv 81 - Story Genin)
echo     3. Misi 3 (Stage 3, Min Lv 82)
echo     4. Misi 4 (Stage 4, Min Lv 83)
echo     5. Stage 5 (Bonus, Min Lv 84)
echo.
set "STG="
set /p "STG=Pilihan Stage [1-5, default: 1]: "
if "%STG%"=="" set "STG=1"
set "JDA="
set /p "JDA=Jeda antar battle dalam detik (default: 8s): "
if "%JDA%"=="" set "JDA=8"
echo.
node ns_grade_s.js %STG% %JDA%
echo.
pause
goto MENU

:GRADES_SPAM
cls
echo ======================================================================
echo                SPAM SATU MISI GRADE S - LOOP MANUAL STOP
echo ======================================================================
echo   Pilih Stage. Bot menjalankan stage sama sampai energi habis,
echo   menunggu refill, lalu lanjut lagi. Berhenti: Ctrl+C.
echo.
echo     1. Misi 1 (Stage 1, Min Lv 80)
echo     2. Misi 2 (Stage 2, Min Lv 81)
echo     3. Misi 3 (Stage 3, Min Lv 82)
echo     4. Misi 4 (Stage 4, Min Lv 83)
echo     5. Stage 5 (Bonus, Min Lv 84)
echo.
set "STG="
set /p "STG=Pilihan Stage [1-5, default: 1]: "
if "%STG%"=="" set "STG=1"
set "JDA="
set /p "JDA=Jeda antar battle dalam detik (default: 8s): "
if "%JDA%"=="" set "JDA=8"
echo.
node ns_grade_s.js spam %STG% %JDA%
echo.
pause
goto MENU

:LEVEL
cls
echo ======================================================================
echo               AUTO LEVELING + UJIAN HARD OTOMATIS
echo ======================================================================
echo   Menaikkan level karakter secara bertahap:
echo     - Misi level tertinggi yang tersedia
echo     - Ujian Chunin / Jounin / Sp. Jounin / Sennin diselesaikan otomatis
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "TARGET="
set /p "TARGET=Target Level (misal: 60 / 80 / 100, default: 100): "
if "%TARGET%"=="" set "TARGET=100"
set "JEDA="
set /p "JEDA=Jeda antar misi dalam detik (default: 8s): "
if "%JEDA%"=="" set "JEDA=8"
echo.
node ns_level.js %TARGET% %JEDA%
echo.
pause
goto MENU

:MISSIONONLY
cls
echo ======================================================================
echo             MURNI GRINDING MISI GRADE LEVEL (C / B / A / S)
echo ======================================================================
echo.
echo   Urutan:
echo     (1) Misi Grade (C/B/A/S) level tertinggi karakter, naik terus
echo     (2) Ujian Chunin/Jounin/Special Jounin/Sennin SELALU HARD MODE
echo     (3) Murni misi grade (tanpa Hunting / Daily lain)
echo   Setiap level 20/40/60/80 ujian diselesaikan dulu sebelum lanjut.
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "TARGET="
set /p "TARGET=Mau naik sampai level berapa? (kosong = 100) : "
if "%TARGET%"=="" set "TARGET=100"
echo.
node ns_level.js %TARGET% 8 --only-mission --no-event
echo.
pause
goto MENU

:MISSIONS
cls
echo ======================================================================
echo                      DAFTAR MISI PER GRADE
echo ======================================================================
echo   Grade di data server: C / B / A / S / E / D
set "GRD="
set /p "GRD=Pilih Grade (C/B/A/S, kosong = ringkasan semua) : "
echo.
node ns_mission.js %GRD%
echo.
pause
goto MENU

:STATE
cls
node ns_state.js
echo.
pause
goto MENU

:GANTICHAR
cls
set "NS_FORCE_SELECT=1"
call node ns_select_char.js
if exist "%~dp0.char_env.bat" (
  call "%~dp0.char_env.bat"
)
set "NS_FORCE_SELECT="
goto MENU

:GANTI
if exist ".char_env.bat" del ".char_env.bat" >nul 2>nul
set "NS_USER="
set "NS_PASS="
set "NS_CHAR_ID="
set "NS_CHAR_NAME="
set "NS_CHAR_LEVEL="
set "NS_CHAR_GENDER="
set "NS_CHAR_SLOT="
set "NS_FORCE_SELECT="
set "NS_RELOAD="
goto LOGIN

:DUMMYFARMER
cls
node ns_dummy_farmer.js
echo.
pause
goto MENU

:LOCALFEED
cls
echo ======================================================================
echo                         TEST LOCAL FEED
echo ======================================================================
echo   Target : https://ninjasaga.cc/?feed=XXXXXXXX
echo   Mode   : login akun, 5 request paralel, jeda batch 3 detik.
echo   Tekan Ctrl+C untuk menghentikan pengujian.
echo.
node ns_local_feed_test.js
echo.
pause
goto MENU

:MULTIMANAGER
cls
echo ======================================================================
echo             MULTI-ACCOUNT ^& MULTI-CHARACTER BULK RUNNER
echo ======================================================================
echo   Menjalankan akun dan karakter dari accounts.txt secara otomatis
echo   dengan jeda aman tanpa saling bertabrakan sesi login.
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
node ns_multi_manager.js
echo.
pause
goto MENU

:COOPCERBERUS
cls
echo ======================================================================
echo              AUTO CO-OP CERBERUS - PUBLIC ROOM
echo ======================================================================
echo   Config : coop_accounts.txt
echo   Format : main:username:password:slot
echo   Syarat : room punya player lain; Emblem dicek bila status dikirim server.
echo.
echo   [ 1 ] Auto quickmatch: cari dan join room Cerberus publik
echo   [ 2 ] Create room: host, kick pemain Lv ^< 80, start saat 3 pemain ready
echo   [ 0 ] Kembali
echo.
set "COOP_OPT="
set /p "COOP_OPT=Pilih [0-2]: "
if "%COOP_OPT%"=="1" node ns_coop_minotaur.js --accounts coop_accounts.txt
if "%COOP_OPT%"=="2" node ns_coop_minotaur.js --host-room --headful --min-level 80 --accounts coop_accounts.txt

if "%COOP_OPT%"=="0" goto MENU
echo.
pause
goto MENU

:PVPDUEL
cls
echo ======================================================================
echo                        AUTO LIVE PVP DUEL
echo ======================================================================
echo   Config : pvpduel.txt
echo   Format : winner:username:password:characterSlot
echo            loser:username:password:characterSlot
echo   Option : loserAction:dodge ^| loserAction:pass
echo.
echo   Winner menyerang otomatis. pass lebih cepat, dodge mode default.
echo   Loop berjalan sampai Q, Esc, atau Ctrl+C. Tidak memakai rematch.
echo.
node ns_pvp_duel.js
echo.
pause
goto MENU

:END
if exist ".char_env.bat" del ".char_env.bat" >nul 2>nul
exit /b 99
