#!/usr/bin/env python3
"""Generate ui/src/phosphor.ts from the installed Phosphor icon set.

    pnpm add -D @phosphor-icons/core
    tools/extract-icons.py

Only the handful of icons the panel actually uses are copied in, as raw path
data. That keeps Phosphor a build-time dependency rather than a runtime one —
the panel ships five paths, not a 1,500-icon library — while the generated file
stays reproducible instead of being a wall of pasted blobs nobody can check.

Phosphor Icons is MIT licensed; the attribution is written into the output.
"""

import json
import pathlib
import re
import sys

WEIGHT = "fill"

# Each entry is the icon's purpose in the panel, not just its name, because the
# choice is the interesting part and the name alone does not record it.
WANTED = {
    # `changed:` lists files an agent edited. A diff is the literal thing.
    "changed": ("git-diff", "files the agent edited"),
    # `verified:` is the agent's claim, never Muninn's finding. Quote marks say
    # "reported speech" more honestly than a tick, which would imply the check
    # was confirmed by something. See design principle §5.
    "verified": ("quotes", "the agent's claim, quoted"),
    "next": ("arrow-right", "what it would do next"),
    "risk": ("warning", "look at this sceptically"),
    # Shown in the blocked state, where `done` is demoted below the blocker.
    "done": ("check-circle", "what did land"),
    # The panel's Details button. The panel sits at the right edge of the
    # screen and the details window opens centred, so the arrow points the way
    # the window actually travels.
    "details": ("caret-left", "open the full record"),
    # Status, and the provenance rows — details window only.
    "waiting": ("hourglass-medium", "the agent is waiting on you"),
    "blocked": ("prohibit", "it could not continue"),
    "folder": ("folder", "the working directory"),
    "branch": ("git-branch", "the branch it was on"),
    "clock": ("clock", "when it arrived"),
    "agent": ("terminal-window", "which agent reported it"),
    "asked": ("chat-teardrop-text", "what the user asked for"),
    "explain": ("book-open-text", "the long-form account"),
    "history": ("clock-counter-clockwise", "what this project finished lately"),
    # Searching the history — by project, by prompt, or by what was reported.
    "search": ("magnifying-glass", "find a turn"),
    # Writing the history out to a file the user chooses.
    "export": ("export", "save the history somewhere"),
    "prev": ("caret-left", "back out of a project"),
}


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    assets = root / "node_modules/@phosphor-icons/core/assets" / WEIGHT
    if not assets.is_dir():
        print(f"missing {assets} — run: pnpm add -D @phosphor-icons/core", file=sys.stderr)
        return 1

    lines = [
        "/**",
        " * Phosphor icon paths, extracted by tools/extract-icons.py.",
        " *",
        " * Generated — do not edit. Change the WANTED map in the script instead.",
        " *",
        f" * Phosphor Icons ({WEIGHT} weight) — MIT licensed.",
        " * https://github.com/phosphor-icons/core",
        " */",
        "",
        "/** All Phosphor icons are drawn on this grid. */",
        "export const PHOSPHOR_BOX = 256;",
        "",
        "export const PHOSPHOR: Record<string, string> = {",
    ]

    for key, (name, why) in WANTED.items():
        svg = assets / f"{name}-{WEIGHT}.svg"
        if not svg.is_file():
            print(f"no such icon: {svg.name}", file=sys.stderr)
            return 1

        text = svg.read_text()
        body = re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", text, flags=re.S).strip()
        if not body:
            print(f"could not read paths out of {svg.name}", file=sys.stderr)
            return 1

        lines.append(f"  // {name} — {why}")
        # json.dumps, because the path data is full of double quotes of its own.
        lines.append(f"  {key}: {json.dumps(body)},")

    lines.append("};")
    lines.append("")

    out = root / "ui/src/phosphor.ts"
    out.write_text("\n".join(lines))
    print(f"wrote {out.relative_to(root)} with {len(WANTED)} icons")
    return 0


if __name__ == "__main__":
    sys.exit(main())
