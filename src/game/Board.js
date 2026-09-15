import {EMPTY, INTACT, MARKED, MINE, MINED, NEIGHBOUR_STRIDE, SCAR} from './Grid.js';
import {relocateMinesAwayFrom} from './MineGenerator.js';
import {applyDeep, applyWorld, classify, DEFAULT_NODE_BUDGET, findWorld} from './Solver.js';
import {rngFromSeed} from '../core/rng.js';

export const DEFAULT_BOARD_OPTS = Object.freeze({
    cascade: 'on', // 'on' | 'off' | 'single-layer'
    strictMarks: true,
    lives: 1, // number | Infinity
    safeFirstStrike: true,
    shellMs: 22, // reveal delay per cascade shell
    seed: 'mineminer',
    // Quantum grace (quantum_grace.md): 'off' | 'on'
    //   on: marking an ambiguous frontier cell crystallises a mine there (quantum flag), and
    //       striking an ambiguous frontier cell is repaired to be safe (strike grace). If the
    //       visible numbers can be consistent with the player's action, the world is rewritten
    //       so that they are. Blocks in the dark (nothing revealed nearby) are covered too:
    //       a blind strike on a mine swaps it with an unobserved empty block, and a blind mark
    //       pulls a mine under the flag. Legacy values 'marks' / 'full' are both treated as 'on'.
    quantum: 'on',
    // Quantum lives: how many collapses the run may spend. Each collapse costs one, and they
    // are expended *before* the classical lives: at zero the vault behaves classically again,
    // so an ambiguous mine detonates and costs an ordinary life. 0 == grace off, Infinity ==
    // never guess. Accepts a number, 'inf' or Infinity.
    quantumLives: Infinity,
    quantumBudget: DEFAULT_NODE_BUDGET,
});

/** '0' | '3' | 'inf' | Infinity -> a usable collapse budget. Unknown values mean Infinity. */
export function quantumLivesFrom(value) {
    if (value === undefined || value === null || value === Infinity || value === 'inf' || value === '∞') {
        return Infinity;
    }
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Infinity;
}


export function countMines(grid) {
    let c = 0;
    for (let i = 0; i < grid.cellCount; i++) if (grid.content[i] === MINE) c++;
    return c;
}

/**
 * Rules engine. Deterministic given (grid, opts, action list).
 * Emits on the optional bus: board:started, board:action, cascade, mine:defused,
 * misfire, mine:detonated, quantum:collapse, board:won, board:lost, board:restored.
 */
export class Board {
    constructor(grid, opts = {}, bus = null) {
        this.grid = grid;
        this.opts = {...DEFAULT_BOARD_OPTS, ...opts};
        // Older callers / saved settings used 'marks' or 'full'; grace now always covers both.
        if (this.opts.quantum && this.opts.quantum !== 'off') this.opts.quantum = 'on';
        this.bus = bus;
        this.rng = rngFromSeed(`${this.opts.seed}:relocate`);
        this.mineCount = countMines(grid);
        this.safeTotal = grid.cellCount - this.mineCount;
        this.lives = this.opts.lives === Infinity ? Infinity : Number(this.opts.lives) || 1;
        // Collapses left before grace switches off and classical lives take over.
        this.quantumLives = quantumLivesFrom(this.opts.quantumLives);
        this.status = 'ready'; // 'ready' | 'playing' | 'won' | 'lost'
        this.started = false;
        this.marks = 0;
        this.defused = 0;
        this.scars = 0;
        this.misfires = 0;
        this.minedSafe = 0;
        this.largestCascade = 0;
        this.collapses = 0;
        // Cells whose content the player has crystallised through a collapse. They are
        // constants for every later frontier search, so a declared branch is never undone.
        this.pinned = new Uint8Array(grid.cellCount);
        this.actionLog = [];
    }

    get isOver() {
        return this.status === 'won' || this.status === 'lost';
    }

    get minesRemaining() {
        return this.mineCount - this.marks - this.defused - this.scars;
    }

    get progress() {
        return this.safeTotal ? this.minedSafe / this.safeTotal : 1;
    }

    /**
     * Quantum grace applies to both marks and strikes whenever it is not switched off *and*
     * the run still has a quantum life to spend. Once the budget is exhausted the board is
     * indistinguishable from classical Minesweeper.
     */
    get quantumOn() {
        return Boolean(this.opts.quantum) && this.opts.quantum !== 'off' && this.quantumLives > 0;
    }

    isWon() {
        return this.status !== 'lost' && this.minedSafe >= this.safeTotal;
    }

    emit(name, payload) {
        if (this.bus) this.bus.emit(name, payload);
    }

    result(kind, cell) {
        return {
            kind,
            cell,
            revealed: [],
            defused: [],
            changed: [],
            scar: -1,
            lives: this.lives,
            quantumLives: this.quantumLives,
            won: false,
            lost: false,
            collapse: false,
            reason: null,
        };
    }

    validCell(cell) {
        return Number.isInteger(cell) && cell >= 0 && cell < this.grid.cellCount;
    }

    beginIfNeeded(cell) {
        if (this.started) return;
        this.started = true;
        if (this.opts.safeFirstStrike) {
            const {state} = this.grid;
            // Flags and pinned blocks are constants: the relocation must neither pull a mine
            // out from under them nor drop one onto them. Otherwise a flag planted before
            // the first strike lies, and "that 1 is my flag, so its other neighbour is
            // safe" walks the player straight into the mine the relocation parked there.
            // The struck block is the one exception: if the player un-flagged a crystallised
            // mine and then opens the board on it, forgetting that pin beats dying on move
            // one. A still-flagged block is handled by the mark branch (defuse / misfire).
            if (state[cell] !== MARKED) this.pinned[cell] = 0;
            relocateMinesAwayFrom(this.grid, cell, this.rng, (i) => state[i] === MARKED || this.pinned[i] === 1);
        }
        this.status = 'playing';
        this.emit('board:started', {cell});
    }

    // ------------------------------------------------------------- actions

    strike(cell) {
        const r = this.result('noop', cell);
        if (this.isOver || !this.validCell(cell)) return r;
        const {state, content} = this.grid;
        const st = state[cell];
        if (st === MINED || st === SCAR) return r;

        this.beginIfNeeded(cell);
        this.actionLog.push({type: 'strike', cell});

        if (st === MARKED) {
            this.marks--;
            if (content[cell] === MINE) {
                state[cell] = MINED;
                this.defused++;
                r.kind = 'defused';
                r.defused.push({cell, delay: 0});
                this.emit('mine:defused', {cell});
            } else {
                r.kind = 'misfire';
                this.misfires++;
                this.clear(cell, r);
                this.emit('misfire', {cell});
                this.loseLife(r);
            }
        } else {
            // Strike grace: if the visible numbers can be consistent with this cell being safe,
            // the hidden world is repaired so that it is, before we look at its content.
            if (this.quantumOn) r.collapse = this.collapse(cell, 0);
            if (content[cell] === MINE) {
                this.detonate(cell, r);
            } else {
                r.kind = 'cleared';
                this.clear(cell, r);
            }
        }
        this.finish(r);
        return r;
    }

    toggleMark(cell) {
        const r = this.result('noop', cell);
        if (this.isOver || !this.validCell(cell)) return r;
        const {state} = this.grid;
        const st = state[cell];
        if (st === MINED || st === SCAR) return r;
        if (st === INTACT) {
            if (this.opts.strictMarks && this.minesRemaining <= 0) {
                r.reason = 'mark-limit';
                return r;
            }
            // Quantum flag: committing to an ambiguous frontier cell makes it a mine.
            if (this.quantumOn) r.collapse = this.collapse(cell, 1);
            state[cell] = MARKED;
            this.marks++;
            r.kind = 'marked';
        } else {
            state[cell] = INTACT;
            this.marks--;
            r.kind = 'unmarked';
        }
        r.changed.push(cell);
        r.quantumLives = this.quantumLives;
        this.actionLog.push({type: 'mark', cell});
        this.emit('board:action', r);
        return r;
    }

    /** Chord: if marks around a revealed number equal it, strike every INTACT neighbour. */
    probe(cell) {
        const r = this.result('noop', cell);
        if (this.isOver || !this.validCell(cell)) return r;
        const {state, counts} = this.grid;
        if (state[cell] !== MINED || counts[cell] === 0) {
            r.reason = 'not-a-number';
            return r;
        }
        let marked = 0;
        const targets = [];
        // Marks are summed with the same weights the number was built from, so a chord
        // on a "3½" needs marks whose weights add up to 3.5.
        this.grid.forEachNeighbour(cell, (n, w) => {
            if (state[n] === MARKED) marked += w;
            else if (state[n] === INTACT) targets.push(n);
        });
        if (Math.abs(marked - counts[cell]) > 1e-6) {
            r.reason = 'marks-mismatch';
            return r;
        }
        if (!targets.length) {
            r.reason = 'nothing-to-probe';
            return r;
        }
        r.kind = 'probe';
        for (const n of targets) {
            if (this.isOver) break;
            const sub = this.strike(n);
            r.revealed.push(...sub.revealed);
            r.defused.push(...sub.defused);
            r.changed.push(...sub.changed);
            r.collapse = r.collapse || sub.collapse;
            if (sub.kind === 'boom') {
                r.kind = 'boom';
                r.scar = sub.scar;
            }
            r.won = r.won || sub.won;
            r.lost = r.lost || sub.lost;
        }
        r.lives = this.lives;
        r.quantumLives = this.quantumLives;
        return r;
    }

    applyAction(action) {
        if (action.type === 'strike') return this.strike(action.cell);
        if (action.type === 'mark') return this.toggleMark(action.cell);
        return this.result('noop', action.cell);
    }

    replay(log) {
        for (const a of log) this.applyAction(a);
    }

    // ----------------------------------------------------------- quantum grace

    /**
     * The Quantum Flag / lazy repair operator from quantum_grace.md.
     *
     * `cell` must be INTACT; `want` is the branch the player is asserting (1 = mine, 0 = safe).
     * If the visible numbers *force* the cell's content nothing happens: a provable mine still
     * detonates and a provably safe mark still misfires, so every deduction stays true. If the
     * cell is in superposition (worlds of both kinds exist) the hidden world is rewritten to a
     * valid one where the cell has content `want`, the global mine count is conserved through
     * unobserved cells, and the cell is pinned so later collapses respect this choice.
     *
     * Cells with nothing revealed nearby (the dark) are in superposition too: they are
     * repaired by swapping contents with another unobserved cell, which changes no visible
     * number. Only when every other dark cell already agrees with the hidden content is the
     * cell forced (a blind strike then detonates exactly like classical Minesweeper).
     *
     * Returns true when a collapse happened. On the frontier that is whenever the cell was
     * ambiguous (the numbers were there to read, so committing without a proof is a
     * collapse whether or not the world had to change). In the dark there was nothing to
     * read, so a lucky blind dig is not a collapse: only an actual rewrite counts.
     */
    collapse(cell, want) {
        const {verdict, comp, deep, alt} = classify(this.grid, cell, {
            pinned: this.pinned,
            budget: this.opts.quantumBudget,
        });
        if (verdict !== 'ambiguous') return false;
        const have = this.grid.content[cell] === MINE ? 1 : 0;
        let changed = 0;
        if (comp) {
            if (want !== have) {
                // `alt` already has the wanted content; prefer a randomised branch for variety.
                const world = findWorld(comp, 0, want, this.rng, this.opts.quantumBudget) ?? alt;
                changed = applyWorld(this.grid, comp, world, this.rng).length;
            }
        } else {
            if (want === have) return false;
            changed = applyDeep(this.grid, deep, want, this.rng).length;
        }
        this.pinned[cell] = 1;
        this.collapses++;
        // Spend a quantum life. At zero, `quantumOn` turns false and the classical lives
        // start paying for ambiguity instead.
        if (this.quantumLives !== Infinity) this.quantumLives--;
        this.emit('quantum:collapse', {
            cell,
            want,
            changed,
            deep: !comp,
            component: comp ? comp.vars.length : 0,
            livesLeft: this.quantumLives,
        });
        return true;
    }

    // ----------------------------------------------------------- internals

    detonate(cell, r) {
        this.grid.state[cell] = SCAR;
        this.scars++;
        r.kind = 'boom';
        r.scar = cell;
        r.changed.push(cell);
        this.emit('mine:detonated', {cell});
        this.loseLife(r);
    }

    loseLife(r) {
        if (this.lives !== Infinity) this.lives--;
        r.lives = this.lives;
        if (this.lives <= 0) {
            this.status = 'lost';
            r.lost = true;
        }
    }

    clear(cell, r) {
        this.reveal(cell, r, 0);
        if (this.grid.counts[cell] === 0 && this.opts.cascade !== 'off') this.cascade(cell, r);
        if (r.revealed.length > this.largestCascade) this.largestCascade = r.revealed.length;
    }

    reveal(cell, r, delay) {
        this.grid.state[cell] = MINED;
        this.minedSafe++;
        r.revealed.push({cell, delay});
    }

    /** BFS flood fill in expanding shells. Never touches MARKED cells. */
    cascade(start, r) {
        const {grid} = this;
        const {state, content, counts, neighbours} = grid;
        const sameLayer = this.opts.cascade === 'single-layer';
        const y0 = grid.y(start);
        let frontier = [start];
        let shell = 1;
        while (frontier.length) {
            const next = [];
            for (const c of frontier) {
                const base = c * NEIGHBOUR_STRIDE;
                for (let k = 0; k < NEIGHBOUR_STRIDE; k++) {
                    const n = neighbours[base + k];
                    if (n < 0 || state[n] !== INTACT) continue;
                    if (content[n] === MINE) continue; // impossible when counts[c] === 0, defensive
                    if (sameLayer && grid.y(n) !== y0) continue;
                    this.reveal(n, r, shell * this.opts.shellMs);
                    if (counts[n] === 0) next.push(n);
                }
            }
            frontier = next;
            shell++;
        }
        if (r.revealed.length > 1) this.emit('cascade', {origin: start, size: r.revealed.length, shells: shell - 1});
    }

    finish(r) {
        if (this.status !== 'lost' && this.minedSafe >= this.safeTotal) {
            this.status = 'won';
            r.won = true;
            // Remaining mines are solved by elimination: auto-defuse them in a chain of pops.
            let delay = r.revealed.length ? r.revealed[r.revealed.length - 1].delay : 0;
            const {content, state} = this.grid;
            for (let i = 0; i < this.grid.cellCount; i++) {
                if (content[i] !== MINE || state[i] === MINED || state[i] === SCAR) continue;
                if (state[i] === MARKED) this.marks--;
                state[i] = MINED;
                this.defused++;
                delay += 45;
                r.defused.push({cell: i, delay});
            }
        }
        r.lives = this.lives;
        r.quantumLives = this.quantumLives;
        this.emit('board:action', r);
        if (r.won) this.emit('board:won', {board: this});
        if (r.lost) this.emit('board:lost', {board: this, cell: r.scar});
    }

    // --------------------------------------------------------------- undo

    snapshot() {
        return {
            content: this.grid.content.slice(),
            state: this.grid.state.slice(),
            counts: this.grid.counts.slice(),
            pinned: this.pinned.slice(),
            rng: this.rng.state,
            status: this.status,
            started: this.started,
            lives: this.lives,
            quantumLives: this.quantumLives,
            marks: this.marks,
            defused: this.defused,
            scars: this.scars,
            misfires: this.misfires,
            minedSafe: this.minedSafe,
            largestCascade: this.largestCascade,
            collapses: this.collapses,
            actionLog: this.actionLog.slice(),
        };
    }

    restore(s) {
        this.grid.content.set(s.content);
        this.grid.state.set(s.state);
        this.grid.counts.set(s.counts);
        if (s.pinned) this.pinned.set(s.pinned);
        else this.pinned.fill(0);
        if (s.rng !== undefined) this.rng.state = s.rng;
        this.status = s.status;
        this.started = s.started;
        this.lives = s.lives;
        this.quantumLives = s.quantumLives ?? quantumLivesFrom(this.opts.quantumLives);
        this.marks = s.marks;
        this.defused = s.defused;
        this.scars = s.scars;
        this.misfires = s.misfires;
        this.minedSafe = s.minedSafe;
        this.largestCascade = s.largestCascade;
        this.collapses = s.collapses ?? 0;
        this.actionLog = s.actionLog.slice();
        this.emit('board:restored', {board: this});
    }
}

export {EMPTY, MINE, INTACT, MARKED, MINED, SCAR};