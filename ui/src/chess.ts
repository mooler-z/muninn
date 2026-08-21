/**
 * Chess, against Stockfish.
 *
 * Muninn draws the board and nothing else. The rules come from chess.js and
 * every move the opponent makes comes from Stockfish, compiled to WebAssembly
 * and running in a worker — so the search never blocks the frame, and no part
 * of the thinking is ours.
 *
 * Nothing leaves the machine. That is not incidental: a cloud chess API would
 * be the only thing in Muninn that phones out, on a product whose whole claim
 * is that your working directory and your agent's output stay on your Mac.
 *
 * The engine is Stockfish 10 — the last release before neural networks, which
 * is why it is 650KB rather than the 180MB the modern one ships. It is still
 * far stronger than any human needs, so the difficulty setting spends most of
 * its range making it worse on purpose.
 */

import { Chess as Rules, type Move, type Square } from "chess.js";

export interface Chess {
  destroy(): void;
  onState(handler: (state: ChessState) => void): void;
  restart(): void;
  /** 0 is a beginner, 20 is the engine trying. */
  setLevel(level: number): void;
  snapshot(): ChessSave | null;
}

export interface ChessState {
  /** Whose turn, as a word rather than a letter. */
  turn: "yours" | "theirs";
  thinking: boolean;
  check: boolean;
  over: boolean;
  /** Only set when `over` — how it ended, in plain language. */
  outcome: string | null;
  /** Full moves played, for the HUD. */
  moves: number;
  level: number;
}

/** A game in progress. FEN carries the whole position in eighty characters. */
export interface ChessSave {
  fen: string;
  level: number;
}

export interface Skin {
  surface: string;
  ink: string;
  faint: string;
  accent: string;
  hairline: string;
  font: string;
}

/**
 * Unicode rather than images: six glyphs per side, already in every system
 * font, scalable, and tintable to the palette. An image set would be another
 * dozen files to ship and would not follow the theme.
 */
const GLYPH: Record<string, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

const FILES = "abcdefgh";

export function startChess(canvas: HTMLCanvasElement, skin: Skin, saved?: ChessSave | null): Chess {
  const ctx = canvas.getContext("2d")!;
  const rules = new Rules();
  if (saved?.fen) {
    try {
      rules.load(saved.fen);
    } catch {
      // A position from an older build, or a corrupted file. A fresh game is
      // the safe outcome — never a board that cannot be played.
    }
  }

  let level = saved?.level ?? 5;
  let thinking = false;
  let selected: Square | null = null;
  let legal: Move[] = [];
  /** The move just played, and by whom — theirs is marked more strongly. */
  let lastMove: { from: Square; to: Square; theirs: boolean } | null = null;
  let dead = false;
  /**
   * Runs only while the engine is searching.
   *
   * The board is otherwise drawn on demand — a position that is not changing
   * does not need sixty frames a second, and design principle §8 makes idle
   * cost a constraint rather than a preference. So the loop exists exactly as
   * long as there is something to animate.
   */
  let pulse = 0;
  let thinkingSince = 0;

  /**
   * Pieces in flight.
   *
   * A list rather than a single piece, because castling is two pieces moving
   * at once — the king teleporting while the rook slid would look like a bug
   * in the rules rather than a flourish.
   */
  interface Slide {
    glyph: string;
    white: boolean;
    from: Square;
    to: Square;
  }
  let slides: Slide[] = [];
  let slideStart = 0;
  const SLIDE_MS = 240;

/** 
 * The shortest a reply is allowed to take.
 *
 * At low strength the engine answers in a couple of hundred milliseconds,
 * which lands the piece before the eye has left its own move — it reads as the
 * board twitching rather than as an opponent. Holding the move briefly is not
 * a fake delay for its own sake: it is the difference between a reply and a
 * reflex.
 */
  const MIN_THINK_MS = 750;

  let notify: (s: ChessState) => void = () => {};

  function outcome(): string | null {
    if (!rules.isGameOver()) return null;
    if (rules.isCheckmate()) return rules.turn() === "w" ? "Checkmate. It won." : "Checkmate. You won.";
    if (rules.isStalemate()) return "Stalemate.";
    if (rules.isThreefoldRepetition()) return "Draw — the position repeated three times.";
    if (rules.isInsufficientMaterial()) return "Draw — neither side has enough left to mate.";
    return "Draw.";
  }

  const announce = () =>
    notify({
      turn: rules.turn() === "w" ? "yours" : "theirs",
      thinking,
      check: rules.inCheck(),
      over: rules.isGameOver(),
      outcome: outcome(),
      moves: rules.moveNumber(),
      level,
    });

  // --- the engine -----------------------------------------------------------

  /**
   * Loaded from `public/`, verbatim and unhashed, deliberately.
   *
   * The Emscripten loader fetches `stockfish.wasm` from beside itself by name,
   * so the two files have to keep their names and stay together — which rules
   * out the hashed-asset pipeline the models and fonts go through.
   */
  const engine = new Worker("./engine/stockfish.wasm.js");
  let ready = false;
  const queued: string[] = [];

  function send(command: string) {
    if (ready) engine.postMessage(command);
    else queued.push(command);
  }

  engine.onmessage = (e: MessageEvent) => {
    const line = typeof e.data === "string" ? e.data : String(e.data?.data ?? "");

    if (line === "uciok") {
      engine.postMessage("isready");
      return;
    }
    if (line === "readyok" && !ready) {
      ready = true;
      applyLevel();
      for (const q of queued.splice(0)) engine.postMessage(q);
      return;
    }

    if (line.startsWith("bestmove")) {
      const move = line.split(" ")[1];
      if (dead || !move || move === "(none)") {
        thinking = false;
        if (pulse) {
          cancelAnimationFrame(pulse);
          pulse = 0;
        }
        announce();
        return;
      }

      const owed = MIN_THINK_MS - (performance.now() - thinkingSince);
      if (owed > 0) {
        window.setTimeout(() => {
          if (!dead) apply(move);
        }, owed);
        return;
      }
      apply(move);
    }
  };

  function apply(move: string) {
    thinking = false;
    if (pulse) {
      cancelAnimationFrame(pulse);
      pulse = 0;
    }

    try {
      const played = rules.move({
        from: move.slice(0, 2) as Square,
        to: move.slice(2, 4) as Square,
        // Stockfish appends the piece when a pawn promotes; chess.js wants it
        // separately, and rejects the move outright without it.
        promotion: move.length > 4 ? move[4] : undefined,
      });
      if (played) {
        lastMove = { from: played.from, to: played.to, theirs: true };
        beginSlide(played);
      }
    } catch {
      // The engine and the rules disagreeing should be impossible; if it ever
      // happens, the position stands and the player keeps their turn.
    }

    draw();
    announce();
  }

  /**
   * Two dials, because one is not enough to make it beatable.
   *
   * `Skill Level` blunts the engine's judgement, but even at zero Stockfish is
   * strong when given time to search. Capping the search depth as well is what
   * actually produces a beginner.
   */
  function applyLevel() {
    engine.postMessage(`setoption name Skill Level value ${level}`);
  }

  /** Which rook moves with the king, for each side of each castle. */
  const CASTLE: Record<string, [Square, Square]> = {
    wk: ["h1", "f1"],
    wq: ["a1", "d1"],
    bk: ["h8", "f8"],
    bq: ["a8", "d8"],
  };

  function beginSlide(move: Move) {
    const white = move.color === "w";
    slides = [
      { glyph: GLYPH[move.piece]!, white, from: move.from, to: move.to },
    ];

    // `flags` carries `k` or `q` when the move was a castle.
    const side = move.flags.includes("k") ? "k" : move.flags.includes("q") ? "q" : null;
    if (side) {
      const rook = CASTLE[`${move.color}${side}`];
      if (rook) slides.push({ glyph: GLYPH.r!, white, from: rook[0], to: rook[1] });
    }

    slideStart = performance.now();
    if (!pulse) pulse = requestAnimationFrame(beat);
  }

  /**
   * One loop for everything that moves.
   *
   * It exists only while there is something to animate and stops the moment
   * there is not — a settled board does not need sixty frames a second, and
   * idle cost is a constraint here rather than a preference.
   */
  function beat() {
    if (dead) {
      pulse = 0;
      return;
    }
    if (slides.length && performance.now() - slideStart >= SLIDE_MS) slides = [];

    draw();

    if (thinking || slides.length) {
      pulse = requestAnimationFrame(beat);
    } else {
      pulse = 0;
      // One last frame with everything landed.
      draw();
    }
  }

  function think() {
    if (rules.isGameOver() || dead) return;
    thinking = true;
    thinkingSince = performance.now();
    announce();
    if (!pulse) pulse = requestAnimationFrame(beat);
    send(`position fen ${rules.fen()}`);
    const depth = 1 + Math.round(level / 2);
    send(`go depth ${depth} movetime ${300 + level * 60}`);
  }

  engine.postMessage("uci");

  // --- drawing --------------------------------------------------------------

  /**
   * Resolve any CSS colour to plain RGB.
   *
   * The palette is authored in `oklch`, and hand-parsing hex — which is what
   * this did — turned the accent into `rgba(NaN, NaN, NaN)` and made
   * `addColorStop` throw the moment the engine started thinking. Painting one
   * pixel and reading it back asks the browser instead, which knows every
   * colour space it accepts and will keep knowing them.
   */
  const swatch = document.createElement("canvas");
  swatch.width = 1;
  swatch.height = 1;
  const swatchCtx = swatch.getContext("2d", { willReadFrequently: true })!;
  const resolved = new Map<string, [number, number, number]>();

  function rgb(colour: string): [number, number, number] {
    const cached = resolved.get(colour);
    if (cached) return cached;
    swatchCtx.clearRect(0, 0, 1, 1);
    swatchCtx.fillStyle = "#000";
    swatchCtx.fillStyle = colour;
    swatchCtx.fillRect(0, 0, 1, 1);
    const [r, g, b] = swatchCtx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number] = [r!, g!, b!];
    resolved.set(colour, out);
    return out;
  }

  function withAlpha(colour: string, alpha: number): string {
    const [r, g, b] = rgb(colour);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function mix(a: string, b: string, t: number): string {
    const [r1, g1, b1] = rgb(a);
    const [r2, g2, b2] = rgb(b);
    const c = (x: number, y: number) => Math.round(x + (y - x) * t);
    return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`;
  }

  const light = mix(skin.surface, skin.ink, 0.1);
  const dark = mix(skin.surface, skin.ink, 0.34);

  /**
   * Room kept clear along the bottom for the window's control bar.
   *
   * The board is square and otherwise takes the full height of the stage, so
   * the strength slider — which floats over the game, centred at the bottom —
   * landed on the back rank and hid the pieces under it. Everything else here
   * is a 3D scene where a control at the edge overlaps nothing that matters;
   * a board has no spare edge.
   */
  const CONTROL_ROOM = 58;

  /** Board geometry, recomputed each draw so a resize needs no bookkeeping. */
  function board() {
    const rect = canvas.getBoundingClientRect();
    const usable = Math.max(0, rect.height - CONTROL_ROOM);
    const size = Math.min(rect.width, usable) * 0.94;
    return {
      size,
      cell: size / 8,
      x: (rect.width - size) / 2,
      // Centred in what is left, not in the whole stage.
      y: (usable - size) / 2,
      w: rect.width,
      h: rect.height,
    };
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const b = board();
    const targets = new Set(legal.map((m) => m.to));

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const x = b.x + file * b.cell;
        const y = b.y + rank * b.cell;
        const square = `${FILES[file]}${8 - rank}` as Square;

        ctx.fillStyle = (file + rank) % 2 === 0 ? light : dark;
        ctx.fillRect(x, y, b.cell, b.cell);

        // Where the last move came from and went to, so the board can be read
        // after looking away — which is the entire situation this game is for.
        if (lastMove && (square === lastMove.from || square === lastMove.to)) {
          ctx.fillStyle = withAlpha(skin.accent, lastMove.theirs ? 0.26 : 0.14);
          ctx.fillRect(x, y, b.cell, b.cell);
        }
        if (square === selected) {
          ctx.fillStyle = withAlpha(skin.accent, 0.34);
          ctx.fillRect(x, y, b.cell, b.cell);
        }

        // A piece still in flight is drawn at its own position further down,
        // not at the square the rules have already put it on.
        const piece = slides.some((f) => f.to === square) ? null : rules.get(square);
        if (piece) {
          const held = square === selected;
          ctx.fillStyle = piece.color === "w" ? "#f6ece4" : "#241611";
          // The held piece is drawn larger and sitting a little higher, as if
          // picked up off the board — so which piece is in hand is obvious
          // from the piece itself and not only from the square under it.
          ctx.font = `${b.cell * (held ? 0.86 : 0.76)}px ${skin.font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          if (held) {
            ctx.shadowColor = withAlpha(skin.accent, 0.9);
            ctx.shadowBlur = b.cell * 0.3;
          }
          // The filled glyphs for both sides, coloured rather than outlined:
          // the hollow white set disappears against a light square.
          ctx.fillText(GLYPH[piece.type]!, x + b.cell / 2, y + b.cell * (held ? 0.5 : 0.55));
          ctx.shadowBlur = 0;
        }

        // The ring goes on last, over the piece, so nothing can bury it.
        if (square === selected) {
          ctx.strokeStyle = skin.accent;
          ctx.lineWidth = Math.max(2, b.cell * 0.055);
          const inset = ctx.lineWidth / 2;
          ctx.strokeRect(x + inset, y + inset, b.cell - ctx.lineWidth, b.cell - ctx.lineWidth);
        }

        // A legal destination: a dot on an empty square, a ring on a capture.
        if (targets.has(square)) {
          ctx.fillStyle = withAlpha(skin.accent, 0.75);
          ctx.beginPath();
          if (piece) {
            ctx.lineWidth = Math.max(2, b.cell * 0.06);
            ctx.strokeStyle = withAlpha(skin.accent, 0.85);
            ctx.arc(x + b.cell / 2, y + b.cell / 2, b.cell * 0.42, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.arc(x + b.cell / 2, y + b.cell / 2, b.cell * 0.13, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    ctx.strokeStyle = withAlpha(skin.ink, 0.25);
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.size - 1, b.size - 1);

    drawSlides(b);
    if (thinking) drawThinking(b);
  }

  /** The centre of a square, in canvas coordinates. */
  function centreOf(b: ReturnType<typeof board>, square: Square) {
    return {
      x: b.x + (FILES.indexOf(square[0]!) + 0.5) * b.cell,
      y: b.y + (8 - Number(square[1]) + 0.5) * b.cell,
    };
  }

  /**
   * Pieces on their way.
   *
   * Eased out and lifted slightly at the midpoint, so a move reads as a piece
   * being carried rather than a sprite being dragged — which is what makes it
   * possible to see what moved without watching for it.
   */
  function drawSlides(b: ReturnType<typeof board>) {
    if (!slides.length) return;

    const t = Math.min(1, (performance.now() - slideStart) / SLIDE_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    // Rises and settles: nothing at the ends, most in the middle.
    const lift = Math.sin(t * Math.PI);

    for (const flight of slides) {
      const from = centreOf(b, flight.from);
      const to = centreOf(b, flight.to);
      const x = from.x + (to.x - from.x) * eased;
      const y = from.y + (to.y - from.y) * eased - lift * b.cell * 0.14;

      ctx.save();
      ctx.shadowColor = withAlpha(skin.ink, 0.45 * lift);
      ctx.shadowBlur = b.cell * 0.3 * lift;
      ctx.shadowOffsetY = b.cell * 0.06 * lift;
      ctx.fillStyle = flight.white ? "#f6ece4" : "#241611";
      ctx.font = `${b.cell * (0.76 + lift * 0.06)}px ${skin.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(flight.glyph, x, y + b.cell * 0.05);
      ctx.restore();
    }
  }

  /**
   * The opponent, visibly working.
   *
   * Along the top edge, because that is its side of the board — the movement
   * belongs to the player who is moving. Deliberately says nothing about what
   * it is considering: Stockfish broadcasts its best line continuously and
   * drawing that would hand over the move before it plays it.
   */
  function drawThinking(b: ReturnType<typeof board>) {
    const now = performance.now();
    const edge = b.y - Math.max(4, b.cell * 0.14);
    const height = Math.max(2, b.cell * 0.055);

    // A band that breathes, so the whole side reads as occupied.
    const breath = 0.18 + Math.sin(now * 0.0022) * 0.1;
    ctx.fillStyle = withAlpha(skin.accent, breath);
    ctx.fillRect(b.x, edge, b.size, height);

    // And a light that sweeps it, so it reads as working rather than merely
    // lit. Eased at both ends, so it slows into the turn instead of wrapping.
    const cycle = (now % 2400) / 2400;
    const eased = 0.5 - Math.cos(cycle * Math.PI * 2) / 2;
    const width = b.size * 0.22;
    const x = b.x + (b.size - width) * eased;

    const sweep = ctx.createLinearGradient(x, 0, x + width, 0);
    sweep.addColorStop(0, withAlpha(skin.accent, 0));
    sweep.addColorStop(0.5, withAlpha(skin.accent, 0.85));
    sweep.addColorStop(1, withAlpha(skin.accent, 0));
    ctx.fillStyle = sweep;
    ctx.fillRect(x, edge, width, height);

    // The king it is playing for, breathing with the band — enough to tie the
    // movement to a side without pointing at any square it cares about.
    const king = rules.board().flat().find((p) => p && p.type === "k" && p.color === "b");
    if (king) {
      const file = FILES.indexOf(king.square[0]!);
      const rank = 8 - Number(king.square[1]);
      ctx.strokeStyle = withAlpha(skin.accent, breath * 1.6);
      ctx.lineWidth = Math.max(1.5, b.cell * 0.04);
      ctx.strokeRect(
        b.x + file * b.cell + ctx.lineWidth,
        b.y + rank * b.cell + ctx.lineWidth,
        b.cell - ctx.lineWidth * 2,
        b.cell - ctx.lineWidth * 2,
      );
    }
  }

  // --- input ----------------------------------------------------------------

  function squareAt(event: MouseEvent): Square | null {
    const rect = canvas.getBoundingClientRect();
    const b = board();
    const file = Math.floor((event.clientX - rect.left - b.x) / b.cell);
    const rank = Math.floor((event.clientY - rect.top - b.y) / b.cell);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return `${FILES[file]}${8 - rank}` as Square;
  }

  const onClick = (event: MouseEvent) => {
    if (thinking || rules.isGameOver() || rules.turn() !== "w") return;
    const square = squareAt(event);
    if (!square) return;

    const move = legal.find((m) => m.to === square);
    if (selected && move) {
      // Always a queen. Offering the choice costs a dialogue box for something
      // that is the right answer virtually every time.
      const mine = rules.move({ from: selected, to: square, promotion: "q" });
      lastMove = { from: selected, to: square, theirs: false };
      beginSlide(mine);
      selected = null;
      legal = [];
      draw();
      announce();
      window.setTimeout(think, 220);
      return;
    }

    const piece = rules.get(square);
    if (piece && piece.color === "w") {
      selected = square;
      legal = rules.moves({ square, verbose: true }) as Move[];
    } else {
      selected = null;
      legal = [];
    }
    draw();
  };

  canvas.addEventListener("click", onClick);

  const onResize = () => draw();
  window.addEventListener("resize", onResize);

  // A restored game where it is the engine's turn should not sit waiting for a
  // move nobody asked it to make.
  draw();
  announce();
  if (rules.turn() === "b" && !rules.isGameOver()) window.setTimeout(think, 400);

  return {
    destroy() {
      dead = true;
      if (pulse) cancelAnimationFrame(pulse);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("resize", onResize);
      engine.terminate();
    },
    onState(handler) {
      notify = handler;
      announce();
    },
    restart() {
      rules.reset();
      slides = [];
      selected = null;
      legal = [];
      lastMove = null;
      thinking = false;
      draw();
      announce();
    },
    setLevel(next: number) {
      level = Math.max(0, Math.min(20, Math.round(next)));
      if (ready) applyLevel();
      announce();
    },
    snapshot() {
      // Nothing to keep before the first move, or once it is decided.
      if (rules.isGameOver() || rules.history().length === 0) return null;
      return { fen: rules.fen(), level };
    },
  };
}
