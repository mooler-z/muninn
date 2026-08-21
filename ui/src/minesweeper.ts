/**
 * Minesweeper, in three dimensions.
 *
 * A 5×5×5 volume rather than a board. Every cell has up to 26 neighbours, so a
 * number means something quite different from the flat game — and the reason
 * for the orbit and the zoom is that you genuinely cannot see the middle of the
 * cube without moving around it.
 *
 * Revealed empty cells are removed rather than flattened, which is what opens a
 * way in. Numbers shrink to a small solid marker so the volume stays legible
 * once a few of them are up.
 *
 * Everything is drawn from the panel's own tokens: frosted glass for the
 * untouched cells, the accent for a flag and for the cell under the pointer,
 * hairline edges. Three is imported dynamically by
 * the caller so its weight only lands if this game is the one chosen.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * A board in progress.
 *
 * One number per cell carries everything that is not derivable: where the
 * mines are, what has been opened, what has been flagged. The neighbour counts
 * are not stored — they are a function of the mines, so they are recomputed on
 * the way back in.
 */
export interface MinesSave {
  /** Bit 1 mine, bit 2 revealed, bit 4 flagged. */
  cells: number[];
  seconds: number;
  spread: number;
}

export interface Mines {
  destroy(): void;
  /** The board so far, or null when there is nothing worth keeping. */
  snapshot(): MinesSave | null;
  onState(handler: (state: MinesState) => void): void;
  restart(): void;
  /** Pull the cube apart, 0 (packed) to 1 (fully dispersed). */
  spread(amount: number): void;
}

export interface MinesState {
  /** Mines minus flags planted — what the counter shows. */
  left: number;
  seconds: number;
  started: boolean;
  over: boolean;
  won: boolean;
}

export interface Skin {
  surface: string;
  ink: string;
  faint: string;
  accent: string;
  hairline: string;
  font: string;
}

/** 5³ is 125 cells: enough that the middle is genuinely hidden, small enough
 *  that you can hold the shape of it in your head. */
const DIM = 5;
const MINES = 20;
const GAP = 1.06;

/**
 * How far apart the cells can be pulled.
 *
 * A packed cube hides twenty-seven of its hundred and twenty-five cells
 * completely — you can orbit all day and never see the middle, let alone click
 * it, and the only way in was to open your way there. Dispersing separates the
 * lattice so the interior is reachable directly.
 *
 * The group shrinks as the lattice grows so a fully dispersed cube is only
 * about half again as wide as a packed one. Spreading without that compensation
 * throws the corners off screen and makes you re-zoom every time you touch the
 * slider.
 */
const SPREAD_GAP = 1.5;
const SPREAD_SHRINK = 0.58;

export function startMines(canvas: HTMLCanvasElement, skin: Skin, saved?: MinesSave | null): Mines {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(7.5, 6, 7.5);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 30;
  // No panning: the cube is the subject and letting it slide off screen only
  // ever costs you your bearings.
  controls.enablePan = false;

  // Lit from above and one side, so the glass has something to catch. The fill
  // is tinted with the surface colour rather than white, which keeps the cube
  // in the same light as the window around it.
  scene.add(new THREE.AmbientLight(new THREE.Color(skin.surface), 2.2));
  const key = new THREE.DirectionalLight(new THREE.Color(skin.ink), 1.1);
  key.position.set(4, 7, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(skin.accent), 0.6);
  rim.position.set(-6, -3, -4);
  scene.add(rim);

  // --- materials ------------------------------------------------------------

  /**
   * Grain, so the frost is not uniform.
   *
   * A single roughness value gives clean, even glass, which reads as polished
   * plastic once it is transmitting. Varying the roughness per texel scatters
   * the light unevenly and the surface starts to look like something that was
   * ground rather than moulded.
   */
  function grain(): THREE.CanvasTexture {
    const size = 256;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    const image = g.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      // Biased high: mostly rough, with occasional clearer patches.
      const v = 150 + Math.random() * 105;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(c);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    return texture;
  }

  const noise = grain();

  /** Untouched cells: frosted glass, not shiny. */
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(skin.surface),
    metalness: 0,
    roughness: 0.72,
    roughnessMap: noise,
    transmission: 0.9,
    thickness: 1.1,
    ior: 1.32,
    // Scatters what passes through, which is what turns clear glass into
    // frosted glass rather than merely dimming it.
    attenuationDistance: 2.4,
    attenuationColor: new THREE.Color(skin.surface),
    transparent: true,
    opacity: 0.98,
  });

  /** The cell under the pointer. Warmer and a little clearer, so the eye can
   *  tell which one a click would open without anything moving. */
  const glassHover = glass.clone();
  glassHover.color = new THREE.Color(skin.accent);
  glassHover.roughness = 0.5;
  glassHover.transmission = 0.72;
  glassHover.emissive = new THREE.Color(skin.accent);
  glassHover.emissiveIntensity = 0.22;

  const flagged = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(skin.accent),
    metalness: 0,
    roughness: 0.62,
    roughnessMap: noise,
    transmission: 0.4,
    thickness: 0.8,
    transparent: true,
    opacity: 0.97,
  });

  const detonated = new THREE.MeshStandardMaterial({
    color: new THREE.Color(skin.accent),
    roughness: 0.35,
    emissive: new THREE.Color(skin.accent),
    emissiveIntensity: 0.5,
  });

  const edgeMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(skin.ink),
    transparent: true,
    opacity: 0.22,
  });

  const cube = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(cube);

  /**
   * Animations in flight.
   *
   * Revealing used to be instantaneous — a cascade of forty cells resolved
   * between one frame and the next, which is the moment the game is actually
   * about, and it was over before you saw it. Each cell now takes half a second
   * and the cascade is staggered by how far it spread from the click, so an
   * opening unfolds outward instead of appearing already finished.
   *
   * A tween is just "drive this number from a to b", because the things that
   * need driving are not all scales — the blast fades a sphere's opacity and
   * the shake rolls the whole cube.
   */
  interface Tween {
    apply: (v: number) => void;
    from: number;
    to: number;
    delay: number;
    duration: number;
    elapsed: number;
    /** Overshoot and settle, rather than easing flat into the target. */
    springy?: boolean;
    done?: () => void;
  }
  let tweens: Tween[] = [];

  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
  const spring = (t: number) => {
    const c = 1.9;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  };

  function tween(t: Omit<Tween, "elapsed">) {
    tweens.push({ ...t, elapsed: 0 });
  }

  /** The common case: drive an object's uniform scale. */
  function scaleTo(
    object: THREE.Object3D,
    from: number,
    to: number,
    opts: { delay?: number; duration?: number; springy?: boolean; done?: () => void } = {},
  ) {
    object.scale.setScalar(from);
    tween({
      apply: (v) => object.scale.setScalar(Math.max(0, v)),
      from,
      to,
      delay: opts.delay ?? 0,
      duration: opts.duration ?? 0.5,
      springy: opts.springy,
      done: opts.done,
    });
  }

  function runTweens(dt: number) {
    if (tweens.length === 0) return;
    const still: Tween[] = [];

    for (const t of tweens) {
      t.elapsed += dt;
      const local = t.elapsed - t.delay;
      if (local < 0) {
        still.push(t);
        continue;
      }

      const p = Math.min(1, local / t.duration);
      const shaped = t.springy ? spring(p) : easeOut(p);
      t.apply(t.from + (t.to - t.from) * shaped);

      if (p < 1) still.push(t);
      else t.done?.();
    }

    tweens = still;
  }

  /** One flat texture and one material per count, drawn once and reused. */
  const numbers = new Map<number, THREE.CanvasTexture>();
  const numberMaterials = new Map<number, THREE.MeshBasicMaterial>();
  function numberMaterial(n: number): THREE.MeshBasicMaterial {
    let m = numberMaterials.get(n);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map: numberTexture(n) });
      numberMaterials.set(n, m);
    }
    return m;
  }
  function numberTexture(n: number): THREE.CanvasTexture {
    const cached = numbers.get(n);
    if (cached) return cached;

    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    g.fillStyle = skin.surface;
    g.fillRect(0, 0, size, size);
    g.fillStyle = skin.ink;
    g.font = `600 76px ${skin.font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(n), size / 2, size / 2 + 4);

    const texture = new THREE.CanvasTexture(c);
    texture.anisotropy = 4;
    numbers.set(n, texture);
    return texture;
  }

  // --- the volume -----------------------------------------------------------

  interface Cell {
    x: number;
    y: number;
    z: number;
    mine: boolean;
    count: number;
    revealed: boolean;
    flagged: boolean;
    mesh: THREE.Mesh;
    wire: THREE.LineSegments;
    /** Position with the lattice packed; dispersing scales this outward. */
    home: THREE.Vector3;
  }

  const group = new THREE.Group();
  scene.add(group);
  let cells: Cell[] = [];
  const at = (x: number, y: number, z: number): Cell | undefined =>
    x < 0 || y < 0 || z < 0 || x >= DIM || y >= DIM || z >= DIM
      ? undefined
      : cells[(x * DIM + y) * DIM + z];

  let started = false;
  let over = false;
  let won = false;
  let flags = 0;
  let elapsed = 0;

  let notify: (s: MinesState) => void = () => {};

  /**
   * Hold the state back until the animation finishes.
   *
   * The overlay is driven by `over`, so announcing the moment a mine is struck
   * put the "Again" card up on the same frame as the blast started — the whole
   * explosion happened behind it. The game is over internally straight away
   * (input is dead, the clock has stopped); it just does not say so until there
   * is nothing left to watch.
   */
  function announceAfter(seconds: number) {
    tween({ apply: () => {}, from: 0, to: 1, delay: 0, duration: seconds, done: () => announce() });
  }
  const announce = () =>
    notify({
      left: MINES - flags,
      seconds: Math.floor(elapsed),
      started,
      over,
      won,
    });

  function build() {
    for (const c of cells) {
      group.remove(c.mesh);
      group.remove(c.wire);
    }
    cells = [];

    const offset = ((DIM - 1) * GAP) / 2;
    for (let x = 0; x < DIM; x++) {
      for (let y = 0; y < DIM; y++) {
        for (let z = 0; z < DIM; z++) {
          const home = new THREE.Vector3(x * GAP - offset, y * GAP - offset, z * GAP - offset);
          const mesh = new THREE.Mesh(cube, glass);
          mesh.position.copy(home);
          const wire = new THREE.LineSegments(edges, edgeMaterial);
          wire.position.copy(home);

          const cell: Cell = { x, y, z, mine: false, count: 0, revealed: false, flagged: false, mesh, wire, home };
          mesh.userData.cell = cell;
          group.add(mesh);
          group.add(wire);
          cells.push(cell);
        }
      }
    }

    applySpread(spreadNow);
  }

  // --- dispersal ------------------------------------------------------------

  let spreadNow = 0;
  let spreadTarget = 0;

  function applySpread(t: number) {
    const lattice = 1 + SPREAD_GAP * t;
    for (const c of cells) {
      c.mesh.position.copy(c.home).multiplyScalar(lattice);
      c.wire.position.copy(c.mesh.position);
    }
    group.scale.setScalar(1 / (1 + SPREAD_SHRINK * t));
  }

  /**
   * Mines are laid after the first click, never before.
   *
   * Losing on the opening move is not a puzzle, it is a coin toss — so the
   * first cell you open, and everything touching it, is guaranteed clear.
   */
  function layMines(safe: Cell) {
    const forbidden = new Set<Cell>([safe, ...neighbours(safe)]);
    const candidates = cells.filter((c) => !forbidden.has(c));

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
    }
    for (const c of candidates.slice(0, MINES)) c.mine = true;

    for (const c of cells) c.count = neighbours(c).filter((n) => n.mine).length;
  }

  /** All 26, which is what makes this a different game from the flat one. */
  function neighbours(c: Cell): Cell[] {
    const out: Cell[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const n = at(c.x + dx, c.y + dy, c.z + dz);
          if (n) out.push(n);
        }
      }
    }
    return out;
  }

  /** How far a cell sits from the blast, in cells — the stagger reads as a
   *  wave travelling out from where you clicked. */
  const distance = (a: Cell, b: Cell) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));

  /**
   * The blast.
   *
   * Losing used to be a material swap on a single frame: the cube you clicked
   * was simply a different colour, and every other mine was already showing.
   * Nothing about that read as an explosion. Now the struck cell flares and
   * collapses, a shell of light passes through the volume, the cube takes the
   * hit, and the remaining mines surface in the wake of the wave.
   */
  function detonate(hit: Cell) {
    over = true;
    hit.revealed = true;
    hit.mesh.material = detonated;
    hit.wire.visible = false;

    // Flare, then collapse to a cinder.
    scaleTo(hit.mesh, 1, 1.75, {
      duration: 0.16,
      done: () => scaleTo(hit.mesh, 1.75, 0.5, { duration: 0.6, springy: true }),
    });

    // A shell of light through the volume. Back faces only, so it reads as
    // something passing through the cube rather than a ball sitting in front
    // of it, and it never occludes what it is expanding past.
    const shellMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(skin.accent),
      transparent: true,
      opacity: 0.55,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), shellMaterial);
    shell.position.copy(hit.mesh.position);
    shell.scale.setScalar(0.2);
    group.add(shell);
    tween({
      apply: (v) => {
        shell.scale.setScalar(v);
        shellMaterial.opacity = 0.55 * Math.max(0, 1 - v / 7);
      },
      from: 0.2,
      to: 7,
      delay: 0,
      duration: 0.8,
      done: () => {
        group.remove(shell);
        shell.geometry.dispose();
        shellMaterial.dispose();
      },
    });

    // The cube takes the hit — a decaying roll, not a shove.
    tween({
      apply: (v) => {
        group.rotation.z = Math.sin(v * 34) * 0.05 * Math.max(0, 1 - v / 0.7);
      },
      from: 0,
      to: 0.7,
      delay: 0,
      duration: 0.7,
      done: () => {
        group.rotation.z = 0;
      },
    });

    // Everything else surfaces behind the wave, nearest first.
    for (const c of cells) {
      if (!c.mine || c === hit) continue;
      c.mesh.material = detonated;
      c.wire.visible = false;
      scaleTo(c.mesh, 0.01, 0.55, {
        delay: 0.06 + distance(c, hit) * 0.07,
        duration: 0.42,
        springy: true,
      });
    }

    announceAfter(1.2);
  }

  function reveal(cell: Cell) {
    if (over || cell.revealed || cell.flagged) return;

    if (!started) {
      started = true;
      layMines(cell);
    }

    if (cell === hovered) unhover();

    if (cell.mine) {
      detonate(cell);
      return;
    }

    // Iterative flood rather than recursive: 125 cells is fine either way, but
    // the shape of this is clearer and it cannot blow a stack on a larger grid.
    // Breadth-first, and carrying a depth, because the depth is the stagger —
    // a cascade should arrive in the order it spread.
    const queue: Array<{ cell: Cell; depth: number }> = [{ cell, depth: 0 }];
    for (let head = 0; head < queue.length; head++) {
      const { cell: c, depth } = queue[head]!;
      if (c.flagged || c.mine) continue;
      c.revealed = true;

      const delay = depth * 0.05;

      if (c.count === 0) {
        // Empty cells disappear. That is what lets you see into the volume at
        // all — flattening them would leave the middle as sealed as before.
        // They shrink out with a half-turn, so a big opening is something you
        // watch happen.
        const mesh = c.mesh;
        const wire = c.wire;
        const spin = mesh.rotation.y;
        tween({
          apply: (v) => {
            mesh.rotation.y = spin + (1 - v) * Math.PI * 0.5;
          },
          from: 1,
          to: 0,
          delay,
          duration: 0.46,
        });
        scaleTo(mesh, 1, 0, { delay, duration: 0.46, done: () => (mesh.visible = false) });
        scaleTo(wire, 1, 0, { delay, duration: 0.46, done: () => (wire.visible = false) });

        for (const n of neighbours(c)) {
          if (!n.revealed && !n.flagged && !n.mine) {
            n.revealed = true; // claimed here, so it cannot be queued twice
            queue.push({ cell: n, depth: depth + 1 });
          }
        }
      } else {
        // Numbers shrink to a small solid marker. Swapping the material at the
        // top of the tween rather than at the end means the count is legible
        // while it is settling, not only once it stops.
        c.mesh.material = numberMaterial(c.count);
        const wire = c.wire;
        scaleTo(wire, 1, 0, { delay, duration: 0.42, done: () => (wire.visible = false) });
        scaleTo(c.mesh, 1, 0.42, { delay, duration: 0.42, springy: true });
      }
    }

    if (cells.every((c) => c.mine || c.revealed)) {
      over = true;
      won = true;
      unhover();
      // Won, so the mines are disarmed rather than blown: they come up in the
      // accent as flags, staggered, which is a lap of honour and not a bang.
      let n = 0;
      for (const c of cells) {
        if (!c.mine) continue;
        c.mesh.material = flagged;
        c.wire.visible = false;
        scaleTo(c.mesh, c.mesh.scale.x, 0.5, {
          delay: (n++) * 0.05,
          duration: 0.4,
          springy: true,
        });
      }
      announceAfter(1.5);
      return;
    }
    announce();
  }

  function flag(cell: Cell) {
    if (over || cell.revealed) return;
    cell.flagged = !cell.flagged;
    flags += cell.flagged ? 1 : -1;
    cell.mesh.material = cell.flagged ? flagged : cell === hovered ? glassHover : glass;
    announce();
  }

  // --- input ----------------------------------------------------------------

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = { x: 0, y: 0, time: 0 };
  let dragging = false;

  /**
   * The cell under the pointer.
   *
   * Twenty-six neighbours means the count on a face is often ambiguous about
   * which cube it belongs to, and in a volume you are frequently about to click
   * the one behind the one you meant. Lighting the cell that would actually
   * open removes the guess. CSS `:hover` is no help here — this is a canvas —
   * so the pick is the same raycast the click uses.
   */
  let hovered: Cell | null = null;

  function unhover() {
    if (hovered && !hovered.revealed && !hovered.flagged) hovered.mesh.material = glass;
    hovered = null;
    canvas.style.cursor = "";
  }

  function hover(cell: Cell | null) {
    if (cell === hovered) return;
    unhover();
    if (!cell || over || cell.revealed || cell.flagged) return;
    hovered = cell;
    cell.mesh.material = glassHover;
    canvas.style.cursor = "pointer";
  }

  function pick(event: PointerEvent | MouseEvent): Cell | null {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);

    const hits = ray.intersectObjects(
      cells.filter((c) => c.mesh.visible).map((c) => c.mesh),
      false,
    );
    return (hits[0]?.object.userData.cell as Cell | undefined) ?? null;
  }

  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY, time: performance.now() };
    dragging = true;
  };

  const onMove = (e: PointerEvent) => {
    // While orbiting, the pointer is steering the camera and every cell it
    // sweeps across would flash. Nothing is highlighted mid-drag.
    if (dragging) {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) unhover();
      return;
    }
    hover(pick(e));
  };

  const onLeave = () => unhover();

  const onUp = (e: PointerEvent) => {
    dragging = false;
    // A drag is an orbit, not a click. Without this every attempt to look
    // around would open whatever cell you started the drag on.
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    if (moved > 5 || performance.now() - downAt.time > 400) return;

    const cell = pick(e);
    hover(null);
    if (!cell) return;
    if (e.shiftKey || e.button === 2 || e.altKey) flag(cell);
    else reveal(cell);
  };

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    const cell = pick(e);
    if (cell) flag(cell);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("contextmenu", onContext);

  // --- loop -----------------------------------------------------------------

  let raf = 0;
  let last = performance.now();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (started && !over) {
      elapsed += dt;
      // Once a second is enough for a clock, and it keeps the HUD from
      // re-rendering on every frame.
      if (Math.floor(elapsed) !== Math.floor(elapsed - dt)) announce();
    }

    runTweens(dt);

    // Eased rather than bound directly to the slider, so a keyboard nudge
    // travels instead of jumping and a drag still feels immediate.
    if (Math.abs(spreadNow - spreadTarget) > 0.0005) {
      spreadNow += (spreadTarget - spreadNow) * Math.min(1, dt * 12);
      applySpread(spreadNow);
    }

    // A slow drift while nobody is touching it, so the shape reads as a volume
    // before you have moved at all.
    if (!controls.enabled || !started) group.rotation.y += dt * 0.12;

    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  function restart() {
    started = false;
    over = false;
    won = false;
    flags = 0;
    elapsed = 0;
    tweens = [];
    hovered = null;
    group.rotation.set(0, 0, 0);
    build();
    announce();
  }

  /**
   * Put a saved board back.
   *
   * The revealed cells are set to their finished appearance directly rather
   * than replayed through `reveal` — the cascade animation is the reward for
   * opening a cell, and firing forty of them at once on load would be a
   * fireworks display for something the player did a while ago.
   */
  function reinstate(save: MinesSave): boolean {
    if (!Array.isArray(save.cells) || save.cells.length !== cells.length) return false;

    flags = 0;
    save.cells.forEach((bits, i) => {
      const cell = cells[i]!;
      cell.mine = (bits & 1) !== 0;
      cell.revealed = (bits & 2) !== 0;
      cell.flagged = (bits & 4) !== 0;
      if (cell.flagged) flags += 1;
    });

    for (const c of cells) c.count = neighbours(c).filter((n) => n.mine).length;

    for (const cell of cells) {
      if (cell.flagged) {
        cell.mesh.material = flagged;
        continue;
      }
      if (!cell.revealed) continue;
      cell.wire.visible = false;
      if (cell.count === 0) {
        cell.mesh.visible = false;
      } else {
        cell.mesh.material = numberMaterial(cell.count);
        cell.mesh.scale.setScalar(0.42);
      }
    }

    started = true;
    over = false;
    won = false;
    elapsed = save.seconds;
    spreadTarget = save.spread;
    spreadNow = save.spread;
    applySpread(spreadNow);
    return true;
  }

  build();
  if (saved) reinstate(saved);
  resize();
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("contextmenu", onContext);
      controls.dispose();
      for (const t of numbers.values()) t.dispose();
      for (const m of numberMaterials.values()) m.dispose();
      cube.dispose();
      edges.dispose();
      noise.dispose();
      renderer.dispose();
    },
    snapshot() {
      // Nothing before the first click, and nothing once it is decided: a
      // finished board handed back as unfinished would be unwinnable or
      // already lost.
      if (!started || over) return null;
      return {
        cells: cells.map(
          (c) => (c.mine ? 1 : 0) | (c.revealed ? 2 : 0) | (c.flagged ? 4 : 0),
        ),
        seconds: elapsed,
        spread: spreadTarget,
      };
    },
    onState(handler) {
      notify = handler;
      announce();
    },
    spread(amount) {
      spreadTarget = Math.min(1, Math.max(0, amount));
    },
    restart,
  };
}
