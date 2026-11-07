"""
Genera los iconos de MapaVivo (PWA) a partir de un diseño vectorial simple.
Uso:  python tools/make-icons.py
Requiere Pillow:  pip install pillow
"""
from pathlib import Path
from PIL import Image, ImageDraw

C1 = (109, 94, 252)   # violeta
C2 = (34, 211, 238)   # cian
SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "icons"


def gradient(size: int) -> Image.Image:
    """Degradado diagonal violeta → cian."""
    w = 256
    g = Image.new("RGB", (w, w))
    px = g.load()
    for y in range(w):
        for x in range(w):
            t = (x + y) / (2 * (w - 1))
            px[x, y] = tuple(round(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return g.resize((size, size), Image.LANCZOS)


def pin_mask(size: int, scale: float = 1.0, cy_ratio: float = 0.46) -> Image.Image:
    """Silueta blanca de un pin de mapa (círculo + punta + agujero)."""
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)

    cx = size / 2
    cy = size * cy_ratio
    r = size * 0.19 * scale

    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    tw = r * 0.62
    d.polygon(
        [(cx - tw, cy + r * 0.55), (cx + tw, cy + r * 0.55), (cx, cy + r * 2.05)],
        fill=255,
    )

    hr = r * 0.42
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=0)
    return m


def make(size: int, rounded: bool = True, scale: float = 1.0) -> Image.Image:
    base = gradient(size)

    if rounded:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * 0.225), fill=255
        )
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        img.paste(base, (0, 0), mask)
    else:
        img = base.convert("RGBA")

    img.paste(Image.new("RGBA", (size, size), (255, 255, 255, 255)), (0, 0), pin_mask(size, scale))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    make(512).save(OUT / "icon-512.png", optimize=True)
    make(192).save(OUT / "icon-192.png", optimize=True)
    make(32).save(OUT / "favicon-32.png", optimize=True)

    # Icono "maskable": fondo a sangre y contenido dentro de la zona segura
    make(512, rounded=False, scale=0.82).save(OUT / "maskable-512.png", optimize=True)

    # iOS aplica su propia máscara: cuadrado completo
    make(180, rounded=False).save(OUT / "apple-touch-icon-180.png", optimize=True)

    print("Iconos generados en", OUT)


if __name__ == "__main__":
    main()
