# Contributing

## Getting oriented

Read in this order:

1. [README.md](README.md) — what it is
2. [docs/product-brief.md](docs/product-brief.md) — who for, and what counts as failure
3. [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit
4. [docs/decisions/](docs/decisions/) — why they fit that way

[AGENTS.md](AGENTS.md) carries the hard rules; they apply to humans equally.

## Development setup

You need a Rust toolchain ([rustup](https://rustup.rs)), Node with pnpm, and
Xcode command line tools. Then:

```sh
pnpm install
pnpm tauri dev
```

The app has no Dock icon — it is a menu bar item, and the panel only appears
when something finishes. To make something finish without waiting for an agent:

```sh
cargo build --release -p muninn-forward
echo '{"cwd":"'"$PWD"'","last_assistant_message":"```muninn\ndone: Hello\n```"}' \
  | ./target/release/muninn-forward --source claude-code
```

### Working on the panel

`pnpm dev` and open <http://localhost:5183/fixtures.html>. Every state renders
there in light and dark, from fixtures, without an agent or the Rust side —
which is the fastest way to compare against the design.

### Layout

| Path | What lives there |
|---|---|
| `crates/muninn-core` | The event shape and the summary parser |
| `crates/muninn-forward` | The shim. No dependencies; keep it that way |
| `src-tauri/src` | Receiver, normaliser, queue, panel, sound, tray |
| `ui/src` | The panel frontend. Vanilla TS, no framework |
| `tools/` | M0 capture scripts and the icon generator |

### Tests

```sh
cargo test --workspace
pnpm build                  # typecheck and bundle
cargo clippy --workspace --all-targets
```

The ones worth knowing about before you change anything:

- `crates/muninn-forward/tests/never_blocks_the_agent.rs` — the shim against a
  receiver that is unreachable, refusing, and hanging. AGENTS.md mandates these.
- `crates/muninn-core/tests/summary_parsing.rs` — mostly malformed input, because
  the raw fallback is the path that has to hold.
- `src-tauri/src/receiver.rs` — the ADR-0005 checks, including the browser case.

### Icons

Generated from source rather than checked in as opaque binaries:

```sh
./tools/make-icon.sh
```

## Testing changes against a real agent

You need a real agent finishing real turns; synthetic payloads will not surface
the interesting problems.

Register the shim as a `Stop` hook in a **project-local** `.claude/settings.json`
in a scratch repo rather than your user-wide settings, so a broken build cannot
disrupt your actual work:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [{ "type": "command", "command": "/path/to/muninn-forward --source claude-code" }] }
    ]
  }
}
```

Then give the agent something that takes a few minutes and walk away. If you
watched it, you did not test it.

## Pull requests

- One concern per PR.
- If you change how the panel looks, include a screenshot in light and dark.
- If you change the shim, include evidence it still exits 0 and fast with the
  receiver down.
- If you contradict an ADR, add the superseding ADR in the same PR.

## Reporting a problem

The useful bug report includes: which agent and version, the payload the shim
received (redact paths as needed), what the panel showed, and what you expected.
The payload matters most — most bugs here are payload-shape surprises.
