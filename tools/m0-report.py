#!/usr/bin/env python3
"""M0 — read the captured payloads and answer the roadmap's questions.

Run after m0-log-hook.sh has been collecting for a while:

    tools/m0-report.py

The kill criterion from docs/roadmap.md is the headline number: if
last_assistant_message is frequently empty or useless, ADR-0002 is wrong and
the architecture needs revisiting before any more code gets written.

It also diffs the observed payload keys against what
docs/integrations/claude-code.md claims, because AGENTS.md is explicit that
payload shapes must be verified against the live tool rather than trusted from
a doc page.
"""

import json
import pathlib
import re
import sys

# What docs/integrations/claude-code.md:18-28 says a Stop payload carries.
DOCUMENTED = {
    "session_id",
    "prompt_id",
    "transcript_path",
    "cwd",
    "permission_mode",
    "hook_event_name",
    "effort",
    "last_assistant_message",
}

FENCE = re.compile(r"^[ \t]*```+[ \t]*muninn[ \t]*$", re.MULTILINE)


def pct(n, total):
    return f"{(100 * n / total):.0f}%" if total else "—"


def main():
    root = pathlib.Path(__file__).resolve().parent.parent / "captures"
    files = sorted(root.glob("*.json")) if root.is_dir() else []

    if not files:
        print(f"No captures in {root}.")
        print("Register the hook (see CONTRIBUTING.md) and run some real turns.")
        return 1

    payloads, unreadable = [], 0
    for f in files:
        try:
            payloads.append(json.loads(f.read_text()))
        except (ValueError, OSError):
            unreadable += 1

    total = len(payloads)
    print(f"M0 report — {total} payloads captured in {root}")
    if unreadable:
        print(f"  ({unreadable} unreadable — worth looking at by hand)")

    # --- The kill criterion -------------------------------------------------
    msgs = [p.get("last_assistant_message") or "" for p in payloads]
    present = [m for m in msgs if m.strip()]
    print()
    print("Is last_assistant_message populated?")
    print(f"  non-empty            {len(present)}/{total}  {pct(len(present), total)}")
    if total and len(present) / total < 0.9:
        print("  ^ ADR-0002 assumes this is reliably present. It is not.")

    # --- How long are real closing messages? --------------------------------
    if present:
        lens = sorted(len(m) for m in present)
        lines = sorted(m.count("\n") + 1 for m in present)

        def q(xs, f):
            return xs[min(int(len(xs) * f), len(xs) - 1)]

        print()
        print("How long are they?")
        print(f"  chars   min {lens[0]}  median {q(lens, .5)}  p90 {q(lens, .9)}  max {lens[-1]}")
        print(f"  lines   min {lines[0]}  median {q(lines, .5)}  p90 {q(lines, .9)}  max {lines[-1]}")
        print("  (the panel shows ~372px wide; anything past p90 will scroll)")

    # --- Does the agent already comply with the contract? -------------------
    fenced = [m for m in present if FENCE.search(m)]
    print()
    print("How many already carry a ```muninn block?")
    print(f"  fenced               {len(fenced)}/{len(present)}  {pct(len(fenced), len(present))}")
    print("  (expected to be ~0 until the prompt fragment is installed — this is")
    print("   the baseline the raw-fallback path has to carry)")

    # --- Payload shape, observed vs documented ------------------------------
    seen = {}
    for p in payloads:
        for k in p:
            seen[k] = seen.get(k, 0) + 1

    undocumented = set(seen) - DOCUMENTED
    missing = {k for k in DOCUMENTED if seen.get(k, 0) < total}

    print()
    print("Payload shape vs docs/integrations/claude-code.md")
    for k in sorted(seen):
        mark = "  " if k in DOCUMENTED else " +"
        print(f" {mark} {k:<24} {seen[k]}/{total}")
    if undocumented:
        print(f"  + undocumented: {', '.join(sorted(undocumented))}")
    if missing:
        print(f"  ! not always present: {', '.join(sorted(missing))}")
        print("    AGENTS.md: verify before relying on a field.")

    # --- Would anything have been worth showing? ----------------------------
    trivial = [m for m in present if len(m.strip()) < 40]
    print()
    print("How often is a turn not worth a panel?")
    print(f"  empty                {total - len(present)}/{total}")
    print(f"  under 40 chars       {len(trivial)}/{total}")
    if trivial:
        print("  shortest seen:")
        for m in sorted(trivial, key=len)[:3]:
            print(f"    {m.strip()[:70]!r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
