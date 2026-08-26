@echo off
setlocal
title Amni-Connect
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo [ERROR] Electron runtime is missing.
    echo         Run: npm ci
    echo         On npm 11 and up the Electron download is blocked until you also run:
    echo              npm approve-scripts electron
    echo.
    pause
    exit /b 1
)

if not exist "rust\target\release\amni-control.exe" (
    echo [WARN] amni-control.exe not found.
    echo        Screen sharing will work, but the viewer gets no mouse or keyboard control.
    echo        Fix: open the "rust" folder and run: cargo build --release
    echo.
    timeout /t 5 >nul
)

echo Starting Amni-Connect...
start "" "node_modules\electron\dist\electron.exe" "."
exit /b 0
