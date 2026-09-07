from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "client" / "public" / "isabel"
WIDTHS = (480, 900, 1254)
SOURCES = {
    "personagem_saudação.png": "saudacao",
    "personagem_balão_fala.png": "fala",
    "personagem_alertando.png": "alerta",
    "personagem_feliz.png": "feliz",
    "personagem_triste.png": "triste",
    "personagem_comemorando.png": "comemorando",
}


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, slug in SOURCES.items():
        with Image.open(ROOT / filename) as source:
            source = source.convert("RGBA")
            for width in WIDTHS:
                height = round(source.height * width / source.width)
                image = source.resize((width, height), Image.Resampling.LANCZOS)
                webp_path = OUTPUT / f"{slug}-{width}.webp"
                avif_path = OUTPUT / f"{slug}-{width}.avif"
                if not webp_path.exists() or webp_path.stat().st_size == 0:
                    image.save(webp_path, "WEBP", quality=82, method=4)
                if not avif_path.exists() or avif_path.stat().st_size == 0:
                    image.save(avif_path, "AVIF", quality=65, speed=9)


if __name__ == "__main__":
    main()
