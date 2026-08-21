/**
 * The corner notice.
 *
 * One message, five seconds, gone. The app owns the timing — this window only
 * draws what it is told and never decides to stay.
 *
 * Its own window rather than a state of the panel: see the note in notice.rs.
 * The short version is that a summary is something you asked for and a remark
 * about the network is not, so they must not be able to displace each other.
 */

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { PHOSPHOR, PHOSPHOR_BOX } from "./phosphor";

import "./styles/tokens.css";
import "./styles/panel.css";
import "./styles/notice.css";

const root = document.getElementById("root")!;

const report = (what: string, e: unknown) =>
  void invoke("report_error", {
    message: `notice ${what}: ${e instanceof Error ? (e.stack ?? e.message) : e}`,
  });
window.addEventListener("error", (e) => report("uncaught", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => report("unhandled rejection", e.reason));

interface Notice {
  title: string;
  body: string;
  urgent: boolean;
}

/** The same icon set the panel draws from, so the vocabulary is one
 *  vocabulary. Generated path data — nothing here is interpolated. */
function glyph(name: string, size = 16): SVGElement | null {
  const body = PHOSPHOR[name];
  if (!body) return null;
  const wrapper = document.createElement("div");
  wrapper.innerHTML =
    `<svg class="mn-glyph" width="${size}" height="${size}" viewBox="0 0 ${PHOSPHOR_BOX} ${PHOSPHOR_BOX}" ` +
    `fill="currentColor" aria-hidden="true">${body}</svg>`;
  return wrapper.firstElementChild as SVGElement;
}

function el(tag: string, className?: string, ...kids: (Node | string | null)[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const k of kids) if (k !== null) node.append(typeof k === "string" ? document.createTextNode(k) : k);
  return node;
}

function render(notice: Notice) {
  root.replaceChildren(
    el(
      "div",
      `nt-card${notice.urgent ? " nt-card--urgent" : ""}`,
      el(
        "span",
        "nt-icon",
        // The same two glyphs the panel uses for "you are needed" and "this
        // landed", so the vocabulary is one vocabulary.
        glyph(notice.urgent ? "blocked" : "done", 17),
      ),
      el(
        "span",
        "nt-text",
        el("span", "nt-title mn-fact", notice.title),
        el("span", "nt-body mn-voice", notice.body),
      ),
    ),
  );
}

void listen<Notice>("muninn://notice", (e) => render(e.payload));

type Theme = "system" | "light" | "dark";
function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
void invoke<Theme>("appearance").then(applyTheme);
void listen<Theme>("muninn://appearance", (e) => applyTheme(e.payload));
