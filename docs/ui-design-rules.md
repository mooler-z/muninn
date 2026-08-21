# UI design rules

The referee for visual changes. [design-principles.md](design-principles.md)
says what Muninn must *be*; this says what a contributor's diff must *do*.
Every rule here is enforced somewhere in the tree — the file that enforces it
is named, so you can read the reason at the scene.

If your change fights one of these, it is not automatically wrong — but it
needs a PR that argues against the rule, not one that quietly breaks it.

---

## 1 · Two registers, and nothing between them

Everything Muninn writes is in one of two voices:

- **Fact** — something known first-hand: a label, a project name, a status
  word. Tracked uppercase, 10px, letter-spaced. Class `mn-fact`.
- **Voice** — prose, usually the agent's. Sentence case, set light. Class
  `mn-voice`.

If you are adding text and cannot say which register it is, the text is
probably wrong. A third register — unquoted, for things Muninn verified
itself — is deliberately reserved and unused, because Muninn verifies nothing
today.

**Claims are quoted by the stylesheet, never by the markup.** `mn-claim` adds
the quotation marks via `::before`/`::after`, so a claim can never be rendered
and lose its quotes by accident. Do not type quotation marks around agent
output.

## 2 · One accent, one meaning

The accent colour means **you are needed**. Nothing else may use it.

- `blocked` and `needs-input` earn it. Finishing successfully earns no colour
  at all.
- Status colour never stands alone: always icon + word + colour, for
  colour-blind users and for glanceability.
- One hue, tuned per theme (`--mn-accent-light` / `--mn-accent-dark` in the
  tokens). Do not introduce a second accent; do not use the accent for
  decoration, hover states, or emphasis in prose.

At display sizes the raw accent stops being a highlight and becomes a hazard
colour — blend it toward the foreground (`color-mix(... 55%, var(--mn-fg))`)
rather than using it neat.

## 3 · Liquid glass, by the recipe

Every raised control is the same material. The recipe
(`.mn-glass` in the site, the equivalent in `ui/styles`):

- **Tint** — a vertical gradient of the glass colour, strongest at the top.
- **Rim** — a gradient *ring*, not a border colour: a 1px mask over a
  155° gradient, brightest where it faces the light.
- **Specular** — an inset top highlight, one pixel.
- **Shade** — an inset bottom shadow, soft.

**No `backdrop-filter`.** It shimmered: the panel repaints on a loop while
breathing, and every repaint re-samples the blur. What actually reads as glass
is the rim, the specular and the depth below — none of which need it.

## 4 · Shadows are light, not outlines

- Light theme: the dichromatic pair — a cool cast left, a warm cast right,
  over a neutral drop. Things sit *in coloured light*, not on grey smudges.
- Dark theme: lift comes from black; the coloured pair survives only as a
  faint tint. A light shadow on a dark field does not read as depth — it reads
  as glow, and then everything glows.
- A window capture with its native shadow baked into the alpha gets **no CSS
  frame** — framing a shadow gives it two edges.

Tokens: `--mn-shadow`, `--mn-glow-soft`, `--dark-drop-*`. The glow belongs to
the panel's breathing and to exactly one element at a time.

## 5 · Type

- **Serif** (`--mn-font-serif`) is the voice of headings and anything with an
  opinion.
- **UI sans** (`--mn-font-ui`) is chrome, labels, body.
- **Mono** (`--mn-font-mono`) is *only* for paths, commands and code. Never
  for atmosphere.
- Emphasis inside a serif heading is italic, not bold — the italics carry
  warmth; bold carries alarm.

The site self-hosts its fonts (`next/font`, build-time). A `<link>` to a font
CDN breaks the "no third-party requests" claim on first paint — do not add
one.

## 6 · Motion

- Animate **transform and opacity only**. `height`, `top`, `width` re-run
  layout every frame; the compositor properties do not. This is the
  layout-vs-compositor split, and it is the reason the popup animations that
  animated `height` never stopped glitching.
- Motion happens **because something happened** — an arrival, a dismissal, a
  press. Nothing loops except the panel's breathing and the contribute
  button's glow, each of which is one element with a stated reason.
- Everything respects `prefers-reduced-motion`; the site disables all
  animation wholesale under it (`ScrollFx` returns early, CSS zeroes the
  rest).
- Scroll reveals fire **once**. A section that re-animates on every pass turns
  reading into a slideshow.

## 7 · Windows

All of this is in `src-tauri/src` and it is behavioural, not cosmetic — treat
regressions here as bugs, not opinions:

- **Never steal focus.** Windows are shown without activation (`focus: false`,
  shown unfocused). If the user is typing, they keep typing. First click makes
  a window interactive.
- **Closing gives focus back.** Every hide path calls `release_focus` —
  `NSApp.deactivate()`, not `hide()` — so the next app's window becomes active.
  If you add a window, wire its close path the same way.
- **Corner-anchored, never centred over work** — except the waiting window,
  which is explicitly invited.
- **`Esc` dismisses, always.**
- **The panel does not time out.** The user stepped away; it waits until seen.
  The corner notice is the opposite — five seconds, then gone — because it
  carries news you cannot act on. Know which kind you are building.
- **One panel, ever.** Simultaneous finishes queue behind a count
  (`queue.rs`); they never stack windows.

## 8 · Sound

Rules live in [design-principles.md §1](design-principles.md) and are enforced
by compile-time asserts in `sound.rs`: the ask-sound must be quieter than the
finish-sound, volume is capped, hits are capped at three and identical. If
your change fails those asserts, the asserts are right.

## 9 · Games

A game earns its place by holding one thread of attention and letting go
gracefully. The contract (`ui/src/waiting.ts` + `games.rs`):

- **Pause when told.** `EVENT_PAUSE` arrives before the window hides; a hidden
  webview keeps running, so a game that ignores it plays itself in the dark.
- **Snapshot once a second** through `progress.ts`, and restore on open. The
  agent finishing is the likeliest interruption; it must never cost a run.
- **Draw something fast.** The window is transparent and click-trapping; the
  watchdog hides it if nothing renders within seconds (`waiting.rs::PROOF`).
  Call `drew()` once you have painted.
- **No streaks, no persistent scores, no daily anything.** A game that wants
  the user back tomorrow is the problem this product exists to solve.
- **Guard real input.** Play/restart handlers check `event.isTrusted` so a
  stray synthetic event cannot restart someone's run.
- Colours come from the shared palette. If you need a colour as a number
  (canvas, WebGL), resolve it through the 1×1-canvas helper — the palette is
  `oklch` and your own hex parsing will silently produce `NaN`.

## 10 · The site is the product's voice

- The landing page makes claims (`local only`, `works offline`, `no third-party
  requests`). **Do not add anything that falsifies one** — no CDN scripts, no
  analytics beacons beyond the first-party one, no fonts from Google's
  servers.
- Copy states facts it can prove. If the build does not do it, the page does
  not say it. When the numbers change (history size, hook count), the page
  changes in the same PR.

## The test

Before opening a PR that touches anything visible, put it on screen and look:

- App windows: `python3 tools/popups.py`, every state you touched, both themes.
- Site: both themes, 1440 and 390 wide, and screenshot what changed —
  screenshots go in the PR.

If you did not look at it, it is not done.
