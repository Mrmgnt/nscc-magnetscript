@echo off
:: deploy_nscc.bat — salin semua file yang sudah diupdate ke Program Files
net session >nul 2>&1
if errorlevel 1 goto ELEVATE
goto RUN

:ELEVATE
echo Meminta izin Administrator...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
exit /b

:RUN
cls
echo ==========================================================
echo            DEPLOY NSCC UPDATE KE PROGRAM FILES
echo ==========================================================
echo Menyalin file dari Documents\nscc ke Program Files...
echo.

set "SRC=%USERPROFILE%\Documents\nscc"
set "DST1=C:\Program Files (x86)\Ninja Saga\nscc-magnetscript\nscc"
set "DST2=C:\Program Files (x86)\Ninja Saga\nscc-magnetscript\nscc-magnetscript\nscc"
set "DST3=C:\Program Files (x86)\Ninja Saga\nscc-magnetscript2\nscc"

if not exist "%SRC%" (
  echo ERROR: Folder sumber tidak ditemukan: %SRC%
  pause
  exit /b 1
)

robocopy "%SRC%" "%DST1%" /E /IS /IT /NP
robocopy "%SRC%" "%DST2%" /E /IS /IT /NP
robocopy "%SRC%" "%DST3%" /E /IS /IT /NP

echo Memberikan izin akses penuh ke folder Ninja Saga...
icacls "C:\Program Files (x86)\Ninja Saga" /grant Users:(OI)(CI)F /T >nul 2>&1
echo.
echo === Deploy BERHASIL! ===
echo File-file telah diperbarui di Program Files.
echo Sekarang Anda bisa langsung menjalankan nscc.bat!
echo.
pause
exit /b 0

:GAGAL
echo.
echo ERROR: Deploy gagal.
echo Pastikan Anda memilih "Yes" pada jendela Administrator.
echo.
pause
exit /b 1
