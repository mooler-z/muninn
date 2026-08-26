/**
 * The panel window.
 *
 * Listens for a view from the app, renders it, and tells the window how tall it
 * needs to be. Everything else here is the behaviour design principle §4 asks
 * for: Esc always dismisses, and nothing ever demands focus.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { renderPanel, RING_CIRCUMFERENCE, RING_ARC, type Handlers } from "./render";
import { streamPanel, type Cancel } from "./stream";
import type { View } from "./types";

import "./styles/tokens.css";
import "./styles/panel.css";

/**
 * How long a panel stays before dismissing itself.
 *
 * NOTE — this is in tension with `docs/design-principles.md` §4: "If the user
 * does not engage, it stays — it does not vanish after 5 seconds like a toast.
 * They stepped away; the whole point is that it waits." The updated design adds
 * a countdown ring to every panel footer, so the behaviour follows the design.
 *
 * It is a single number on purpose. Setting it to `null` removes the countdown
 * and restores the documented behaviour without touching anything else.
 */
const DISMISS_AFTER_SECONDS: number | null = 6;

const root = document.getElementById("root")!;

// The panel has no console attached. Without this, a JavaScript error is an
// empty window and no explanation anywhere.
const report = (what: string, e: unknown) =>
  void invoke("report_error", { message: `${what}: ${e instanceof Error ? e.stack ?? e.message : e}` });

window.addEventListener("error", (e) => report("uncaught", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => report("unhandled rejection", e.reason));

const handlers: Handlers = {
  onDismiss: () => dismiss(),
  onHistory: () => void invoke("open_history"),
  onDetails: () => {
    // The panel is about to be hidden by the app; stop the countdown here so
    // nothing clears the queue while the details window is being read.
    stopCountdown();
    void invoke("open_details");
  },
  onPage: (delta) => void invoke("page", { delta }),
  onOpenTerminal: (cwd) => void invoke("open_terminal", { cwd }),
};

function paint(view: View | null) {
  stopCountdown();
  stopTyping();
  root.replaceChildren();
  if (!view) return;

  const panel = renderPanel(view, handlers);
  root.append(panel);
  // Measure before animating. Every element is already in the document at its
  // final size, so the window is sized once and does not move again.
  measure();
  stopStream = streamPanel(panel);
  startCountdown();
}

let stopStream: Cancel | undefined;

function stopTyping() {
  stopStream?.();
  stopStream = undefined;
}

/**
 * Ask the window to fit the content.
 *
 * Two frames rather than one: the first lands after layout, the second after
 * font metrics and any wrapping have settled, which is when a headline can grow
 * by a line.
 */
function measure() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const panel = root.firstElementChild as HTMLElement | null;
      if (!panel) return;
      // The window is the panel plus its shadow margin, which is asymmetric —
      // see --mn-shadow-pad-top.
      const style = getComputedStyle(document.documentElement);
      const pad = (name: string) => parseFloat(style.getPropertyValue(name));
      void invoke("resize_panel", {
        height: panel.offsetHeight + pad("--mn-shadow-pad-top") + pad("--mn-shadow-pad"),
      });
    });
  });
}

function dismiss() {
  void invoke("dismiss");
}

// --- the countdown ----------------------------------------------------------
//
// Driven per frame from elapsed time rather than stepped once a second. At six
// seconds a per-second step is six visible jumps, and pausing part-way through
// a CSS transition cannot be done cleanly — where "pause exactly here and carry
// on from exactly there" is the whole behaviour being asked for.

let frame: number | undefined;
let remainingMs = 0;
let resumeAt = 0;
let arcs: NodeListOf<SVGCircleElement> | null = null;

// The hover-hold is a lease, not a latch. Every "pointer is on the panel"
// signal extends it; if nothing renews it, the countdown resumes on its own.
// Before this, one stale inside=true froze the timer until the user clicked
// the panel and moved away — the only path that produced a real mouseleave.
// A wrongly-expiring lease costs a resume under a reading pointer for at most
// a poll interval; a latch cost the panel never closing.
const HOLD_LEASE_MS = 1500;
let held = false;
let holdUntil = 0;

setInterval(() => {
  if (held && performance.now() > holdUntil) {
    resumeCountdown();
  }
}, 400);

function paintRing(msLeft: number) {
  if (!arcs || DISMISS_AFTER_SECONDS === null) return;
  const total = DISMISS_AFTER_SECONDS * 1000;
  const offset = (RING_CIRCUMFERENCE * (1 - Math.max(msLeft, 0) / total)).toFixed(2);
  arcs.forEach((arc) => arc.setAttribute("stroke-dashoffset", offset));
}

function tick() {
  const left = resumeAt - performance.now();
  paintRing(left);

  if (left <= 0) {
    stopCountdown();
    dismiss();
    return;
  }
  frame = requestAnimationFrame(tick);
}

function stopCountdown() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
  // A stop is deliberate — dismissal, a repaint, Details opening. The lease
  // must not resurrect the countdown afterwards.
  held = false;
  remainingMs = 0;
}

/** Hold where it is. The ring keeps whatever it is showing.
 *
 * Renewable: callers say "the pointer is here now", and the hold lapses on
 * its own unless renewed — see HOLD_LEASE_MS. */
function pauseCountdown(lease: number = HOLD_LEASE_MS) {
  held = true;
  holdUntil = performance.now() + lease;
  if (frame === undefined) return;
  remainingMs = Math.max(0, resumeAt - performance.now());
  frozen();
}

/** Cancel the frame without touching the lease or the remaining time. */
function frozen() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
}

/** Carry on from where it stopped. */
function resumeCountdown() {
  held = false;
  if (frame !== undefined || remainingMs <= 0 || !arcs) return;
  resumeAt = performance.now() + remainingMs;
  frame = requestAnimationFrame(tick);
}

function startCountdown() {
  stopCountdown();
  if (DISMISS_AFTER_SECONDS === null) return;

  // Every layer of the ring, moved together — see RING_ARC in render.ts.
  arcs = root.querySelectorAll<SVGCircleElement>(`.${RING_ARC}`);
  if (arcs.length === 0) return;

  remainingMs = DISMISS_AFTER_SECONDS * 1000;
  resumeAt = performance.now() + remainingMs;
  paintRing(remainingMs);
  frame = requestAnimationFrame(tick);

  // If the pointer is already over the panel when it arrives — which happens
  // whenever it opens under wherever the mouse was left — start held rather
  // than counting down behind the cursor.
  if (root.querySelector(".mn-panel:hover")) pauseCountdown();
}

// Hovering holds it. Someone with the pointer on the panel is reading it, and
// taking it away mid-sentence is what a six-second timer most obviously risks.
//
// The signal comes from the app rather than from the DOM. The panel never takes
// focus, and macOS does not send mouse-moved events to a window that is not
// key — so `mouseenter` never fires here and `:hover` never matches until the
// window has been clicked. See src-tauri/src/hover.rs.
interface Hover {
  inside: boolean;
  x: number;
  y: number;
}

/**
 * Drive hover from the app's cursor poll.
 *
 * `:hover` does not match in a window that is not key, for the same reason
 * `mouseenter` never fires there — macOS routes no mouse-moved events to it. So
 * the control under the pointer is resolved here and marked with a class, and
 * the stylesheet accepts either that class or a real `:hover`.
 */
let hovered: Element | null = null;

function applyHover(h: Hover) {
  if (h.inside) pauseCountdown();
  else resumeCountdown();

  const under = h.inside ? document.elementFromPoint(h.x, h.y) : null;
  const target = under?.closest("button, a") ?? null;

  if (target !== hovered) {
    hovered?.classList.remove("is-hover");
    hovered = target;
    hovered?.classList.add("is-hover");
  }

  // NOTE: the cursor is deliberately not driven from here.
  //
  // `cursor: pointer` in the stylesheet does nothing while the panel is
  // unfocused, for the same reason `:hover` does not match — but asking the app
  // to set it was worse. On a window that is not key, `CursorIcon::Hand` takes
  // effect and `CursorIcon::Default` does not clear it, so the pointer stuck
  // and bled across the whole panel. The real fix is a non-activating NSPanel,
  // which would make all of this native; see hover.rs.
}

void listen<Hover>("muninn://hover", (e) => applyHover(e.payload));

// Kept as well, for the case where the window *has* been clicked: these fire
// immediately, where the poller can be up to its interval late.
// A DOM enter only ever fires in a key window, and a key window is
// guaranteed its mouseleave — so this hold need not expire. The poller's
// holds do, because the poller's death must not freeze the countdown.
root.addEventListener("mouseenter", () => pauseCountdown(Infinity), true);
root.addEventListener("mouseleave", () => resumeCountdown(), true);

// Esc dismisses, always. The panel does not hold focus when it appears — the
// app is an accessory, so showing it does not activate — which means this only
// fires once the user has actually engaged with it. That is the intended
// trade: no stolen keystrokes, and the key works the moment they look.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    dismiss();
    return;
  }

  if (view && view.total > 1) {
    if (event.key === "ArrowLeft") handlers.onPage?.(-1);
    if (event.key === "ArrowRight") handlers.onPage?.(1);
  }
});

// --- appearance -------------------------------------------------------------

type Theme = "system" | "light" | "dark";

/**
 * Apply the menu bar's light/dark override.
 *
 * "system" removes the attribute entirely rather than setting it to something,
 * so the stylesheet's `prefers-color-scheme` query is back in charge — see the
 * mapping block in styles/tokens.css.
 */
function applyTheme(theme: Theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  measure();
}

void invoke<Theme>("appearance").then(applyTheme);
void listen<Theme>("muninn://appearance", (e) => applyTheme(e.payload));

// --- events -----------------------------------------------------------------

let view: View | null = null;

void listen<View>("muninn://view", (incoming) => {
  view = incoming.payload;
  paint(view);
});

// A window reopened from the tray needs its content back without waiting for a
// new event.
void invoke<View | null>("current_view").then((current) => {
  view = current;
  paint(view);
});

// Re-measure when the system theme flips, since type metrics can shift with it.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", measure);
