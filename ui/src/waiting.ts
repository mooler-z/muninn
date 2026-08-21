/**
 * The waiting window.
 *
 * Opens only once a turn has been running long enough to be a wait, and stands
 * down the moment the summary arrives — the app closes it, so the panel is the
 * raven coming back rather than something you have to dismiss first.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { startGame, palette, type Game } from "./game";
import { startRunner, type Runner, type RunnerSave, type RunnerState } from "./runner";
import type { Mines, MinesSave, MinesState } from "./minesweeper";
import type { Maze, MazeSave, MazeState } from "./maze";
import type { Chess, ChessSave, ChessState } from "./chess";

type Mode = "raven" | "dino" | "mines" | "maze" | "chess";
import { closeButton } from "./render";
import { clearProgress, keep, loadProgress, saveNow } from "./progress";

import "./styles/tokens.css";
import "./styles/panel.css";
import "./styles/waiting.css";

const root = document.getElementById("root")!;

const describe = (e: unknown): string => {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
};

const report = (what: string, e: unknown) =>
  void invoke("report_error", { message: `waiting ${what}: ${describe(e)}` });
window.addEventListener("error", (e) => report("uncaught", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => report("unhandled rejection", e.reason));

let runner: Runner | null = null;
let raven: Game | null = null;
let mines: Mines | null = null;
let maze: Maze | null = null;
let chess: Chess | null = null;

/** Stops the once-a-second snapshot of whatever is on screen. */
let stopKeeping: (() => void) | null = null;

function el(tag: string, className?: string, ...kids: (Node | string | null)[]) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const k of kids) if (k !== null) node.append(typeof k === "string" ? document.createTextNode(k) : k);
  return node;
}

const pad = (n: number) => String(n).padStart(5, "0");

/**
 * The games, in the order the menu bar lists them.
 *
 * Kept here rather than derived from the app so the picker can name and
 * describe each one — the tray has room for a label and nothing else.
 */
/**
 * What to press, per game.
 *
 * Kept out of the header. It used to be one long line of hints beside the
 * title, which is unreadable at a glance and grew every time a game gained a
 * key — the maze's line had six clauses. A list behind a button is the right
 * shape for something you read once and then stop needing.
 */
const CONTROLS: Record<Mode, [string, string][]> = {
  raven: [["Space", "Fly"]],
  dino: [
    ["Space / Click", "Jump"],
    ["R", "Start again"],
  ],
  mines: [
    ["Click", "Open a cell"],
    ["Right-click", "Flag a mine"],
    ["Drag", "Orbit the cube"],
    ["Scroll", "Zoom"],
    ["Disperse", "Pull the lattice apart to reach the buried cells"],
  ],
  maze: [
    ["W A S D", "Walk and strafe"],
    ["← →", "Turn on the spot"],
    ["Shift", "Jog"],
    ["Click", "Mouse look"],
    ["Tab", "Open the map"],
    ["Drag / Scroll", "Pan and zoom the map"],
    ["R", "A new maze"],
  ],
  chess: [
    ["Click", "A piece, then where it goes"],
    ["Strength", "0 is a beginner, 20 is the engine trying"],
  ],
};

const GAMES: { id: Mode; name: string; note: string }[] = [
  { id: "raven", name: "Muninn's flight", note: "The raven, drifting." },
  { id: "dino", name: "Runner", note: "Side-scrolling, one button." },
  { id: "mines", name: "Minesweeper 3D", note: "A 5×5×5 volume. 26 neighbours each." },
  { id: "maze", name: "Maze", note: "Walked in first person. Tab for the map." },
  { id: "chess", name: "Chess", note: "Against Stockfish, running on this Mac." },
];

/** The current theme's flat colours — the game draws on the surface it is in. */
function skin() {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.dataset.theme === "dark"
    || (!document.documentElement.dataset.theme
        && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return {
    surface: read(dark ? "--dark-surface" : "--light-surface", dark ? "#2c1b20" : "#fdefe4"),
    ink: read("--mn-fg", "#4a332b"),
    faint: read("--mn-fg-3", "#b08e80"),
    font: read("--mn-font-ui", "system-ui"),
  };
}

function teardown() {
  // Before anything is destroyed: this writes one last snapshot, and a
  // destroyed game cannot describe itself.
  stopKeeping?.();
  stopKeeping = null;
  showing = null;
  runner?.destroy();
  raven?.destroy();
  mines?.destroy();
  maze?.destroy();
  chess?.destroy();
  runner = null;
  raven = null;
  mines = null;
  maze = null;
  chess = null;
  root.replaceChildren();
}

/** What is on screen, so the same game is not torn down and rebuilt. */
let showing: Mode | null = null;

/**
 * Tell the app there is something to look at.
 *
 * Called on every open, not once per render. The window is hidden rather than
 * destroyed between turns, so a second turn re-shows content that is already
 * in the DOM and `render` returns early — but the app restarts its
 * "did it draw anything" probation each time it shows the window, and without
 * this it would hide it again four seconds later. See waiting.rs.
 */
const confirmDrawn = () => void invoke("waiting_ready");

function render(mode: Mode) {
  // The window is told which game twice on open — once by asking, once by the
  // event that opened it. Rebuilding on the second would discard a game that
  // had already started loading, and for the runner it would throw away a run
  // the player is part-way through.
  if (showing === mode) return;

  teardown();
  showing = mode;

  const titles: Record<Mode, string> = {
    raven: "Muninn is out",
    dino: "Pixel Sprint",
    mines: "Minesweeper 3D",
    maze: "Maze",
    chess: "Chess",
  };
  const subtitles: Record<Mode, string> = {
    raven: "The raven, drifting",
    dino: "Endless runner",
    mines: "125 cells · 20 mines",
    maze: "First person · 12×12",
    chess: "Stockfish plays black",
  };
  const title = el("span", "wt-title mn-fact", titles[mode]);
  const hint = el("span", "wt-hint", subtitles[mode]);

  const score = el("span", "wt-value", "00000");
  const hiscore = el("span", "wt-value", "00000");
  // The picker, built up front so every game's HUD has it.
  const picker = el("div", "wt-picker", el("span", "wt-picker-title mn-fact", "Games"));
  const sheet = el("div", "wt-sheet", picker);
  sheet.hidden = true;

  for (const game of GAMES) {
    const row = el(
      "button",
      `wt-game${game.id === mode ? " is-current" : ""}`,
      el("span", "wt-game-name", game.name),
      el("span", "wt-game-note", game.note),
    );
    (row as HTMLButtonElement).type = "button";
    row.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      sheet.hidden = true;
      if (game.id === mode) return;
      // Written to settings, so the tray agrees and the next turn opens this
      // one — the picker is not a temporary override.
      void invoke("choose_game", { game: game.id });
      render(game.id);
    });
    picker.append(row);
  }

  // --- how to play ---------------------------------------------------------
  const keys = el("div", "wt-picker", el("span", "wt-picker-title mn-fact", "Controls"));
  for (const [key, what] of CONTROLS[mode]) {
    keys.append(
      el("div", "wt-key-row", el("kbd", "wt-kbd", key), el("span", "wt-key-what", what)),
    );
  }
  const info = el("div", "wt-sheet", keys);
  info.hidden = true;
  info.addEventListener("click", (e) => {
    if (e.target === info) info.hidden = true;
  });

  // The two sheets are alternatives, never both.
  const open = (which: HTMLElement, other: HTMLElement) => {
    other.hidden = true;
    which.hidden = !which.hidden;
  };

  const help = el("button", "wt-pill wt-chrome", el("span", "wt-key mn-fact", "Controls"), "?");
  (help as HTMLButtonElement).type = "button";
  help.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    open(info, sheet);
  });

  const games = el("button", "wt-pill wt-chrome", el("span", "wt-key mn-fact", "Games"), "⌘");
  (games as HTMLButtonElement).type = "button";
  games.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    open(sheet, info);
  });

  // Readouts sit with the title, on the left: they are what the game is
  // saying. The right-hand side is the window's own controls and nothing else.
  const readouts = el(
    "div",
    "wt-readouts",
    el("span", "wt-pill", el("span", "wt-key mn-fact", "Score"), score),
    el("span", "wt-pill", el("span", "wt-key mn-fact", "Hi"), hiscore),
  );

  /**
   * The game's own controls, along the bottom of the stage.
   *
   * Not in the header. A slider for the maze's map and a slider for the chess
   * engine are things you reach for mid-game, and putting them beside the
   * close button meant every adjustment was a trip to the top-right corner
   * past the one control that ends the session.
   */
  const controls = el("div", "wt-controls");

  /**
   * Start over.
   *
   * Every game gets one, in the same place, doing the same thing — including
   * throwing away the saved progress, because a run you deliberately abandoned
   * should not come back the next time the window opens. The default re-renders
   * the mode, which is the only way to restart a game that has no restart of
   * its own.
   */
  let resetGame = () => {
    showing = null;
    render(mode);
  };

  const fresh = el("button", "wt-pill wt-fresh", el("span", "wt-key mn-fact", "New game"), "↻");
  (fresh as HTMLButtonElement).type = "button";
  fresh.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    clearProgress(mode);
    resetGame();
    overlay.hidden = true;
  });
  controls.append(fresh);

  const hud = el(
    "div",
    "wt-hud",
    help,
    games,
    closeButton(() => {
      // Before the window goes: a hidden webview's timers are throttled, so
      // the interval cannot be relied on to have caught the last second.
      saveNow();
      void invoke("close_waiting");
    }),
  );

  const canvas = document.createElement("canvas");
  canvas.className = "wt-canvas";

  const ovTitle = el("h2", "wt-ov-title");
  const ovText = el("p", "wt-ov-text");
  const play = el("button", "mn-details mn-glass", "Play");
  (play as HTMLButtonElement).type = "button";
  const card = el("div", "wt-card", ovTitle, ovText, el("div", "wt-row", play));
  const overlay = el("div", "wt-overlay", card);

  root.append(
    el("header", "wt-bar", el("span", "wt-brand", title, hint), readouts, hud),
    el("main", "wt-stage", canvas, controls, overlay, sheet, info),
  );

  // Anywhere off the sheet closes it, which is what a menu is expected to do.
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) sheet.hidden = true;
  });

  confirmDrawn();

  if (mode === "raven") {
    overlay.remove();
    requestAnimationFrame(() => {
      raven = startGame(canvas, mode, palette());
    });
    return;
  }

  if (mode === "mines") {
    // Three is loaded only when this game is the one chosen, so the other two
    // do not carry its weight.
    void Promise.all([import("./minesweeper"), loadProgress<MinesSave>("mines")]).then(
      ([{ startMines }, saved]) => {
      const s = skin();
      const style = getComputedStyle(document.documentElement);
      mines = startMines(
        canvas,
        {
          ...s,
          accent: style.getPropertyValue("--mn-accent").trim() || "#c25a35",
          hairline: style.getPropertyValue("--mn-fg-3").trim() || "#b08e80",
        },
        saved,
      );
      stopKeeping = keep("mines", () => mines?.snapshot() ?? null);
      resetGame = () => mines?.restart();

      // Dispersal, which is the only way to reach the twenty-seven cells the
      // packed cube hides completely. Lives beside the readouts rather than
      // over the canvas, where it would be one more thing to drag by accident
      // while orbiting.
      const slider = el("input", "") as HTMLInputElement;
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = "0";
      slider.setAttribute("aria-label", "Disperse the cube");
      const spread = el("label", "wt-pill wt-spread", el("span", "wt-key mn-fact", "Disperse"), slider);
      controls.append(spread);
      const onSpread = () => {
        const t = Number(slider.value) / 100;
        spread.style.setProperty("--wt-spread", `${slider.value}%`);
        mines?.spread(t);
      };
      slider.addEventListener("input", onSpread);
      onSpread();

      const pad3 = (n: number) => String(Math.max(0, n)).padStart(3, "0");
      const clock = (n: number) =>
        `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

      mines.onState((st: MinesState) => {
        score.textContent = pad3(st.left);
        hiscore.textContent = clock(st.seconds);
        overlay.hidden = st.started && !st.over;
        if (st.over) {
          ovTitle.textContent = st.won ? "Swept" : "Boom";
          ovText.textContent = st.won
            ? `All ${st.left >= 0 ? "" : ""}mines accounted for in ${clock(st.seconds)}.`
            : "That one was a mine. The rest are marked.";
          play.textContent = "Again";
        } else {
          ovTitle.textContent = "Ready?";
          ovText.textContent =
            "125 cells, 20 mines, 26 neighbours each. Drag to look around; the first cell you open is always safe.";
          play.textContent = "Play";
        }
      });
      play.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        // A board started again is not the board that was saved.
        clearProgress("mines");
        mines?.restart();
        overlay.hidden = true;
      });
      },
    );
    return;
  }

  if (mode === "chess") {
    // The engine is 650KB of WebAssembly; it only lands if chess is chosen.
    void Promise.all([import("./chess"), loadProgress<ChessSave>("chess")]).then(
      ([{ startChess }, saved]) => {
        const s = skin();
        const style = getComputedStyle(document.documentElement);
        chess = startChess(
          canvas,
          {
            ...s,
            accent: style.getPropertyValue("--mn-accent").trim() || "#c25a35",
            hairline: style.getPropertyValue("--mn-fg-3").trim() || "#b08e80",
          },
          saved,
        );
        stopKeeping = keep("chess", () => chess?.snapshot() ?? null);
        resetGame = () => chess?.restart();

        // Strength lives in the HUD beside the readouts, like the maze's map
        // toggle — it is a setting you change mid-game, not a menu item.
        const slider = el("input", "") as HTMLInputElement;
        slider.type = "range";
        slider.min = "0";
        slider.max = "20";
        slider.value = "5";
        slider.setAttribute("aria-label", "Engine strength");
        const strength = el(
          "label",
          "wt-pill wt-spread",
          el("span", "wt-key mn-fact", "Strength"),
          slider,
        );
        controls.append(strength);
        // Painting and setting are kept apart on purpose. Folding them into one
        // handler meant the state callback set the level, which announced, which
        // called the state callback — the engine recursed until the stack gave
        // out before a single move had been played.
        const paint = () =>
          strength.style.setProperty("--wt-spread", `${(Number(slider.value) / 20) * 100}%`);
        slider.addEventListener("input", () => {
          paint();
          chess?.setLevel(Number(slider.value));
        });

        chess.onState((st: ChessState) => {
          slider.value = String(st.level);
          paint();
          score.textContent = String(st.moves).padStart(3, "0");
          hiscore.textContent = st.thinking
            ? "…"
            : st.check
              ? "CHECK"
              : st.turn === "yours"
                ? "YOU"
                : "IT";
          overlay.hidden = !st.over;
          if (st.over) {
            ovTitle.textContent = st.outcome?.startsWith("Checkmate. You") ? "Won" : "Over";
            ovText.textContent = st.outcome ?? "";
            play.textContent = "New game";
          }
        });

        play.addEventListener("click", (e) => {
          if (!e.isTrusted) return;
          clearProgress("chess");
          chess?.restart();
          overlay.hidden = true;
        });

        // No "Ready?" card: a board is legible on sight and there is nothing
        // to explain before the first move.
        overlay.hidden = true;
      },
    );
    return;
  }

  if (mode === "maze") {
    void Promise.all([import("./maze"), loadProgress<MazeSave>("maze")]).then(
      ([{ startMaze }, saved]) => {
      const s = skin();
      const style = getComputedStyle(document.documentElement);
      maze = startMaze(
        canvas,
        {
          ...s,
          accent: style.getPropertyValue("--mn-accent").trim() || "#c25a35",
          hairline: style.getPropertyValue("--mn-fg-3").trim() || "#b08e80",
        },
        saved,
      );
      stopKeeping = keep("maze", () => maze?.snapshot() ?? null);
      resetGame = () => maze?.restart();

      // A toggle rather than a held key: reading a map with a finger down is
      // a different activity from reading one.
      const look = el("button", "wt-pill wt-look", el("span", "wt-key mn-fact", "Map"), "TAB");
      (look as HTMLButtonElement).type = "button";
      controls.append(look);
      look.addEventListener("click", () => maze?.overview(!look.classList.contains("is-on")));

      const clock = (n: number) =>
        `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

      maze.onState((st: MazeState) => {
        score.textContent = String(st.steps).padStart(3, "0");
        hiscore.textContent = clock(st.seconds);
        look.classList.toggle("is-on", st.overview);
        overlay.hidden = st.started && !st.solved && !st.paused;

        if (st.paused) {
          ovTitle.textContent = "Paused";
          ovText.textContent = `The agent finished. ${st.steps} steps in — pick up where you left off.`;
          play.textContent = "Resume";
        } else if (st.solved) {
          ovTitle.textContent = "Out";
          ovText.textContent = `Found the way in ${st.steps} steps, ${clock(st.seconds)}.`;
          play.textContent = "New maze";
        } else {
          ovTitle.textContent = "Ready?";
          ovText.textContent =
            "Walk to the light. The mist means you cannot see far enough to solve it on foot — press Tab for the map, which shows the way out and where you are standing.";
          play.textContent = "Walk";
        }
      });

      play.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        if (maze) {
          const solvedNow = play.textContent === "New maze";
          if (solvedNow) {
            // A new maze is not the maze that was saved.
            clearProgress("maze");
            maze.restart();
          } else {
            maze.play();
          }
        }
        overlay.hidden = true;
      });
      },
    );
    return;
  }

  if (mode !== "dino") {
    /* The app asked for a game this bundle does not know — a version mismatch
       between the binary and the embedded frontend. Say so rather than
       silently drawing a different game, which is what used to happen. */
    report("unknown game", mode);
    ovTitle.textContent = "Out of step";
    ovText.textContent = `This build does not have "${mode}". Rebuild the frontend.`;
    play.textContent = "Close";
    overlay.hidden = false;
    play.addEventListener("click", () => void invoke("close_waiting"));
    return;
  }

  void loadProgress<RunnerSave>("dino").then((saved) => {
    runner = startRunner(canvas, skin(), saved);
    stopKeeping = keep("dino", () => runner?.snapshot() ?? null);
    resetGame = () => runner?.restart();
    runner.onState((s: RunnerState) => {
      score.textContent = pad(s.score);
      hiscore.textContent = pad(s.best);
      overlay.hidden = s.running;

      if (s.paused) {
        ovTitle.textContent = "Paused";
        ovText.textContent = `The agent finished. Your ${s.score} is banked — pick up where you left off.`;
        play.textContent = "Resume";
      } else if (s.over) {
        ovTitle.textContent = "Game over";
        ovText.textContent = `Scored ${s.score}. Best ${s.best}.`;
        play.textContent = "Again";
      } else {
        ovTitle.textContent = "Ready?";
        ovText.textContent = "Space, click, or Play. The panel will interrupt when the agent is done.";
        play.textContent = "Play";
      }
    });
    play.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      // Starting again abandons the banked run.
      if (play.textContent === "Again") clearProgress("dino");
      runner?.play();
    });
  });
}

// The turn ended, or the window is closing. Hold the run and bank the score
// rather than letting it die unseen behind a hidden window.
void listen("muninn://waiting-pause", () => {
  runner?.pause();
  maze?.pause();
  // The agent has finished and the window is about to be hidden. Paused first,
  // so what is written is the held state rather than one still in motion.
  saveNow();
});

void listen<Mode | "off">("muninn://waiting", (e) => {
  if (e.payload === "off") return;
  try {
    render(e.payload);
  } catch (err) {
    report("render threw", err);
  }
  confirmDrawn();
});

void invoke<Mode | "off">("waiting_game").then(
  (mode) => {
    try {
      if (mode !== "off") render(mode);
    } catch (e) {
      report("render threw", e);
    }
  },
  (e) => report("waiting_game rejected", e),
);

type Theme = "system" | "light" | "dark";
function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
void invoke<Theme>("appearance").then(applyTheme);
void listen<Theme>("muninn://appearance", (e) => applyTheme(e.payload));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // A picker that is open is the thing Escape should close, not the window.
    // A sheet that is open is the thing Escape should close, not the window.
    const sheets = document.querySelectorAll<HTMLElement>(".wt-sheet:not([hidden])");
    if (sheets.length) {
      sheets.forEach((one) => (one.hidden = true));
      return;
    }
    runner?.pause();
    maze?.pause();
    saveNow();
    void invoke("close_waiting");
  }
});
