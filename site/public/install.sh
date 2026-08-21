#!/bin/sh
# Muninn installer.
#
#   curl -fsSL https://muninn.moolerz.et/install.sh | sh
#
# Run it from inside a project and it sets that project up too. Run it again
# later and it upgrades in place — this is the update path as well.
#
# The script's whole job is to get a binary onto the disk. Everything after
# that is `muninn init`, which is compiled Rust: registering a hook means
# merging JSON into a settings file someone may have spent months
# accumulating, and doing that with sed is how you eat somebody's config.
#
# POSIX sh, because /bin/sh on macOS is not bash and this has to run before
# anything is installed.
set -eu

BASE="${MUNINN_BASE:-https://muninn.moolerz.et}"
APP="/Applications/Muninn.app"

say()  { printf '  %s\n' "$*"; }
bail() { printf '\nmuninn: %s\n' "$*" >&2; exit 1; }

printf '\n  Muninn\n\n'

# ── checks ────────────────────────────────────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || bail "macOS only for now — this is $(uname -s)."

case "$(uname -m)" in
  arm64)  ARCH=arm64 ;;
  x86_64) ARCH=x86_64 ;;
  *)      bail "unknown architecture $(uname -m)." ;;
esac

command -v curl >/dev/null 2>&1 || bail "curl is required."

# ── fetch ─────────────────────────────────────────────────────────────────
VERSION="$(curl -fsSL "$BASE/download/latest" 2>/dev/null || true)"
[ -n "$VERSION" ] || bail "could not reach $BASE. Check your connection."

ZIP="muninn-$VERSION-$ARCH.zip"
TMP="$(mktemp -d)"
# Leaving a few megabytes in /tmp on every failure is its own small bug.
trap 'rm -rf "$TMP"' EXIT INT TERM

say "downloading $ZIP"
curl -fsSL "$BASE/download/$ZIP" -o "$TMP/$ZIP" \
  || bail "download failed. $BASE/download/$ZIP"

# The checksum is advisory rather than a gate: it catches a truncated download,
# which is the realistic failure. It is not a defence against whoever served
# the file, since they would serve the checksum too.
if curl -fsSL "$BASE/download/$ZIP.sha256" -o "$TMP/sum" 2>/dev/null; then
  want="$(cut -d' ' -f1 < "$TMP/sum")"
  got="$(shasum -a 256 "$TMP/$ZIP" | cut -d' ' -f1)"
  [ "$want" = "$got" ] || bail "checksum mismatch — the download is corrupt.
    expected $want
    got      $got"
  say "checksum ok"
fi

# ── install ───────────────────────────────────────────────────────────────
say "unpacking"
ditto -x -k "$TMP/$ZIP" "$TMP/unpacked" || bail "could not unpack $ZIP."
[ -d "$TMP/unpacked/Muninn.app" ] || bail "the archive did not contain Muninn.app."

# Quit a running copy first: replacing the bundle underneath a live process
# leaves it running from a path that no longer exists.
pkill -x muninn >/dev/null 2>&1 || true

if [ -d "$APP" ]; then
  rm -rf "$APP" || bail "could not replace $APP. Is it running, or not yours?"
fi
cp -R "$TMP/unpacked/Muninn.app" "$APP" || bail "could not write to /Applications."

# curl does not set the quarantine flag the way a browser does, so this is
# usually a no-op. It costs nothing and saves the "unidentified developer"
# dialog for anyone who got the archive another way.
xattr -cr "$APP" 2>/dev/null || true

say "installed $APP"

# ── put `muninn` on PATH ──────────────────────────────────────────────────
# Never sudo. If /usr/local/bin is not already writable, use a home directory
# that needs no permission, and say so rather than failing.
BIN="$APP/Contents/MacOS/muninn"
LINKED=""
for dir in /usr/local/bin "$HOME/.local/bin"; do
  if [ -w "$dir" ] 2>/dev/null || mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; then
    ln -sf "$BIN" "$dir/muninn" && LINKED="$dir/muninn" && break
  fi
done

if [ -n "$LINKED" ]; then
  say "linked $LINKED"
  case ":$PATH:" in
    *":${LINKED%/muninn}:"*) ;;
    *) say "note: ${LINKED%/muninn} is not on your PATH" ;;
  esac
fi

# ── set the project up ────────────────────────────────────────────────────
# `init` refuses a directory that does not look like a project, which is the
# right answer when this was piped to sh from a home directory. Not an error.
printf '\n'
if "$BIN" init --launch; then
  :
else
  printf '\n  Installed. To set up a project:\n\n      muninn init\n\n'
fi
