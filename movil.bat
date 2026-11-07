@echo off
setlocal
cd /d "%~dp0"

set PORT=8123

echo.
echo   ============================================
echo    MapaVivo - abrir en el movil
echo   ============================================
echo.

REM Obtener la IP local del PC (la del adaptador con salida a Internet)
set LANIP=
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } ^| Select-Object -First 1).IPv4Address.IPAddress"') do set LANIP=%%i

echo   En la misma Wi-Fi puedes abrir:
echo      http://%LANIP%:%PORT%
echo   (OJO: sin HTTPS el navegador bloquea el GPS; el mapa si funciona)
echo.

where cloudflared >nul 2>nul
if errorlevel 1 goto :sin_tunel

echo   cloudflared detectado: creando tunel HTTPS...
echo   En la ventana nueva aparecera una URL https://....trycloudflare.com
echo   Abrela en el movil (esa si permite ubicacion GPS).
echo.
start "MapaVivo - tunel HTTPS" cloudflared tunnel --url http://localhost:%PORT%
python -m http.server %PORT% --bind 127.0.0.1
goto :fin

:sin_tunel
echo   cloudflared no esta instalado, asi que se usara la red local.
echo   Para tener HTTPS (y GPS) instala cloudflared con:
echo      winget install Cloudflare.cloudflared
echo   y vuelve a ejecutar este archivo.
echo.
echo   Si Windows pregunta por el firewall, permite el acceso.
echo.
python -m http.server %PORT% --bind 0.0.0.0

:fin
echo.
echo   Servidor detenido.
pause
