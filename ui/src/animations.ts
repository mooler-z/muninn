/**
 * A playground for the panel's arrival animation.
 *
 * This exists because the animation was being iterated on blind: each attempt
 * meant a full Tauri rebuild, an event fired at the app, and someone watching a
 * corner of the screen for four hundred milliseconds to say whether it felt
 * right. That is a terrible loop for a thing whose only measure is how it
 * looks.
 *
 * Every candidate here renders the real panel, through the real stylesheet, so
 * what plays is what would ship. Replay any of them, slow them all down, and
 * pick one.
 *
 * Development only — not in the Tauri bundle. See vite.config.ts.
 */

import { renderPanel } from "./render";
import { FIXTURES } from "./fixtures";

import "./styles/tokens.css";
import "./styles/panel.css";

interface Candidate {
  id: string;
  name: string;
  note: string;
  /** Applied to `.mn-panel`. `--t` is the duration, set from the speed slider. */
  css: string;
}

const CANDIDATES: Candidate[] = [
  {
    id: "unroll",
    name: "Unroll from the header",
    note: "Clipped from the top down. No layout — the clip is a compositor property, so the body is uncovered rather than resized.",
    css: `
      transform-origin: 100% 0;
      animation: a-unroll var(--t) cubic-bezier(0.16, 1, 0.3, 1) both;
    `,
  },
  {
    id: "grow",
    name: "Grow from the corner",
    note: "Scales up from the top-right, where the window is pinned.",
    css: `
      transform-origin: 100% 0;
      animation: a-grow var(--t) cubic-bezier(0.16, 1.02, 0.3, 1) both;
    `,
  },
  {
    id: "drop",
    name: "Drop in from above",
    note: "Falls from behind the menu bar and settles, with a small overshoot at the end. What is shipping now — 22px on the panel, which is all the clearance the window has above the card.",
    css: `animation: a-drop var(--t) cubic-bezier(0.22, 1.2, 0.36, 1) both;`,
  },
  {
    id: "settle",
    name: "Fade and settle",
    note: "Barely moves. The calmest of these, and the closest to what the design principles ask for.",
    css: `animation: a-settle var(--t) cubic-bezier(0.22, 1, 0.36, 1) both;`,
  },
  {
    id: "slide",
    name: "Slide in from the right",
    note: "Comes in from off-screen, the way a notification does.",
    css: `animation: a-slide var(--t) cubic-bezier(0.16, 1, 0.3, 1) both;`,
  },
  {
    id: "focus",
    name: "Resolve into focus",
    note: "Blurs in while scaling very slightly. Reads as the panel coming into being rather than arriving from somewhere.",
    css: `animation: a-focus var(--t) cubic-bezier(0.22, 1, 0.36, 1) both;`,
  },
];

const KEYFRAMES = `
@keyframes a-unroll {
  from { opacity: 0; clip-path: inset(0 0 100% 0 round var(--mn-r)); }
  25%  { opacity: 1; }
  to   { opacity: 1; clip-path: inset(0 0 0 0 round var(--mn-r)); }
}
@keyframes a-grow {
  from { opacity: 0; transform: scale(0.5); }
  45%  { opacity: 1; }
  to   { opacity: 1; transform: none; }
}
@keyframes a-drop {
  from { opacity: 0; transform: translateY(-38px); }
  40%  { opacity: 1; }
  to   { opacity: 1; transform: none; }
}
@keyframes a-settle {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to   { opacity: 1; transform: none; }
}
@keyframes a-slide {
  from { opacity: 0; transform: translateX(60px); }
  35%  { opacity: 1; }
  to   { opacity: 1; transform: none; }
}
@keyframes a-focus {
  from { opacity: 0; filter: blur(14px); transform: scale(1.04); }
  to   { opacity: 1; filter: blur(0); transform: none; }
}
`;

const style = document.createElement("style");
style.textContent =
  KEYFRAMES +
  CANDIDATES.map((c) => `.play-${c.id} .mn-panel { ${c.css} }`).join("\n") +
  `
  body {
    margin: 0;
    background: var(--mn-bg);
    color: var(--mn-fg);
    font-family: var(--mn-font-ui);
    padding: 28px;
  }
  .bar {
    position: sticky; top: 0; z-index: 5;
    display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
    padding: 14px 0 20px;
    background: var(--mn-bg);
  }
  .bar h1 { margin: 0; font: 400 20px/1 var(--mn-font-serif); }
  .bar label { font: 400 10px/1 var(--mn-font-ui); letter-spacing: .2em; text-transform: uppercase; color: var(--mn-fg-3); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 26px; }
  .cell { display: flex; flex-direction: column; gap: 10px; }
  .cell h2 { margin: 0; font: 400 15px/1.3 var(--mn-font-ui); }
  .cell p { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--mn-fg-2); max-width: 46ch; }
  /* Room for the shadow, and a fixed height so replaying does not reflow the page. */
  .stage { min-height: 430px; padding: 34px 20px; }
  button { cursor: pointer; }
`;
document.head.append(style);

const root = document.getElementById("root")!;
const view = FIXTURES[0]!.view;

const bar = document.createElement("div");
bar.className = "bar";
bar.innerHTML = `
  <h1>Panel arrival</h1>
  <button class="mn-glass mn-details" id="all">Replay all</button>
  <label for="speed">Speed</label>
  <input id="speed" type="range" min="1" max="20" value="15" />
  <span id="ms" class="mn-fact"></span>
`;
root.append(bar);

const grid = document.createElement("div");
grid.className = "grid";
root.append(grid);

const stages = new Map<string, HTMLElement>();

for (const candidate of CANDIDATES) {
  const cell = document.createElement("div");
  cell.className = "cell";

  const title = document.createElement("h2");
  title.textContent = candidate.name;

  const note = document.createElement("p");
  note.textContent = candidate.note;

  const replay = document.createElement("button");
  replay.className = "mn-glass mn-details";
  replay.textContent = "Replay";
  replay.style.alignSelf = "flex-start";

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.append(renderPanel(view));
  stages.set(candidate.id, stage);

  replay.addEventListener("click", () => play(candidate.id));
  cell.append(title, note, replay, stage);
  grid.append(cell);
}

const speed = document.getElementById("speed") as HTMLInputElement;
const readout = document.getElementById("ms")!;

function duration(): number {
  return Number(speed.value) * 50;
}

function play(id: string) {
  const stage = stages.get(id);
  if (!stage) return;
  const panel = stage.firstElementChild as HTMLElement;

  // Removed and re-added, with a layout read between: without the read the
  // browser coalesces both class changes and the animation never restarts.
  stage.classList.remove(`play-${id}`);
  panel.style.setProperty("--t", `${duration()}ms`);
  void stage.offsetWidth;
  stage.classList.add(`play-${id}`);
}

function playAll() {
  readout.textContent = `${duration()}ms`;
  for (const c of CANDIDATES) play(c.id);
}

document.getElementById("all")!.addEventListener("click", playAll);
speed.addEventListener("input", playAll);
playAll();
