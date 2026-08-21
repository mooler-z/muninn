#!/bin/sh
# Derive every icon Tauri bundles from the 1024px master.
#
# The master is squared up from assets/muninn-raven.png by png-to-icon.py, so
# the whole set is reproducible from the one piece of artwork.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
icons="$root/src-tauri/icons"
master="$icons/icon.png"

python3 "$root/tools/png-to-icon.py" "$root/assets/muninn-raven.png" "$master" 1024

# The menu bar item, cropped tight to the artwork. macOS scales a template
# image to the bar's height whatever is in it, so the square app icon's side
# padding would show up there as a smaller bird for no reason.
python3 "$root/tools/png-to-icon.py" "$root/assets/muninn-raven.png" \
  "$icons/tray.png" 128 --tight

for size in 32 128 256 512; do
  sips -z "$size" "$size" "$master" --out "$icons/${size}x${size}.png" >/dev/null
done
mv "$icons/256x256.png" "$icons/128x128@2x.png"
mv "$icons/512x512.png" "$icons/256x256@2x.png"

# .icns, via the iconset layout iconutil expects.
set="$icons/muninn.iconset"
rm -rf "$set"
mkdir -p "$set"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$master" --out "$set/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$master" --out "$set/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set" -o "$icons/icon.icns"
rm -rf "$set"

echo "icons written to $icons"
