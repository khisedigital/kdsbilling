#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${1:-$ROOT/assets/branding/kdspoz-logo.png}"
RES="$ROOT/android/app/src/main/res"
ASSETS="$ROOT/src/assets"
ICONSET="$ROOT/ios/BillingPOS/Images.xcassets/AppIcon.appiconset"
SPLASHSET="$ROOT/ios/BillingPOS/Images.xcassets/SplashLogo.imageset"

if [[ ! -f "$SOURCE" ]]; then
  echo "Logo not found: $SOURCE"
  exit 1
fi

mkdir -p "$ASSETS" "$ROOT/assets/branding" "$SPLASHSET"
cp "$SOURCE" "$ROOT/assets/branding/kdspoz-logo.png"
cp "$SOURCE" "$ASSETS/logo.png"

# Padded splash assets: Android 12 circular-masks the splash icon (~66% safe zone).
python3 - "$SOURCE" "$RES/drawable" <<'PY'
import sys
from pathlib import Path
from PIL import Image

src, out_dir = Path(sys.argv[1]), Path(sys.argv[2])

def padded(scale: float, dest: Path, canvas: int = 1024) -> None:
    logo = Image.open(src).convert("RGBA")
    size = int(canvas * scale)
    logo = logo.resize((size, size), Image.Resampling.LANCZOS)
    canvas_img = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))
    offset = ((canvas - size) // 2, (canvas - size) // 2)
    canvas_img.paste(logo, offset, logo)
    canvas_img.convert("RGB").save(dest, "PNG", optimize=True)

padded(0.52, out_dir / "splash_icon.png")  # Android 12+ system splash
padded(0.72, out_dir / "splash_logo.png")  # pre-31 windowBackground
print("Wrote splash_icon.png and splash_logo.png")
PY

for spec in "mdpi:48" "hdpi:72" "xhdpi:96" "xxhdpi:144" "xxxhdpi:192"; do
  density="${spec%%:*}"
  size="${spec##*:}"
  dir="$RES/mipmap-$density"
  sips -z "$size" "$size" "$SOURCE" --out "$dir/ic_launcher.png" >/dev/null
  cp "$dir/ic_launcher.png" "$dir/ic_launcher_round.png"
done

# Android 8+ uses the adaptive icon. Without these, a library's default robot icon wins.
python3 - "$SOURCE" "$RES" <<'PY'
import sys
from pathlib import Path
from PIL import Image

src, res = Path(sys.argv[1]), Path(sys.argv[2])
logo = Image.open(src).convert("RGBA")
pixels = []
for r, g, b, a in logo.getdata():
    if r > 245 and g > 245 and b > 245:
        pixels.append((255, 255, 255, 0))
    else:
        pixels.append((r, g, b, 255))
logo.putdata(pixels)
sizes = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for density, size in sizes.items():
    inner = int(size * 0.72)
    scaled = logo.resize((inner, inner), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = ((size - inner) // 2, (size - inner) // 2)
    canvas.paste(scaled, offset, scaled)
    canvas.save(res / f"mipmap-{density}" / "ic_launcher_foreground.png", "PNG")
print("Wrote adaptive launcher foregrounds")
PY

cp "$SOURCE" "$ICONSET/AppIcon-1024.png"
sips -z 40 40 "$SOURCE" --out "$ICONSET/AppIcon-20@2x.png" >/dev/null
sips -z 60 60 "$SOURCE" --out "$ICONSET/AppIcon-20@3x.png" >/dev/null
sips -z 58 58 "$SOURCE" --out "$ICONSET/AppIcon-29@2x.png" >/dev/null
sips -z 87 87 "$SOURCE" --out "$ICONSET/AppIcon-29@3x.png" >/dev/null
sips -z 80 80 "$SOURCE" --out "$ICONSET/AppIcon-40@2x.png" >/dev/null
sips -z 120 120 "$SOURCE" --out "$ICONSET/AppIcon-40@3x.png" >/dev/null
sips -z 120 120 "$SOURCE" --out "$ICONSET/AppIcon-60@2x.png" >/dev/null
sips -z 180 180 "$SOURCE" --out "$ICONSET/AppIcon-60@3x.png" >/dev/null

cp "$SOURCE" "$SPLASHSET/logo.png"
sips -z 512 512 "$SOURCE" --out "$SPLASHSET/logo@2x.png" >/dev/null
sips -z 768 768 "$SOURCE" --out "$SPLASHSET/logo@3x.png" >/dev/null

echo "Generated app icons and splash assets from $SOURCE"
