@echo off
title Violet Music Bot
cd /d "%~dp0"

echo ===================================================
echo             VIOLET MUSIC BOT - START
echo ===================================================

:: Periksa apakah bot sudah berjalan sebelumnya
if exist .bot.pid (
    set /p OLD_PID=<.bot.pid
    if defined OLD_PID (
        tasklist /FI "PID eq %OLD_PID%" 2>NUL | find /I "%OLD_PID%" >NUL
        if not errorlevel 1 (
            echo [PERINGATAN] Bot sudah berjalan dengan PID: %OLD_PID%
            echo Jika ingin mematikan atau me-restart, jalankan stop.bat terlebih dahulu.
            echo ===================================================
            pause
            exit /b 0
        )
    )
)

echo [*] Menjalankan bot...
echo [*] Tekan Ctrl + C atau jalankan stop.bat untuk menghentikan.
echo ===================================================

node index.js

echo.
echo [!] Bot telah berhenti.
pause
