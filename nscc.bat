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
if exist ".char_env.bat" (
  call ".char_env.bat"
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
if exist ".char_env.bat" (
  call ".char_env.bat"
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
echo   [ 1 ] RUTINITAS HARIAN ^& EVENT
echo         1. Jatah Harian Lengkap (Daily TP/SS + Hunt + Event)
echo         2. Event Battle (Halloween Furious Zombie + Tengu / Kage)
echo         3. TP Training ^& SS Training (Jalur Misi Resmi)
echo         4. Hunting House / Eudemon Garden (Boss Hunt Auto)
echo.
echo   [ 2 ] MISI ^& GRINDING LEVEL
echo         5. Misi Grade S (Auto Stamina Runner: Stage 1-5, XP 80k-100k)
echo         6. Auto Leveling + Ujian Hard (Chunin / Jounin / Sennin)
echo         7. Murni Grinding Misi Grade Level (C / B / A / S)
echo         8. Cek Daftar Misi ^& Status Selesai (Per Grade)
echo.
echo   [ 3 ] INFORMASI ^& KARAKTER
echo         9. Cek Status Karakter (Level, XP, Gold, Token, Event Item)
echo        10. Ganti Karakter Aktif (Pilih karakter lain di akun ini)
echo        11. Ganti Akun / Logout
echo.
echo   [ 4 ] TOOLS ^& PENGUJIAN
echo        12. Memory Patch Cheat (Damage Tinggi ^& Infinite HP PvE)
echo        13. Dummy Farmer (Auto Create Akun ^& Kirim Gift Harian)
echo        14. Test Local Feed (Multi-Threaded Dev Test)
echo        15. Multi-Account ^& Multi-Character Runner (accounts.txt)
echo.
echo         0. Keluar
echo ======================================================================
set "PILIH="
set /p "PILIH=Pilih menu [0-15]: "

if "%PILIH%"=="1" goto DAILY
if "%PILIH%"=="2" goto EVENT
if "%PILIH%"=="3" goto TRAIN
if "%PILIH%"=="4" goto HUNT
if "%PILIH%"=="5" goto GRADES
if "%PILIH%"=="6" goto LEVEL
if "%PILIH%"=="7" goto MISSIONONLY
if "%PILIH%"=="8" goto MISSIONS
if "%PILIH%"=="9" goto STATE
if "%PILIH%"=="10" goto GANTICHAR
if "%PILIH%"=="11" goto GANTI
if "%PILIH%"=="12" goto CHEAT
if "%PILIH%"=="13" goto DUMMYFARMER
if "%PILIH%"=="14" goto LOCALFEED
if "%PILIH%"=="15" goto MULTIMANAGER
if "%PILIH%"=="0" goto END
goto MENU

:DAILY
cls
echo ======================================================================
echo              JATAH HARIAN LENGKAP (DAILY + EVENT + HUNT)
echo ======================================================================
echo   Menjalankan seluruh rutinitas harian otomatis:
echo     1. Special Event : Kage Apprenticeship ^& Halloween Furious Zombie
echo     2. Daily Mission : TP Training ^& SS Training
echo     3. Hunting House : Eudemon Garden
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "TARGET="
set /p "TARGET=Tambah target naik level? (kosong = hanya jatah harian, misal: 80/100): "
echo.
if "%TARGET%"=="" (
  node ns_daily.js
) else (
  node ns_daily.js --level %TARGET%
)
echo.
pause
goto MENU

:EVENT
cls
echo ======================================================================
echo                       EVENT BATTLE
echo ======================================================================
echo   1. Halloween Furious Zombie + Tengu Goblin (Semua)
echo   2. Tengu Goblin / Kage Apprenticeship saja
echo   3. Halloween / Furious Zombie saja
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "EV="
set /p "EV=Pilih (1/2/3, kosong = 1) : "
echo.
if "%EV%"=="2" (
  node ns_event.js kage 20
) else if "%EV%"=="3" (
  node ns_event.js halloween 10
) else (
  node ns_event.js all 20
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
node ns_train.js tp 5 20
echo.
node ns_train.js ss 5 20
echo.
pause
goto MENU

:HUNT
cls
echo ======================================================================
echo                 HUNTING HOUSE / EUDEMON GARDEN
echo ======================================================================
echo   1. Lihat daftar room (Status)
echo   2. Jalankan semua room (Auto Hunt)
echo.
echo   Tips: Tekan [Q] atau [Ctrl+C] kapan saja untuk berhenti ke menu.
echo.
set "HNT="
set /p "HNT=Pilih (1/2, kosong = 2) : "
echo.
if "%HNT%"=="1" (
  node ns_hunt.js status
) else (
  node ns_hunt.js run 10 20
)
echo.
pause
goto MENU

:GRADES
cls
echo ======================================================================
echo             MISI GRADE S (AUTO STAMINA RUNNER - STAGE 1 s/d 5)
echo ======================================================================
echo   Misi Grade S menggunakan sistem stamina (-12 Stamina per battle)
echo   dan memberikan XP serta Gold masif untuk karakter Level 80+:
echo     - Stage 1 (Lv 80+) : XP 82.700  ^| Gold 5.000 ^| -12 Stamina
echo     - Stage 2 (Lv 81+) : XP 88.600  ^| Gold 5.300 ^| -12 Stamina
echo     - Stage 3 (Lv 82+) : XP 92.580  ^| Gold 5.500 ^| -12 Stamina
echo     - Stage 4 (Lv 83+) : XP 95.430  ^| Gold 5.600 ^| -12 Stamina
echo     - Stage 5 (Lv 84+) : XP 100.000 ^| Gold 5.900 ^| -12 Stamina
echo.
echo   Pilih Stage yang ingin dimainkan:
echo     0. Auto (Pilih stage tertinggi yang memenuhi level)
echo     1. Stage 1 (Min Lv 80)
echo     2. Stage 2 (Min Lv 81 - Story Genin)
echo     3. Stage 3 (Min Lv 82)
echo     4. Stage 4 (Min Lv 83)
echo     5. Stage 5 (Min Lv 84)
echo.
set "STG="
set /p "STG=Pilihan Stage [0-5, default: 0]: "
if "%STG%"=="" set "STG=0"
set "JDA="
set /p "JDA=Jeda antar battle dalam detik (default: 8s): "
if "%JDA%"=="" set "JDA=8"
echo.
if "%STG%"=="0" (
  node ns_grade_s.js auto %JDA%
) else (
  node ns_grade_s.js %STG% %JDA%
)
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
echo     (3) Murni misi grade (tanpa Event Kage / Halloween / Hunting)
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
if exist ".char_env.bat" (
  call ".char_env.bat"
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

:CHEAT
cls
echo ======================================================================
echo      CHEAT: DAMAGE BESAR + HP TIDAK HABIS (PLAYER ONLY)
echo ======================================================================
echo.
echo   PENTING: Patch ini HANYA mempengaruhi damage player di battle PvE.
echo   Musuh di Arena / PvP / Clan Battle TIDAK di-patch (tidak terpengaruh).
echo   Jalankan sebagai Administrator agar WriteProcessMemory berhasil.
echo.
echo   Metode: scan pattern di memori Flash Player, patch 2 byte damage saja.
echo   Array asli  : A2 25 E8 07 A3 A2 46  (damage ~2000)
echo   Array patch : A2 25 A9 A2 A3 A2 46  (damage ~42000)
echo.
echo   1. Damage besar saja
echo   2. HP tidak habis saja  (panduan manual CE)
echo   3. Semua (damage + HP)
echo   4. Restore ke nilai normal
echo   5. Cek status (proses Flash Player aktif?)
echo.
set "CHT="
set /p "CHT=Pilih (1/2/3/4/5, kosong = 3) : "
echo.
if "%CHT%"=="1" (
  node ns_cheat.js damage
) else if "%CHT%"=="2" (
  node ns_cheat.js hp
) else if "%CHT%"=="4" (
  node ns_cheat.js restore
) else if "%CHT%"=="5" (
  node ns_cheat.js status
) else (
  node ns_cheat.js all
)
echo.
pause
goto MENU

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

:END
if exist ".char_env.bat" del ".char_env.bat" >nul 2>nul
exit /b 99
