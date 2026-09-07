"""Recorta a arte aprovada para o formato Open Graph 1200x630."""

from pathlib import Path
import sys

from PIL import Image


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("uso: python scripts/create_og.py ENTRADA SAIDA")

    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    with Image.open(source) as image:
        image = image.convert("RGB")
        target_ratio = 1200 / 630
        crop_height = round(image.width / target_ratio)
        top = max(0, round((image.height - crop_height) * 0.36))
        cropped = image.crop((0, top, image.width, top + crop_height))
        resized = cropped.resize((1200, 630), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        resized.save(target, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
