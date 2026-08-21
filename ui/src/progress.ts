/**
 * Keeping a game between openings.
 *
 * The waiting window closes for reasons the player did not choose — the agent
 * finishing is the entire point of the window, and it is also the thing most
 * likely to interrupt a good run. So every game writes a snapshot of itself
 * once a second, and picks it up when it is next opened.
 *
 * A snapshot is whatever the game says it is: this module never looks inside
 * one. That keeps the games free to change their own state without anything
 * here needing to know, and it is why `restore` is given back exactly what
 * `snapshot` produced.
 */

import { invoke } from "@tauri-apps/api/core";

/** Often enough that almost nothing is lost, rarely enough to be free. */
const EVERY_MS = 1000;

/** A game that can be put down and picked up again. */
export interface Keepable<T> {
  /** The state worth keeping, or null when there is nothing to keep — a game
   *  that has not started, or one that is over. */
  snapshot(): T | null;
  restore(state: T): void;
}

export async function loadProgress<T>(game: string): Promise<T | null> {
  try {
    const text = await invoke<string | null>("load_game", { game });
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    // A snapshot from an older build whose shape has since changed, or no file
    // at all. Either way the game starts fresh, which is the safe outcome.
    return null;
  }
}

export function clearProgress(game: string) {
  void invoke("clear_game", { game }).catch(() => {});
}

function write<T>(game: string, snapshot: () => T | null) {
  let state: T | null;
  try {
    state = snapshot();
  } catch {
    // A game mid-teardown may not be able to describe itself. Losing one
    // snapshot is not worth taking down the window.
    return;
  }

  if (state === null) {
    clearProgress(game);
    return;
  }
  void invoke("save_game", { game, state: JSON.stringify(state) }).catch(() => {});
}

/**
 * Write the current snapshot immediately.
 *
 * The interval is not enough on its own. The waiting window is hidden rather
 * than closed, and a hidden webview has its timers throttled to a crawl or
 * stopped outright — so the moments that actually end a run (the close button,
 * the agent finishing) are exactly the moments the timer is least likely to
 * fire. Those call this instead of hoping.
 */
export function saveNow() {
  writeCurrent?.();
}

let writeCurrent: (() => void) | null = null;

/**
 * Start saving, and return the function that stops.
 *
 * The returned stop also writes one final snapshot, because the moments that
 * end a run are exactly the ones whose last second matters most.
 */
export function keep<T>(game: string, snapshot: () => T | null): () => void {
  writeCurrent = () => write(game, snapshot);
  const timer = window.setInterval(writeCurrent, EVERY_MS);

  // The window is hidden rather than unloaded most of the time, so this covers
  // only the app actually quitting — but that is one of the ways a run ends.
  const onLeave = () => write(game, snapshot);
  window.addEventListener("pagehide", onLeave);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("pagehide", onLeave);
    write(game, snapshot);
    writeCurrent = null;
  };
}
