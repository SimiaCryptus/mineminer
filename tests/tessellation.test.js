import test from 'node:test';
import assert from 'node:assert/strict';
import {Grid, INTACT, MINE} from '../src/game/Grid.js';
import {getTessellation, neighbourCount, TESSELLATIONS} from '../src/game/Tessellation.js';
import {Board} from '../src/game/Board.js';
import {placeMines} from '../src/game/MineGenerator.js';
import {customLevel, DEFAULT_LEVEL} from '../src/game/LevelDefs.js';
import {DEFAULT_SETTINGS} from '../src/core/settings.js';
import {rngFromSeed} from '../src/core/rng.js';

const EXPECTED = {
    cubic: {face: 6, edge: 12, corner: 8},
    hex: {face: 8, edge: 12, corner: 0},
    fcc: {face: 12, edge: 0, corner: 6},
    bcc: {face: 14, edge: 0, corner: 0},
};

function classCounts(tessId, pick) {
    const count = (weights) => {
        const g = new Grid(7, 7, 7, weights, tessId);
        let n = 0;
        g.forEachNeighbour(pick(g), () => n++);
        return n;
    };
    const face = count({face: 1, edge: 0, corner: 0});
    const edge = count({face: 1, edge: 1, corner: 0}) - face;
    const corner = count({face: 1, edge: 0, corner: 1}) - face;
    return {face, edge, corner};
}

test('every tessellation has the advertised neighbour classes, whatever the cell parity', () => {
    assert.equal(TESSELLATIONS.length, 4);
    for (const t of TESSELLATIONS) {
        assert.deepEqual({...t.classes}, EXPECTED[t.id]);
        for (const [x, y, z] of [[3, 3, 3], [3, 3, 2], [3, 2, 3], [2, 2, 2]]) {
            assert.deepEqual(classCounts(t.id, (g) => g.index(x, y, z)), EXPECTED[t.id], `${t.id} at ${x},${y},${z}`);
        }
        const e = EXPECTED[t.id];
        assert.equal(neighbourCount(t), e.face + e.edge + e.corner);
    }
    assert.equal(getTessellation('nonsense').id, 'cubic');
    assert.equal(getTessellation(TESSELLATIONS[1]).id, 'hex');
});

test('neighbourhoods are symmetric with equal weights both ways', () => {
    for (const t of TESSELLATIONS) {
        const grid = new Grid(5, 4, 5, {face: 1, edge: 0.5, corner: 1}, t.id);
        for (let i = 0; i < grid.cellCount; i++) {
            grid.forEachNeighbour(i, (n, w) => {
                let back = -1;
                grid.forEachNeighbour(n, (m, w2) => {
                    if (m === i) back = w2;
                });
                assert.equal(back, w, `${t.id}: ${i} -> ${n}`);
            });
        }
    }
});

test('face neighbours are closer than edge or corner neighbours', () => {
    for (const t of TESSELLATIONS) {
        const grid = new Grid(5, 5, 5, {face: 1, edge: 1, corner: 1}, t.id);
        const facesOnly = new Grid(5, 5, 5, {face: 1, edge: 0, corner: 0}, t.id);
        const centre = grid.index(2, 2, 2);
        const faceSet = new Set();
        facesOnly.forEachNeighbour(centre, (n) => faceSet.add(n));
        const a = grid.centreOf(centre);
        let maxFace = 0;
        let minOther = Infinity;
        grid.forEachNeighbour(centre, (n) => {
            const b = grid.centreOf(n);
            const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
            if (faceSet.has(n)) maxFace = Math.max(maxFace, d);
            else minOther = Math.min(minOther, d);
        });
        assert.ok(maxFace > 0, t.id);
        if (minOther < Infinity) assert.ok(maxFace < minOther - 1e-6, `${t.id}: ${maxFace} vs ${minOther}`);
    }
});

test('cell centres (and points near them) map back to their own cell; outside is -1', () => {
    for (const t of TESSELLATIONS) {
        const grid = new Grid(6, 5, 7, 26, t.id);
        const rng = rngFromSeed(`locate-${t.id}`);
        const r = 0.3 * Math.min(t.extent.x, t.extent.y, t.extent.z);
        for (let i = 0; i < grid.cellCount; i++) {
            const c = grid.centreOf(i);
            assert.equal(grid.cellAt(c.x, c.y, c.z), i, `${t.id}: centre of ${i}`);
            for (let k = 0; k < 3; k++) {
                const jx = (rng() * 2 - 1) * r;
                const jy = (rng() * 2 - 1) * r;
                const jz = (rng() * 2 - 1) * r;
                assert.equal(grid.cellAt(c.x + jx, c.y + jy, c.z + jz), i, `${t.id}: near ${i}`);
            }
        }
        const {min, max} = grid.bounds;
        assert.equal(grid.cellAt(min[0] - 1, (min[1] + max[1]) / 2, 0), -1);
        assert.equal(grid.cellAt(0, max[1] + 1, 0), -1);
        assert.equal(grid.cellAt(0, min[1] - 1, 0), -1);
    }
});

test('the board sits on y = 0 and is centred on the origin', () => {
    for (const t of TESSELLATIONS) {
        const grid = new Grid(9, 4, 6, 26, t.id);
        const {min, max} = grid.bounds;
        assert.ok(Math.abs(min[1]) < 1e-9, t.id);
        assert.ok(Math.abs(min[0] + max[0]) < 1e-9, t.id);
        assert.ok(Math.abs(min[2] + max[2]) < 1e-9, t.id);
        assert.ok(max[1] > 0 && max[0] > 0 && max[2] > 0);
    }
    // Cubes keep the classic layout.
    const cubes = new Grid(8, 6, 3);
    assert.deepEqual(cubes.bounds, {min: [-4, 0, -3], max: [4, 3, 3]});
    const c = cubes.centreOf(cubes.index(0, 0, 0));
    assert.deepEqual([c.x, c.y, c.z], [-3.5, 0.5, -2.5]);
});

test('a lone mine is counted by exactly its neighbourhood and a cascade clears everything else', () => {
    for (const t of TESSELLATIONS) {
        const grid = new Grid(9, 9, 9, 26, t.id);
        const mine = grid.index(4, 4, 4);
        grid.content[mine] = MINE;
        grid.recomputeCounts();
        let numbered = 0;
        for (let i = 0; i < grid.cellCount; i++) if (grid.counts[i] > 0) numbered++;
        assert.equal(numbered, neighbourCount(t), t.id);
        assert.equal(grid.neighbourCount(), neighbourCount(t));
        assert.equal(grid.maxCount(), neighbourCount(t));
        const board = new Board(grid, {safeFirstStrike: false, quantum: 'off'});
        const r = board.strike(grid.index(0, 0, 0));
        assert.equal(r.kind, 'cleared', t.id);
        assert.equal(grid.state[mine], INTACT, t.id);
        assert.equal(board.status, 'won', t.id);
    }
});

test('seeded boards play on every tessellation', () => {
    for (const t of TESSELLATIONS) {
        const seed = `tess-${t.id}`;
        const grid = new Grid(8, 8, 4, {face: 1, edge: 1, corner: 0.5}, t.id);
        placeMines(grid, 20, rngFromSeed(seed));
        const board = new Board(grid, {seed, lives: Infinity, strictMarks: false});
        const play = rngFromSeed(`${seed}:play`);
        board.strike(grid.index(4, 2, 4));
        for (let step = 0; step < 60 && !board.isOver; step++) {
            const cell = Math.floor(play() * grid.cellCount);
            if (play() < 0.3) board.toggleMark(cell);
            else board.strike(cell);
        }
        let mines = 0;
        for (const c of grid.content) if (c === MINE) mines++;
        assert.equal(mines, 20, t.id);
    }
});

test('defaults: an 8×8×8 cubic vault with 30 mines and half-weighted corners', () => {
    assert.deepEqual({...DEFAULT_LEVEL}, {w: 8, d: 8, h: 8, mines: 30, tess: 'cubic'});
    const spec = customLevel({});
    assert.equal(spec.w, 8);
    assert.equal(spec.d, 8);
    assert.equal(spec.h, 8);
    assert.equal(spec.mines, 30);
    assert.equal(spec.tess, 'cubic');
    assert.ok(spec.par > 0);
    assert.equal(customLevel({w: 6, d: 6, h: 2, mines: 5, tess: 'hex'}).tess, 'hex');
    assert.equal(customLevel({w: 6, tess: 'bogus'}).tess, 'cubic');
    assert.equal(DEFAULT_SETTINGS.cornerWeight, 0.5);
    assert.equal(DEFAULT_SETTINGS.boardW * DEFAULT_SETTINGS.boardD * DEFAULT_SETTINGS.boardH, 512);
    assert.equal(DEFAULT_SETTINGS.boardMines, 30);
});