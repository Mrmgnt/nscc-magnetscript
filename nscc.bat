@echo off
setlocal
title NinjaSaga Bot - NSCC
cd /d "%~dp0"

set "NS_USER="
set "NS_PASS="

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

:LOGIN
cls
echo ==========================================================
echo            NINJASAGA BOT - NSCC
echo            cc: MagnetScript(Razki)
echo ==========================================================
echo.
if "%NS_USER%"=="" (
  set /p "NS_USER=Username NinjaSaga : "
)
if "%NS_USER%"=="" goto LOGIN
set /p "NS_PASS=Password NinjaSaga : "
if "%NS_PASS%"=="" goto LOGIN
echo.
echo Login tersimpan di memori sesi ini saja (tidak ditulis ke file).
timeout /t 1 >nul

:MENU
cls
echo ==========================================================
echo            NINJASAGA BOT - NSCC
echo            cc: MagnetScript(Razki)
echo ==========================================================
echo   Akun : %NS_USER%
echo.
echo   1. Jatah harian + naik level (event, training, hunting, misi)
echo      - ujian Chunin / Jounin / Special Jounin / Sennin otomatis
echo   2. Event battle (Halloween Furious Zombie + Tengu Goblin / Kage)
echo      - sub-menu: all / kage saja / halloween saja
echo   3. TP Training + SS Training
echo   4. Hunting House / Eudemong (status saja)
echo   5. Cek karakter (level, XP, gold, misi)
echo   6. Ganti akun
echo   7. Daftar misi per grade (cek sisa misi)
echo   8. AUTO GRIND - Misi Grade Level (Ujian HARD, sampai target)
echo      - Murni Misi Grade C/B/A level tertinggi karakter (tanpa event)
echo   9. CHEAT - Damage besar + HP tidak habis (player only, bukan PvP)
echo  10. TEST LOCAL - Coba feed hex 8 karakter (localhost.dev)
echo   0. Keluar
echo ==========================================================
set "PILIH="
set /p "PILIH=Pilih menu : "

if "%PILIH%"=="1" goto LEVEL
if "%PILIH%"=="2" goto EVENT
if "%PILIH%"=="3" goto TRAIN
if "%PILIH%"=="4" goto HUNT
if "%PILIH%"=="5" goto STATE
if "%PILIH%"=="6" goto GANTI
if "%PILIH%"=="7" goto MISSIONS
if "%PILIH%"=="8" goto MISSIONONLY
if "%PILIH%"=="9" goto CHEAT
if "%PILIH%"=="10" goto LOCALFEED
if "%PILIH%"=="0" goto END
goto MENU

:LOCALFEED
cls
echo === TEST LOCAL FEED ===
echo   Target : https://ninjasaga.cc/?feed=XXXXXXXX
echo   Mode   : login akun, 5 request paralel, jeda batch 3 detik.
echo   Tekan Ctrl+C untuk menghentikan pengujian.
echo.
node ns_local_feed_test.js
echo.
pause
goto MENU

:MISSIONONLY
cls
echo === AUTO GRIND - Misi Grade Level (Ujian HARD Otomatis) ===
echo.
echo   Urutan:
echo     (1) Misi Grade (C/B/A) level tertinggi karakter, naik terus
echo     (2) Ujian Chunin/Jounin/Special Jounin/Sennin SELALU HARD MODE
echo     (3) Murni misi grade (tanpa Event Kage / Halloween)
echo   Setiap level 20/40/60/80 ujian diselesaikan dulu sebelum lanjut.
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
echo === DAFTAR MISI PER GRADE ===
echo   Grade di data server: E / D / C / S
set "GRD="
set /p "GRD=Grade (E/D/C/S, kosong = ringkasan) : "
echo.
node ns_mission.js %GRD%
echo.
pause
goto MENU

:LEVEL
cls
echo === JATAH HARIAN + AUTO NAIK LEVEL ===
echo   Urutan: TP - SS - Hunting - Kage - Halloween - lalu misi tertinggi
echo.
echo   Catatan: misi harian yang levelnya jauh di bawah karakter dibalas
echo   XP 0 oleh server. Bot sekarang hanya ambil misi harian yang levelnya
echo   dekat dengan level karakter.
echo.
set "TARGET="
set /p "TARGET=Target level (20/40/60/80/100, kosong = 100) : "
if "%TARGET%"=="" set "TARGET=100"
echo.
node ns_daily.js --level %TARGET%
echo.
pause
goto MENU

:EVENT
cls
echo === EVENT BATTLE ===
echo   1. Halloween Furious Zombie + Tengu Goblin (semua)
echo   2. Tengu Goblin / Kage Apprenticeship saja
echo   3. Halloween / Furious Zombie saja
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
echo === TP + SS TRAINING ===
echo.
node ns_train.js tp 5 20
echo.
node ns_train.js ss 5 20
echo.
pause
goto MENU

:HUNT
cls
echo === HUNTING HOUSE / EUDEMON GARDEN ===
echo   1. Lihat daftar room (status)
echo   2. Jalan semua room (auto)
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

:STATE
cls
node ns_state.js
echo.
pause
goto MENU

:GANTI
set "NS_USER="
set "NS_PASS="
goto LOGIN

:CHEAT
cls
echo === CHEAT: DAMAGE BESAR + HP TIDAK HABIS (PLAYER ONLY) ===
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

:END
endlocal
exit /b 0
