// Pure logic: no three.js, no DOM.
//
// A tessellation is a space-filling arrangement of identical cells, organised as a
// *layered lattice*: layer y holds a width × depth array of cells addressed by (x, z),
// so every tessellation shares Grid's flat indexing, layer isolation and cascades.
// Each tessellation supplies
//   * the neighbour offsets of a cell, grouped by class (face / edge / corner) in a slot
//     order that is identical for every cell – offsets may depend on the parity of the
//     cell's row or layer, but slot k always has the same class,
//   * the position of a cell centre in lattice space and the inverse (point -> cell),
//     which for these lattices is simply "the nearest centre" (Voronoi cells),
//   * the half-size of a cell's bounding box and a shape description for the renderer.

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);

function offsetsOf(face, edge, corner) {
    const list = [];
    for (const [dx, dy, dz] of face) list.push([dx, dy, dz, 'face']);
    for (const [dx, dy, dz] of edge) list.push([dx, dy, dz, 'edge']);
    for (const [dx, dy, dz] of corner) list.push([dx, dy, dz, 'corner']);
    return Object.freeze(list);
}

// ---------------------------------------------------------------- cubes

const CUBIC_OFFSETS = (() => {
    const face = [];
    const edge = [];
    const corner = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0 && dz === 0) continue;
                const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
                (m === 1 ? face : m === 2 ? edge : corner).push([dx, dy, dz]);
            }
        }
    }
    return offsetsOf(face, edge, corner);
})();

export const CUBIC = Object.freeze({
    id: 'cubic',
    name: 'Cubes',
    classes: Object.freeze({face: 6, edge: 12, corner: 8}),
    offsets: () => CUBIC_OFFSETS,
    centre(x, y, z, out) {
        out.x = x + 0.5;
        out.y = y + 0.5;
        out.z = z + 0.5;
        return out;
    },
    locate(px, py, pz, out) {
        out.x = Math.floor(px);
        out.y = Math.floor(py);
        out.z = Math.floor(pz);
        return out;
    },
    extent: Object.freeze({x: 0.5, y: 0.5, z: 0.5}),
    shape: Object.freeze({type: 'box'}),
});

// ------------------------------------------------------- hexagonal prisms

// Pointy-top hexagons in "odd-r" offset coordinates: rows run along x, odd rows are
// shifted half a cell. Circumradius chosen so a hexagon has unit area.
const HEX_R = 0.62;
const HEX_S = SQRT3 * HEX_R; // centre spacing along a row
const HEX_ROW = 1.5 * HEX_R; // spacing between rows
const HEX_RING = [
    [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]], // even row
    [[1, 0], [-1, 0], [0, -1], [1, -1], [0, 1], [1, 1]], // odd row
];

function hexOffsets(ring) {
    // Faces: the 6 prisms around, the prism above and the one below.
    // Edges: the 6 prisms diagonally above and the 6 diagonally below.
    // No two hexagonal prisms touch at a vertex only.
    const face = [...ring.map(([dx, dz]) => [dx, 0, dz]), [0, 1, 0], [0, -1, 0]];
    const edge = [...ring.map(([dx, dz]) => [dx, 1, dz]), ...ring.map(([dx, dz]) => [dx, -1, dz])];
    return offsetsOf(face, edge, []);
}

const HEX_OFFSETS = [hexOffsets(HEX_RING[0]), hexOffsets(HEX_RING[1])];

function cubeRound(q, r) {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return [rq, rr];
}

export const HEX = Object.freeze({
    id: 'hex',
    name: 'Hexagonal prisms',
    classes: Object.freeze({face: 8, edge: 12, corner: 0}),
    offsets: (x, y, z) => HEX_OFFSETS[z & 1],
    centre(x, y, z, out) {
        out.x = HEX_S * (x + 0.5 * (z & 1));
        out.y = y + 0.5;
        out.z = HEX_ROW * z;
        return out;
    },
    locate(px, py, pz, out) {
        const q = ((SQRT3 / 3) * px - pz / 3) / HEX_R;
        const r = ((2 / 3) * pz) / HEX_R;
        const [rq, rr] = cubeRound(q, r);
        out.x = rq + (rr - (rr & 1)) / 2;
        out.y = Math.floor(py);
        out.z = rr;
        return out;
    },
    extent: Object.freeze({x: HEX_S / 2, y: 0.5, z: HEX_R}),
    shape: Object.freeze({type: 'prism', radius: HEX_R, height: 1, sides: 6}),
});

// ------------------------------------------ staggered square lattices (FCC / BCC)

// Square layers; odd layers sit at (+½, +½). Used for the rhombic dodecahedral
// honeycomb (face-centred cubic lattice) and the bitruncated cubic honeycomb of
// truncated octahedra (body-centred cubic lattice); only the constants differ.
const STAGGER_UP = [
    [[0, 1, 0], [-1, 1, 0], [0, 1, -1], [-1, 1, -1]], // from an even layer
    [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]], // from an odd layer
];
const IN_LAYER_4 = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const IN_LAYER_DIAG = [[1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1]];
const TWO_LAYERS = [[0, 2, 0], [0, -2, 0]];

function staggeredFaces(parity) {
    const up = STAGGER_UP[parity];
    return [...IN_LAYER_4, ...up, ...up.map(([dx, , dz]) => [dx, -1, dz])];
}

function staggeredLattice({id, name, s, ls, faces, corners, extent, shape}) {
    const offsets = [0, 1].map((p) => offsetsOf(faces(p), [], corners));
    const faceCount = offsets[0].filter((o) => o[3] === 'face').length;
    return Object.freeze({
        id,
        name,
        classes: Object.freeze({face: faceCount, edge: 0, corner: corners.length}),
        offsets: (x, y) => offsets[y & 1],
        centre(x, y, z, out) {
            const sh = 0.5 * (y & 1);
            out.x = s * (x + sh);
            out.y = ls * y;
            out.z = s * (z + sh);
            return out;
        },
        locate(px, py, pz, out) {
            // Nearest lattice point: the containing Voronoi cell. Checking the four
            // layers around the point is always enough for these spacings.
            const y0 = Math.floor(py / ls);
            let best = Infinity;
            for (let yc = y0 - 1; yc <= y0 + 2; yc++) {
                const sh = 0.5 * (yc & 1);
                const xc = Math.round(px / s - sh);
                const zc = Math.round(pz / s - sh);
                const dx = px - s * (xc + sh);
                const dy = py - ls * yc;
                const dz = pz - s * (zc + sh);
                const d = dx * dx + dy * dy + dz * dz;
                if (d < best) {
                    best = d;
                    out.x = xc;
                    out.y = yc;
                    out.z = zc;
                }
            }
            return out;
        },
        extent: Object.freeze(extent),
        shape: Object.freeze(shape),
    });
}

/** Rhombic dodecahedron of the FCC lattice with in-layer spacing `s` (unit volume). */
function rhombicDodecahedron(s) {
    const a = s / 2;
    const b = s / SQRT2;
    const c = s / (2 * SQRT2);
    const v = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) v.push([sx * a, 0, sz * a]);
    v.push([0, b, 0], [0, -b, 0]);
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            v.push([sx * a, sy * c, 0]);
            v.push([0, sy * c, sx * a]);
        }
    }
    return v;
}

/** Truncated octahedron of the BCC lattice with cube edge `a`: permutations of (0, ±a/4, ±a/2). */
function truncatedOctahedron(a) {
    const q = a / 4;
    const h = a / 2;
    const v = [];
    for (let zero = 0; zero < 3; zero++) {
        const [i, j] = [0, 1, 2].filter((k) => k !== zero);
        for (const swap of [0, 1]) {
            for (const si of [-1, 1]) {
                for (const sj of [-1, 1]) {
                    const p = [0, 0, 0];
                    p[i] = si * (swap ? h : q);
                    p[j] = sj * (swap ? q : h);
                    v.push(p);
                }
            }
        }
    }
    return v;
}

const FCC_S = Math.pow(2, 1 / 6); // in-layer spacing for unit cell volume
export const FCC = staggeredLattice({
    id: 'fcc',
    name: 'Rhombic dodecahedra',
    s: FCC_S,
    ls: FCC_S / SQRT2,
    faces: staggeredFaces, // 4 in the layer + 4 above + 4 below
    corners: [...IN_LAYER_DIAG, ...TWO_LAYERS], // the 6 four-valent vertices
    extent: {x: FCC_S / 2, y: FCC_S / SQRT2, z: FCC_S / 2},
    shape: {type: 'hull', vertices: rhombicDodecahedron(FCC_S)},
});

const BCC_A = Math.cbrt(2); // cube edge for unit cell volume
export const BCC = staggeredLattice({
    id: 'bcc',
    name: 'Truncated octahedra',
    s: BCC_A,
    ls: BCC_A / 2,
    faces: (p) => [...staggeredFaces(p), ...TWO_LAYERS], // 8 hexagons + 6 squares
    corners: [], // every touching cell shares a face
    extent: {x: BCC_A / 2, y: BCC_A / 2, z: BCC_A / 2},
    shape: {type: 'hull', vertices: truncatedOctahedron(BCC_A)},
});

// -------------------------------------------------------------- registry

export const TESSELLATIONS = Object.freeze([CUBIC, HEX, FCC, BCC]);

/** id string or tessellation object -> tessellation (unknown ids fall back to cubes). */
export function getTessellation(spec) {
    if (spec && typeof spec === 'object' && typeof spec.offsets === 'function') return spec;
    return TESSELLATIONS.find((t) => t.id === spec) ?? CUBIC;
}

export function neighbourCount(tess) {
    const {face, edge, corner} = tess.classes;
    return face + edge + corner;
}