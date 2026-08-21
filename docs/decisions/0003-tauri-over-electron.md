# 3. Tauri rather than Electron

**Status:** accepted · 2026-08-17

## Context

The app idles in the menu bar all day and shows a window perhaps six times.
Cross-platform desired, macOS first.

## Decision

Tauri (system webview + Rust core). Revisit only if a platform-specific blocker
appears.

## Reasoning

The usage pattern is almost entirely idle. Carrying a full Chromium per user for
a window that appears a handful of times a day is indefensible for a tool whose
pitch is calm, unobtrusive background presence — a fat idle process contradicts
the product.

The Rust side also suits the shim: a small, fast, single binary is exactly what
must run inside the agent's stop path.

The webview is still there for the panel, so markdown rendering stays easy.

## Consequences

- Webview differences across platforms must be tested; the panel stays simple
  partly for this reason.
- Contributors need a Rust toolchain.
- If a needed capability turns out to be Electron-only, this gets superseded.
