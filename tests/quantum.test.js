import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY, Grid, INTACT, MINE, MINED } from '../src/game/Grid.js';
import { placeMines } from '../src/game/MineGenerator.js';
import { Board } from '../src/game/Board.js';
import { classify, findWorld, frontierComponent, touchesNumber } from '../src/game/Solver.js';
import { rngFromSeed } from '../src/core/rng.js';

function totalMines(grid) {
  let n = 0;
  for (const c of grid.content) if (c === MINE) n++;
  return n;
}

/** 3×3, one mine in a corner, centre revealed with cascade off: every ring cell is a 1-in-8. */
function ringBoard(opts = {}) {
  const grid = new Grid(3, 3, 1);
  grid.content[grid.index(0, 0, 0)] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, {
    safeFirstStrike: false,
    cascade: 'off',
    seed: 'quantum',
    ...opts,
  });
  const centre = grid.index(1, 0, 1);
  assert.equal(board.strike(centre).kind, 'cleared');
  assert.equal(grid.counts[centre], 1);
  return { grid, board, centre };
}

test('solver: deep and revealed cells are not frontier variables; forced values return null', () => {
  const grid = new Grid(3, 1, 1);
  grid.content[2] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, { safeFirstStrike: false, cascade: 'off', quantum: 'off' });
  assert.equal(frontierComponent(grid, 1), null, 'nothing revealed yet');
  board.strike(1); // shows 1: cell 2 is a provable mine, cell 0 provably safe
  assert.equal(frontierComponent(grid, 1), null, 'revealed cells are constraints, not variables');
  const comp = frontierComponent(grid, 2);
  assert.deepEqual(comp.vars.sort(), [0, 2]);
  assert.equal(findWorld(comp, 0, 0), null, 'cell 2 cannot be safe');
  assert.deepEqual([...findWorld(comp, 0, 1)], [1, 0]);
  assert.equal(classify(grid, 2).verdict, 'mine');
  assert.equal(classify(grid, 0).verdict, 'safe');
});

test('quantum flag: marking an ambiguous cell crystallises a mine there and conserves the total', () => {
  const { grid, board, centre } = ringBoard({ quantum: 'on' });
  const target = grid.index(2, 0, 2);
  assert.equal(grid.content[target], EMPTY);
  const r = board.toggleMark(target);
  assert.equal(r.kind, 'marked');
  assert.ok(r.collapse);
  assert.equal(board.collapses, 1);
  assert.equal(grid.content[target], MINE, 'the marked cell is now the mine');
  assert.equal(grid.content[grid.index(0, 0, 0)], EMPTY, 'the old mine is gone');
  assert.equal(totalMines(grid), 1);
  assert.equal(grid.counts[centre], 1, 'the revealed number never changes');
  assert.equal(board.strike(target).kind, 'defused');
  for (let i = 0; i < grid.cellCount; i++) {
    if (i === centre || i === target) continue;
    assert.equal(board.strike(i).kind, 'cleared', `cell ${i} is safe now`);
  }
  assert.equal(board.status, 'won');
});

test('a provably safe cell cannot be crystallised: the mark stays plain and misfires', () => {
  const grid = new Grid(3, 1, 1);
  grid.content[2] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, {
    safeFirstStrike: false,
    cascade: 'off',
    quantum: 'on',
    lives: 2,
  });
  assert.equal(board.strike(0).kind, 'cleared');
  assert.equal(grid.counts[0], 0);
  const r = board.toggleMark(1);
  assert.equal(r.kind, 'marked');
  assert.equal(r.collapse, false);
  assert.equal(grid.content[1], EMPTY);
  assert.equal(board.strike(1).kind, 'misfire');
  assert.equal(board.collapses, 0);
});

test('a provable mine still detonates, even with quantum grace on', () => {
  const grid = new Grid(2, 1, 1);
  grid.content[1] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, { safeFirstStrike: false, quantum: 'on' });
  assert.equal(board.strike(0).kind, 'cleared');
  const r = board.strike(1);
  assert.equal(r.kind, 'boom');
  assert.equal(r.collapse, false);
  assert.equal(board.collapses, 0);
  assert.equal(board.status, 'lost');
});

test('strike grace: clearing an ambiguous mine repairs the world so the strike is consistent', () => {
  const on = ringBoard({ quantum: 'on' });
  const mineCell = on.grid.index(0, 0, 0);
  assert.equal(on.grid.content[mineCell], MINE);
  const r = on.board.strike(mineCell);
  assert.equal(r.kind, 'cleared');
  assert.ok(r.collapse);
  assert.equal(on.board.status, 'playing');
  assert.equal(on.grid.content[mineCell], EMPTY, 'the struck cell is now safe');
  assert.equal(totalMines(on.grid), 1, 'the mine moved rather than vanished');
  assert.equal(on.grid.counts[on.centre], 1, 'the revealed number never changes');

  // Default options are grace-on: the same strike is repaired without asking.
  const dflt = ringBoard();
  assert.equal(dflt.board.strike(dflt.grid.index(0, 0, 0)).kind, 'cleared');

  // Legacy 'marks' is treated as 'on' as well.
  const legacy = ringBoard({ quantum: 'marks' });
  assert.equal(legacy.board.strike(legacy.grid.index(0, 0, 0)).kind, 'cleared');

  const off = ringBoard({ quantum: 'off' });
  assert.equal(off.board.strike(off.grid.index(0, 0, 0)).kind, 'boom');
  assert.equal(off.board.collapses, 0);
});
test('zero quantum lives is exactly grace off', () => {
  const { grid, board } = ringBoard({ quantum: 'on', quantumLives: 0 });
  assert.equal(board.quantumOn, false);
  const r = board.strike(grid.index(0, 0, 0));
  assert.equal(r.kind, 'boom');
  assert.equal(r.collapse, false);
  assert.equal(board.collapses, 0);
});
test('quantum lives are spent before the classical lives, then the vault turns classical', () => {
  // Two independent ambiguous corners: (1,1) sees the mine at (0,0), (4,4) sees (5,5),
  // and their frontier components do not touch.
  const grid = new Grid(6, 6, 1);
  grid.content[grid.index(0, 0, 0)] = MINE;
  grid.content[grid.index(5, 0, 5)] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, {
    safeFirstStrike: false,
    cascade: 'off',
    quantum: 'on',
    quantumLives: 1,
    lives: 3,
    seed: 'q-lives',
  });
  assert.equal(board.strike(grid.index(1, 0, 1)).kind, 'cleared');
  assert.equal(board.strike(grid.index(4, 0, 4)).kind, 'cleared');
  assert.equal(board.collapses, 0, 'blind openings that needed no rewrite are free');
  assert.equal(board.quantumLives, 1);
  const first = grid.index(0, 0, 0);
  assert.equal(classify(grid, first, { pinned: board.pinned }).verdict, 'ambiguous');
  const r1 = board.strike(first);
  assert.equal(r1.kind, 'cleared', 'the first ambiguous strike is graced');
  assert.ok(r1.collapse);
  assert.equal(board.quantumLives, 0, 'the collapse spent the only quantum life');
  assert.equal(board.quantumOn, false);
  assert.equal(board.lives, 3, 'classical lives are untouched while grace pays');
  assert.equal(totalMines(grid), 2);
  const second = grid.index(5, 0, 5);
  assert.equal(classify(grid, second, { pinned: board.pinned }).verdict, 'ambiguous');
  const r2 = board.strike(second);
  assert.equal(r2.kind, 'boom', 'with no quantum lives left the same situation detonates');
  assert.equal(r2.collapse, false);
  assert.equal(board.collapses, 1);
  assert.equal(board.lives, 2, 'the classical lives pay from here on');
  assert.equal(board.status, 'playing');
  // The budget survives snapshot/restore.
  const snap = board.snapshot();
  board.quantumLives = 7;
  board.restore(snap);
  assert.equal(board.quantumLives, 0);
});
test('strike grace in the dark: a second blind opening on a dense board is repaired', () => {
  const seed = 'dense-seeds';
  const make = (quantum) => {
    const grid = new Grid(6, 6, 1);
    placeMines(grid, 20, rngFromSeed(seed));
    return { grid, board: new Board(grid, { seed, quantum }) };
  };
  const { grid, board } = make('on');
  const first = board.strike(grid.index(1, 0, 1));
  assert.equal(first.kind, 'cleared');
  assert.equal(first.collapse, false, 'a safe first strike is not a collapse');
  assert.equal(board.collapses, 0);
  const shown = new Map();
  for (let i = 0; i < grid.cellCount; i++) {
    if (grid.state[i] === MINED && grid.content[i] === EMPTY) shown.set(i, grid.counts[i]);
  }
  // Dense board: the opening barely spreads, so most of the slab is dark. Pick a dark mine.
  let target = -1;
  for (let i = grid.cellCount - 1; i >= 0; i--) {
    if (grid.state[i] === INTACT && grid.content[i] === MINE && !touchesNumber(grid, i)) {
      target = i;
      break;
    }
  }
  assert.ok(target >= 0, 'there is a mine in the dark');
  assert.equal(classify(grid, target).verdict, 'ambiguous');
  const r = board.strike(target);
  assert.equal(r.kind, 'cleared', 'the blind second opening is repaired, not detonated');
  assert.ok(r.collapse);
  assert.equal(board.collapses, 1);
  assert.equal(board.status, 'playing');
  assert.equal(grid.content[target], EMPTY);
  assert.equal(totalMines(grid), 20, 'the mine moved rather than vanished');
  for (const [i, c] of shown) assert.equal(grid.counts[i], c, `number ${i} never changes`);
  // The identical layout under classical rules is exactly the coin flip we removed.
  const off = make('off');
  off.board.strike(off.grid.index(1, 0, 1));
  assert.equal(off.grid.content[target], MINE);
  assert.equal(off.board.strike(target).kind, 'boom');
});
test('a dark block detonates only when every other dark block is a mine', () => {
  const grid = new Grid(5, 1, 1);
  grid.content[3] = MINE;
  grid.content[4] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, { safeFirstStrike: false, quantum: 'on' });
  assert.equal(board.strike(0).kind, 'cleared');
  assert.equal(grid.state[2], MINED, 'cascade reached the "1"');
  assert.equal(board.collapses, 0, 'a lucky blind dig on a safe block is not a collapse');
  // Cell 3 is on the frontier (provable mine), cell 4 is dark with no dark empty to swap with.
  assert.equal(classify(grid, 4).verdict, 'mine');
  const r = board.strike(4);
  assert.equal(r.kind, 'boom');
  assert.equal(r.collapse, false);
  assert.equal(board.status, 'lost');
});
test('quantum flag in the dark pulls a mine under the mark and conserves the total', () => {
  const grid = new Grid(4, 1, 1);
  grid.content[3] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, { safeFirstStrike: false, quantum: 'on', cascade: 'off' });
  const r = board.toggleMark(0);
  assert.equal(r.kind, 'marked');
  assert.ok(r.collapse);
  assert.equal(grid.content[0], MINE);
  assert.equal(grid.content[3], EMPTY);
  assert.equal(totalMines(grid), 1);
  assert.equal(board.collapses, 1);
  assert.equal(board.strike(0).kind, 'defused');
});
test('the safe first strike never moves a mine out from under a flag', () => {
  for (let s = 0; s < 20; s++) {
    const seed = `flag-first-${s}`;
    const grid = new Grid(7, 7, 1);
    placeMines(grid, 10, rngFromSeed(seed));
    const board = new Board(grid, { seed, quantum: 'on' });
    const flags = [grid.index(2, 0, 3), grid.index(4, 0, 3)];
    for (const f of flags) assert.equal(board.toggleMark(f).kind, 'marked');
    for (const f of flags)
      assert.equal(grid.content[f], MINE, `${seed}: a blind flag pulls a mine under it`);
    // Open the board right between the two flags: everything else in the neighbourhood
    // is relocated, the player's commitments are left exactly where they are.
    const first = grid.index(3, 0, 3);
    assert.equal(board.strike(first).kind, 'cleared');
    assert.equal(grid.content[first], EMPTY);
    for (const f of flags)
      assert.equal(grid.content[f], MINE, `${seed}: the flag still covers its mine`);
    assert.equal(totalMines(grid), 10, `${seed}: mine total conserved`);
    grid.forEachNeighbour(first, (n) => {
      if (!flags.includes(n))
        assert.equal(grid.content[n], EMPTY, `${seed}: unflagged neighbour ${n} is clear`);
    });
    assert.equal(grid.counts[first], 2, 'the number reads the two flagged mines');
    for (const f of flags) assert.equal(board.strike(f).kind, 'defused');
  }
});
test('deductions built on a flag stay true after the opening', () => {
  // Flag (2,1), open on (1,1). Before the fix the flagged mine was relocated into the
  // x=3 column, so "the 1 is my flag, its other neighbours are safe" hit that mine.
  const grid = new Grid(4, 3, 1);
  grid.content[grid.index(2, 0, 1)] = MINE;
  grid.content[grid.index(3, 0, 2)] = MINE;
  grid.recomputeCounts();
  const board = new Board(grid, { seed: 'flag-logic', quantum: 'on', lives: 1 });
  const flag = grid.index(2, 0, 1);
  assert.equal(board.toggleMark(flag).kind, 'marked');
  assert.equal(grid.content[flag], MINE);
  assert.equal(board.strike(grid.index(1, 0, 1)).kind, 'cleared');
  assert.equal(grid.counts[grid.index(1, 0, 1)], 1, 'the flag is the only mine the number sees');
  // Every other neighbour of that 1 is therefore safe – and must actually be safe.
  grid.forEachNeighbour(grid.index(1, 0, 1), (n) => {
    if (n !== flag)
      assert.equal(board.strike(n).kind, 'cleared', `neighbour ${n} of the 1 is safe`);
  });
  // (2,0) now shows a 1 explained by the flag, so (3,0) and (3,1) are safe too.
  assert.equal(grid.counts[grid.index(2, 0, 0)], 1);
  assert.equal(board.strike(grid.index(3, 0, 0)).kind, 'cleared');
  assert.equal(board.strike(grid.index(3, 0, 1)).kind, 'cleared');
  assert.equal(board.status, 'playing');
  assert.equal(board.strike(flag).kind, 'defused');
});
test('striking your own flag as the very first move defuses it', () => {
  const grid = new Grid(5, 5, 1);
  placeMines(grid, 4, rngFromSeed('flag-strike'));
  const board = new Board(grid, { seed: 'flag-strike', quantum: 'on', lives: 1 });
  const flag = grid.index(2, 0, 2);
  board.toggleMark(flag);
  assert.equal(grid.content[flag], MINE);
  assert.equal(board.strike(flag).kind, 'defused');
  assert.equal(board.lives, 1);
  assert.equal(board.status, 'playing');
});

test('pinned choices are respected by later collapses', () => {
  const { grid, board } = ringBoard({ quantum: 'on' });
  const a = grid.index(2, 0, 2);
  const b = grid.index(2, 0, 0);
  assert.ok(board.toggleMark(a).collapse);
  assert.equal(board.toggleMark(a).kind, 'unmarked');
  assert.equal(grid.content[a], MINE, 'unmarking does not undo the crystallised mine');
  const r = board.toggleMark(b);
  assert.equal(r.collapse, false, 'with a pinned mine the number is satisfied: b is provably safe');
  assert.equal(grid.content[b], EMPTY);
  assert.equal(grid.content[a], MINE);
  assert.equal(board.collapses, 1);

  const snap = board.snapshot();
  board.collapses = 99;
  board.pinned.fill(0);
  board.restore(snap);
  assert.equal(board.collapses, 1);
  assert.equal(board.pinned[a], 1);
});

test('replaying a log with collapses is exact', () => {
  const make = () => {
    const grid = new Grid(3, 3, 1);
    grid.content[grid.index(0, 0, 0)] = MINE;
    grid.recomputeCounts();
    return new Board(grid, {
      safeFirstStrike: false,
      cascade: 'off',
      quantum: 'on',
      seed: 'replay-q',
    });
  };
  const a = make();
  a.strike(a.grid.index(1, 0, 1));
  a.toggleMark(a.grid.index(2, 0, 2));
  a.strike(a.grid.index(0, 0, 0));
  assert.ok(a.collapses >= 1);
  const b = make();
  b.replay(a.actionLog);
  assert.deepEqual([...b.grid.content], [...a.grid.content]);
  assert.deepEqual([...b.grid.state], [...a.grid.state]);
  assert.equal(b.collapses, a.collapses);
});

test('random play: collapses conserve the mine count and never contradict a revealed number', () => {
  for (let s = 0; s < 6; s++) {
    const seed = `chaos-${s}`;
    const grid = new Grid(8, 8, 2);
    placeMines(grid, 18, rngFromSeed(seed));
    const board = new Board(grid, { seed, quantum: 'on', strictMarks: false, lives: Infinity });
    const play = rngFromSeed(`${seed}:play`);
    board.strike(grid.index(4, 0, 4));
    for (let step = 0; step < 80 && !board.isOver; step++) {
      const shown = new Map();
      for (let i = 0; i < grid.cellCount; i++) {
        if (grid.state[i] === MINED && grid.content[i] === EMPTY) shown.set(i, grid.counts[i]);
      }
      const intact = [];
      for (let i = 0; i < grid.cellCount; i++) if (grid.state[i] === INTACT) intact.push(i);
      if (!intact.length) break;
      const cell = intact[Math.floor(play() * intact.length)];
      const { verdict } = classify(grid, cell, { pinned: board.pinned });
      assert.notEqual(
        verdict,
        'unknown',
        `${seed} step ${step}: the frontier search ran out of budget`
      );
      const r = play() < 0.5 ? board.toggleMark(cell) : board.strike(cell);
      if (r.kind === 'boom') {
        // With grace on, only a block the numbers (or a pin) prove to be a mine may detonate.
        assert.ok(
          verdict === 'mine' || verdict === 'classical',
          `${seed} step ${step}: an ambiguous block detonated`
        );
      }
      assert.equal(totalMines(grid), 18, `${seed} step ${step}: mine total drifted`);
      for (const [i, c] of shown)
        assert.equal(grid.counts[i], c, `${seed} step ${step}: number ${i} changed`);
    }
  }
});
