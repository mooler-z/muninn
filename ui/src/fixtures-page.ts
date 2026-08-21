/**
 * The fixtures harness.
 *
 * Every state, light and dark, side by side — the same layout as the design
 * canvas so the two can be compared without running an agent. `pnpm dev` and
 * open /fixtures.html.
 *
 * This page is a development tool and is not bundled into the app.
 */

import { renderPanel } from "./render";
import { streamPanel } from "./stream";
import { FIXTURES } from "./fixtures";

import "./styles/tokens.css";
import "./styles/panel.css";
import "./styles/fixtures.css";

const root = document.getElementById("root")!;

const handlers = {
  onPage: (delta: number) => console.log("page", delta),
  onOpenTerminal: (cwd: string | null) => console.log("open terminal", cwd),
};

FIXTURES.forEach((fixture, index) => {
  const section = document.createElement("section");
  section.className = "fx-section";

  const heading = document.createElement("div");
  heading.className = "fx-heading";
  const number = document.createElement("span");
  number.className = "fx-number";
  number.textContent = String(index + 1).padStart(2, "0");
  const title = document.createElement("h2");
  title.textContent = fixture.name;
  heading.append(number, title);

  const note = document.createElement("p");
  note.className = "fx-note";
  note.textContent = fixture.note;

  const row = document.createElement("div");
  row.className = "fx-row";

  for (const theme of ["light", "dark"] as const) {
    const stage = document.createElement("div");
    stage.className = `fx-stage fx-stage--${theme}`;
    stage.dataset.theme = theme;

    const label = document.createElement("span");
    label.className = "fx-stage-label";
    label.textContent = theme;

    stage.append(label, renderPanel(fixture.view, handlers));
    row.append(stage);
  }

  section.append(heading, note, row);
  root.append(section);
});

/**
 * Run every panel's arrival, the same code the app runs.
 *
 * Staggered by section so sixteen panels do not all stream at once, which is a
 * light show rather than something you can judge.
 */
function replay() {
  root.querySelectorAll<HTMLElement>(".mn-panel").forEach((panel, i) => {
    panel.style.animation = "none";
    // Reflow, so restarting the arrival animation actually restarts it.
    void panel.offsetWidth;
    panel.style.animation = "";
    window.setTimeout(() => streamPanel(panel), i * 90);
  });
}

const button = document.createElement("button");
button.className = "fx-replay";
button.type = "button";
button.textContent = "Replay";
button.addEventListener("click", replay);
document.body.append(button);

replay();
