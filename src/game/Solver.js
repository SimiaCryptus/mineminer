// Pure logic: no three.js, no DOM.
//
// The "Multiverse Constraint Engine" from quantum_grace.md, adapted to MineMiner:
//
//  * The hidden mine layout (grid.content) is the *working world* w0. It always satisfies
//    every constraint the player can see, because the numbers were computed from it.
//  * Revealed safe cells are constraints:  sum(weight * isMine(n)) over their neighbours
//    equals their (possibly fractional) count.
//  * INTACT cells adjacent to at least one revealed number are the *frontier* variables.
//    Everything else is fixed at its current content: marked cells are the player's
//    commitments and defused / scarred cells are known mines.
//  * "Deep" cells (INTACT, nothing revealed nearby) have not been observed by any number.
//    Two deep cells can swap contents without changing a visible count or the mine total,
//    so a deep cell is in superposition whenever a deep cell of the opposite content
//    exists. Deep cells also absorb the mine surplus/deficit of a repaired frontier.
//  * A frontier *component* is one connected piece of the bipartite graph
//    numbers <-> frontier cells. Components are independent, so a collapse only needs
//    to enumerate the component the target cell belongs to.
import { EMPTY, MINE, INTACT, MINED, NEIGHBOUR_STRIDE } from './Grid.js';
import { shuffle } from './MineGenerator.js';

const EPS = 1e-6;

/** Backtracking node budget before a search gives up (returns `undefined`). */
export const DEFAULT_NODE_BUDGET = 200000;

/** A revealed safe cell carries a number and therefore acts as a constraint. */
export function isNumberCell(grid, i) {
  return grid.state[i] === MINED && grid.content[i] === EMPTY;
}

/** True if any neighbour of `i` is a revealed number. */
export function touchesNumber(grid, i) {
  const { neighbours } = grid;
  const base = i * NEIGHBOUR_STRIDE;
  for (let k = 0; k < NEIGHBOUR_STRIDE; k++) {
    const n = neighbours[base + k];
    if (n >= 0 && isNumberCell(grid, n)) return true;
  }
  return false;
}

/** An unpinned INTACT cell next to at least one revealed number: a CSP variable. */
export function isFrontier(grid, i, pinned = null) {
  return grid.state[i] === INTACT && !(pinned && pinned[i]) && touchesNumber(grid, i);
}
/** An unpinned INTACT cell with nothing revealed nearby: no number has observed it yet. */
export function isDeep(grid, i, pinned = null) {
   return grid.state[i] === INTACT && !(pinned && pinned[i]) && !touchesNumber(grid, i);
}
/**
  * The dark around a deep `cell`: every *other* deep cell, split by content. Swapping
  * `cell` with one of them changes no visible number and conserves the mine total, so the
  * cell is ambiguous exactly when the pool of the opposite content is non-empty.
  * Returns null when `cell` is not deep.
  */
export function deepContext(grid, cell, pinned = null) {
   if (!isDeep(grid, cell, pinned)) return null;
   const mines = [];
   const empties = [];
   for (let i = 0; i < grid.cellCount; i++) {
     if (i === cell || !isDeep(grid, i, pinned)) continue;
     (grid.content[i] === MINE ? mines : empties).push(i);
   }
   return { cell, mines, empties };
}
/**
  * Gives `deep.cell` content `want` (1 = mine, 0 = safe) by swapping it with a random deep
  * cell of the opposite content. Counts are recomputed. Returns the two changed cells.
  */
export function applyDeep(grid, deep, want, rng) {
   const pool = want ? deep.mines : deep.empties;
   if (!pool.length) throw new Error('quantum repair has no deep cell to swap with');
   const partner = pool[Math.floor(rng() * pool.length)];
   grid.content[deep.cell] = want ? MINE : EMPTY;
   grid.content[partner] = want ? EMPTY : MINE;
   grid.recomputeCounts();
   return [deep.cell, partner];
}

/**
 * Algorithm 1 (frontier component extraction). BFS through the bipartite constraint graph
 * starting at `start`, which becomes variable 0.
 *
 * Returns null when `start` is not a frontier variable, otherwise
 *   {
 *     vars:        cell index of every variable (vars[0] === start),
 *     cons:        [{ cell, residual, terms: [varIdx, weight, ...] }],
 *     varCons:     per variable: [conIdx, weight, ...],
 *     mines:       mines currently inside the component,
 *     deepMines / deepEmpties: unobserved cells usable to conserve the mine total,
 *     lo / hi:     allowed range for the component's mine total,
 *   }
 */
export function frontierComponent(grid, start, pinned = null) {
  if (!isFrontier(grid, start, pinned)) return null;
  const { neighbours, slotWeights, state, content, counts, cellCount } = grid;
  const varIndex = new Map([[start, 0]]);
  const vars = [start];
  const cons = [];
  const seen = new Set();

  for (let qi = 0; qi < vars.length; qi++) {
    const v = vars[qi];
    const vb = v * NEIGHBOUR_STRIDE;
    for (let k = 0; k < NEIGHBOUR_STRIDE; k++) {
      const num = neighbours[vb + k];
      if (num < 0 || seen.has(num) || !isNumberCell(grid, num)) continue;
      seen.add(num);
      let residual = counts[num];
      const terms = [];
      const nb = num * NEIGHBOUR_STRIDE;
      for (let kk = 0; kk < NEIGHBOUR_STRIDE; kk++) {
        const m = neighbours[nb + kk];
        if (m < 0) continue;
        const w = slotWeights[kk];
        if (state[m] === INTACT && !(pinned && pinned[m])) {
          let idx = varIndex.get(m);
          if (idx === undefined) {
            idx = vars.length;
            varIndex.set(m, idx);
            vars.push(m);
          }
          terms.push(idx, w);
        } else if (content[m] === MINE) {
          residual -= w; // marked / defused / scarred / pinned mine: fixed
        }
      }
      cons.push({ cell: num, residual, terms });
    }
  }

  const varCons = vars.map(() => []);
  for (let ci = 0; ci < cons.length; ci++) {
    const t = cons[ci].terms;
    for (let i = 0; i < t.length; i += 2) varCons[t[i]].push(ci, t[i + 1]);
  }

  let mines = 0;
  for (const v of vars) if (content[v] === MINE) mines++;

  // Deep cells: intact, unpinned, not adjacent to any number. Rewriting them changes no
  // visible count, so they absorb the mine surplus/deficit of a repaired component.
  const deepMines = [];
  const deepEmpties = [];
  for (let i = 0; i < cellCount; i++) {
    if (state[i] !== INTACT || (pinned && pinned[i]) || varIndex.has(i) || touchesNumber(grid, i)) continue;
    (content[i] === MINE ? deepMines : deepEmpties).push(i);
  }

  return {
    start,
    vars,
    cons,
    varCons,
    mines,
    deepMines,
    deepEmpties,
    lo: mines - deepEmpties.length,
    hi: mines + deepMines.length,
  };
}

/**
 * Budgeted backtracking search for one world of `comp` in which variable `forcedVar`
  * has content `forcedValue` (1 = mine, 0 = safe).
  *
  * After the target, variables are picked dynamically from the open constraint with the
  * least slack (most-constrained first). A constraint with no slack left forces its
  * remaining variables outright, so this is unit propagation folded into the search
  * order: every forced cell costs a single node and the budget is spent only on real
  * choices. With an `rng` the value order of those choices is randomised so the chosen
  * branch is not always the lexicographically first one.
 *
 * Returns a Uint8Array over comp.vars, `null` if no such world exists (the value is forced
 * by the visible numbers), or `undefined` if the budget ran out (too entangled to tell).
 */
export function findWorld(comp, forcedVar, forcedValue, rng = null, budget = DEFAULT_NODE_BUDGET) {
  const { vars, cons, varCons, lo, hi } = comp;
  const n = vars.length;

  const assign = new Uint8Array(n);
   const done = new Uint8Array(n);
  const assigned = new Float64Array(cons.length); // weight of mines placed so far
  const remaining = new Float64Array(cons.length); // weight of still-unassigned variables
   const open = new Int32Array(cons.length); // number of still-unassigned variables
  for (let c = 0; c < cons.length; c++) {
    const t = cons[c].terms;
     open[c] = t.length >> 1;
    for (let i = 1; i < t.length; i += 2) remaining[c] += t[i];
  }
  let nodes = 0;
  let mines = 0;

  const feasible = (v) => {
    const vc = varCons[v];
    for (let i = 0; i < vc.length; i += 2) {
      const c = vc[i];
      const res = cons[c].residual;
      if (assigned[c] > res + EPS || assigned[c] + remaining[c] < res - EPS) return false;
    }
    return true;
  };
  const place = (v, val) => {
    const vc = varCons[v];
    for (let i = 0; i < vc.length; i += 2) {
       const c = vc[i];
       remaining[c] -= vc[i + 1];
       open[c]--;
       if (val) assigned[c] += vc[i + 1];
    }
    mines += val;
    assign[v] = val;
     done[v] = 1;
  };
  const lift = (v, val) => {
    const vc = varCons[v];
    for (let i = 0; i < vc.length; i += 2) {
       const c = vc[i];
       remaining[c] += vc[i + 1];
       open[c]++;
       if (val) assigned[c] -= vc[i + 1];
    }
    mines -= val;
     done[v] = 0;
   };
   // Next variable: one from the open constraint with the least slack. Sets `forcedNext`
   // to the only value that constraint still admits, or -1 when both are possible.
   let forcedNext = -1;
   const pick = () => {
     let bestC = -1;
     let bestSlack = Infinity;
     for (let c = 0; c < cons.length; c++) {
       if (open[c] === 0) continue;
       const need = cons[c].residual - assigned[c];
       const slack = Math.min(need, remaining[c] - need);
       if (slack < bestSlack) {
         bestSlack = slack;
         bestC = c;
         if (slack <= EPS) break; // already forced, cannot do better
       }
     }
     if (bestC < 0) {
       // Unconstrained leftovers (cannot happen: every variable touches a number).
       forcedNext = -1;
       for (let v = 0; v < n; v++) if (!done[v]) return v;
       return -1;
     }
     const need = cons[bestC].residual - assigned[bestC];
     forcedNext = need <= EPS ? 0 : remaining[bestC] - need <= EPS ? 1 : -1;
     const t = cons[bestC].terms;
     for (let i = 0; i < t.length; i += 2) if (!done[t[i]]) return t[i];
     return -1;
  };

  // 1 = found (assign holds the world), 0 = exhausted, 2 = budget exceeded
  const dfs = (pos) => {
    if (pos === n) return mines >= lo && mines <= hi ? 1 : 0;
    if (++nodes > budget) return 2;
    if (mines > hi || mines + (n - pos) < lo) return 0;
     let v;
     let forced;
     if (pos === 0) {
       v = forcedVar;
       forced = forcedValue;
     } else {
       v = pick();
       forced = forcedNext;
     }
     // Value ordering: forced values (the target, or a constraint with no slack) have a
     // single branch; with an rng flip a coin; otherwise prefer a mine while the
     // component still needs more of them to reach `lo`. Dense boards have few deep
     // empties (so lo ≈ mines) and would otherwise enumerate every mine-poor world
     // before finding a valid one, burning the budget.
     const first = forced >= 0 ? forced : rng ? (rng() < 0.5 ? 1 : 0) : mines < lo ? 1 : 0;
    for (let t = 0; t < 2; t++) {
       if (t === 1 && forced >= 0) break; // only one value can be consistent
      const val = t === 0 ? first : 1 - first;
      place(v, val);
      const res = feasible(v) ? dfs(pos + 1) : 0;
      if (res === 1) return 1;
      lift(v, val);
      if (res === 2) return 2;
    }
    return 0;
  };

  const res = dfs(0);
  if (res === 1) return assign;
  return res === 0 ? null : undefined;
}

/**
 * Project `world` onto the hidden grid. Component cells take the world's content; the
 * global mine count is conserved through deep cells; counts are recomputed. Returns the
 * list of cells whose content changed.
 */
export function applyWorld(grid, comp, world, rng) {
  const { content } = grid;
  const changed = [];
  let delta = 0;
  for (let i = 0; i < comp.vars.length; i++) {
    const cell = comp.vars[i];
    const was = content[cell] === MINE ? 1 : 0;
    if (world[i] === was) continue;
    content[cell] = world[i] ? MINE : EMPTY;
    delta += world[i] - was;
    changed.push(cell);
  }
  if (delta !== 0) {
    const pool = (delta > 0 ? comp.deepMines : comp.deepEmpties).slice();
    const need = Math.abs(delta);
    if (pool.length < need) throw new Error('quantum repair cannot conserve the mine count');
    shuffle(pool, rng);
    for (let k = 0; k < need; k++) {
      content[pool[k]] = delta > 0 ? EMPTY : MINE;
      changed.push(pool[k]);
    }
  }
  grid.recomputeCounts();
  return changed;
}

/**
 * Classifies a cell against the visible numbers:
  *   'classical'  not an unpinned INTACT cell (marked, revealed or pinned) – no grace applies
 *   'mine'       every consistent world has a mine here
 *   'safe'       every consistent world is safe here
 *   'ambiguous'  both kinds of world exist (superposition)
 *   'unknown'    the component was too large for the budget
  *
  * Frontier cells are judged by an exact search over their component (`comp`). Deep
  * cells (nothing revealed nearby) are judged by the dark around them (`deep`): they are
  * ambiguous as long as another deep cell of the opposite content exists to swap with.
 */
export function classify(grid, cell, { pinned = null, budget = DEFAULT_NODE_BUDGET } = {}) {
   const have = grid.content[cell] === MINE ? 1 : 0;
  const comp = frontierComponent(grid, cell, pinned);
   if (!comp) {
     const deep = deepContext(grid, cell, pinned);
     if (!deep) return { verdict: 'classical', comp: null, deep: null };
     const partners = have ? deep.empties : deep.mines;
     if (!partners.length) return { verdict: have ? 'mine' : 'safe', comp: null, deep };
     return { verdict: 'ambiguous', comp: null, deep };
   }
  const alt = findWorld(comp, 0, 1 - have, null, budget);
   if (alt === undefined) return { verdict: 'unknown', comp, deep: null };
   if (alt === null) return { verdict: have ? 'mine' : 'safe', comp, deep: null };
   return { verdict: 'ambiguous', comp, deep: null, alt };
}