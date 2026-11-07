@echo off
setlocal
cd /d "%~dp0"

set PORT=8123

echo.
echo   MapaVivo - servidor local
echo   ------------------------------
echo   URL:  http://localhost:%PORT%
echo   Cierra esta ventana para detener el servidor
echo.

start "" "http://localhost:%PORT%"
python -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 py -m http.server %PORT% --bind 127.0.0.1

pause
