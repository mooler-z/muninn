/**
 * Building the panel.
 *
 * Everything is constructed as DOM nodes with `textContent`, never by
 * assembling an HTML string. The text being rendered is whatever the agent
 * wrote, and this is the one place it meets the document — so there is exactly
 * one `innerHTML` in this file, for markdown that `src-tauri/src/markdown.rs`
 * has already stripped of raw tags, and it is commented as such.
 *
 * On the two registers and where colour is allowed, see the note at the top of
 * `styles/panel.css`. The short version: prose the agent wrote is `.mn-voice`,
 * facts Muninn knows are `.mn-fact`, and the accent appears only where the user
 * is the blocker.
 */

import { PHOSPHOR, PHOSPHOR_BOX } from "./phosphor";
import type { MuninnEvent, Summary, View } from "./types";

/**
 * The sentence that takes the headline slot.
 *
 * Mirrors `Summary::headline` in `crates/muninn-core/src/summary.rs`: blocked
 * outranks done, because it is the only field that requires the user to act.
 */
function headline(summary: Summary | null): string | null {
  return summary?.blocked ?? summary?.done ?? null;
}

// --- small DOM helpers ------------------------------------------------------

type Child = Node | string | null | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function svg(paths: string, size = 13, box = 14, strokeWidth = 1.3): SVGElement {
  const wrapper = document.createElement("div");
  // Static markup written here in this file, with no interpolation of anything
  // the agent produced.
  wrapper.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" fill="none" ` +
    `stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
    `stroke-linejoin="round">${paths}</svg>`;
  return wrapper.firstElementChild as SVGElement;
}

const icons = {
  finished: () => svg(`<path d="M2.5 7.6l3.1 3.1L11.5 4"></path>`),
  blocked: () => svg(`<circle cx="7" cy="7" r="5.4"></circle><path d="M4.6 7h4.8"></path>`),
  waiting: () =>
    svg(
      `<circle cx="7" cy="7" r="5.4"></circle>` +
        `<circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none"></circle>`,
    ),
  prev: () => svg(`<path d="M6.2 1.8L3 5l3.2 3.2"></path>`, 11, 10, 1.2),
  next: () => svg(`<path d="M3.8 1.8L7 5L3.8 8.2"></path>`, 11, 10, 1.2),
  // Still the largest glyph on the panel, but set in the panel's ink rather
  // than white — at stroke 2 in a muted colour it reads clearly without
  // shouting.
  close: () => svg(`<path d="M3.5 3.5l7 7M10.5 3.5l-7 7"></path>`, 15, 14, 1.8),
};

// --- pieces -----------------------------------------------------------------

const SOURCE_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  // "4:42 pm", as the design sets it — lower case, which reads quieter than
  // the default capitals.
  return date
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * The raven, in the corner where the project's initial used to be.
 *
 * The artwork is the same file the app icon is built from, so the mark in the
 * panel and the one in the menu bar cannot drift apart. It is drawn as a CSS
 * mask rather than an `img`: the source is a black silhouette, which would
 * vanish against the dark theme, and masking lets it take `currentColor` the
 * way the rest of the panel's marks do.
 */
function logo(): HTMLElement {
  const mark = el("span", "mn-logo");
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

/** Project, branch, source, time — all of it first-hand, all of it tracked. */
function header(event: MuninnEvent): HTMLElement {
  const project = event.project ?? "—";

  return el(
    "div",
    "mn-head",
    el("span", "mn-avatar", logo()),
    el(
      "span",
      "mn-head-id",
      el("span", "mn-project mn-fact", project),
      event.gitBranch ? el("span", "mn-branch", event.gitBranch) : null,
    ),
    el(
      "span",
      "mn-head-meta",
      el("span", "mn-source mn-fact", SOURCE_LABEL[event.source] ?? event.source),
      el("span", "mn-time", formatTime(event.receivedAt)),
    ),
  );
}

type StatusTone = "settled" | "needed";

function status(word: string, icon: SVGElement, tone: StatusTone): HTMLElement {
  return el(
    "div",
    `mn-status${tone === "needed" ? " mn-status--needed" : ""}`,
    icon,
    el("span", "mn-status-word mn-fact", word),
  );
}

/**
 * A Phosphor glyph, sized to sit on a label's cap height.
 *
 * Phosphor draws filled paths on a 256 grid rather than strokes, so these are
 * filled with `currentColor` and inherit the label's own ink.
 */
function glyph(name: string): SVGElement | null {
  const body = PHOSPHOR[name];
  if (!body) return null;
  const wrapper = document.createElement("div");
  // Generated path data from tools/extract-icons.py — nothing interpolated.
  wrapper.innerHTML =
    `<svg class="mn-glyph" width="16" height="16" viewBox="0 0 ${PHOSPHOR_BOX} ${PHOSPHOR_BOX}" ` +
    `fill="currentColor" aria-hidden="true">${body}</svg>`;
  return wrapper.firstElementChild as SVGElement;
}

/** The label above a field: its glyph and its word, in Muninn's own register. */
function label(text: string, icon?: string): HTMLElement {
  return el("span", "mn-label mn-fact", icon ? glyph(icon) : null, el("span", undefined, text));
}

function field(
  text: string,
  value: string,
  secondary = false,
  claim = false,
  icon?: string,
): HTMLElement {
  const classes = ["mn-value", "mn-voice"];
  if (secondary) classes.push("mn-value--secondary");
  if (claim) classes.push("mn-claim");

  return el("div", "mn-field", label(text, icon), el("p", classes.join(" "), value));
}

function changedList(summary: Summary): HTMLElement | null {
  if (summary.changed.length === 0) return null;

  const rows = summary.changed.map((item) => {
    const row = el("p", "mn-changed");
    if (item.path) row.append(el("span", "mn-path", item.path));
    if (item.path && item.note) row.append(document.createTextNode(" — "));
    if (item.note) row.append(document.createTextNode(item.note));
    return row;
  });

  return el("div", "mn-field mn-field--list", label("Changed", "changed"), ...rows);
}

function terminalLink(event: MuninnEvent, onOpenTerminal?: (cwd: string | null) => void) {
  const button = el("button", "mn-action", "Open the terminal →");
  button.type = "button";
  button.addEventListener("click", () => onOpenTerminal?.(event.cwd));
  return button;
}

// --- the states -------------------------------------------------------------

export interface Handlers {
  onDismiss?: () => void;
  onDetails?: () => void;
  onHistory?: () => void;
  onPage?: (delta: number) => void;
  onOpenTerminal?: (cwd: string | null) => void;
}

/** The scrolling middle of the panel — everything between header and footer. */
function body(view: View, handlers: Handlers): Child[] {
  const { event, rawHtml } = view;
  const summary = event.summary;

  if (event.kind === "needs-input") {
    // Claude Code's `Notification` payload carries no text, so most of the time
    // there is no question to quote. Saying which command was asked about would
    // mean inventing it.
    const question = headline(summary);
    return [
      status("Waiting on you", icons.waiting(), "needed"),
      el("p", "mn-headline mn-voice", question ?? "The agent is waiting for an answer."),
      el("p", "mn-value mn-value--secondary", "Paused until you answer in the terminal."),
      terminalLink(event, handlers.onOpenTerminal),
    ];
  }

  // Nothing came back at all. Say so; never fabricate — design principle §5.
  if (!summary && !rawHtml.trim()) {
    return [
      status("Finished", icons.finished(), "settled"),
      el("p", "mn-headline mn-headline--muted mn-voice", "The agent left no summary."),
    ];
  }

  // The raw fallback. Same chrome, and the first paragraph gets the headline
  // type — an agent that writes prose is not broken, so this is not styled as
  // a degraded state. The only flag is the quiet "as written" line.
  if (!summary) {
    const prose = el("div", "mn-raw mn-voice");
    // The one innerHTML: markdown already rendered and stripped of raw tags in
    // Rust. See src-tauri/src/markdown.rs.
    prose.innerHTML = rawHtml;

    return [
      el(
        "div",
        "mn-status-row",
        status("Finished", icons.finished(), "settled"),
        el("span", "mn-asis mn-fact", "as written"),
      ),
      prose,
    ];
  }

  // Blocked escalates by position: it takes the headline slot and `done` moves
  // one notch down. No banner, no second colour.
  if (summary.blocked) {
    return [
      status("Blocked", icons.blocked(), "needed"),
      el("p", "mn-headline mn-voice", summary.blocked),
      terminalLink(event, handlers.onOpenTerminal),
      el("div", "mn-rule"),
      summary.done ? field("Done", summary.done, false, false, "done") : null,
      summary.next ? field("Next", summary.next, true, false, "next") : null,
    ];
  }

  const parts: Child[] = [
    status("Finished", icons.finished(), "settled"),
    el("p", "mn-headline mn-voice", summary.done ?? "Finished."),
  ];

  const details =
    summary.changed.length > 0 || summary.verified || summary.next || summary.risk;
  if (details) parts.push(el("div", "mn-rule"));

  parts.push(changedList(summary));
  if (summary.verified) {
    // The label is permanently "reported" and the value is quoted by the
    // stylesheet. Muninn checked nothing — see design principle §5.
    parts.push(field("Verified — reported", summary.verified, true, true, "verified"));
  }
  if (summary.next) parts.push(field("Next", summary.next, false, false, "next"));
  if (summary.risk) parts.push(field("Risk", summary.risk, true, false, "risk"));
  for (const [key, value] of summary.extra) parts.push(field(key, value, true));

  return parts;
}

/** Ring geometry. The circumference is 2π × r, and the dash array depends on
 *  it, so these move together or the countdown stops reaching empty. */
const RING_BOX = 46;
const RING_RADIUS = 21;
const RING_STROKE = 3;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Class on every arc that empties — `panel.ts` drives their `stroke-dashoffset`
 * together.
 *
 * There is more than one because the ring is built in layers to give it some
 * depth: a cast shadow underneath, the gradient body, and a gloss on top. They
 * have to advance as one or the ring comes apart as it empties.
 */
export const RING_ARC = "mn-ring-arc";

let ringInstance = 0;

/**
 * The ring, and the button it wraps.
 *
 * The ring starts full and empties as the panel's time runs out. Drawing it at
 * full here rather than at whatever the current count is keeps this function
 * pure — the countdown belongs to the window, not to a render pass.
 */
function dismissControl(handlers: Handlers): HTMLElement {
  const c = RING_BOX / 2;
  // A gradient is referenced by id, and an id resolves to whichever element
  // defined it first — so two panels in one document (the fixtures harness
  // shows eight) would all inherit the first one's colours. Unique per render.
  const gradient = `mn-ring-${++ringInstance}`;

  const dash = RING_CIRCUMFERENCE.toFixed(1);
  const spin = `rotate(-90 ${c} ${c})`;

  /** One layer of the ring. All of them share the dash geometry. */
  const arc = (cls: string, width: number, stroke: string, extra = "") =>
    `<circle class="${RING_ARC} ${cls}" cx="${c}" cy="${c}" r="${RING_RADIUS}" ` +
    `stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ` +
    `stroke-dasharray="${dash}" stroke-dashoffset="0" transform="${spin}" ${extra}></circle>`;

  const ring = document.createElement("div");
  // Static markup, no interpolation of anything the agent wrote.
  ring.innerHTML =
    `<svg class="mn-dismiss-ring" width="${RING_BOX}" height="${RING_BOX}" ` +
    `viewBox="0 0 ${RING_BOX} ${RING_BOX}" fill="none">` +
    `<defs>` +
    // Lit from the top-left, so the gradient runs light → body → deep across
    // the ring rather than around it.
    `<linearGradient id="${gradient}" x1="0" y1="0" x2="0.9" y2="1">` +
    `<stop offset="0%" class="mn-ring-stop-a"></stop>` +
    `<stop offset="48%" class="mn-ring-stop-b"></stop>` +
    `<stop offset="100%" class="mn-ring-stop-c"></stop>` +
    `</linearGradient>` +
    `<linearGradient id="${gradient}-gloss" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0%" class="mn-ring-gloss-a"></stop>` +
    `<stop offset="60%" class="mn-ring-gloss-b"></stop>` +
    `</linearGradient>` +
    `</defs>` +
    // The groove the ring sits in.
    `<circle class="mn-ring-track" cx="${c}" cy="${c}" r="${RING_RADIUS}" ` +
    `stroke-width="${RING_STROKE + 0.5}"></circle>` +
    // Cast shadow, body, gloss: the three layers that give it thickness.
    arc("mn-ring-cast", RING_STROKE, "currentColor") +
    arc("mn-ring-body", RING_STROKE, `url(#${gradient})`) +
    arc("mn-ring-gloss", RING_STROKE * 0.42, `url(#${gradient}-gloss)`) +
    `</svg>`;

  return el("span", "mn-dismiss", ring.firstElementChild, closeButton(() => handlers.onDismiss?.()));
}

/**
 * The round close button.
 *
 * Exported because the details window uses the same control without the ring
 * around it — it has no countdown, since it is a window someone deliberately
 * opened rather than one that arrived on its own.
 */
export function closeButton(onClick: () => void): HTMLButtonElement {
  return roundButton(icons.close(), "Close", onClick);
}

/**
 * The panel's one control shape: a round button in the footer.
 *
 * There is exactly one of these shapes and both footer controls use it. Earlier
 * attempts gave Details a pill of its own, which put a second, wider control
 * language next to this one and looked like two unrelated things had been
 * bolted to the same panel.
 */
function roundButton(mark: SVGElement, label: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", "mn-round mn-glass", mark);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", onClick);
  return button;
}

function footer(handlers: Handlers): HTMLElement {
  const details = el("button", "mn-details mn-glass", glyph("details")!, el("span", undefined, "Details"));
  details.type = "button";
  details.addEventListener("click", () => handlers.onDetails?.());

  const history = el("button", "mn-details mn-glass", glyph("history")!, el("span", undefined, "History"));
  history.type = "button";
  history.addEventListener("click", () => handlers.onHistory?.());

  return el("div", "mn-foot", el("span", "mn-foot-left", details, history), dismissControl(handlers));
}

/**
 * The queue pager, and why it lives above the summary rather than below it.
 *
 * The panel is sized to its content and anchored by its top edge, so the
 * footer's position depends on how much the agent wrote. Paging through a
 * queue moved the buttons out from under the pointer on every step, which
 * turned "read the next one" into chasing a target around the screen.
 *
 * Everything above the content is at a fixed offset from the top edge. Putting
 * the pager here means the arrows stay exactly where they were clicked.
 */
function pager(view: View, handlers: Handlers): HTMLElement {
  const control = pagerControl(view.position, view.total, (d) => handlers.onPage?.(d));
  control.classList.add("mn-pager--ruled");
  return control;
}

/**
 * `‹ 2 of 3 ›`.
 *
 * Exported because the details window carries the same control. Paging is a
 * command on the app rather than window-local state, so whichever window is on
 * screen drives the same queue and both stay in step.
 */
export function pagerControl(
  position: number,
  total: number,
  onPage: (delta: number) => void,
): HTMLElement {
  const prev = el("button", "mn-step mn-glass", icons.prev());
  prev.type = "button";
  prev.disabled = position <= 1;
  prev.setAttribute("aria-label", "Previous summary");
  prev.addEventListener("click", () => onPage(-1));

  const next = el("button", "mn-step mn-glass", icons.next());
  next.type = "button";
  next.disabled = position >= total;
  next.setAttribute("aria-label", "Next summary");
  next.addEventListener("click", () => onPage(1));

  return el(
    "div",
    "mn-pager",
    prev,
    el(
      "span",
      "mn-count",
      el("span", "mn-count-now", String(position)),
      el("span", "mn-count-total mn-fact", `of ${total}`),
    ),
    next,
  );
}

export function renderPanel(view: View, handlers: Handlers = {}): HTMLElement {
  return el(
    "div",
    "mn-panel",
    header(view.event),
    view.total > 1 ? pager(view, handlers) : null,
    el("div", "mn-scroll", ...body(view, handlers)),
    footer(handlers),
  );
}
