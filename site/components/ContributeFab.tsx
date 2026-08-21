"use client";

/**
 * The contribute button — fixed bottom-right, on screen from the first paint
 * to the last. The in-page section makes the argument for contributing; this
 * makes sure nobody has to scroll to discover the project is theirs to build
 * on. Click → a card rises from the button with the four seams and one way in.
 */

import { useEffect, useRef, useState } from "react";

/** How long the pointer may travel between button and card before it counts
 * as having left. Without this, crossing the 12px gap closes the card. */
const LINGER_MS = 260;

const REPO = "https://github.com/mooler-z/muninn";

const SEAMS: [string, string][] = [
  ["Other OSes", "Muninn runs on macOS only right now. A Linux or Windows port is wide open."],
  ["Other CLI agents", "Only Claude Code is wired up. Codex, Cursor, Gemini, Aider — bring yours."],
  ["More games", "Have an idea for something that holds one thread of attention? Add it."],
  ["Anything else", "The panel, the sounds, the site, the docs — change whatever you can make better."],
];

const GitHubMark = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

export function ContributeFab() {
  const [open, setOpen] = useState(false);
  // Hover opens; a click pins. A pinned card ignores the pointer leaving, so
  // mouse users who clicked get the same stay-open behaviour as touch users.
  const [pinned, setPinned] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setOpen(true);
  };

  const leave = () => {
    if (pinned) return;
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setOpen(false), LINGER_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
      setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <>
      {open && (
        <div
          className="mn-fab-card"
          ref={card}
          role="dialog"
          aria-label="Ways to contribute"
          onMouseEnter={enter}
          onMouseLeave={leave}
        >
          <p className="mn-fab-title mn-serif">Help build Muninn.</p>
          <p className="mn-fab-sub">
            Right now it covers <strong>macOS</strong> and <strong>Claude Code</strong> &mdash;
            that&rsquo;s it. Everything beyond that is open for you to build:
          </p>
          <ul className="mn-fab-list">
            {SEAMS.map(([name, note]) => (
              <li key={name}>
                <span className="mn-fact">{name}</span>
                <p>{note}</p>
              </li>
            ))}
          </ul>
          <a className="mn-glass mn-cta mn-cta--primary mn-fab-cta" href={REPO}>
            Contribute on GitHub
            <span className="mn-cta-mark" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10L10 4M4.6 4H10v5.4" />
              </svg>
            </span>
          </a>
          <p className="mn-fab-fine mn-fact">Start with CONTRIBUTING.md</p>
        </div>
      )}

      <button
        type="button"
        ref={button}
        className={open ? "mn-glass mn-fab is-open" : "mn-glass mn-fab"}
        onClick={() => {
          // Toggling while hover holds it open would read as a dead click, so
          // a click on an already-hovered-open card pins instead of closing.
          if (open && !pinned) {
            setPinned(true);
            return;
          }
          setPinned(!open);
          setOpen(!open);
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        aria-expanded={open}
        aria-label="Ways to contribute"
      >
        <GitHubMark />
        <span>Contribute</span>
      </button>
    </>
  );
}
