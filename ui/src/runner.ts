/**
 * The runner, in Muninn's palette.
 *
 * Mechanics and tuning are the version you supplied: a 980×320 world, a 360px/s
 * start ramping to 780, cactus clusters and two bird lanes, a fair inset
 * hitbox, and a day/night cycle that drifts rather than snaps.
 *
 * What is different is the skin. The original ran dark neon on white; this runs
 * on the panel's own colours, and its day and night are Muninn's light and dark
 * themes rather than white and black. The cycle therefore stays a real mechanic
 * — the world does change under you — without ever putting a colour on screen
 * that the rest of the app would not use.
 */

/**
 * A run in progress.
 *
 * Only the score and the best, deliberately. Restoring the exact obstacles
 * would mean serialising the whole world every second to reproduce a layout
 * nobody remembers — what a player comes back for is the number they had
 * reached, not the particular cactus they were about to clear.
 */
export interface RunnerSave {
  score: number;
  best: number;
}

export interface Runner {
  destroy(): void;
  /** The run so far, or null when there is nothing worth keeping. */
  snapshot(): RunnerSave | null;
  /** Whether the overlay should be up, and what it should say. */
  onState(handler: (state: RunnerState) => void): void;
  play(): void;
  restart(): void;
  /** Hold the run where it is and bank the score. */
  pause(): void;
}

export interface RunnerState {
  running: boolean;
  over: boolean;
  /** Held mid-run rather than finished — the score still stands. */
  paused: boolean;
  score: number;
  best: number;
}

/**
 * The world, in its own units.
 *
 * Smaller than the 980×320 it started at, and that is the whole point: the
 * canvas is stretched to the stage, so shrinking the world magnifies
 * everything drawn in it. Enlarging the window alone did nothing — the sprites
 * simply kept their share of a wider box.
 *
 * The shape also matches the stage now. At 980×320 the world was far wider than
 * the window, so it sat as a band with dead space above and below it.
 */
const W = 700;
const H = 340;
const GROUND_Y = 272;

/**
 * Everything below is the supplied tuning divided by ZOOM.
 *
 * Distances shrink with the world but time must not: dividing the speeds,
 * gravity and jump by the same factor keeps the jump arc the same shape and the
 * obstacles the same beats apart. Only the *scale* changes — the game feels
 * identical and draws 1.4× larger.
 */
const ZOOM = 1.4;
const z = (n: number) => n / ZOOM;

const SPEED_START = z(360);
const SPEED_MAX = z(780);
const SPEED_RAMP = z(8);

const HI_KEY = "muninn.best.runner";

/**
 * The colours the game draws with — the app's current theme, not a palette of
 * its own.
 *
 * The first attempt cross-faded between the light and dark themes, which meant
 * a cream world sitting inside a dark window: two different surfaces on screen
 * at once, and the game reading as a bright rectangle pasted into the app. Now
 * it draws on the theme it is in, and the night cycle is a shift within that
 * rather than a jump to the other one.
 */
export interface Skin {
  surface: string;
  ink: string;
  faint: string;
  font: string;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const chance = (p: number) => Math.random() < p;

function mix(a: string, b: string, t: number): string {
  const parse = (c: string) => {
    const m = c.trim().match(/^#?([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1]!, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const nums = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return `rgb(${Math.round(r1! + (r2! - r1!) * t)},${Math.round(g1! + (g2! - g1!) * t)},${Math.round(
    b1! + (b2! - b1!) * t,
  )})`;
}

interface Obstacle {
  type: "cactus" | "bird";
  x: number;
  y: number;
  w: number;
  h: number;
  bumps: number;
  flap: number;
}

export function startRunner(canvas: HTMLCanvasElement, skin: Skin, saved?: RunnerSave | null): Runner {
  // Night is the same world after dark: the surface moves a little towards the
  // ink and the ink lifts a little off it. Enough to notice, not enough to look
  // like a different application.
  const day = skin;
  const night: Skin = {
    surface: mix(skin.surface, skin.ink, 0.16),
    ink: mix(skin.ink, skin.surface, 0.12),
    faint: skin.faint,
    font: skin.font,
  };

  const ctx = canvas.getContext("2d")!;
  canvas.width = W;
  canvas.height = H;

  let running = false;
  let over = false;
  let paused = false;
  let last = 0;
  let t = 0;
  let raf = 0;

  let speed = SPEED_START;
  let score = 0;
  let best = Number(localStorage.getItem(HI_KEY) ?? 0);

  /** 0 is day, 1 is night; eased rather than switched. */
  let isNight = false;
  let phase = 0;

  // Sizes are left alone — they are what gets bigger. Only the physics is
  // scaled, so the arc stays the same shape in a smaller world.
  const player = {
    x: z(120),
    y: GROUND_Y,
    w: 34,
    h: 44,
    vy: 0,
    gravity: z(1700),
    jumpVel: z(-640),
    onGround: true,
    blink: 0,
  };

  let obstacles: Obstacle[] = [];
  let spawnTimer = 0;
  let nextSpawn = rand(0.85, 1.35);

  const stars = Array.from({ length: 70 }, () => ({
    x: Math.random() * W,
    y: Math.random() * (GROUND_Y - 90),
    r: rand(0.6, 1.6),
    a: rand(0.15, 0.85),
    tw: rand(0.8, 1.8),
  }));

  const clouds = Array.from({ length: 6 }, () => ({
    x: rand(0, W),
    y: rand(30, GROUND_Y - 120),
    s: rand(0.5, 1.2),
    w: rand(50, 110),
    a: rand(0.08, 0.18),
  }));

  const pebbles = Array.from({ length: 90 }, () => ({
    x: Math.random() * W,
    y: GROUND_Y + rand(10, 28),
    r: rand(1, 2.2),
    a: rand(0.08, 0.18),
  }));

  let notify: (s: RunnerState) => void = () => {};
  const announce = () =>
    notify({ running, over, paused, score: Math.floor(score), best: Math.floor(best) });

  /** Bank the score. Called on death and on pause, so a run that was
   *  interrupted still counts for what it reached. */
  function bank() {
    if (Math.floor(score) > best) {
      best = Math.floor(score);
      localStorage.setItem(HI_KEY, String(best));
    }
  }

  // --- theme ----------------------------------------------------------------

  const surface = () => mix(day.surface, night.surface, phase);
  const ink = () => mix(day.ink, night.ink, phase);
  const faint = () => mix(day.faint, night.faint, phase);

  // --- lifecycle ------------------------------------------------------------

  function reset() {
    running = false;
    over = false;
    paused = false;
    score = 0;
    speed = SPEED_START;
    t = 0;
    phase = 0;
    isNight = false;

    player.y = GROUND_Y;
    player.vy = 0;
    player.onGround = true;
    player.blink = 0;

    obstacles = [];
    spawnTimer = 0;
    nextSpawn = rand(0.85, 1.35);

    for (const c of clouds) {
      c.x = rand(0, W);
      c.y = rand(30, GROUND_Y - 120);
    }
    for (const p of pebbles) p.x = Math.random() * W;

    announce();
  }

  function start() {
    if (over) reset();
    paused = false;
    running = true;
    announce();
  }

  function end() {
    running = false;
    over = true;
    paused = false;
    bank();
    announce();
  }

  /**
   * Hold the run rather than end it.
   *
   * The turn finishing should not cost you the run. The score is banked at the
   * moment of the pause, so closing the window here keeps what you reached, and
   * coming back resumes from exactly where you stopped.
   */
  function pause() {
    if (!running || over) return;
    running = false;
    paused = true;
    bank();
    announce();
  }

  function jump() {
    // Resuming is not restarting: a held run picks up where it left off.
    if (paused) {
      paused = false;
      running = true;
      announce();
      return;
    }
    if (!running) start();
    if (over) return;
    if (player.onGround) {
      player.vy = player.jumpVel;
      player.onGround = false;
    }
  }

  // --- simulation -----------------------------------------------------------

  function spawn() {
    // Birds only once there is pace, and then only sometimes.
    const bird = chance(clamp((speed - z(420)) / z(520), 0, 0.35)) && chance(0.45);
    if (bird) {
      obstacles.push({
        type: "bird",
        x: W + 30,
        y: chance(0.5) ? GROUND_Y - 46 : GROUND_Y - 78,
        w: rand(28, 44),
        h: 18,
        bumps: 0,
        flap: rand(0, 1),
      });
      return;
    }

    const count = chance(0.55) ? 1 : chance(0.6) ? 2 : 3;
    let x = W + 20;
    for (let i = 0; i < count; i++) {
      const s = rand(0.9, 1.35);
      const w = 18 * s;
      const h = 40 * s;
      obstacles.push({
        type: "cactus",
        x,
        y: GROUND_Y - h + 2,
        w,
        h,
        bumps: Math.floor(rand(2, 5)),
        flap: 0,
      });
      x += w + rand(10, 16);
    }
  }

  /** Inset on both sides: pixel-exact corners make near misses feel unfair. */
  function hitbox() {
    return { x: player.x + 5, y: player.y - player.h + 6, w: player.w - 10, h: player.h - 12 };
  }

  function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function update(dt: number) {
    t += dt;
    speed = Math.min(SPEED_MAX, speed + SPEED_RAMP * dt);
    score += dt * (speed * 0.08 * ZOOM);

    if (!isNight && score > 250 && chance(0.0025)) isNight = true;
    if (isNight && score > 500 && chance(0.002)) isNight = false;
    // Eased, so dusk takes a moment rather than flicking over.
    phase += ((isNight ? 1 : 0) - phase) * (1 - Math.pow(0.001, dt));

    player.vy += player.gravity * dt;
    player.y += player.vy * dt;
    if (player.y >= GROUND_Y) {
      player.y = GROUND_Y;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }

    player.blink += dt;
    if (player.blink > 4.2) player.blink = 0;

    spawnTimer += dt;
    const scale = clamp(1.25 - (speed - SPEED_START) / z(900), 0.72, 1.2);
    if (spawnTimer >= nextSpawn * scale) {
      spawnTimer = 0;
      nextSpawn = rand(0.85, 1.5);
      spawn();
    }

    for (const o of obstacles) {
      o.x -= speed * dt;
      if (o.type === "bird") o.flap += dt * 10;
    }
    obstacles = obstacles.filter((o) => o.x + o.w > -40);

    for (const c of clouds) {
      c.x -= speed * 0.18 * c.s * dt;
      if (c.x + c.w < -60) {
        c.x = W + rand(20, 200);
        c.y = rand(35, 130);
        c.s = rand(0.5, 1.2);
        c.w = rand(50, 110);
      }
    }

    for (const p of pebbles) {
      p.x -= speed * dt;
      if (p.x < -10) p.x = W + rand(0, 80);
    }

    const me = hitbox();
    for (const o of obstacles) {
      if (overlaps(me, { x: o.x + 2, y: o.y + 1, w: o.w - 4, h: o.h - 2 })) {
        end();
        break;
      }
    }

    announce();
  }

  // --- drawing --------------------------------------------------------------

  function round(x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function background() {
    ctx.fillStyle = surface();
    ctx.fillRect(0, 0, W, H);

    if (phase > 0.001) {
      ctx.save();
      for (const s of stars) {
        const tw = (Math.sin(t * s.tw + s.x * 0.02) * 0.35 + 0.65) * s.a;
        ctx.globalAlpha = tw * phase;
        ctx.fillStyle = night.ink;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = ink();
    for (const c of clouds) {
      ctx.globalAlpha = c.a * (1 - phase * 0.4);
      round(c.x, c.y, c.w, 22, 12);
      ctx.fill();
      ctx.globalAlpha = c.a * 0.6 * (1 - phase * 0.4);
      round(c.x + 16, c.y - 10, c.w * 0.55, 18, 10);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = ink();
    for (const p of pebbles) {
      ctx.globalAlpha = p.a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const x = player.x;
    const top = player.y - player.h;
    const bob = running && player.onGround && !over ? Math.sin(t * 18) * 1.5 : 0;

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = ink();
    ctx.beginPath();
    ctx.ellipse(x + 18, GROUND_Y + 12, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = ink();
    round(x, top + bob, player.w, player.h, 8);
    ctx.fill();
    round(x + 18, top - 10 + bob, 20, 18, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, top + 18 + bob);
    ctx.lineTo(x - 12, top + 24 + bob);
    ctx.lineTo(x, top + 30 + bob);
    ctx.closePath();
    ctx.fill();

    if (player.onGround && running && !over) {
      const s = Math.sin(t * 22);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = surface();
      round(x + 8 + (s > 0 ? 0 : 3), top + player.h - 8 + bob, 9, 10, 4);
      ctx.fill();
      round(x + 20 + (s > 0 ? 3 : 0), top + player.h - 8 + bob, 9, 10, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // The eye reads as the surface colour punched through the silhouette,
    // which works in both themes without needing a third colour.
    const blinking = player.blink > 3.95 && player.blink < 4.05;
    ctx.strokeStyle = surface();
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (blinking) {
      ctx.moveTo(x + 30, top + 6 + bob);
      ctx.lineTo(x + 34, top + 6 + bob);
    } else {
      ctx.arc(x + 32, top + 6 + bob, 2.2, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawObstacle(o: Obstacle) {
    ctx.save();
    ctx.fillStyle = ink();

    if (o.type === "cactus") {
      round(o.x, o.y, o.w, o.h, 6);
      ctx.fill();

      const armW = o.w * 0.45;
      const armH = o.h * 0.35;
      round(o.x - armW * 0.55, o.y + o.h * 0.35, armW, armH, 6);
      ctx.fill();
      round(o.x + o.w - armW * 0.45, o.y + o.h * 0.25, armW, armH, 6);
      ctx.fill();

      ctx.globalAlpha = 0.22;
      ctx.fillStyle = surface();
      for (let i = 0; i < o.bumps; i++) {
        ctx.beginPath();
        ctx.arc(o.x + rand(4, o.w - 6), o.y + rand(6, o.h - 8), rand(0.8, 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const flap = Math.sin(o.flap) * 8;
      round(o.x, o.y, o.w, o.h, 6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(o.x + 6, o.y + o.h / 2);
      ctx.quadraticCurveTo(o.x + o.w / 2, o.y - flap, o.x + o.w - 6, o.y + o.h / 2);
      ctx.quadraticCurveTo(o.x + o.w / 2, o.y + o.h + flap, o.x + 6, o.y + o.h / 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = surface();
      ctx.beginPath();
      ctx.arc(o.x + o.w - 10, o.y + 7, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    background();
    for (const o of obstacles) drawObstacle(o);
    drawPlayer();

    ctx.save();
    ctx.strokeStyle = ink();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 13);
    ctx.lineTo(W, GROUND_Y + 13);
    ctx.stroke();
    ctx.restore();

    if (running && !over && score < 40) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = faint();
      ctx.font = `500 13px ${day.font}`;
      ctx.letterSpacing = "0.18em";
      ctx.fillText("SPACE TO JUMP", 22, 32);
      ctx.restore();
    }
  }

  function loop(now: number) {
    if (!last) last = now;
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (running && !over) update(dt);
    render();
    raf = requestAnimationFrame(loop);
  }

  const onKey = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === " " || key === "arrowup" || key === "w") {
      e.preventDefault();
      if (!over) jump();
    }
    if (key === "r") {
      reset();
      start();
    }
  };
  const onPointer = (e: Event) => {
    e.preventDefault();
    if (!over) jump();
  };

  window.addEventListener("keydown", onKey, { passive: false });
  canvas.addEventListener("mousedown", onPointer);
  canvas.addEventListener("touchstart", onPointer, { passive: false });

  reset();
  raf = requestAnimationFrame(loop);

  if (saved) {
    // Held, not resumed. The window has only just opened; dropping someone
    // straight back into a moving run they were not watching would cost them
    // the score they came back for.
    score = saved.score;
    best = Math.max(best, saved.best);
    paused = true;
    running = false;
    announce();
  }

  return {
    snapshot() {
      // Only a run that is still standing. A finished one has nothing to carry
      // forward but the best, which already lives in localStorage.
      if (over || score < 1) return null;
      return { score: Math.floor(score), best };
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("mousedown", onPointer);
      canvas.removeEventListener("touchstart", onPointer);
    },
    onState(handler) {
      notify = handler;
      announce();
    },
    play() {
      if (paused) {
        paused = false;
        running = true;
        announce();
        return;
      }
      reset();
      start();
    },
    restart() {
      reset();
      start();
    },
    pause,
  };
}
