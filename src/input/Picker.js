import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _o = [0, 0, 0];
const _d = [0, 0, 0];
const _cell = [0, 0, 0];
const _step = [0, 0, 0];
const _tMax = [0, 0, 0];
const _tDelta = [0, 0, 0];
const _slab = {tmin: 0, tmax: 0, entryAxis: -1, entrySign: 0};

/** Ray-march step for non-cubic tessellations, in world units. */
const MARCH_STEP = 0.05;

/** Screen-space pick: NDC -> ray -> first targetable cell along it. */
export function pick(camera, ndc, grid, targetable, out = {}) {
    _ray.setFromCamera(ndc, camera);
    return pickRay(_ray.ray.origin, _ray.ray.direction, grid, targetable, out);
}

/**
 * Returns { cell, x, y, z, nx, ny, nz } for the first cell where targetable(cell) is true.
 * Cubes use an exact Amanatides–Woo voxel traversal; other tessellations march the ray
 * through the board's bounding box and ask the grid which Voronoi cell each sample is in.
 */
export function pickRay(origin, dir, grid, targetable, out = {}) {
    _o[0] = origin.x;
    _o[1] = origin.y;
    _o[2] = origin.z;
    _d[0] = dir.x;
    _d[1] = dir.y;
    _d[2] = dir.z;
    if (!slabTest(grid.bounds.min, grid.bounds.max)) return null;
    return grid.tess.id === 'cubic' ? ddaPick(grid, targetable, out) : marchPick(grid, targetable, out);
}

/** Ray vs AABB. Fills _slab; false when the ray misses the box entirely. */
function slabTest(min, max) {
    let tmin = -Infinity;
    let tmax = Infinity;
    let entryAxis = -1;
    let entrySign = 0;
    for (let a = 0; a < 3; a++) {
        if (Math.abs(_d[a]) < 1e-12) {
            if (_o[a] < min[a] || _o[a] > max[a]) return false;
            continue;
        }
        let t1 = (min[a] - _o[a]) / _d[a];
        let t2 = (max[a] - _o[a]) / _d[a];
        let sign = -1;
        if (t1 > t2) {
            const tmp = t1;
            t1 = t2;
            t2 = tmp;
            sign = 1;
        }
        if (t1 > tmin) {
            tmin = t1;
            entryAxis = a;
            entrySign = sign;
        }
        if (t2 < tmax) tmax = t2;
    }
    if (tmax < Math.max(tmin, 0)) return false;
    _slab.tmin = tmin;
    _slab.tmax = tmax;
    _slab.entryAxis = entryAxis;
    _slab.entrySign = entrySign;
    return true;
}

function hit(grid, i, nAxis, nSign, out) {
    out.cell = i;
    out.x = grid.x(i);
    out.y = grid.y(i);
    out.z = grid.z(i);
    out.nx = nAxis === 0 ? nSign : 0;
    out.ny = nAxis === 1 ? nSign : 0;
    out.nz = nAxis === 2 ? nSign : 0;
    return out;
}

/** Amanatides–Woo voxel traversal against the cubic grid — no per-instance raycasts. */
function ddaPick(grid, targetable, out) {
    const min = grid.bounds.min;
    const dims = [grid.width, grid.height, grid.depth];
    const tStart = Math.max(_slab.tmin, 0) + 1e-6;
    for (let a = 0; a < 3; a++) {
        const p = _o[a] + _d[a] * tStart;
        _cell[a] = Math.min(dims[a] - 1, Math.max(0, Math.floor(p - min[a])));
        _step[a] = _d[a] > 0 ? 1 : _d[a] < 0 ? -1 : 0;
        if (_step[a] === 0) {
            _tMax[a] = Infinity;
            _tDelta[a] = Infinity;
        } else {
            const next = min[a] + _cell[a] + (_step[a] > 0 ? 1 : 0);
            _tMax[a] = (next - _o[a]) / _d[a];
            _tDelta[a] = Math.abs(1 / _d[a]);
        }
    }

    let nAxis = _slab.tmin < 0 ? -1 : _slab.entryAxis; // started inside the volume: no entry face
    let nSign = _slab.entrySign;
    const maxSteps = dims[0] + dims[1] + dims[2] + 3;
    for (let s = 0; s < maxSteps; s++) {
        const i = grid.index(_cell[0], _cell[1], _cell[2]);
        if (targetable(i)) return hit(grid, i, nAxis, nSign, out);
        let a = 0;
        if (_tMax[1] < _tMax[a]) a = 1;
        if (_tMax[2] < _tMax[a]) a = 2;
        _cell[a] += _step[a];
        _tMax[a] += _tDelta[a];
        nAxis = a;
        nSign = -_step[a];
        if (_cell[a] < 0 || _cell[a] >= dims[a]) return null;
    }
    return null;
}

/** Fixed-step march through the bounding box; each sample is resolved to its Voronoi cell. */
function marchPick(grid, targetable, out) {
    const tEnd = _slab.tmax;
    let last = -2;
    for (let t = Math.max(_slab.tmin, 0) + 1e-4; t <= tEnd; t += MARCH_STEP) {
        const i = grid.cellAt(_o[0] + _d[0] * t, _o[1] + _d[1] * t, _o[2] + _d[2] * t);
        if (i < 0 || i === last) continue;
        last = i;
        if (targetable(i)) return hit(grid, i, -1, 0, out);
    }
    return null;
}