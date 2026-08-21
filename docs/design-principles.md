# Design principles

Muninn interrupts someone who chose to stop paying attention. Everything below
follows from taking that seriously.

## 1. Never startle

The sound is the product's first impression and the easiest thing to get wrong.

- Soft attack, short, low-mid frequency, quiet by default. On macOS,
  `/System/Library/Sounds/Tink.aiff` is roughly the target character.
- No rising alarm shapes, no repeats, no escalation.
- A different, *quieter* sound for `needs-input` than for `completed` — being
  asked a question is less final than being finished.
- Silent hours by default, and a mute that is one click, never buried.
- If the user is on a call or screen-sharing (Do Not Disturb / Focus), suppress
  the sound and keep the panel for later.

## 2. The first screen carries the outcome

Assume the user reads exactly one line. That line is `done`. Everything else is
progressive disclosure.

Nothing that matters may sit below a scroll. If `blocked` is present it sorts
above everything, because it is the only field that requires the user to act.

## 3. It is a briefing, not a chat log

No message bubbles, no timestamps down the side, no avatars. This is a page from
a report: heading, short body, a list, a status row. Typographic hierarchy is
doing the work, not chrome.

## 4. Never demand focus

- The panel appears; it does not steal keyboard focus mid-sentence from whatever
  the user is typing in.
- `Esc` dismisses, always.
- It never covers the centre of the screen. Corner-anchored, sized to content.
- If the user does not engage, it stays — it does not vanish after 5 seconds like
  a toast. They stepped away; the whole point is that it waits.

## 5. Honest about uncertainty

Fields the agent claimed are rendered as claims. If Muninn ever infers anything
itself, it must look different. "Tests pass" reported by the agent and "tests
pass" observed by Muninn are not the same statement and must not look alike.

A missing summary says "finished, no summary" — never a fabricated one.

## 6. Calm visual language

- Light and dark, following the system.
- One accent colour, used for one thing at a time.
- Status colour never alone: always paired with an icon and a word, for
  colour-blind users and for glanceability.
- Monospace only for paths, commands and code fragments.
- No progress bars, no spinners, no animated counters. Nothing is happening —
  that is the point. The work is already done.

## 7. Multiple agents, one queue

Two agents finishing together must not stack two windows. Queue them, show a
count, let the user page through. A pile of windows is the exact anxiety this
tool exists to remove.

## 8. Cheap at rest

It idles all day in a menu bar. Idle CPU should be indistinguishable from zero,
and memory should not embarrass itself next to a text editor. This is a
constraint on the stack, not a nice-to-have — see
[ADR-0003](decisions/0003-tauri-over-electron.md).

## Anti-goals

- No dashboard. No charts. No streaks or gamification.
- No "AI insights" beyond what the agent itself said.
- No account, no cloud, no telemetry-by-default. The payload contains the user's
  working directory and their agent's full output; it stays on the machine.
