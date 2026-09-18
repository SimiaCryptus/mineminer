// Pure logic: no three.js, no DOM.
import { getTessellation } from './Tessellation.js';

export const EMPTY = 0;
export const MINE = 1;

export const INTACT = 0;
export const MARKED = 1;
export const MINED = 2;
export const SCAR = 3;

/**
 * Upper bound on the neighbours of one cell (26 for cubes). Tessellations with fewer
 * neighbours leave the trailing slots empty (-1 in the table, weight 0).
 */
export const NEIGHBOUR_STRIDE = 26;
/**
 * Neighbour classes, by how two cells touch:
 *   face   – they share a face
 *   edge   – they share only an edge
 *   corner – they share only a vertex
 * For cubes that is 6 / 12 / 8 cells; other tessellations have other counts (see
 * Tessellation.js). Each class contributes `weight` to a cell's proximity count.
 * Faces are always 1; edges and corners are configurable as 1 / 0.5 / 0.
 */
export const DEFAULT_WEIGHTS = Object.freeze({ face: 1, edge: 1, corner: 1 });
const WEIGHT_STEPS = [0, 0.5, 1];

/** Snaps an arbitrary number to the nearest allowed weight (0, 0.5, 1). */
export function quantiseWeight(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  let best = WEIGHT_STEPS[0];
  let bestD = Infinity;
  for (const s of WEIGHT_STEPS) {
    const d = Math.abs(s - n);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Accepts the legacy `26` / `6` presets or a `{face, edge, corner}` weight object. */
export function normaliseWeights(spec) {
  if (spec === 6) return { face: 1, edge: 0, corner: 0 };
  if (spec === null || spec === undefined || typeof spec === 'number')
    return { ...DEFAULT_WEIGHTS };
  return {
    face: quantiseWeight(spec.face, 1),
    edge: quantiseWeight(spec.edge, 1),
    corner: quantiseWeight(spec.corner, 1),
  };
}

/**
 * Flat typed-array voxel grid over a layered tessellation.
 * index(x, y, z) = x + width * (z + depth * y)
 */
export class Grid {
  constructor(width, depth, height, adjacency = 26, tessellation = 'cubic') {
    if (width < 1 || depth < 1 || height < 1) throw new Error('Grid dimensions must be >= 1');
    this.width = width | 0;
    this.depth = depth | 0;
    this.height = height | 0;
    this.tess = getTessellation(tessellation);
    this.weights = normaliseWeights(adjacency);
    // Legacy shorthand kept for callers/tests that only care about "faces only or not".
    this.adjacency = this.weights.edge === 0 && this.weights.corner === 0 ? 6 : 26;
    this.layerSize = this.width * this.depth;
    this.cellCount = this.layerSize * this.height;
    this.content = new Uint8Array(this.cellCount);
    this.state = new Uint8Array(this.cellCount);
    // Fractional weights mean counts are no longer integers (0, 0.5, 1, 1.5, ...).
    this.counts = new Float32Array(this.cellCount);
    this.slotWeights = new Float32Array(NEIGHBOUR_STRIDE);
    this.neighbours = buildNeighbourTable(this);
    // World layout: lattice space shifted so the board is centred on x/z = 0 and
    // its lowest point sits on y = 0.
    this.origin = { x: 0, y: 0, z: 0 };
    this.bounds = { min: [0, 0, 0], max: [0, 0, 0] };
    this._loc = { x: 0, y: 0, z: 0 };
    computeLayout(this);
  }

  index(x, y, z) {
    return x + this.width * (z + this.depth * y);
  }

  x(i) {
    return i % this.width;
  }

  y(i) {
    return Math.floor(i / this.layerSize);
  }

  z(i) {
    return Math.floor(i / this.width) % this.depth;
  }

  coords(i, out = { x: 0, y: 0, z: 0 }) {
    out.x = this.x(i);
    out.y = this.y(i);
    out.z = this.z(i);
    return out;
  }

  inBounds(x, y, z) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height && z >= 0 && z < this.depth;
  }

  /** World-space centre of cell `i`, written into `out` (anything with x/y/z). */
  centreOf(i, out = { x: 0, y: 0, z: 0 }) {
    this.tess.centre(this.x(i), this.y(i), this.z(i), out);
    out.x += this.origin.x;
    out.y += this.origin.y;
    out.z += this.origin.z;
    return out;
  }

  /** World point -> cell index, or -1 when the point is outside the board. */
  cellAt(px, py, pz) {
    const l = this.tess.locate(
      px - this.origin.x,
      py - this.origin.y,
      pz - this.origin.z,
      this._loc
    );
    return this.inBounds(l.x, l.y, l.z) ? this.index(l.x, l.y, l.z) : -1;
  }

  neighbour(i, k) {
    return this.neighbours[i * NEIGHBOUR_STRIDE + k];
  }

  /** Weight of neighbour slot `k` (identical for every cell). */
  neighbourWeight(k) {
    return this.slotWeights[k];
  }

  /** Calls fn(neighbourIndex, weight). Zero-weight classes are not in the table at all. */
  forEachNeighbour(i, fn) {
    const base = i * NEIGHBOUR_STRIDE;
    for (let k = 0; k < NEIGHBOUR_STRIDE; k++) {
      const n = this.neighbours[base + k];
      if (n >= 0) fn(n, this.slotWeights[k]);
    }
  }

  /** Neighbours an interior cell has, counting only classes with a non-zero weight. */
  neighbourCount() {
    const { classes } = this.tess;
    const { face, edge, corner } = this.weights;
    return (
      (face > 0 ? classes.face : 0) +
      (edge > 0 ? classes.edge : 0) +
      (corner > 0 ? classes.corner : 0)
    );
  }

  /** Highest count this grid could ever produce (used to size glyph atlases). */
  maxCount() {
    const { classes } = this.tess;
    const { face, edge, corner } = this.weights;
    return classes.face * face + classes.edge * edge + classes.corner * corner;
  }

  isSolid(i) {
    const s = this.state[i];
    return s === INTACT || s === MARKED;
  }

  recomputeCounts() {
    const { counts, content, neighbours, slotWeights, cellCount } = this;
    for (let i = 0; i < cellCount; i++) {
      let c = 0;
      const base = i * NEIGHBOUR_STRIDE;
      for (let k = 0; k < NEIGHBOUR_STRIDE; k++) {
        const n = neighbours[base + k];
        if (n >= 0 && content[n] === MINE) c += slotWeights[k];
      }
      counts[i] = c;
    }
  }
}

function buildNeighbourTable(grid) {
  const { tess, weights } = grid;
  // A class weighted 0 contributes nothing to counts and is excluded from the
  // neighbourhood entirely, so cascades and safe-first-strike ignore it too. The
  // tessellation returns shared offset arrays, so the filtered variants are cached.
  const filtered = new Map();
  const active = (offsets) => {
    let f = filtered.get(offsets);
    if (!f) {
      f = offsets.filter((o) => weights[o[3]] > 0);
      filtered.set(offsets, f);
    }
    return f;
  };
  // Slot k has the same class for every cell: every parity variant lists its offsets
  // class by class with identical counts, so one sample fixes the slot weights.
  const sample = active(tess.offsets(0, 0, 0));
  if (sample.length > NEIGHBOUR_STRIDE) {
    throw new Error(
      `tessellation ${tess.id} has ${sample.length} neighbours, max ${NEIGHBOUR_STRIDE}`
    );
  }
  grid.slotWeights.fill(0);
  for (let k = 0; k < sample.length; k++) grid.slotWeights[k] = weights[sample[k][3]];

  const table = new Int32Array(NEIGHBOUR_STRIDE * grid.cellCount).fill(-1);
  for (let i = 0; i < grid.cellCount; i++) {
    const x = grid.x(i);
    const y = grid.y(i);
    const z = grid.z(i);
    const offs = active(tess.offsets(x, y, z));
    const base = i * NEIGHBOUR_STRIDE;
    for (let k = 0; k < offs.length; k++) {
      const [dx, dy, dz] = offs[k];
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (grid.inBounds(nx, ny, nz)) table[base + k] = grid.index(nx, ny, nz);
    }
  }
  return table;
}

function computeLayout(grid) {
  const { tess, width, depth, height } = grid;
  const e = tess.extent;
  const c = { x: 0, y: 0, z: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        tess.centre(x, y, z, c);
        minX = Math.min(minX, c.x - e.x);
        maxX = Math.max(maxX, c.x + e.x);
        minY = Math.min(minY, c.y - e.y);
        maxY = Math.max(maxY, c.y + e.y);
        minZ = Math.min(minZ, c.z - e.z);
        maxZ = Math.max(maxZ, c.z + e.z);
      }
    }
  }
  grid.origin.x = -(minX + maxX) / 2;
  grid.origin.y = -minY;
  grid.origin.z = -(minZ + maxZ) / 2;
  grid.bounds.min[0] = minX + grid.origin.x;
  grid.bounds.min[1] = minY + grid.origin.y;
  grid.bounds.min[2] = minZ + grid.origin.z;
  grid.bounds.max[0] = maxX + grid.origin.x;
  grid.bounds.max[1] = maxY + grid.origin.y;
  grid.bounds.max[2] = maxZ + grid.origin.z;
}
