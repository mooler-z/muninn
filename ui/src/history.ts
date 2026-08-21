/**
 * The history window.
 *
 * Two levels. Projects first, because "which repo" is the question you actually
 * arrive with — a single flat list mixes four repositories together and makes
 * you scan past three of them to find the one you meant. Choosing one opens its
 * turns, newest first and grouped by day, as section 08 of the design lays out.
 *
 * A list, not a dashboard: the only number anywhere is how many turns a project
 * has, and that is there to help you pick between them. Clicking a turn opens
 * it in the details window, which already renders a summary and does not need a
 * second reader beside it.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { closeButton } from "./render";
import { PHOSPHOR, PHOSPHOR_BOX } from "./phosphor";
import type { MuninnEvent } from "./types";

import "./styles/tokens.css";
import "./styles/panel.css";
import "./styles/history.css";

const root = document.getElementById("root")!;

const report = (what: string, e: unknown) =>
  void invoke("report_error", {
    message: `history ${what}: ${e instanceof Error ? (e.stack ?? e.message) : e}`,
  });
window.addEventListener("error", (e) => report("uncaught", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => report("unhandled rejection", e.reason));

type Child = Node | string | null | false;

function el(tag: string, className?: string, ...kids: Child[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const k of kids) if (k !== null && k !== false) node.append(typeof k === "string" ? document.createTextNode(k) : k);
  return node;
}

function glyph(name: string, size = 14): SVGElement | null {
  const body = PHOSPHOR[name];
  if (!body) return null;
  const wrap = document.createElement("div");
  wrap.innerHTML =
    `<svg class="mn-glyph" width="${size}" height="${size}" viewBox="0 0 ${PHOSPHOR_BOX} ${PHOSPHOR_BOX}" ` +
    `fill="currentColor" aria-hidden="true">${body}</svg>`;
  return wrap.firstElementChild as SVGElement;
}

/** Today, Yesterday, then the date — as the design groups them. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(/\s+/g, "");
};

/** The one line each row gets, in the agent's own words where there are any. */
function line(e: MuninnEvent): string {
  const s = e.summary;
  if (s?.blocked) return `Blocked — ${s.blocked}`;
  if (s?.done) return s.done;
  const first = e.raw.split("\n").find((l) => l.trim());
  return first?.trim() || "Finished, no summary";
}

function status(e: MuninnEvent): { icon: string; needed: boolean } {
  if (e.kind === "needs-input") return { icon: "waiting", needed: true };
  if (e.summary?.blocked) return { icon: "blocked", needed: true };
  return { icon: "done", needed: false };
}

let all: MuninnEvent[] = [];
/** Null while showing the project list; a name once one has been chosen. */
let chosen: string | null = null;
/** What is being searched for, lower-cased. Empty means everything. */
let query = "";

const UNKNOWN = "—";
const nameOf = (e: MuninnEvent) => e.project ?? UNKNOWN;

/** Projects in order of when each last finished something. */
function projects(): { name: string; turns: MuninnEvent[] }[] {
  const byName = new Map<string, MuninnEvent[]>();
  for (const e of all) {
    const key = nameOf(e);
    const list = byName.get(key);
    if (list) list.push(e);
    else byName.set(key, [e]);
  }
  // `all` is newest-first, so insertion order is already most-recent-first.
  return [...byName].map(([name, turns]) => ({ name, turns }));
}

/**
 * Everything about a turn that is worth searching.
 *
 * The prompt is in here, which is the point of storing it on the event — a
 * history you can only search by its answers is half a history. The raw body
 * is included too, so the fallback path (a turn with no structured summary) is
 * as findable as any other.
 */
function haystack(e: MuninnEvent): string {
  const s = e.summary;
  return [
    e.project,
    e.gitBranch,
    e.prompt,
    s?.done,
    s?.verified,
    s?.next,
    s?.blocked,
    s?.risk,
    s?.explain,
    ...(s?.changed ?? []).flatMap((c) => [c.path, c.note]),
    s ? null : e.raw,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/** Where the match was, so a row can say why it is in the results. */
function why(e: MuninnEvent): string | null {
  if (!query) return null;
  const check = (label: string, text: string | null | undefined) =>
    text && text.toLowerCase().includes(query) ? `${label}: ${text}` : null;

  return (
    check("Asked", e.prompt) ??
    check("Done", e.summary?.done) ??
    check("Next", e.summary?.next) ??
    check("Blocked", e.summary?.blocked) ??
    check("Verified", e.summary?.verified) ??
    check("Explains", e.summary?.explain) ??
    (e.summary
      ? (e.summary.changed.find((c) => (c.path ?? "").toLowerCase().includes(query))?.path ?? null)
      : check("Body", e.raw))
  );
}

const matches = (e: MuninnEvent) => !query || haystack(e).includes(query);

/**
 * The text, with every occurrence of the search term wrapped.
 *
 * Built as nodes rather than by interpolating `<mark>` into a string: this is
 * a project name, a prompt, or an agent's own words, none of which are ours to
 * trust with innerHTML.
 */
function marked(text: string): Node {
  if (!query) return document.createTextNode(text);

  const fragment = document.createDocumentFragment();
  const lower = text.toLowerCase();
  let from = 0;

  for (;;) {
    const at = lower.indexOf(query, from);
    if (at === -1) break;
    if (at > from) fragment.append(text.slice(from, at));
    const hit = document.createElement("mark");
    hit.className = "hs-mark";
    hit.textContent = text.slice(at, at + query.length);
    fragment.append(hit);
    from = at + query.length;
  }

  fragment.append(text.slice(from));
  return fragment;
}

/**
 * The search field.
 *
 * One box for both levels. Project names rank above everything else because
 * "which repo" is the question you arrive with; text inside prompts and
 * summaries is what you fall back to when you cannot remember which repo it
 * was.
 */
function searchBox(): HTMLElement {
  const input = el("input", "hs-search-input") as HTMLInputElement;
  input.type = "search";
  input.placeholder = chosen ? `Search ${chosen}` : "Search projects, prompts, summaries";
  input.value = query;
  input.setAttribute("aria-label", "Search history");

  input.addEventListener("input", () => {
    query = input.value.trim().toLowerCase();
    render();
    // Re-rendering replaces the field, so focus and caret have to be put back
    // or every keystroke would be the last one.
    const fresh = root.querySelector<HTMLInputElement>(".hs-search-input");
    fresh?.focus();
    fresh?.setSelectionRange(fresh.value.length, fresh.value.length);
  });

  return el("label", "hs-search", glyph("search", 14), input);
}

/**
 * Projects, narrowed and ordered by how well they match.
 *
 * A project whose *name* matches goes above one that merely contains a turn
 * mentioning the term. That ordering is the whole of "search by project name
 * first": when you can remember the repo you get it immediately, and when you
 * cannot you still find it by something you said.
 */
function ranked(groups: { name: string; turns: MuninnEvent[] }[]) {
  if (!query) return groups;

  return groups
    .map((group) => {
      const named = group.name.toLowerCase().includes(query);
      const hits = group.turns.filter(matches);
      return { ...group, named, hits };
    })
    .filter((group) => group.named || group.hits.length > 0)
    // A named project keeps all of its turns; one found by its contents shows
    // only the turns that were actually found.
    .map((group) => ({ ...group, turns: group.named ? group.turns : group.hits }))
    .sort((a, b) => Number(b.named) - Number(a.named));
}

/**
 * The history as Markdown.
 *
 * Markdown rather than JSON by default because these are summaries written to
 * be read — the point of exporting them is to put them somewhere a person will
 * look, a notebook or a standup note, not to feed them to another program.
 * JSON is offered too, for when it is the other thing.
 */
function asMarkdown(events: MuninnEvent[], title: string): string {
  const out: string[] = [`# ${title}`, ""];
  out.push(`_${events.length} turn${events.length === 1 ? "" : "s"}, exported from Muninn._`, "");

  let day: string | null = null;
  for (const e of events) {
    const label = dayLabel(e.receivedAt);
    if (label !== day) {
      day = label;
      out.push(`## ${label}`, "");
    }

    const s = e.summary;
    out.push(`### ${time(e.receivedAt)} — ${e.project ?? UNKNOWN}${e.gitBranch ? ` (${e.gitBranch})` : ""}`, "");
    if (e.prompt) out.push(`**Asked:** ${e.prompt}`, "");
    if (s?.done) out.push(`**Done:** ${s.done}`, "");
    if (s?.blocked) out.push(`**Blocked:** ${s.blocked}`, "");
    if (s?.changed.length) {
      out.push("**Changed:**", "");
      for (const c of s.changed) out.push(`- ${c.path ? `\`${c.path}\` — ` : ""}${c.note}`);
      out.push("");
    }
    // Quoted, and labelled as reported, exactly as the panel renders it.
    // Design principle §5 does not stop applying because the text left the app.
    if (s?.verified) out.push(`**Verified — reported:** “${s.verified}”`, "");
    if (s?.next) out.push(`**Next:** ${s.next}`, "");
    if (s?.risk) out.push(`**Risk:** ${s.risk}`, "");
    if (s?.explain) out.push("", s.explain, "");
    if (!s) out.push(e.raw, "");
    out.push("---", "");
  }

  return out.join("\n");
}

/**
 * Write the history out, wherever the user says.
 *
 * Through a save dialogue rather than to a fixed path: the file carries
 * working directories and an agent's full output, so where it lands is a
 * decision worth making rather than one to discover afterwards.
 */
function exportButton(rows: () => MuninnEvent[], stem: string): HTMLElement {
  const button = el("button", "mn-details mn-glass hs-export", glyph("export", 13), el("span", undefined, "Export"));
  (button as HTMLButtonElement).type = "button";

  button.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    const events = rows();
    if (events.length === 0) return;

    const markdown = asMarkdown(events, stem === "muninn-history" ? "Muninn history" : `Muninn — ${chosen}`);
    void invoke("export_history", {
      stem,
      markdown,
      json: JSON.stringify(events, null, 2),
    }).catch((err) => report("export", err));
  });

  return button;
}

function head(...actions: Child[]) {
  return el(
    "header",
    "hs-head",
    ...actions,
    el("span", "hs-actions", closeButton(() => void invoke("close_history"))),
  );
}

function renderProjects() {
  const groups = ranked(projects());

  root.append(
    el("div", "hs-drag"),
    head(
      el("span", "hs-title mn-fact", "History"),
      searchBox(),
      exportButton(() => all, "muninn-history"),
    ),
  );

  const list = el("div", "hs-list");
  if (groups.length === 0) {
    list.append(
      el("p", "hs-empty mn-voice", query ? `Nothing matches “${query}”.` : "Nothing here yet."),
    );
  }

  for (const { name, turns } of groups) {
    const latest = turns[0]!;
    const st = status(latest);
    const row = el(
      "button",
      `hs-project-row${st.needed ? " hs-row--needed" : ""}`,
      el("span", "hs-icon", glyph("folder", 16)),
      el(
        "span",
        "hs-project-id",
        el("span", "hs-project-name mn-fact", marked(name)),
        el("span", "hs-line mn-voice", marked(line(latest))),
      ),
      el(
        "span",
        "hs-project-meta",
        el("span", "hs-count mn-fact", `${turns.length} ${turns.length === 1 ? "turn" : "turns"}`),
        el("span", "hs-time", time(latest.receivedAt)),
      ),
      el("span", "hs-chevron", glyph("next", 13)),
    );
    (row as HTMLButtonElement).type = "button";
    row.addEventListener("click", () => {
      chosen = name;
      render();
    });
    list.append(row);
  }

  root.append(list, el("footer", "hs-foot mn-fact", "Kept on this Mac · last 50 turns"));
}

function renderTurns(name: string) {
  const back = el("button", "mn-details mn-glass hs-back", glyph("prev", 13), el("span", undefined, "Projects"));
  (back as HTMLButtonElement).type = "button";
  back.addEventListener("click", () => {
    chosen = null;
    query = "";
    render();
  });

  const mine = () => all.filter((e) => nameOf(e) === name);

  root.append(
    el("div", "hs-drag"),
    head(
      back,
      el("span", "hs-title mn-fact", name),
      searchBox(),
      exportButton(() => mine().filter(matches), `muninn-${name}`),
    ),
  );

  const rows = mine().filter(matches);
  const list = el("div", "hs-list");
  if (rows.length === 0) {
    list.append(
      el("p", "hs-empty mn-voice", query ? `Nothing matches “${query}”.` : "Nothing here yet."),
    );
  }

  let group: string | null = null;
  for (const e of rows) {
    const label = dayLabel(e.receivedAt);
    if (label !== group) {
      group = label;
      list.append(el("div", "hs-day mn-fact", label));
    }

    const st = status(e);
    // Why this row is in the results, when it is not already obvious from the
    // headline — searching for something you said should show you where you
    // said it, not just that a turn exists.
    const context = why(e);
    const row = el(
      "button",
      `hs-row${st.needed ? " hs-row--needed" : ""}`,
      el("span", "hs-icon", glyph(st.icon, 15)),
      el("span", "hs-time", time(e.receivedAt)),
      el(
        "span",
        "hs-lines",
        el("span", "hs-line mn-voice", marked(line(e))),
        context && !line(e).toLowerCase().includes(query)
          ? el("span", "hs-why mn-voice", context)
          : null,
      ),
    );
    (row as HTMLButtonElement).type = "button";
    row.addEventListener("click", () => {
      // Sent first, so the details window has the term before it renders.
      void invoke("highlight", { term: query });
      void invoke("show_from_history", { id: e.id });
    });
    list.append(row);
  }

  root.append(list, el("footer", "hs-foot mn-fact", "Kept on this Mac · last 50 turns"));
}

function render() {
  root.replaceChildren();
  if (chosen === null) renderProjects();
  else renderTurns(chosen);
}

async function load() {
  all = await invoke<MuninnEvent[]>("history");
  // A project that has emptied out — cleared history, say — should not leave
  // the window staring at a list that no longer exists.
  if (chosen !== null && !all.some((e) => nameOf(e) === chosen)) chosen = null;
  render();
}

void load();
// The list is live: a turn finishing while this is open appears at the top.
void listen("muninn://view", () => void load());

// Unrolled from its header each time the window is shown — the window is
// hidden rather than destroyed, so this module only runs once.
void listen("muninn://history-opened", () => {
  // Replayed by removing and re-adding the class: the window is hidden
  // rather than destroyed, so the animation would otherwise only ever run
  // the first time it was opened.
  root.classList.remove("hs-opening");
  void root.offsetWidth;
  root.classList.add("hs-opening");
});

type Theme = "system" | "light" | "dark";
function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
void invoke<Theme>("appearance").then(applyTheme);
void listen<Theme>("muninn://appearance", (e) => applyTheme(e.payload));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Escape steps back out of a project before it closes the window.
  if (chosen !== null) {
    chosen = null;
    render();
    return;
  }
  void invoke("close_history");
});
