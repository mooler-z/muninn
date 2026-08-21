/**
 * Something to do while the agent works.
 *
 * Two games, one each in its own file rather than sharing an engine. The first
 * attempt did share one, and the result was two halves of a compromise: the
 * runner needs a fixed world, a run cycle, ducking and a night flip, none of
 * which the raven wants, and generalising over both produced a block that
 * jumped over other blocks.
 *
 *   raven   holds altitude against gravity and flies between gaps — the bird
 *           out over the world, which is the half of the myth the README opens
 *           with that the product was not using
 *   runner  the offline game, in runner.ts
 *
 * Both draw from the panel's own tokens, so they belong to the same object as
 * everything else rather than looking like games someone embedded.
 */

export type Mode = "raven" | "dino";

interface Obstacle {
  x: number;
  /** Top of the gap (raven) or height of the block (runner). */
  y: number;
  w: number;
  h: number;
}

const GRAVITY = 1500; // px/s²
const FLAP = -380; // per press
const SPEED_START = 210;
const SPEED_GAIN = 6; // px/s per second survived

export interface Game {
  destroy(): void;
}

/**
 * The raven game.
 *
 * The runner lives in runner.ts and is started directly, because it needs two
 * palettes for its day/night cycle and reports score back for the window's HUD
 * — a signature this one has no use for. They were briefly forced through one
 * entry point and it made both worse.
 */
export function startGame(canvas: HTMLCanvasElement, _mode: Mode, palette: Palette): Game {
  const ctx = canvas.getContext("2d")!;
  let width = 0;
  let height = 0;

  // State
  let y = 0;
  let vy = 0;
  let speed = SPEED_START;
  let obstacles: Obstacle[] = [];
  let score = 0;
  let best = Number(localStorage.getItem("muninn.best.raven") ?? 0);
  let dead = false;
  let started = false;
  let last = 0;
  let frame = 0;
  let spawnIn = 0;

  const player = { x: 0, size: 26 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    player.x = Math.max(56, width * 0.18);
  }

  function reset() {
    y = height / 2;
    vy = 0;
    speed = SPEED_START;
    obstacles = [];
    score = 0;
    dead = false;
    started = false;
    spawnIn = 0.9;
  }

  function press() {
    if (dead) {
      reset();
      return;
    }
    started = true;
    vy = FLAP;
  }

  function spawn() {
    // A gap to fly through, never so near an edge that it cannot be reached
    // from the middle of the screen.
    const gap = Math.max(120, height * 0.34);
    const top = 40 + Math.random() * Math.max(10, height - gap - 90);
    obstacles.push({ x: width + 40, y: top, w: 32, h: gap });
  }

  function hits(o: Obstacle): boolean {
    const half = player.size / 2;
    const left = player.x - half;
    const right = player.x + half;
    if (right < o.x || left > o.x + o.w) return false;
    // Inside the gap is safe; above or below it is not.
    return y - half < o.y || y + half > o.y + o.h;
  }

  function step(dt: number) {
    if (!started || dead) return;

    speed += SPEED_GAIN * dt;
    vy += GRAVITY * dt;
    y += vy * dt;

    // The ceiling and the floor are both fatal, so the whole screen is the
    // playing field rather than a corridor with soft edges.
    if (y < player.size / 2 || y > height - player.size / 2) dead = true;

    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawn();
      spawnIn = 1.15;
    }

    for (const o of obstacles) o.x -= speed * dt;
    obstacles = obstacles.filter((o) => o.x + o.w > -20);

    for (const o of obstacles) {
      if (hits(o)) {
        dead = true;
        if (score > best) {
          best = score;
          localStorage.setItem("muninn.best.raven", String(best));
        }
      }
    }

    score += dt * 12;
  }

  // --- drawing --------------------------------------------------------------

  function drawRaven(cx: number, cy: number, size: number, tilt: number) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.fillStyle = palette.ink;

    // A bird, not the logo: the mark is a filled silhouette that reads as a
    // blob at 26px, where two wings and a tail still read as flight.
    const beat = Math.sin(frame / 5) * 0.5;
    const s = size / 2;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.quadraticCurveTo(0, s * 0.36, -s, s * 0.12);
    ctx.quadraticCurveTo(-s * 0.4, 0, -s, -s * 0.12);
    ctx.quadraticCurveTo(0, -s * 0.36, s, 0);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-s * 0.1, 0);
    ctx.quadraticCurveTo(-s * 0.5, -s * (0.9 + beat), -s * 1.05, -s * (0.5 + beat));
    ctx.quadraticCurveTo(-s * 0.5, -s * 0.2, -s * 0.1, 0);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = palette.ink;
    for (const o of obstacles) {
      // Only the solid parts are drawn; the gap is the space between.
      ctx.fillRect(o.x, 0, o.w, o.y);
      ctx.fillRect(o.x, o.y + o.h, o.w, height - o.y - o.h);
    }

    drawRaven(player.x, y, player.size, Math.max(-0.5, Math.min(0.7, vy / 900)));

    ctx.fillStyle = palette.faint;
    ctx.font = `500 11px ${palette.font}`;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.floor(score)}   BEST ${Math.floor(best)}`, width - 18, 26);

    if (!started || dead) {
      ctx.textAlign = "center";
      ctx.fillStyle = palette.faint;
      ctx.font = `500 11px ${palette.font}`;
      ctx.fillText(dead ? "SPACE TO FLY AGAIN" : "SPACE TO FLY", width / 2, height - 30);
    }
  }

  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    frame++;
    step(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "Enter") {
      e.preventDefault();
      press();
    }
  };
  const onPointer = () => press();
  const onResize = () => {
    resize();
    reset();
  };

  resize();
  reset();
  window.addEventListener("keydown", onKey);
  canvas.addEventListener("pointerdown", onPointer);
  window.addEventListener("resize", onResize);

  let raf = requestAnimationFrame((t) => {
    last = t;
    raf = requestAnimationFrame(loop);
  });

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onResize);
    },
  };
}

export interface Palette {
  ink: string;
  faint: string;
  hairline: string;
  font: string;
}

/** Read the drawing colours from the panel's own tokens. */
export function palette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    ink: read("--mn-fg", "#4a332b"),
    faint: read("--mn-fg-3", "#b08e80"),
    hairline: read("--mn-fg-3", "#b08e80"),
    font: read("--mn-font-ui", "system-ui"),
  };
}
