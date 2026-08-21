/**
 * The details window.
 *
 * Everything the panel had to leave out: every `changed` entry rather than a
 * collapsed list, the agent's message in full, and the working directory and
 * session it arrived from.
 *
 * Laid out in two columns. A single column of prose in a window half the width
 * of the screen leaves most of it empty and pushes the provenance so far below
 * the summary that nobody scrolls to it — so the account reads down the left at
 * a sane measure, and the facts about where it came from sit beside it.
 *
 * It reuses the panel's tokens and registers: the agent's prose stays in
 * `.mn-voice`, facts Muninn knows stay in tracked capitals, and `verified` is
 * still quoted and still labelled reported. Somewhere with more room is exactly
 * where those distinctions would be easiest to let slip.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { PHOSPHOR, PHOSPHOR_BOX } from "./phosphor";
import { closeButton, pagerControl } from "./render";
import type { MuninnEvent, View } from "./types";

import "./styles/tokens.css";
import "./styles/panel.css";
import "./styles/details.css";

const root = document.getElementById("root")!;

const report = (what: string, e: unknown) =>
  void invoke("report_error", {
    message: `details ${what}: ${e instanceof Error ? (e.stack ?? e.message) : e}`,
  });
window.addEventListener("error", (e) => report("uncaught", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => report("unhandled rejection", e.reason));

type Child = Node | string | null | false;

function el(tag: string, className?: string, ...children: Child[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function glyph(name: string, size = 16): SVGElement | null {
  const body = PHOSPHOR[name];
  if (!body) return null;
  const wrapper = document.createElement("div");
  // Generated path data from tools/extract-icons.py — nothing interpolated.
  wrapper.innerHTML =
    `<svg class="mn-glyph" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${PHOSPHOR_BOX} ${PHOSPHOR_BOX}" fill="currentColor" aria-hidden="true">` +
    `${body}</svg>`;
  return wrapper.firstElementChild as SVGElement;
}

/** The same masked mark as the panel — see logo() in render.ts. */
function logo(): HTMLElement {
  const mark = el("span", "dt-logo");
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

/** Long values that are not prose — paths, ids — set so they can be copied. */
const mono = (value: string) => el("code", "dt-mono", value);

function block(title: string, icon: string | null, ...content: Child[]) {
  return el(
    "section",
    "dt-block",
    el("h2", "dt-label mn-fact", icon ? glyph(icon, 15) : null, el("span", undefined, title)),
    ...content,
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SOURCE_LABEL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

/** Word, glyph, and whether the user is the blocker — as on the panel. */
const STATUS: Record<string, { word: string; icon: string; needed: boolean }> = {
  completed: { word: "Finished", icon: "done", needed: false },
  "needs-input": { word: "Waiting on you", icon: "waiting", needed: true },
  failed: { word: "Failed", icon: "blocked", needed: true },
};

/** What was searched for to get here, if anything. */
let highlightTerm = "";

/**
 * Wrap every occurrence of the term, wherever it appears.
 *
 * Walks the text nodes rather than working on markup. Most of what is on this
 * page is markdown the app rendered from an agent's message, and rewriting
 * that as a string would mean putting untrusted HTML back through innerHTML —
 * and would break any match that happened to straddle a tag. A walker only
 * ever sees text, so neither problem exists.
 */
function markMatches(root: HTMLElement, term: string) {
  if (!term) return;
  const needle = term.toLowerCase();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.toLowerCase().includes(needle)) return NodeFilter.FILTER_REJECT;
      // Never inside a mark this pass already made.
      if ((node.parentElement?.closest("mark"))) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collected first: replacing nodes while the walker is mid-traversal is how
  // you get an infinite loop over your own output.
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node as Text);

  for (const node of found) {
    const text = node.nodeValue!;
    const lower = text.toLowerCase();
    const fragment = document.createDocumentFragment();
    let from = 0;

    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at === -1) break;
      if (at > from) fragment.append(text.slice(from, at));
      const hit = document.createElement("mark");
      hit.className = "dt-mark";
      hit.textContent = text.slice(at, at + needle.length);
      fragment.append(hit);
      from = at + needle.length;
    }

    fragment.append(text.slice(from));
    node.replaceWith(fragment);
  }
}

function render(view: View | null) {
  root.replaceChildren();

  const close = closeButton(() => void invoke("close_details"));

  if (!view) {
    root.append(
      el("div", "dt-drag"),
      el("div", "dt-scroll", el("p", "dt-empty mn-voice", "Nothing on screen.")),
      el("div", "dt-close", close),
    );
    return;
  }

  const event: MuninnEvent = view.event;
  const summary = event.summary;
  const status = STATUS[event.kind] ?? STATUS.completed!;

  // --- the account, down the left -----------------------------------------

  const main = el("div", "dt-main");

  // Identity leads the account rather than sitting in a chrome bar above it.
  main.append(
    el(
      "div",
      "dt-head",
      logo(),
      el(
        "span",
        "dt-head-id",
        el("span", "dt-project mn-fact", event.project ?? "—"),
        event.gitBranch ? el("span", "dt-branch", event.gitBranch) : null,
      ),
    ),
  );

  main.append(
    el(
      "div",
      `dt-status${status.needed ? " dt-status--needed" : ""}`,
      glyph(summary?.blocked ? "blocked" : status.icon, 17),
      el("span", "mn-fact", summary?.blocked ? "Blocked" : status.word),
    ),
  );

  const headline = summary?.blocked ?? summary?.done ?? null;
  if (headline) main.append(el("p", "dt-headline mn-voice", headline));

  // What was asked for. Stored on the event now, so it is usually here
  // immediately; the command is the fallback for turns recorded before prompts
  // were kept, and it reads a transcript that can be tens of megabytes — which
  // is why nothing waits on it.
  const asked = el("section", "dt-block dt-asked");
  main.append(asked);

  const showAsked = (prompt: string) =>
    asked.append(
      el("h2", "dt-label mn-fact", glyph("asked", 15), el("span", undefined, "You asked")),
      el("blockquote", "dt-prompt mn-voice", prompt),
    );

  if (event.prompt) {
    showAsked(event.prompt);
  } else {
    void invoke<string | null>("user_prompt").then((prompt) => {
      if (!prompt) return;
      showAsked(prompt);
      markMatches(asked, highlightTerm);
    });
  }

  if (summary?.blocked && summary.done) {
    main.append(block("Done", "done", el("p", "dt-value mn-voice", summary.done)));
  }

  if (view.explainHtml.trim()) {
    const prose = el("div", "mn-raw mn-voice dt-raw");
    // Markdown already rendered and stripped of raw tags in Rust.
    prose.innerHTML = view.explainHtml;
    main.append(block("What happened", "explain", prose));
  }

  if (summary?.changed.length) {
    const rows = summary.changed.map((item) => {
      const row = el("li", "dt-changed");
      if (item.path) row.append(mono(item.path));
      if (item.path && item.note) row.append(document.createTextNode(" — "));
      if (item.note) row.append(document.createTextNode(item.note));
      return row;
    });
    main.append(
      block(
        `Changed · ${summary.changed.length}`,
        "changed",
        el("ul", "dt-list", ...rows),
      ),
    );
  }

  if (summary?.verified) {
    main.append(
      block(
        "Verified — reported",
        "verified",
        el("p", "dt-value mn-voice mn-claim", summary.verified),
        // The honesty rule, said out loud. The panel has only type to carry it;
        // here there is room to write it down.
        el("p", "dt-caveat", "Reported by the agent. Muninn did not check this."),
      ),
    );
  }

  if (summary?.next) main.append(block("Next", "next", el("p", "dt-value mn-voice", summary.next)));
  if (summary?.risk) main.append(block("Risk", "risk", el("p", "dt-value mn-voice", summary.risk)));
  for (const [key, value] of summary?.extra ?? []) {
    main.append(block(key, null, el("p", "dt-value mn-voice", value)));
  }

  if (view.rawHtml.trim()) {
    const prose = el("div", "mn-raw mn-voice dt-raw");
    // Markdown already rendered and stripped of raw tags in Rust — see
    // src-tauri/src/markdown.rs.
    prose.innerHTML = view.rawHtml;
    main.append(block(summary ? "The rest of the message" : "The agent's message", null, prose));
  }

  if (!summary && !view.rawHtml.trim()) {
    main.append(el("p", "dt-empty mn-voice", "The agent left no summary."));
  }

  // --- where it came from, beside it --------------------------------------

  const side = el("aside", "dt-side");
  const fact = (icon: string | null, term: string, value: Node | string | null) => {
    if (value === null) return;
    side.append(
      el(
        "div",
        "dt-fact",
        el("span", "dt-fact-key mn-fact", icon ? glyph(icon, 13) : null, el("span", undefined, term)),
        el("span", "dt-fact-value", value),
      ),
    );
  };

  fact("folder", "Directory", event.cwd ? mono(event.cwd) : null);
  fact("branch", "Branch", event.gitBranch ? mono(event.gitBranch) : null);
  fact("agent", "Agent", SOURCE_LABEL[event.source] ?? event.source);
  fact("clock", "Received", formatWhen(event.receivedAt));
  fact(null, "Session", event.sessionId ? mono(event.sessionId) : null);

  if (view.total > 1) {
    side.append(
      el(
        "div",
        "dt-pager",
        pagerControl(view.position, view.total, (delta) => void invoke("page", { delta })),
      ),
    );
  }

  root.append(
    // A slim invisible strip so the window can still be moved without a bar.
    el("div", "dt-drag"),
    el("div", "dt-scroll", el("div", "dt-columns", main, side)),
    el("div", "dt-close", close),
  );

  // Last, over the finished page — including the prompt, which arrives
  // asynchronously on the fallback path and marks itself when it lands.
  markMatches(root, highlightTerm);
}

// The window shows whatever the panel shows, so it follows the same feed and
// updates live while it is open — including when the queue is paged.
// Unrolled from its head each time the window is shown. The window is hidden
// rather than destroyed between openings, so this module only ever runs once.
// How you arrived here: a term typed in the history window, sent through the
// app because the two webviews cannot see each other.
void listen<string>("muninn://highlight", (e) => {
  highlightTerm = e.payload ?? "";
  // Re-marked immediately, for the case where the window is already open on
  // the summary being searched for.
  if (highlightTerm) markMatches(root, highlightTerm);
});

void listen("muninn://details-opened", () => {
  // Replayed by removing and re-adding the class: the window is hidden
  // rather than destroyed, so the animation would otherwise only ever run
  // the first time it was opened.
  root.classList.remove("dt-opening");
  void root.offsetWidth;
  root.classList.add("dt-opening");
});

void listen<View>("muninn://view", (incoming) => {
  current = incoming.payload;
  render(current);
});
void invoke<View | null>("current_view").then((view) => {
  current = view;
  render(view);
});

type Theme = "system" | "light" | "dark";
function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
void invoke<Theme>("appearance").then(applyTheme);
void listen<Theme>("muninn://appearance", (e) => applyTheme(e.payload));

let current: View | null = null;

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void invoke("close_details");
    return;
  }
  if (current && current.total > 1) {
    if (event.key === "ArrowLeft") void invoke("page", { delta: -1 });
    if (event.key === "ArrowRight") void invoke("page", { delta: 1 });
  }
});
