import { EMPTY, MINE } from './Grid.js';

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Fisher–Yates over all indices, take the first `mineCount`. */
export function placeMines(grid, mineCount, rng) {
  if (mineCount < 0 || mineCount >= grid.cellCount) {
    throw new Error(`mineCount ${mineCount} out of range for ${grid.cellCount} cells`);
  }
  const idx = new Uint32Array(grid.cellCount);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  shuffle(idx, rng);
  grid.content.fill(EMPTY);
  for (let k = 0; k < mineCount; k++) grid.content[idx[k]] = MINE;
  grid.recomputeCounts();
}

export function protectedSet(grid, cell) {
  const set = new Set([cell]);
  grid.forEachNeighbour(cell, (n) => set.add(n));
  return set;
}

/**
 * Safe first strike: move every mine inside `cell`'s neighbourhood to a random
  * cell outside it. Returns the number of mines moved.
  *
  * `locked(i)` marks cells the relocation must not touch, as source or destination:
  * flagged blocks are the player's commitments and pinned blocks are crystallised
  * worlds (quantum grace). Pulling a mine out from under a flag – or dropping one onto
  * a block the player has been told is empty – would make every deduction built on
  * that block silently false.
 */
export function relocateMinesAwayFrom(grid, cell, rng, locked = null) {
  const prot = protectedSet(grid, cell);
   const isLocked = (i) => (locked ? Boolean(locked(i)) : false);
  const toMove = [];
   for (const c of prot) if (grid.content[c] === MINE && !isLocked(c)) toMove.push(c);
  if (!toMove.length) return 0;

  const free = [];
  for (let i = 0; i < grid.cellCount; i++) {
     if (!prot.has(i) && grid.content[i] === EMPTY && !isLocked(i)) free.push(i);
  }
  shuffle(free, rng);
  const moves = Math.min(toMove.length, free.length);
  for (let k = 0; k < moves; k++) {
    grid.content[toMove[k]] = EMPTY;
    grid.content[free[k]] = MINE;
  }
  grid.recomputeCounts();
  return moves;
}