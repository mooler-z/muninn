#!/usr/bin/env bash
# Build the hook shim and stage it where Tauri expects an `externalBin`.
#
# Tauri looks for `<path>-<target-triple>` so that a bundle can carry a binary
# per architecture. Cargo does not name its output that way, so this is the
# small translation between the two — run from `beforeBuildCommand`, which is
# what keeps the shipped shim from silently going stale against the app.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
triple="${MUNINN_TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"

cargo build --release --manifest-path "$root/Cargo.toml" -p muninn-forward

mkdir -p "$root/src-tauri/binaries"
cp "$root/target/release/muninn-forward" \
   "$root/src-tauri/binaries/muninn-forward-$triple"

echo "staged muninn-forward for $triple"
