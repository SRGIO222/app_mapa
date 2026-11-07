"""
Normaliza los nombres de las entradas de un APK a '/' (estándar ZIP).

En Windows, aapt2 guarda los assets con '\\', y Android no los encuentra
(www/index.html no existe). Este script reescribe el ZIP con separadores '/'
conservando el tipo de compresión de cada entrada.

Uso:  python tools/fix-apk-zip.py entrada.apk salida.apk
"""
import sys
import zipfile


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Uso: python tools/fix-apk-zip.py entrada.apk salida.apk")

    src, dst = sys.argv[1], sys.argv[2]
    changed = 0

    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for item in zin.infolist():
            name = item.filename.replace("\\", "/")
            if name != item.filename:
                changed += 1

            info = zipfile.ZipInfo(name, date_time=item.date_time)
            info.compress_type = item.compress_type
            info.external_attr = item.external_attr
            info.internal_attr = item.internal_attr
            info.create_system = item.create_system
            zout.writestr(info, zin.read(item))

    print(f"Entradas normalizadas: {changed}")


if __name__ == "__main__":
    main()
