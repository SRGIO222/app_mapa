package com.mapavivo.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * MapaVivo · contenedor Android de la aplicación web.
 *
 * La web viaja dentro del APK (assets/www) y se sirve en 127.0.0.1 desde un
 * servidor mínimo incluido en la app. Así el origen es seguro (localhost):
 * la geolocalización y el service worker funcionan igual que en la versión web.
 */
public class MainActivity extends Activity {

    private static final int REQUEST_LOCATION = 10;

    private WebView webView;
    private LocalServer server;
    private Thread serverThread;

    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setTextZoom(100);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternally(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternally(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                    return;
                }

                // Guardamos la petición y preguntamos al usuario por el permiso.
                geoCallback = callback;
                geoOrigin = origin;
                requestPermissions(
                        new String[]{
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        REQUEST_LOCATION);
            }
        });

        try {
            server = new LocalServer(getAssets());
            serverThread = new Thread(server, "mapavivo-http");
            serverThread.setDaemon(true);
            serverThread.start();
            webView.loadUrl("http://127.0.0.1:" + server.getPort() + "/index.html");
        } catch (IOException error) {
            // Plan B: cargar desde los assets (file:// también es origen seguro).
            webView.loadUrl("file:///android_asset/www/index.html");
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Mantiene dentro de la app solo el contenido local; el resto se abre fuera. */
    private boolean openExternally(Uri uri) {
        if (uri == null) return false;

        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (scheme.equals("file") || scheme.equals("about") || scheme.equals("javascript")
                || scheme.equals("data") || scheme.equals("blob")) {
            return false;
        }

        // Los enlaces propios (127.0.0.1) se quedan en el WebView.
        String host = uri.getHost();
        if (host != null && (host.equals("127.0.0.1") || host.equals("localhost"))) {
            return false;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            // Si no hay app para abrir el enlace (p. ej. un correo), no hacemos nada.
        }
        return true;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQUEST_LOCATION) {
            boolean granted = false;
            for (int result : grantResults) {
                if (result == PackageManager.PERMISSION_GRANTED) {
                    granted = true;
                    break;
                }
            }

            if (geoCallback != null) {
                geoCallback.invoke(geoOrigin, granted, false);
                geoCallback = null;
                geoOrigin = null;
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        finish();
    }

    @Override
    protected void onDestroy() {
        if (server != null) {
            server.close();
            server = null;
        }
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /* =================================================================
       Servidor HTTP mínimo para los assets de la app.
       ================================================================= */
    private static final class LocalServer implements Runnable {

        private static final Map<String, String> MIME = new HashMap<>();

        static {
            MIME.put("html", "text/html; charset=utf-8");
            MIME.put("js", "text/javascript; charset=utf-8");
            MIME.put("css", "text/css; charset=utf-8");
            MIME.put("json", "application/json; charset=utf-8");
            MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
            MIME.put("png", "image/png");
            MIME.put("jpg", "image/jpeg");
            MIME.put("jpeg", "image/jpeg");
            MIME.put("svg", "image/svg+xml");
            MIME.put("ico", "image/x-icon");
        }

        // Puerto fijo: el origen (127.0.0.1:PUERTO) debe ser siempre el mismo
        // para que el WebView conserve localStorage entre arranques
        // (favoritos, tema, radio, filtros y caché sin conexión).
        private static final int PORT = 47823;

        private final AssetManager assets;
        private final ServerSocket socket;
        private volatile boolean running = true;

        LocalServer(AssetManager assets) throws IOException {
            this.assets = assets;

            ServerSocket candidate = new ServerSocket();
            candidate.setReuseAddress(true);
            try {
                candidate.bind(
                        new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT),
                        16);
            } catch (IOException busy) {
                // Puerto ocupado por otro proceso: seguimos funcionando, aunque
                // esta sesión use un origen distinto.
                candidate.close();
                candidate = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            }
            this.socket = candidate;
        }

        int getPort() {
            return socket.getLocalPort();
        }

        void close() {
            running = false;
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }

        @Override
        public void run() {
            while (running) {
                try (Socket client = socket.accept()) {
                    handle(client);
                } catch (IOException error) {
                    if (!running) break;
                }
            }
        }

        private void handle(Socket client) {
            try {
                client.setSoTimeout(8000);

                InputStream in = client.getInputStream();
                String requestLine = readLine(in);
                if (requestLine == null) return;

                String[] parts = requestLine.split(" ");
                if (parts.length < 2) return;

                String method = parts[0];
                String target = parts[1];

                // Consumir cabeceras hasta la línea en blanco.
                String header;
                while ((header = readLine(in)) != null && !header.isEmpty()) {
                    // sin uso
                }

                int query = target.indexOf('?');
                if (query >= 0) target = target.substring(0, query);

                String path;
                try {
                    path = URLDecoder.decode(target, "UTF-8");
                } catch (Exception error) {
                    respond(client, 400, "text/plain; charset=utf-8", "Bad request".getBytes(StandardCharsets.UTF_8));
                    return;
                }

                if (path.equals("/") || path.isEmpty()) path = "/index.html";
                if (path.endsWith("/")) path += "index.html";
                if (path.contains("..")) {
                    respond(client, 403, "text/plain; charset=utf-8", "Forbidden".getBytes(StandardCharsets.UTF_8));
                    return;
                }

                byte[] body;
                try (InputStream asset = assets.open("www" + path)) {
                    body = readAll(asset);
                } catch (IOException notFound) {
                    byte[] message = "No encontrado".getBytes(StandardCharsets.UTF_8);
                    respond(client, 404, "text/plain; charset=utf-8", message);
                    return;
                }

                if ("HEAD".equals(method)) {
                    respondHead(client, body.length, mimeFor(path));
                } else {
                    respond(client, 200, mimeFor(path), body);
                }
            } catch (IOException ignored) {
                // Conexión cerrada por el WebView: normal.
            }
        }

        private void respond(Socket client, int status, String mime, byte[] body) throws IOException {
            String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : status == 403 ? "Forbidden" : "Bad Request";
            String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
                    + "Content-Type: " + mime + "\r\n"
                    + "Content-Length: " + body.length + "\r\n"
                    + "Cache-Control: no-cache\r\n"
                    + "Connection: close\r\n"
                    + "\r\n";

            OutputStream out = client.getOutputStream();
            out.write(head.getBytes(StandardCharsets.ISO_8859_1));
            out.write(body);
            out.flush();
        }

        private void respondHead(Socket client, int length, String mime) throws IOException {
            String head = "HTTP/1.1 200 OK\r\n"
                    + "Content-Type: " + mime + "\r\n"
                    + "Content-Length: " + length + "\r\n"
                    + "Cache-Control: no-cache\r\n"
                    + "Connection: close\r\n"
                    + "\r\n";
            OutputStream out = client.getOutputStream();
            out.write(head.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        }

        private static String mimeFor(String path) {
            int dot = path.lastIndexOf('.');
            String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase() : "";
            String mime = MIME.get(ext);
            return mime != null ? mime : "application/octet-stream";
        }

        private static String readLine(InputStream in) throws IOException {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(128);
            int c;
            while ((c = in.read()) != -1) {
                if (c == '\n') break;
                if (c != '\r') buffer.write(c);
                if (buffer.size() > 8192) break;
            }
            if (c == -1 && buffer.size() == 0) return null;
            return buffer.toString("ISO-8859-1");
        }

        private static byte[] readAll(InputStream in) throws IOException {
            ByteArrayOutputStream out = new ByteArrayOutputStream(16384);
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) {
                out.write(chunk, 0, read);
            }
            return out.toByteArray();
        }
    }
}
