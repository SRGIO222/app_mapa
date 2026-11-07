# 🗺️ MapaVivo 1.1

Aplicación tipo Google Maps que usa **tu ubicación** y muestra sobre el mapa
los lugares que hay alrededor, cada uno con su **emoji identificativo**:
🍽️ restaurantes, 🍺 bares, 💊 farmacias, ⛽ gasolineras, 🏨 hoteles…

No necesita clave de API ni registro: usa **OpenStreetMap** y su API pública
**Overpass** para obtener datos reales.

Hay dos formas de usarla: **APK para Android** (incluida en `dist/`) y
**versión web / PWA** (instalable desde el navegador).

---

## 📦 APK Android · versión 1.1

**Archivo:** `dist\MapaVivo-1.1.apk` · 0,18 MB · Android 7.0+  
**SHA-256:** `58832C0B81555B272557E3EED562A83EFB766E4309EE526AACEA9A5442307CD1`

La web completa (HTML, CSS, JS, iconos y Leaflet) viaja **dentro del APK** y se
sirve desde un servidor local en `127.0.0.1:47823` (puerto fijo), así que la
geolocalización funciona y **favoritos, tema, filtros y caché se conservan
entre arranques** sin depender de un hosting externo.

### Instalación

1. Copia el APK al móvil (cable USB, Google Drive, Telegram/WhatsApp…).
2. Ábrelo desde el móvil y permite **instalar apps de origen desconocido**
   cuando Android lo pregunte.
3. Pulsa **Instalar**. Si Play Protect avisa por no venir de Google Play,
   elige **“Instalar de todos modos”**.
4. Abre **MapaVivo** y acepta el permiso de **ubicación**.

Tienes las mismas instrucciones en `dist\INSTALAR.txt`, junto al APK.

> La app está **autofirmada**, no publicada en Google Play. Para futuras
> versiones hay que firmar con la misma clave: `android/keystore/mapavivo.jks`
> (contraseña `mapavivo`).
>
> **La clave de firma NO está en este repositorio** por seguridad (está en
> `.gitignore`). Si se pierde ese archivo, Android rechazará las actualizaciones
> futuras del APK ("firma no coincide") y habría que desinstalar y reinstalar la
> app. Guarda una copia privada de `mapavivo.jks` en un lugar seguro.

### Recompilar el APK

Requisitos (ya instalados en este equipo):

- **JDK 17** en `%USERPROFILE%\android-tools\jdk17`
- **Android SDK** en `%LOCALAPPDATA%\Android\Sdk` con
  `platforms;android-34` y `build-tools;34.0.0`

```powershell
cd C:\Users\serro\Desktop\Proyecto1

# (solo si faltan) regenerar iconos de Android
python tools\make-android-icons.py

# compilar y firmar
powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1

# otra versión
powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -Version 1.2 -VersionCode 3
```

El resultado se guarda en `dist\MapaVivo-<versión>.apk`.

### Probar sin instalarla

`iniciar.bat` abre la misma web en el PC. `movil.bat` la sirve para el móvil
(con túnel HTTPS opcional). También puedes subir la carpeta a Netlify Drop,
GitHub Pages o Vercel.

---

## ▶️ Versión web en el PC

1. Doble clic en **`iniciar.bat`**.
2. Se abre `http://localhost:8123`.
3. Acepta el permiso de ubicación.

> Abre siempre con `iniciar.bat` (o con un servidor local), **no** haciendo
> doble clic en `index.html`: los navegadores solo permiten la geolocalización
> en `localhost` o HTTPS.

Alternativa manual:

```powershell
cd C:\Users\serro\Desktop\Proyecto1
python -m http.server 8123
# abre http://localhost:8123
```

## 📱 Versión web en el móvil (PWA)

La web es una **PWA instalable**: icono en la pantalla de inicio, pantalla
completa y caché offline. El GPS del móvil **exige HTTPS**, así que:

- **Netlify Drop** (recomendado): arrastra la carpeta a
  <https://app.netlify.com/drop> y abre la URL resultante en el móvil.
- **`movil.bat`** con `cloudflared` (`winget install Cloudflare.cloudflared`):
  crea un túnel HTTPS temporal desde tu PC.
- **Wi-Fi local** sin HTTPS: el mapa funciona, pero el navegador bloquea el GPS.

Instalación: Android/Chrome → menú ⋮ → *Instalar app*; iPhone/Safari →
Compartir □↑ → *Añadir a pantalla de inicio*.

---

## ✨ Funciones

- **Ubicación automática** (GPS) con punto azul, círculo de precisión y
  seguimiento al moverte; botón 🎯 para recentrar.
- **22 categorías con emoji** y color propio, activables a la vez.
- **Datos reales** de OpenStreetMap vía Overpass, con varios servidores en
  paralelo y reintentos.
- **Buscador** de direcciones/ciudades (Nominatim) con **historial de
  búsquedas recientes**.
- **“Buscar en esta zona”** al desplazar el mapa.
- **Lista por distancia** y ficha con dirección, horario, teléfono, web,
  tiempo a pie aproximado, «Cómo llegar» (Google Maps) y enlace a OpenStreetMap.
- **Favoritos ★**: guarda lugares con la estrella, aparecen en su propia
  pestaña, se conservan al cerrar la app y se muestran con un pin dorado.
- **Filtro «Abierto» 🟢**: oculta los lugares que constan como cerrados ahora
  según `opening_hours` de OpenStreetMap (si el horario es ambiguo, no filtra).
- **Compartir**: envía el lugar por el menú del móvil o copia el enlace.
- **Sin conexión**: guarda los últimos resultados y los muestra si Overpass
  no responde, con aviso de la fecha de esos datos.
- **Agrupación de marcadores** (clusters) y radio de 500 m a 5 km.
- **Tema claro/oscuro** y diseño móvil con panel deslizante.
- **Offline (web)**: service worker + teselas ya vistas.
- **Versión 1.1** visible en el pie del panel.

## 🧱 Estructura

```
Proyecto1/
├─ index.html               Interfaz
├─ iniciar.bat              Servidor local + navegador
├─ movil.bat                Servidor + túnel HTTPS para el móvil
├─ manifest.webmanifest     Metadatos PWA
├─ sw.js                    Service Worker (offline)
├─ vendor/                  Leaflet y MarkerCluster incluidos (sin CDN)
├─ css/styles.css           Estilos (temas, responsive, safe-areas)
├─ js/
│  ├─ categories.js         Categorías, emojis y etiquetas
│  ├─ openhours.js          Horarios «abierto ahora» (opening_hours)
│  ├─ overpass.js           Cliente de Overpass y Nominatim
│  └─ app.js                Mapa, favoritos, filtros, offline y lista
├─ icons/                   Iconos de la PWA
├─ android/
│  ├─ AndroidManifest.xml   Manifest de la app (versión 1.1)
│  ├─ java/…/MainActivity.java  WebView + servidor local + permisos
│  ├─ res/                  Iconos, splash y tema
│  └─ keystore/             Clave de firma local (excluida del repo)
├─ tools/
│  ├─ build-apk.ps1         Compila y firma el APK
│  ├─ make-icons.py         Iconos de la PWA
│  └─ make-android-icons.py Iconos de Android
└─ dist/
   ├─ MapaVivo-1.1.apk
   └─ INSTALAR.txt
```

Tecnologías: **Leaflet 1.9** + **Leaflet.markercluster** (incluidos en
`vendor/`), JavaScript vanilla y un contenedor Android nativo (WebView).

## ➕ Añadir una categoría

Edita `js/categories.js`:

```js
{ id: 'vet', label: 'Veterinarias', emoji: '🐾', color: '#14b8a6',
  tags: [['amenity', 'veterinary']] },
```

Añade la etiqueta legible en `window.TYPE_LABELS`:

```js
'amenity=veterinary': 'Veterinaria',
```

Para la web, sube `VERSION` en `sw.js`. Para el APK, recompila con
`tools\build-apk.ps1`.

## 🔒 Privacidad

- La ubicación **nunca sale del dispositivo**: solo calcula el centro de la
  consulta.
- Las peticiones van directamente a OpenStreetMap (teselas, Overpass y
  Nominatim). Sin servidor propio ni analítica.

## ⚠️ Limitaciones

- Los datos son de OpenStreetMap: cobertura e información dependen de la
  comunidad.
- Los servidores públicos de Overpass a veces van lentos; la app prueba varios
  y muestra **Reintentar** si fallan.
- Sin internet no se pueden buscar lugares nuevos (el APK siempre abre).
- En el APK, si deniegas la ubicación, usa el buscador de direcciones o el
  botón «Buscar en esta zona».

## 🛠️ Problemas frecuentes

| Problema | Solución |
|---|---|
| Android no instala el APK | Permite “origen desconocido” para Archivos/navegador; Play Protect → “Instalar de todos modos”. |
| El APK no pide ubicación | Ajustes → Aplicaciones → MapaVivo → Permisos → Ubicación. |
| «Has bloqueado la ubicación» (web) | Candado de la barra de direcciones → permitir ubicación → recargar. |
| En el móvil (web) no pide GPS | Necesita HTTPS: Netlify, GitHub Pages o `movil.bat` con cloudflared. |
| No carga ningún lugar | Comprueba internet; pulsa **⟳ Recargar** o cambia el radio. |
| Puerto 8123 ocupado | Edita `PORT` en `iniciar.bat` o usa `python -m http.server 9000`. |
| Windows pregunta por el firewall | Permite el acceso (solo para `movil.bat` en la Wi-Fi local). |
