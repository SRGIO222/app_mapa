"""
Genera los recursos gráficos de Android a partir de los iconos de la PWA.

Uso:  python tools/make-android-icons.py
Requiere Pillow:  pip install pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "icons" / "icon-512.png"
RES = ROOT / "android" / "res"

# densidad → tamaño en px
DENSITIES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def pin_foreground(size: int, scale: float = 0.9) -> Image.Image:
    """Pin blanco sobre fondo transparente para el icono adaptativo."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)

    cx = size / 2
    cy = size * 0.47
    r = size * 0.19 * scale

    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    tip = r * 0.62
    draw.polygon(
        [(cx - tip, cy + r * 0.55), (cx + tip, cy + r * 0.55), (cx, cy + r * 2.05)],
        fill=255,
    )
    hole = r * 0.42
    draw.ellipse([cx - hole, cy - hole, cx + hole, cy + hole], fill=0)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(Image.new("RGBA", (size, size), (255, 255, 255, 255)), (0, 0), mask)
    return img


def main() -> None:
    if not SRC.exists():
        raise SystemExit("Falta icons/icon-512.png (ejecuta antes tools/make-icons.py)")

    base = Image.open(SRC).convert("RGBA")

    for density, size in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        base.resize((size, size), Image.LANCZOS).save(folder / "ic_launcher.png", optimize=True)

    # Icono adaptativo (API 26+): pin blanco sobre fondo degradado del tema.
    # Se genera por densidad con el tamaño nominal de 108 dp.
    adaptive_sizes = {
        "mdpi": 108,
        "hdpi": 162,
        "xhdpi": 216,
        "xxhdpi": 324,
        "xxxhdpi": 432,
    }
    for density, size in adaptive_sizes.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        pin_foreground(size, scale=0.9).save(folder / "ic_launcher_foreground.png", optimize=True)

    # Logotipo del splash (fondo a sangre, como el icono maskable)
    drawable = RES / "drawable-nodpi"
    drawable.mkdir(parents=True, exist_ok=True)
    maskable = ROOT / "icons" / "maskable-512.png"
    logo = Image.open(maskable if maskable.exists() else SRC).convert("RGBA")
    logo.resize((512, 512), Image.LANCZOS).save(drawable / "splash_logo.png", optimize=True)

    print("Iconos Android generados en", RES)


if __name__ == "__main__":
    main()
