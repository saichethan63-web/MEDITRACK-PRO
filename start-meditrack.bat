@echo off
title MediTrack Pro - Startup
echo.
echo  ================================================
echo   MediTrack Pro - Starting up...
echo  ================================================
echo.

:: Step 1: Start MySQL
echo [1/3] Starting MySQL database...
start "" "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --defaults-file=C:\ProgramData\MySQL\my.ini --console

:: Wait for MySQL to be ready
echo       Waiting for MySQL to initialize (8 seconds)...
timeout /t 8 /nobreak > nul

:: Check MySQL is up
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqladmin.exe" -u root -h 127.0.0.1 ping >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] MySQL did not start. Check if another instance is running.
    echo         Or try running this script as Administrator.
    pause
    exit /b 1
)
echo       MySQL is running!

:: Step 2: Start Node.js server
echo.
echo [2/3] Starting MediTrack Node.js server...
cd /d "C:\Users\Chethan\Downloads\meditrack-sql_1\meditrack-sql\server"
start "MediTrack Server" cmd /k "node server.js"

:: Wait a moment
timeout /t 3 /nobreak > nul

:: Step 3: Open browser
echo.
echo [3/3] Opening browser...
start http://localhost:3000

echo.
echo  ================================================
echo   MediTrack Pro is running!
echo   URL: http://localhost:3000
echo  ================================================
echo.
echo  To STOP the app:
echo    - Close the "MediTrack Server" window (stops Node.js)
echo    - MySQL will stop automatically when you shut down Windows
echo.
pause

