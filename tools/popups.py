#!/usr/bin/env python3
"""Put Muninn's windows on screen, for screenshots.

    python3 tools/popups.py

A numbered menu opens; pick a number, the window appears, the menu comes
back. Everything goes through the real local receiver with the real token,
exactly the way the hook shim delivers — nothing here is mocked, so what you
screenshot is what ships.
"""

# macOS ships python3 as 3.9, where `dict | None` in a signature is a runtime
# error. This defers all annotations to strings, so the file runs anywhere.
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

RUNTIME = Path.home() / "Library/Application Support/dev.muninn/runtime.json"


# ── talking to the receiver ──────────────────────────────────────────────────

def runtime() -> tuple[int, str]:
    try:
        data = json.loads(RUNTIME.read_text())
        return data["port"], data["token"]
    except (OSError, KeyError, json.JSONDecodeError):
        sys.exit("popups: no runtime.json — is Muninn running?")


def post(kind: str, body: dict | None = None) -> bool:
    port, token = runtime()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/event?source=claude-code&kind={kind}",
        data=json.dumps(body or {}).encode(),
        headers={"X-Muninn-Token": token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as reply:
            return reply.status == 204
    except urllib.error.HTTPError as e:
        hint = "  (stale token — restart Muninn and try again)" if e.code == 403 else ""
        print(f"  ! receiver said {e.code}{hint}")
    except OSError as e:
        print(f"  ! cannot reach the receiver ({e}) — is Muninn running?")
    return False


# ── a believable project for the panel header ────────────────────────────────

def staged(project: str = "signup-flow", branch: str = "feat/phone-verify") -> str:
    """A real directory with a real branch, so the panel header shows
    something plausible rather than /tmp/xyz."""
    stage = Path(tempfile.gettempdir()) / "muninn-popups" / project
    if not (stage / ".git").is_dir():
        stage.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-q", "-b", branch, str(stage)], check=False)
    return str(stage)


def event(message: str, session: str = "popups") -> dict:
    return {"session_id": session, "cwd": staged(), "last_assistant_message": message}


# ── the summaries, one per panel state ───────────────────────────────────────

COMPLETED = """```muninn
done: Phone verification is in — the suite is green end to end.
changed:
  - src/auth/verify.ts — six-digit codes, one retry before lockout
  - src/api/sms.ts — Twilio behind an interface, so tests never text anyone
verified: pnpm test — 87 passed · pnpm typecheck clean
next: wire the rate limiter before this goes near production
explain: |
  Codes are generated server-side and stored hashed, like passwords —
  a code that leaks from the database is useless. The SMS provider sits
  behind an interface so the test suite runs against a fake, which is
  why it can stay green without sending a single real text.
```"""

BLOCKED = """```muninn
done: Added phone-number verification and got the suite green.
blocked: Needs a Twilio production key — the sandbox only sends to verified numbers.
next: wire the rate limiter once the key lands
verified: pnpm test — 87 passed
```"""

NEEDS_INPUT = """```muninn
done: Migration written; waiting on a decision before running it.
next: apply it to staging first, or straight to production?
```"""

PLAIN = (
    "Refactored the session middleware and moved the retry logic into "
    "`refreshToken`. All 34 tests pass. Next I would wire this into the "
    "login flow, but wanted to check the approach with you first."
)


# ── actions ──────────────────────────────────────────────────────────────────

def panel_completed():
    if post("completed", event(COMPLETED)):
        print("  → panel, top-right · stays until you dismiss it")


def panel_blocked():
    if post("completed", event(BLOCKED)):
        print("  → panel, blocked — the accent needs-you state")


def panel_needs_input():
    if post("needs-input", event(NEEDS_INPUT)):
        print("  → panel, needs-input — the quieter ask")


def panel_plain():
    if post("completed", event(PLAIN)):
        print('  → panel, no ```muninn block — rendered "as written"')


def panel_queue():
    turns = [
        ("api", "main", "Rate limiter is in — 429s with a Retry-After header."),
        ("site", "redesign", "Hero rebuilt; Lighthouse back at 99."),
        ("infra", "main", "Backups verified restorable, not just present."),
    ]
    for i, (project, branch, done) in enumerate(turns):
        post("completed", {
            "session_id": f"queue-{i}",
            "cwd": staged(project, branch),
            "last_assistant_message": f"```muninn\ndone: {done}\n```",
        })
        time.sleep(0.3)  # distinct ids come from distinct timestamps
    print("  → panel with a ×3 count — page through with the arrows")


def details_open():   post("debug", {"do": "open-details"})   and print("  → details window open")
def details_close():  post("debug", {"do": "close-details"})  and print("  → details window closed")
def history_open():   post("debug", {"do": "open-history"})   and print("  → history window open")
def history_close():  post("debug", {"do": "close-history"})  and print("  → history window closed")


def _pinned_notice(body: dict, label: str):
    """The notice hides itself after 5s — too quick to frame a shot. Re-show
    it every 4s until Enter, then let it lapse."""
    if not post("notice", body):
        return
    stop = threading.Event()

    def keep_alive():
        while not stop.wait(4):
            post("notice", body)

    ticker = threading.Thread(target=keep_alive, daemon=True)
    ticker.start()
    input(f"  → notice ({label}) pinned top-right — press Enter to release... ")
    stop.set()
    print("  → released; it hides on its own in 5s")


def notice_offline():
    _pinned_notice({"state": "offline"}, "no network · urgent")


def notice_online():
    # The receiver keys urgency off the word "online" in the body.
    _pinned_notice({"state": "online", "online": True}, "back online · calm")


def waiting_arm():
    if post("started", {"session_id": "popups-waiting", "cwd": staged()}):
        print("  → game window armed — it opens after your configured delay\n"
              "    (menu item 12 stands it down; that also delivers a panel,\n"
              "    because the summary always wins the screen — shoot the game first)")


def waiting_over():
    if post("completed", event("```muninn\ndone: The turn is over.\n```", "popups-waiting")):
        print("  → game window stood down; its summary panel arrives now")


MENU: list[tuple[str, object]] = [
    ("Panel — completed (full summary)",        panel_completed),
    ("Panel — blocked (accent, needs you)",     panel_blocked),
    ("Panel — needs input (quieter ask)",       panel_needs_input),
    ('Panel — no block ("as written")',         panel_plain),
    ("Panel — three at once (the pager)",       panel_queue),
    ("Details window — open",                   details_open),
    ("Details window — close",                  details_close),
    ("History window — open",                   history_open),
    ("History window — close",                  history_close),
    ("Corner notice — no network (pinned)",     notice_offline),
    ("Corner notice — back online (pinned)",    notice_online),
    ("Game window — arm it",                    waiting_arm),
    ("Game window — stand it down",             waiting_over),
]


def main() -> None:
    print("\n  Muninn popups — pick a number, screenshot, repeat. q quits.")
    print("  (capture tip: ⇧⌘4, then space, then click the window — alpha included)\n")
    while True:
        for i, (label, _) in enumerate(MENU, 1):
            print(f"  {i:>2}  {label}")
        try:
            choice = input("\n  > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if choice in ("q", "quit", "exit", ""):
            return
        if not choice.isdigit() or not 1 <= int(choice) <= len(MENU):
            print("  ? a number from the list, or q\n")
            continue
        label, action = MENU[int(choice) - 1]
        action()
        print()


if __name__ == "__main__":
    main()
