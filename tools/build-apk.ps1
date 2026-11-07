# =====================================================================
#  MapaVivo · compilador de APK (sin Android Studio)
#  ---------------------------------------------------------------------
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1
#    powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -Version 1.2 -VersionCode 3
#
#  Requiere:
#    - JDK 17 en %USERPROFILE%\android-tools\jdk17
#    - Android SDK en %LOCALAPPDATA%\Android\Sdk
#      (platforms;android-34 y build-tools;34.0.0)
# =====================================================================
param(
    [string]$Sdk = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$Jdk = "$env:USERPROFILE\android-tools\jdk17",
    [string]$Version = "1.1",
    [int]$VersionCode = 3
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$build = Join-Path $android 'build'
$dist = Join-Path $root 'dist'
$buildTools = Join-Path $Sdk 'build-tools\34.0.0'
$androidJar = Join-Path $Sdk 'platforms\android-34\android.jar'

$tools = @{
    aapt2     = Join-Path $buildTools 'aapt2.exe'
    d8        = Join-Path $buildTools 'd8.bat'
    zipalign  = Join-Path $buildTools 'zipalign.exe'
    apksigner = Join-Path $buildTools 'apksigner.bat'
    javac     = Join-Path $Jdk 'bin\javac.exe'
    jar       = Join-Path $Jdk 'bin\jar.exe'
    keytool   = Join-Path $Jdk 'bin\keytool.exe'
}

foreach ($pair in $tools.GetEnumerator()) {
    if (!(Test-Path $pair.Value)) {
        throw "No se encuentra $($pair.Key): $($pair.Value). Instala el JDK 17 y el SDK de Android (ver README)."
    }
}
if (!(Test-Path $androidJar)) {
    throw "No se encuentra android.jar: $androidJar"
}

$env:JAVA_HOME = $Jdk
$env:PATH = (Join-Path $Jdk 'bin') + ';' + $buildTools + ';' + $env:PATH

Write-Host ""
Write-Host "=== MapaVivo $Version ($VersionCode) ===" -ForegroundColor Cyan

# ---------------------------------------------------------------- limpieza
if (Test-Path $build) {
    # En Windows un antivirus puede bloquear un archivo unos segundos.
    for ($i = 0; $i -lt 5; $i++) {
        try {
            Get-ChildItem $build -Recurse -Force -ErrorAction SilentlyContinue |
                ForEach-Object { $_.Attributes = 'Normal' }
            Remove-Item $build -Recurse -Force -ErrorAction Stop
            break
        } catch {
            Start-Sleep -Milliseconds 400
            if ($i -eq 4) {
                cmd /c "rd /s /q `"$build`""
                if (Test-Path $build) { throw "No se pudo limpiar $build" }
            }
        }
    }
}
$gen = Join-Path $build 'gen'
$classes = Join-Path $build 'classes'
$dex = Join-Path $build 'dex'
$assets = Join-Path $build 'assets'
$www = Join-Path $assets 'www'
foreach ($d in @($gen, $classes, $dex, $www)) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# ------------------------------------------------------- copiar la web
Write-Host "Copiando la aplicación web..."
$webItems = @('index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'vendor')
foreach ($item in $webItems) {
    $src = Join-Path $root $item
    if (!(Test-Path $src)) { throw "Falta $src" }
    Copy-Item -Path $src -Destination $www -Recurse -Force
}

# ------------------------------------------------------- recursos
Write-Host "Compilando recursos..."
$resZip = Join-Path $build 'res.zip'
& $tools.aapt2 compile --dir (Join-Path $android 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile falló" }

$unsigned = Join-Path $build 'app-unsigned.apk'
& $tools.aapt2 link `
    -o $unsigned `
    -I $androidJar `
    --manifest (Join-Path $android 'AndroidManifest.xml') `
    --java $gen `
    --auto-add-overlay `
    -A $assets `
    -R $resZip `
    --version-code $VersionCode `
    --version-name $Version
if ($LASTEXITCODE -ne 0) { throw "aapt2 link falló" }

# ------------------------------------------------------- Java → dex
Write-Host "Compilando Java..."
$sources = @()
$sources += (Get-ChildItem (Join-Path $android 'java') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
$sources += (Get-ChildItem $gen -Recurse -Filter 'R.java' | ForEach-Object { $_.FullName })

& $tools.javac -encoding UTF-8 -source 1.8 -target 1.8 `
    -bootclasspath $androidJar -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw "javac falló" }

Write-Host "Generando classes.dex..."
$classFiles = Get-ChildItem $classes -Recurse -Filter '*.class' | ForEach-Object { $_.FullName }
& $tools.d8 --lib $androidJar --min-api 24 --output $dex $classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 falló" }

& $tools.jar uf $unsigned -C $dex classes.dex
if ($LASTEXITCODE -ne 0) { throw "No se pudo añadir classes.dex al APK" }

# ------------------------------------------------------- alinear + firmar
Write-Host "Normalizando rutas de assets..."
$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { throw "Se necesita Python en el PATH para normalizar el APK" }

$normalized = Join-Path $build 'app-normalized.apk'
& $python.Source (Join-Path $PSScriptRoot 'fix-apk-zip.py') $unsigned $normalized
if ($LASTEXITCODE -ne 0) { throw "No se pudieron normalizar las rutas del APK" }
Move-Item $normalized $unsigned -Force

Write-Host "Alineando y firmando..."
$aligned = Join-Path $build 'app-aligned.apk'
& $tools.zipalign -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw "zipalign falló" }

$keystore = Join-Path $android 'keystore\mapavivo.jks'
if (!(Test-Path $keystore)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $keystore) | Out-Null
    Write-Host "Creando clave de firma nueva..."
    & $tools.keytool -genkeypair -keystore $keystore -storepass mapavivo -keypass mapavivo `
        -alias mapavivo -keyalg RSA -keysize 2048 -validity 10000 `
        -dname "CN=MapaVivo, OU=MapaVivo, O=MapaVivo, L=Madrid, C=ES"
    if ($LASTEXITCODE -ne 0) { throw "keytool falló" }
}

if (!(Test-Path $dist)) { New-Item -ItemType Directory -Force -Path $dist | Out-Null }
$apk = Join-Path $dist "MapaVivo-$Version.apk"
if (Test-Path $apk) { Remove-Item $apk -Force }

& $tools.apksigner sign `
    --ks $keystore `
    --ks-key-alias mapavivo `
    --ks-pass pass:mapavivo `
    --key-pass pass:mapavivo `
    --v1-signing-enabled true `
    --v2-signing-enabled true `
    --v3-signing-enabled true `
    --v4-signing-enabled false `
    --out $apk `
    $aligned
if ($LASTEXITCODE -ne 0) { throw "apksigner falló" }

& $tools.apksigner verify --print-certs $apk | Out-Null
if ($LASTEXITCODE -ne 0) { throw "La verificación de la firma falló" }

$size = [math]::Round((Get-Item $apk).Length / 1MB, 2)
$hash = (Get-FileHash $apk -Algorithm SHA256).Hash
Write-Host ""
Write-Host "APK creado: $apk" -ForegroundColor Green
Write-Host "Versión:    $Version (versionCode $VersionCode)"
Write-Host "Tamaño:     $size MB"
Write-Host "SHA-256:    $hash"
Write-Host ""
