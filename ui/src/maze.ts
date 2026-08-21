/**
 * A maze, walked in first person.
 *
 * The whole idea is the tension between two views. On foot you see a corridor
 * and two turns, which is enough to be lost in; pull back and the maze is laid
 * out flat and obvious. Neither view alone is a game — one is frustrating, the
 * other trivial — so the pull-back is a deliberate move you make, animated
 * rather than cut, because a cut costs you the mapping between what you just
 * saw from above and where you are standing.
 *
 * Fog clears as you pull back and closes in as you drop down. That is what
 * makes the overview worth taking: at eye level you genuinely cannot see far
 * enough to solve it by walking.
 *
 * Drawn from the panel's own tokens, like the other games. Three is imported
 * dynamically by the caller so its weight only lands if this game is chosen.
 */

import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import columnUrl from "./models/column.glb?url";
import floorUrl from "./models/floor.glb?url";
import pedestalUrl from "./models/pedestal.glb?url";
import torchUrl from "./models/torch.glb?url";
import wallUrl from "./models/wall.glb?url";

/**
 * A maze in progress, small enough to write once a second.
 *
 * The walls are the only bulky part, and they pack into one number per cell.
 * The goal is not stored: it is the cell furthest from the start by path
 * length, which is a deterministic function of the walls, so restoring the
 * walls restores the goal with them.
 */
export interface MazeSave {
  /** Four bits per cell — north, east, south, west. */
  walls: number[];
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  steps: number;
  elapsed: number;
}

export interface Maze {
  destroy(): void;
  /** The run so far, or null when there is nothing worth keeping. */
  snapshot(): MazeSave | null;
  onState(handler: (state: MazeState) => void): void;
  restart(): void;
  /** Pull back to the overhead view, or drop back in. */
  overview(on: boolean): void;
  pause(): void;
  play(): void;
}

export interface MazeState {
  /** Cells entered — the closest thing to a score here. */
  steps: number;
  seconds: number;
  started: boolean;
  solved: boolean;
  paused: boolean;
  overview: boolean;
  /** Straight-line cells between the walker and the goal, for the HUD. */
  away: number;
}

export interface Skin {
  surface: string;
  ink: string;
  faint: string;
  accent: string;
  hairline: string;
  font: string;
}

/** Big enough to get lost in, small enough to solve in a few minutes. */
const COLS = 12;
const ROWS = 12;
/**
 * World units per cell.
 *
 * The dungeon models are authored on a 2-unit module — a wall panel is exactly
 * 2 wide and 2 tall, a floor tile exactly 2 square. Three-unit cells give a
 * corridor you can turn around in without the walls feeling like a tunnel, so
 * every piece is scaled by `MODULE_SCALE` and the grid still lines up exactly.
 */
const CELL = 3;
const MODULE = 2;
const MODULE_SCALE = CELL / MODULE;
/** Measured from the wall panel, not guessed: 2.01 and 0.44 at native size. */
const WALL_H = 2.01 * MODULE_SCALE;
const WALL_T = 0.44 * MODULE_SCALE;
/** Comfortably inside a corridor, so corners are roundable without snagging. */
const RADIUS = 0.42;
const EYE = 1.45;

interface Cell {
  /** Walls that still stand, clockwise from the top of the grid. */
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  seen: boolean;
}

export function startMaze(canvas: HTMLCanvasElement, skin: Skin, saved?: MazeSave | null): Maze {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const surface = new THREE.Color(skin.surface);
  const accent = new THREE.Color(skin.accent);

  // Exponential rather than linear: it thickens with distance in a way that
  // reads as air rather than as a wall of colour at a fixed range.
  const fog = new THREE.FogExp2(surface.getHex(), 0.085);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 200);

  const worldW = COLS * CELL;
  const worldD = ROWS * CELL;
  const originX = -worldW / 2 + CELL / 2;
  const originZ = -worldD / 2 + CELL / 2;
  const centre = (c: number, r: number) =>
    new THREE.Vector3(originX + c * CELL, 0, originZ + r * CELL);

  // --- lighting -------------------------------------------------------------

  scene.add(new THREE.HemisphereLight(new THREE.Color(skin.ink), surface, 1.1));
  const sun = new THREE.DirectionalLight(new THREE.Color(skin.ink), 0.7);
  sun.position.set(6, 18, 4);
  scene.add(sun);

  // Travels with the walker. Without it the corridors go black under fog and
  // first person becomes guesswork rather than navigation.
  const lamp = new THREE.PointLight(accent, 14, 11, 1.8);
  scene.add(lamp);

  // --- materials ------------------------------------------------------------

  /** Grain, so the walls are not flat panels of one colour under the lamp. */
  function grain(): THREE.CanvasTexture {
    const size = 256;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    const image = g.createImageData(size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = 140 + Math.random() * 115;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(c);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 3);
    return texture;
  }

  const noise = grain();

  /**
   * Wood, painted rather than loaded.
   *
   * The pack ships no images at all, so there is nothing to load — and a
   * canvas costs a few kilobytes against a photograph's few hundred, tiles
   * without a seam by construction, and can be mixed from the theme's own
   * colours so the dungeon belongs to the same product as the panel.
   */
  function woodTexture(): THREE.CanvasTexture {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;

    const warm = surface.clone().lerp(new THREE.Color("#5a3a24"), 0.82);
    g.fillStyle = `#${warm.getHexString()}`;
    g.fillRect(0, 0, size, size);

    // Grain: many long, low-contrast streaks along the plank.
    for (let i = 0; i < 240; i++) {
      const y = Math.random() * size;
      const dark = Math.random() * 0.16;
      g.strokeStyle = `rgba(30, 16, 8, ${dark.toFixed(3)})`;
      g.lineWidth = 0.6 + Math.random() * 2.2;
      g.beginPath();
      g.moveTo(0, y);
      // A gentle wander, so the grain is not a set of ruled lines.
      for (let x = 0; x <= size; x += 32) {
        g.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 3);
      }
      g.stroke();
    }

    // Plank seams, evenly spaced so the tile repeats cleanly.
    const planks = 4;
    for (let i = 0; i <= planks; i++) {
      const y = (i / planks) * size;
      g.strokeStyle = "rgba(20, 10, 5, 0.55)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(size, y);
      g.stroke();
      g.strokeStyle = "rgba(255, 220, 190, 0.07)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, y + 3);
      g.lineTo(size, y + 3);
      g.stroke();
    }

    // A few knots, kept away from the seams so they read as part of a board.
    for (let i = 0; i < 5; i++) {
      const x = 40 + Math.random() * (size - 80);
      const y = ((Math.floor(Math.random() * planks) + 0.5) / planks) * size;
      const r = 5 + Math.random() * 7;
      const knot = g.createRadialGradient(x, y, 1, x, y, r);
      knot.addColorStop(0, "rgba(26, 13, 6, 0.85)");
      knot.addColorStop(1, "rgba(26, 13, 6, 0)");
      g.fillStyle = knot;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    const texture = new THREE.CanvasTexture(c);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  /** Packed earth for the floor: brown, mottled, no direction to it. */
  function groundTexture(): THREE.CanvasTexture {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;

    const earth = surface.clone().lerp(new THREE.Color("#4a2f1e"), 0.86);
    g.fillStyle = `#${earth.getHexString()}`;
    g.fillRect(0, 0, size, size);

    // Broad blotches first, so the ground has large-scale variation and does
    // not read as one flat brown under the walker's lamp.
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 28 + Math.random() * 90;
      const light = Math.random() > 0.5;
      const blotch = g.createRadialGradient(x, y, 1, x, y, r);
      blotch.addColorStop(0, light ? "rgba(150, 110, 78, 0.16)" : "rgba(22, 12, 6, 0.2)");
      blotch.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = blotch;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }

    // Then grit, for something to catch the light close up.
    const image = g.getImageData(0, 0, size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      image.data[i] = Math.max(0, Math.min(255, image.data[i]! + n));
      image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1]! + n));
      image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2]! + n));
    }
    g.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(c);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  const wood = woodTexture();
  const ground = groundTexture();

  /** A soft round blob, for the mist sheets to be cut out of. */
  function blobTexture(): THREE.CanvasTexture {
    const size = 256;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    const r = size / 2;
    const soft = g.createRadialGradient(r, r, 0, r, r, r);
    soft.addColorStop(0, "rgba(255,255,255,0.85)");
    soft.addColorStop(0.45, "rgba(255,255,255,0.35)");
    soft.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = soft;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }

  const blob = blobTexture();

  /**
   * The models carry POSITION and NORMAL and nothing else — they were authored
   * for flat colours, so there is not a single UV in the pack. Textures need
   * somewhere to land, so each vertex is projected onto whichever axis plane
   * its normal points most strongly along. On a dungeon built from boxes that
   * is exactly right, and it costs one pass over the geometry at load.
   */
  function boxUnwrap(geometry: THREE.BufferGeometry, perUnit: number) {
    if (geometry.getAttribute("uv")) return;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = new Float32Array(position.count * 2);

    for (let i = 0; i < position.count; i++) {
      const nx = Math.abs(normal.getX(i));
      const ny = Math.abs(normal.getY(i));
      const nz = Math.abs(normal.getZ(i));
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);

      let u: number;
      let v: number;
      if (nx >= ny && nx >= nz) {
        u = z;
        v = y;
      } else if (ny >= nx && ny >= nz) {
        u = x;
        v = z;
      } else {
        u = x;
        v = y;
      }
      uv[i * 2] = u * perUnit;
      uv[i * 2 + 1] = v * perUnit;
    }

    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }

  // --- the models -----------------------------------------------------------

  /**
   * The pack ships no textures at all — every material is a flat colour with a
   * name like `Wall_Dark` or `Wall_Highlights`. That is a gift rather than a
   * limitation: instead of fighting an imported grey dungeon that clashes with
   * the panel, the names are mapped onto Muninn's own palette, and the
   * relative light-to-dark relationships the artist authored survive.
   */
  const TINTS: Record<string, { mix: number; toward?: "ink" | "accent"; emissive?: number }> = {
    Wall_Dark: { mix: 0.34 },
    Wall_Medium: { mix: 0.2 },
    Wall_Highlights: { mix: 0.08 },
    Grey_Floor: { mix: 0.12 },
    DarkGrey_Floor: { mix: 0.3 },
    DarkMetal: { mix: 0.44 },
    Marble: { mix: 0.5, toward: "accent" },
    Fire: { mix: 0.9, toward: "accent", emissive: 1.6 },
  };

  const ink = new THREE.Color(skin.ink);
  const retinted = new Map<string, THREE.MeshStandardMaterial>();

  /** Which painted surface a model should wear, if any. */
  type Look = "wood" | "ground";

  function retint(source: THREE.Material, look?: Look): THREE.MeshStandardMaterial {
    const name = source.name || "unnamed";
    // Keyed by both: `Grey_Floor` appears on the floor tile and on the column,
    // and only one of them should come back as packed earth.
    const key = `${name}|${look ?? ""}`;
    const cached = retinted.get(key);
    if (cached) return cached;

    const rule = TINTS[name] ?? { mix: 0.18 };
    const map = look === "wood" ? wood : look === "ground" ? ground : null;

    // With a map, the colour multiplies it — so it is pulled most of the way
    // to white and used only to keep the darker pieces of the model darker
    // than the lighter ones, rather than to supply the colour itself.
    const base = map
      ? new THREE.Color(1, 1, 1).lerp(ink, rule.mix * 0.5)
      : surface.clone().lerp(rule.toward === "accent" ? accent : ink, rule.mix);

    const material = new THREE.MeshStandardMaterial({
      color: base,
      map,
      roughness: rule.emissive ? 0.4 : 0.88,
      roughnessMap: rule.emissive ? null : noise,
      metalness: 0,
      emissive: rule.emissive ? accent : new THREE.Color(0, 0, 0),
      emissiveIntensity: rule.emissive ?? 0,
    });
    material.name = key;
    retinted.set(key, material);
    return material;
  }

  /** One drawable piece of a loaded model, flattened out of its hierarchy. */
  interface Part {
    geometry: THREE.BufferGeometry;
    material: THREE.MeshStandardMaterial;
    /** The part's transform within its model, already baked. */
    local: THREE.Matrix4;
  }

  interface Model {
    parts: Part[];
    /** How far to lift the model so it stands on y = 0. */
    lift: number;
    size: THREE.Vector3;
  }

  const loader = new GLTFLoader();

  async function load(url: string, scale: number, look?: Look): Promise<Model> {
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);

    const parts: Part[] = [];
    root.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      const mesh = node as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // Tiled in model space, then scaled with the model — so a wall panel
      // shows the same number of planks whatever `MODULE_SCALE` happens to be.
      if (look) boxUnwrap(mesh.geometry, 0.5);
      parts.push({
        geometry: mesh.geometry,
        material: retint(materials[0]!, look),
        local: mesh.matrixWorld.clone(),
      });
    });

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    // Measured, not assumed: the wall panel is centred on its own origin while
    // the column already sits on the floor, and hard-coding either would put
    // one of them half underground.
    return { parts, lift: -box.min.y, size };
  }

  /**
   * One InstancedMesh per part, so a model with three materials costs three
   * draw calls for all of its copies rather than three per copy.
   */
  function instance(model: Model, placements: THREE.Matrix4[]): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const combined = new THREE.Matrix4();

    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      placements.forEach((placement, i) => {
        combined.multiplyMatrices(placement, part.local);
        mesh.setMatrixAt(i, combined);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // The maze is drawn from inside; three's automatic culling works off the
      // instanced bounding sphere and would pop whole walls in and out.
      mesh.frustumCulled = false;
      out.push(mesh);
    }
    return out;
  }

  /** Set by `destroy()`. An in-flight model load must not build into a scene
   *  whose renderer has already been disposed. */
  let dead = false;

  let models: {
    wall: Model;
    floor: Model;
    column: Model;
    torch: Model;
    pedestal: Model;
  } | null = null;

  // --- the maze -------------------------------------------------------------

  let cells: Cell[] = [];
  const at = (c: number, r: number): Cell | undefined =>
    c < 0 || r < 0 || c >= COLS || r >= ROWS ? undefined : cells[r * COLS + c];

  /**
   * Recursive backtracker, iteratively.
   *
   * It produces long winding corridors with few junctions, which is the right
   * character here: a maze of short branches is trivial on foot, and the whole
   * point is that walking it should be hard enough to want the map.
   */
  function carve() {
    cells = Array.from({ length: COLS * ROWS }, () => ({
      n: true,
      e: true,
      s: true,
      w: true,
      seen: false,
    }));

    const stack: Array<[number, number]> = [[0, 0]];
    at(0, 0)!.seen = true;

    while (stack.length) {
      const [c, r] = stack[stack.length - 1]!;
      const options: Array<[number, number, keyof Cell, keyof Cell]> = [];
      if (at(c, r - 1)?.seen === false) options.push([c, r - 1, "n", "s"]);
      if (at(c + 1, r)?.seen === false) options.push([c + 1, r, "e", "w"]);
      if (at(c, r + 1)?.seen === false) options.push([c, r + 1, "s", "n"]);
      if (at(c - 1, r)?.seen === false) options.push([c - 1, r, "w", "e"]);

      if (options.length === 0) {
        stack.pop();
        continue;
      }

      const [nc, nr, here, there] = options[Math.floor(Math.random() * options.length)]!;
      (at(c, r)! as unknown as Record<string, boolean>)[here] = false;
      (at(nc, nr)! as unknown as Record<string, boolean>)[there] = false;
      at(nc, nr)!.seen = true;
      stack.push([nc, nr]);
    }
  }

  /**
   * The goal is the cell furthest from the start, by path length.
   *
   * A fixed corner would often sit a few turns away through a lucky corridor.
   * Breadth-first from the start and taking the last cell reached guarantees
   * the longest journey the maze contains.
   */
  function farthest(): [number, number] {
    const distance = new Map<number, number>([[0, 0]]);
    const queue: Array<[number, number]> = [[0, 0]];
    let best: [number, number] = [0, 0];

    for (let head = 0; head < queue.length; head++) {
      const [c, r] = queue[head]!;
      const cell = at(c, r)!;
      const d = distance.get(r * COLS + c)!;
      if (d > (distance.get(best[1] * COLS + best[0]) ?? 0)) best = [c, r];

      const step = (nc: number, nr: number) => {
        if (!at(nc, nr) || distance.has(nr * COLS + nc)) return;
        distance.set(nr * COLS + nc, d + 1);
        queue.push([nc, nr]);
      };
      if (!cell.n) step(c, r - 1);
      if (!cell.e) step(c + 1, r);
      if (!cell.s) step(c, r + 1);
      if (!cell.w) step(c - 1, r);
    }

    return best;
  }

  // --- geometry -------------------------------------------------------------

  const group = new THREE.Group();
  scene.add(group);

  /** Every standing wall as an axis-aligned segment, for collision. */
  interface Segment {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
  }
  let segments: Segment[] = [];

  let goal: [number, number] = [0, 0];
  let beam: THREE.Mesh | null = null;
  let beamMaterial: THREE.MeshBasicMaterial | null = null;
  /** The shockwave that runs out across the floor when you get out. */
  let ring: THREE.Mesh | null = null;
  let ringMaterial: THREE.MeshBasicMaterial | null = null;
  let goalMaterial: THREE.MeshStandardMaterial | null = null;
  let mist: THREE.Group | null = null;
  let mistMaterials: THREE.MeshBasicMaterial | null = null;

  function build() {
    if (!models) return;
    for (const child of [...group.children]) group.remove(child);
    segments = [];

    const spin = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const put = (x: number, y: number, z: number, turn = 0) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        spin.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
        one,
      );

    // --- floor ---
    const tiles: THREE.Matrix4[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = centre(c, r);
        // Lifted so the tile's top face lands exactly on y = 0, whatever the
        // model's own origin happens to be.
        tiles.push(put(p.x, models.floor.lift - models.floor.size.y, p.z));
      }
    }
    group.add(...instance(models.floor, tiles));

    // --- walls ---
    const wallsAt: THREE.Matrix4[] = [];
    const posts = new Set<string>();

    const add = (x: number, z: number, horizontal: boolean) => {
      wallsAt.push(put(x, models!.wall.lift, z, horizontal ? 0 : Math.PI / 2));
      const half = CELL / 2;
      segments.push(
        horizontal
          ? { x0: x - half, z0: z, x1: x + half, z1: z }
          : { x0: x, z0: z - half, x1: x, z1: z + half },
      );
      // Both ends want a post, and a Set means shared corners get exactly one.
      const key = (a: number, b: number) => `${a.toFixed(2)}:${b.toFixed(2)}`;
      if (horizontal) {
        posts.add(key(x - half, z));
        posts.add(key(x + half, z));
      } else {
        posts.add(key(x, z - half));
        posts.add(key(x, z + half));
      }
    };

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = at(c, r)!;
        const p = centre(c, r);
        const half = CELL / 2;
        // North and west for every cell, south and east only on the far edges
        // — otherwise every interior wall is built twice, once from each side.
        if (cell.n) add(p.x, p.z - half, true);
        if (cell.w) add(p.x - half, p.z, false);
        if (r === ROWS - 1 && cell.s) add(p.x, p.z + half, true);
        if (c === COLS - 1 && cell.e) add(p.x + half, p.z, false);
      }
    }
    group.add(...instance(models.wall, wallsAt));

    // --- posts ---
    // Modular panels meet at right angles and leave a visible notch at every
    // corner. A column in the corner is what the pack is designed to hide it
    // with, and it reads as architecture rather than as patching.
    const columns = [...posts].map((key) => {
      const [x, z] = key.split(":").map(Number);
      return put(x!, models!.column.lift, z!);
    });
    group.add(...instance(models.column, columns));

    // --- torches ---
    // Sparse and deterministic from position, so a given maze always lights
    // the same way. Emissive only: real lights here would cost more than the
    // atmosphere is worth, and the walker carries one already.
    const torches: THREE.Matrix4[] = [];
    wallsAt.forEach((m, i) => {
      if (i % 6 !== 0) return;
      const at3 = new THREE.Vector3().setFromMatrixPosition(m);
      const turn = i % 12 === 0 ? 0 : Math.PI;
      torches.push(put(at3.x, WALL_H * 0.58, at3.z, turn));
    });
    group.add(...instance(models.torch, torches));

    // --- the goal ---
    goal = farthest();
    const g = centre(goal[0], goal[1]);
    group.add(...instance(models.pedestal, [put(g.x, models.pedestal.lift, g.z)]));

    beamMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 26, 12, 1, true), beamMaterial);
    beam.position.set(g.x, 13, g.z);
    group.add(beam);

    // A flat ring lying on the floor, kept at zero until the moment it is
    // needed. Additive so it reads as light thrown across the ground rather
    // than as a painted circle.
    ringMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 96), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(g.x, 0.06, g.z);
    ring.visible = false;
    ring.renderOrder = 3;
    group.add(ring);

    // The plinth itself, so it can be lit from within at the end. Only the
    // pedestal wears `Marble`, so holding this one material is enough.
    goalMaterial = models.pedestal.parts[0]?.material ?? null;

    // --- mist ---
    // Flat sheets lying just above the floor rather than a volumetric effect:
    // at eye level a handful of drifting blobs read as mist pooling in the
    // corridors, and they cost one transparent draw each. They fade out as you
    // pull back, because from above they would only hide the answer.
    mist = new THREE.Group();
    const mistMaterial = new THREE.MeshBasicMaterial({
      map: blob,
      color: surface.clone().lerp(new THREE.Color("#c9b6a6"), 0.55),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    mistMaterials = mistMaterial;

    for (let i = 0; i < 16; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mistMaterial);
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(
        (Math.random() - 0.5) * worldW,
        0.3 + Math.random() * 0.7,
        (Math.random() - 0.5) * worldD,
      );
      sheet.rotation.z = Math.random() * Math.PI * 2;
      // Each drifts on its own heading and turns at its own rate, so the bank
      // never resolves into a pattern.
      sheet.userData.drift = new THREE.Vector2(
        (Math.random() - 0.5) * 0.22,
        (Math.random() - 0.5) * 0.22,
      );
      sheet.userData.turn = (Math.random() - 0.5) * 0.06;
      sheet.renderOrder = 2;
      mist.add(sheet);
    }
    group.add(mist);


  }

  // --- the map ---------------------------------------------------------------
  //
  // Drawn flat, in 2D, over the top of the game rather than by lifting the
  // camera. Pulling the 3D camera back was the obvious thing and it did not
  // work: from above, a textured dungeon is a field of brown, walls and floor
  // read as the same value, and the one thing the map exists to show — where
  // the corridors go — is exactly what is lost. A schematic has no such
  // problem, and it costs a canvas rather than a second render of the scene.

  const map = document.createElement("canvas");
  map.className = "mz-map";
  map.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 220ms ease-out;pointer-events:none";
  canvas.parentElement?.appendChild(map);
  const mapCtx = map.getContext("2d")!;

  /** Pixels per world unit, and the world point held at the centre. */
  let mapScale = 1;
  const mapPan = new THREE.Vector2(0, 0);
  let mapFitted = false;

  function fitMap() {
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // The whole maze, with a margin, whichever axis is tighter.
    mapScale = Math.min(rect.width / (worldW + CELL * 2), rect.height / (worldD + CELL * 2));
    mapPan.set(0, 0);
    mapFitted = true;
  }

  function drawMap() {
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height || !models) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    if (map.width !== Math.round(rect.width * dpr) || map.height !== Math.round(rect.height * dpr)) {
      map.width = Math.round(rect.width * dpr);
      map.height = Math.round(rect.height * dpr);
    }
    if (!mapFitted) fitMap();

    const g = mapCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    // A wash over the game, so the map is readable without hiding that the
    // dungeon is still there underneath.
    g.fillStyle = `#${surface.getHexString()}ee`;
    g.fillRect(0, 0, rect.width, rect.height);

    const k = mapScale;
    const cx = rect.width / 2 - mapPan.x * k;
    const cy = rect.height / 2 - mapPan.y * k;
    const sx = (x: number) => cx + x * k;
    const sy = (z: number) => cy + z * k;
    const half = CELL / 2;

    // Corridors first, as one light field.
    g.fillStyle = `#${surface.clone().lerp(new THREE.Color("#ffffff"), 0.1).getHexString()}`;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = centre(c, r);
        g.fillRect(sx(p.x - half), sy(p.z - half), CELL * k + 1, CELL * k + 1);
      }
    }

    // Then walls, as strokes on top. Dark and thick: the contrast between
    // corridor and wall is the entire point of the drawing.
    g.strokeStyle = `#${ink.getHexString()}`;
    g.lineWidth = Math.max(2, CELL * k * 0.17);
    g.lineCap = "square";
    g.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = at(c, r)!;
        const p = centre(c, r);
        const line = (x0: number, z0: number, x1: number, z1: number) => {
          g.moveTo(sx(x0), sy(z0));
          g.lineTo(sx(x1), sy(z1));
        };
        if (cell.n) line(p.x - half, p.z - half, p.x + half, p.z - half);
        if (cell.w) line(p.x - half, p.z - half, p.x - half, p.z + half);
        if (r === ROWS - 1 && cell.s) line(p.x - half, p.z + half, p.x + half, p.z + half);
        if (c === COLS - 1 && cell.e) line(p.x + half, p.z - half, p.x + half, p.z + half);
      }
    }
    g.stroke();

    // The way out. Ringed and pulsing, because it is the only thing on the map
    // you are actually looking for.
    const g0 = centre(goal[0], goal[1]);
    const beat = 0.6 + Math.sin(performance.now() * 0.004) * 0.4;
    const rr = Math.max(5, CELL * k * 0.3);
    g.fillStyle = `#${accent.getHexString()}`;
    g.beginPath();
    g.arc(sx(g0.x), sy(g0.z), rr, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `#${accent.getHexString()}`;
    g.globalAlpha = beat;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(sx(g0.x), sy(g0.z), rr + 4 + beat * 5, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;

    // You. A triangle rather than a dot, because which way you are facing is
    // half of what you came to the map to find out.
    const size = Math.max(6, CELL * k * 0.32);
    g.save();
    g.translate(sx(position.x), sy(position.z));
    // Screen y runs the same way as world z here, so the yaw that points the
    // camera down −Z points the triangle up the page.
    g.rotate(-yaw);
    g.fillStyle = `#${ink.getHexString()}`;
    g.beginPath();
    g.moveTo(0, -size);
    g.lineTo(size * 0.66, size * 0.7);
    g.lineTo(0, size * 0.34);
    g.lineTo(-size * 0.66, size * 0.7);
    g.closePath();
    g.fill();
    g.restore();
  }

  // --- the walker -----------------------------------------------------------

  const position = new THREE.Vector3();
  let yaw = 0;
  let pitch = 0;
  let cellNow: [number, number] = [0, 0];

  let started = false;
  /**
   * Whether the player has actually done anything.
   *
   * The clock hangs off this rather than off `started`, because `started` gets
   * set by opening the window — and a run that was restored, or one nobody has
   * touched yet, must not be quietly accumulating seconds while its window
   * sits there. The first key or click is what starts time.
   */
  let touched = false;
  let solved = false;
  let paused = false;
  let steps = 0;
  let elapsed = 0;
  /** Seconds since the exit was reached, or −1 while still walking. */
  let won = -1;
  let announcedWin = false;

  /** 0 on foot, 1 pulled back. Eased every frame toward `wantOverview`. */
  let view = 0;
  let wantOverview = false;

  let notify: (s: MazeState) => void = () => {};
  const announce = () =>
    notify({
      steps,
      seconds: Math.floor(elapsed),
      started,
      solved,
      paused,
      overview: wantOverview,
      away:
        Math.abs(cellNow[0] - goal[0]) + Math.abs(cellNow[1] - goal[1]),
    });

  const WIN_LENGTH = 2.6;

  /**
   * Getting out.
   *
   * One beat, not a fireworks display: the plinth lights, a ring of light runs
   * out across the floor and passes through the walls, the beam swells, and
   * the camera rises off the floor and turns to look back down at the maze you
   * just came through. It resolves rather than celebrating, which is the same
   * register as everything else here.
   */
  function runVictory(dt: number) {
    won += dt;
    const t = won;

    // The ring: out fast, fading as it goes, gone before it reaches the walls
    // of the world.
    if (ring && ringMaterial) {
      ring.visible = true;
      const spread = Math.min(1, t / 1.5);
      const radius = 0.6 + Math.pow(spread, 0.65) * 30;
      ring.scale.setScalar(radius);
      ringMaterial.opacity = Math.max(0, 0.75 * (1 - spread) ** 1.4);
    }

    // The plinth lights from inside, holds, then eases back.
    if (goalMaterial) {
      goalMaterial.emissive = accent;
      goalMaterial.emissiveIntensity = t < 0.35 ? (t / 0.35) * 1.5 : Math.max(0.5, 1.5 - (t - 0.35) * 0.5);
    }

    // The beam swells and brightens with it.
    if (beam && beamMaterial) {
      const swell = 1 + Math.max(0, 1 - t / 0.9) * 2.6;
      beam.scale.set(swell, 1, swell);
      beamMaterial.opacity = 0.24 + Math.max(0, 1 - t / 1.2) * 0.5;
    }

    // The lamp flares and settles, so the corridor around you lifts too.
    lamp.intensity = 14 + Math.max(0, 1 - t / 0.8) * 70;

    if (!announcedWin && t >= WIN_LENGTH) {
      announcedWin = true;
      announce();
    }
  }

  function placeWalker() {
    touched = false;
    const start = centre(0, 0);
    position.set(start.x, EYE, start.z);
    cellNow = [0, 0];
    yaw = 0;
    pitch = 0;
    steps = 0;
    elapsed = 0;
    solved = false;
    won = -1;
    announcedWin = false;
  }

  /** Which cell a world position is standing in. */
  function cellOf(x: number, z: number): [number, number] {
    return [
      Math.min(COLS - 1, Math.max(0, Math.round((x - originX) / CELL))),
      Math.min(ROWS - 1, Math.max(0, Math.round((z - originZ) / CELL))),
    ];
  }

  /** Closest distance from a point to an axis-aligned segment. */
  function distanceTo(seg: Segment, x: number, z: number): number {
    const dx = seg.x1 - seg.x0;
    const dz = seg.z1 - seg.z0;
    const length = dx * dx + dz * dz;
    let t = length === 0 ? 0 : ((x - seg.x0) * dx + (z - seg.z0) * dz) / length;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (seg.x0 + t * dx), z - (seg.z0 + t * dz));
  }

  /**
   * Would the walker overlap a wall here?
   *
   * Only the segments near the candidate position are tested. Half the wall's
   * thickness is added to the walker's radius so it stops against the face of
   * a wall rather than at its centre line.
   */
  function blocked(x: number, z: number): boolean {
    const clearance = RADIUS + WALL_T / 2;
    for (const seg of segments) {
      // Cheap reject before the real test — most segments are far away.
      if (Math.abs(seg.x0 - x) > CELL * 1.5 && Math.abs(seg.x1 - x) > CELL * 1.5) continue;
      if (Math.abs(seg.z0 - z) > CELL * 1.5 && Math.abs(seg.z1 - z) > CELL * 1.5) continue;
      if (distanceTo(seg, x, z) < clearance) return true;
    }
    return false;
  }

  /**
   * Move, one axis at a time.
   *
   * Trying both together means a diagonal into a corner rejects the whole
   * step, and the walker sticks. Resolving X and Z separately lets a blocked
   * diagonal slide along the wall it hit, which is what makes corners feel
   * smooth rather than sticky.
   */
  function step(dx: number, dz: number) {
    if (!blocked(position.x + dx, position.z)) position.x += dx;
    if (!blocked(position.x, position.z + dz)) position.z += dz;

    const now = cellOf(position.x, position.z);
    if (now[0] !== cellNow[0] || now[1] !== cellNow[1]) {
      cellNow = now;
      steps += 1;
      if (!solved && now[0] === goal[0] && now[1] === goal[1]) {
        solved = true;
        won = 0;
        // Deliberately not announced here. `solved` is what raises the card,
        // and raising it now would put it over the top of the one moment the
        // game has been building to — the same mistake the Minesweeper blast
        // taught. The loop announces it when the light has finished.
        return;
      }
      announce();
    }
  }

  // --- input ----------------------------------------------------------------

  const held = new Set<string>();

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();

    if (key === "tab" || key === "m") {
      // Tab would otherwise walk the window's focus ring.
      e.preventDefault();
      setOverview(!wantOverview);
      return;
    }
    if (key === "r") {
      restart();
      return;
    }
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) e.preventDefault();

    if (!started || paused) start();
    touched = true;
    held.add(key);
  };

  const onKeyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());

  // Mouse look, once the canvas has been clicked. Pointer lock is the only way
  // to turn past the edge of a window; the keyboard turn keys exist for anyone
  // who would rather not be captured.
  const onCanvasClick = () => {
    if (!started || paused) start();
    touched = true;
    if (!wantOverview && document.pointerLockElement !== canvas) {
      void canvas.requestPointerLock?.();
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * 0.0022;
    // Stopped just short of straight up or down, where the view would flip.
    pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0022));
  };

  /**
   * Dragging and zooming the map.
   *
   * Live only while pulled back — on foot the same gestures belong to mouse
   * look, and the two must never both be listening. Left drag orbits, right
   * drag (or shift) pans, wheel zooms.
   */
  let dragging: { x: number; y: number; pan: boolean } | null = null;

  const onOverviewDown = (e: PointerEvent) => {
    if (!wantOverview) return;
    dragging = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    canvas.setPointerCapture?.(e.pointerId);
  };

  const onOverviewMove = (e: PointerEvent) => {
    if (!dragging || !wantOverview) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging.x = e.clientX;
    dragging.y = e.clientY;

    // Any drag pans: there is no third dimension left to orbit around, and a
    // flat map has only one useful gesture. Divided by the scale so the map
    // tracks the cursor exactly at every zoom.
    mapPan.x -= dx / mapScale;
    mapPan.y -= dy / mapScale;
    // Held near the maze, or it is possible to lose it off the edge.
    mapPan.x = Math.max(-worldW, Math.min(worldW, mapPan.x));
    mapPan.y = Math.max(-worldD, Math.min(worldD, mapPan.y));
  };

  const onOverviewUp = (e: PointerEvent) => {
    dragging = null;
    canvas.releasePointerCapture?.(e.pointerId);
  };

  const onWheel = (e: WheelEvent) => {
    if (!wantOverview) return;
    e.preventDefault();
    // Multiplicative, so a notch changes the view by the same proportion
    // whether you are zoomed in or out.
    const fit = Math.min(
      map.clientWidth / (worldW + CELL * 2),
      map.clientHeight / (worldD + CELL * 2),
    );
    mapScale = Math.max(fit * 0.85, Math.min(fit * 6, mapScale * (1 - e.deltaY * 0.0016)));
  };

  canvas.addEventListener("click", onCanvasClick);
  canvas.addEventListener("pointerdown", onOverviewDown);
  canvas.addEventListener("pointermove", onOverviewMove);
  canvas.addEventListener("pointerup", onOverviewUp);
  canvas.addEventListener("pointercancel", onOverviewUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);

  function setOverview(on: boolean) {
    wantOverview = on;
    dragging = null;
    if (on) mapFitted = false; // reframe the whole maze each time it is opened
    // Being captured while looking at a map is disorienting and there is
    // nothing to aim at up there.
    if (on && document.pointerLockElement === canvas) document.exitPointerLock?.();
    announce();
  }

  // --- the loop -------------------------------------------------------------

  let raf = 0;
  let last = performance.now();

  const fpTarget = new THREE.Vector3();
  const lookHelper = new THREE.Camera();

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

    if (solved && won >= 0) runVictory(dt);

    if (touched && started && !solved && !paused) {
      elapsed += dt;
      if (Math.floor(elapsed) !== Math.floor(elapsed - dt)) announce();

      // Turning with the keyboard, for anyone not using pointer lock.
      const turn = 2.1 * dt;
      if (held.has("arrowleft") || held.has("q")) yaw += turn;
      if (held.has("arrowright") || held.has("e")) yaw -= turn;

      const speed = (held.has("shift") ? 5.2 : 3.1) * dt;
      let forward = 0;
      let strafe = 0;
      if (held.has("w") || held.has("arrowup")) forward += 1;
      if (held.has("s") || held.has("arrowdown")) forward -= 1;
      if (held.has("a")) strafe -= 1;
      if (held.has("d")) strafe += 1;

      if (forward || strafe) {
        // Normalised, so walking diagonally is not faster than walking straight.
        const length = Math.hypot(forward, strafe);
        const f = forward / length;
        const s = strafe / length;
        step(
          (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed,
          (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed,
        );
      }
    }

    // --- camera ---
    // First person, always. The map is a drawing over the top rather than a
    // second camera, so there is no blend to run and no second view to keep
    // consistent with this one.
    // Rising off the floor at the end: a slow lift and a turn to look back
    // down at the maze, which is the only time the walls are worth seeing from
    // outside. Eased so it feels like being lifted rather than cut to.
    const lift = won < 0 ? 0 : Math.min(1, won / 2.2) ** 0.7;
    camera.position.set(position.x, EYE + lift * 15, position.z + lift * 6);
    fpTarget.set(
      position.x - Math.sin(yaw) * 4 * (1 - lift),
      (EYE + Math.tan(pitch) * 4) * (1 - lift),
      position.z - Math.cos(yaw) * 4 * (1 - lift),
    );
    lookHelper.position.copy(camera.position);
    lookHelper.lookAt(fpTarget);
    camera.quaternion.copy(lookHelper.quaternion);

    // How far the map has faded in. Kept as an eased value because the mist
    // and the map's own opacity both ride on it.
    const want = wantOverview ? 1 : 0;
    view += (want - view) * Math.min(1, dt * 6);
    const eased = view * view * (3 - 2 * view);

    map.style.opacity = String(solved ? 0 : eased);
    map.style.pointerEvents = wantOverview ? "auto" : "none";
    if (eased > 0.01) drawMap();

    lamp.position.set(position.x, EYE + 0.3, position.z);

    if (mist && mistMaterials) {
      mistMaterials.opacity = 0.16;
      for (const sheet of mist.children) {
        const drift = sheet.userData.drift as THREE.Vector2;
        sheet.position.x += drift.x * dt;
        sheet.position.z += drift.y * dt;
        sheet.rotation.z += (sheet.userData.turn as number) * dt;
        // Wrapped rather than respawned, so the bank never thins out.
        if (sheet.position.x > worldW / 2) sheet.position.x -= worldW;
        if (sheet.position.x < -worldW / 2) sheet.position.x += worldW;
        if (sheet.position.z > worldD / 2) sheet.position.z -= worldD;
        if (sheet.position.z < -worldD / 2) sheet.position.z += worldD;
      }
    }


    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  function start() {
    if (solved) {
      restart();
      return;
    }
    started = true;
    paused = false;
    // Pressing Play *is* the player acting, so the clock starts here too.
    // Without this the game began but time stood still, which read as the
    // button doing nothing at all.
    touched = true;
    announce();
  }

  function restart() {
    if (!models) return;
    carve();
    build();
    placeWalker();
    started = true;
    paused = false;
    touched = true;
    won = -1;
    announcedWin = false;
    lamp.intensity = 14;
    wantOverview = false;
    view = 0;
    announce();
  }

  // The models have to be in hand before anything can be placed, so the first
  // frames draw an empty scene and the overlay stays up. It is a few hundred
  // kilobytes off a local disk; the window is already open by then.
  /** Rebuild the walls from a snapshot. Returns false if it does not fit. */
  function reinstate(save: MazeSave): boolean {
    if (!Array.isArray(save.walls) || save.walls.length !== COLS * ROWS) return false;

    cells = save.walls.map((bits) => ({
      n: (bits & 1) !== 0,
      e: (bits & 2) !== 0,
      s: (bits & 4) !== 0,
      w: (bits & 8) !== 0,
      seen: true,
    }));

    build();

    position.set(save.x, EYE, save.z);
    yaw = save.yaw;
    pitch = save.pitch;
    steps = save.steps;
    elapsed = save.elapsed;
    cellNow = cellOf(save.x, save.z);
    started = true;
    solved = false;
    // Held rather than resumed: the window has only just opened, and dropping
    // someone straight back into a running clock they were not watching is not
    // picking up where they left off. `touched` stays false, so the clock does
    // not move until they do.
    paused = true;
    touched = false;
    return true;
  }

  void Promise.all([
    load(wallUrl, MODULE_SCALE, "wood"),
    load(floorUrl, MODULE_SCALE, "ground"),
    load(columnUrl, (WALL_H * 1.06) / 4.07, "wood"),
    load(torchUrl, MODULE_SCALE * 0.8),
    load(pedestalUrl, (WALL_H * 0.72) / 2.31),
  ])
    .then(([wall, floor, column, torch, pedestal]) => {
      if (dead) return;
      models = { wall, floor, column, torch, pedestal };

      if (!saved || !reinstate(saved)) {
        carve();
        build();
        placeWalker();
      }
      announce();
    })
    .catch((e) => {
      if (dead) return;
      // This window has no console attached, so a failure here would otherwise
      // be an empty room with no explanation anywhere.
      void invoke("report_error", {
        message: `maze: could not load models: ${e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e)}`,
      });
    });

  placeWalker();
  resize();
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onCanvasClick);
      canvas.removeEventListener("pointerdown", onOverviewDown);
      canvas.removeEventListener("pointermove", onOverviewMove);
      canvas.removeEventListener("pointerup", onOverviewUp);
      canvas.removeEventListener("pointercancel", onOverviewUp);
      canvas.removeEventListener("wheel", onWheel);
      map.remove();
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      noise.dispose();
      wood.dispose();
      ground.dispose();
      blob.dispose();
      mistMaterials?.dispose();
      for (const material of retinted.values()) material.dispose();
      if (models) {
        for (const model of Object.values(models)) {
          for (const part of model.parts) part.geometry.dispose();
        }
      }
      beam?.geometry.dispose();
      beamMaterial?.dispose();
      ring?.geometry.dispose();
      ringMaterial?.dispose();
      renderer.dispose();
    },
    snapshot() {
      // Nothing to keep before the first step, or once it is solved — a
      // finished maze should not be handed back as unfinished work.
      // `touched` rather than `started`: opening the window is not playing,
      // and a maze nobody has moved in is not a run to come back to.
      if (!models || !touched || solved) return null;
      return {
        walls: cells.map(
          (c) => (c.n ? 1 : 0) | (c.e ? 2 : 0) | (c.s ? 4 : 0) | (c.w ? 8 : 0),
        ),
        x: position.x,
        z: position.z,
        yaw,
        pitch,
        steps,
        elapsed,
      };
    },
    onState(handler) {
      notify = handler;
      announce();
    },
    restart,
    overview: setOverview,
    pause() {
      paused = true;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      announce();
    },
    play: start,
  };
}
