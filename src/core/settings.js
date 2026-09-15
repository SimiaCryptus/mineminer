const KEY = 'mineminer.settings';
const VERSION = 6;

/** value -> label. A "life" is a mistake (misfire or detonation) you survive. */
export const LIVES_OPTIONS = [
    ['1', '1 · no mistakes'],
    ['2', '2 · 1 mistake forgiven'],
    ['3', '3 · 2 mistakes forgiven'],
    ['5', '5 · 4 mistakes forgiven'],
    ['inf', '∞ (Zen)'],
];
/**
 * value -> label. A quantum life pays for one collapse (a quantum flag or a graced
 * strike). They are spent before the classical lives; at 0 the vault is classical.
 */
export const QUANTUM_LIVES_OPTIONS = [
    ['0', '0 · off, classic guessing'],
    ['1', '1 collapse'],
    ['2', '2 collapses'],
    ['3', '3 collapses'],
    ['5', '5 collapses'],
    ['inf', '∞ · never guess'],
];


export const DEFAULT_SETTINGS = Object.freeze({
    version: VERSION,
    cascade: 'on', // 'on' | 'off' | 'single-layer'
    // Face neighbours always count as 1. Edge (12) and corner (8) neighbours are
    // weighted 1 | 0.5 | 0 when summing a block's proximity number.
    edgeWeight: 1,
    cornerWeight: 1,
    // Number of mistakes the run survives. '2' = the first misfire/detonation is forgiven.
    lives: '2', // '1' | '2' | '3' | '5' | 'inf'
    safeFirstStrike: true,
    strictMarks: true,
    undo: true,
    // Quantum grace (quantum_grace.md), measured in collapses the run may spend:
    // '0' | '1' | '2' | '3' | '5' | 'inf'. Marking an ambiguous block crystallises a mine
    // there (quantum flag), striking one is repaired to be safe (strike grace); either
    // costs one quantum life. They run out before the classical lives are touched.
    quantumLives: 'inf',
    // Numbers whose neighbourhood is fully resolved stop being drawn.
    hideSatisfied: true,
    effects: 'med', // 'low' | 'med' | 'high'
    volume: 0.6,
    colourblind: false,
    reducedMotion: false,
});

export function loadSettings() {
    try {
        const raw = globalThis.localStorage?.getItem(KEY);
        if (!raw) return {...DEFAULT_SETTINGS};
        const parsed = JSON.parse(raw);
        if (parsed.version !== VERSION) return {...DEFAULT_SETTINGS};
        return {...DEFAULT_SETTINGS, ...parsed};
    } catch {
        return {...DEFAULT_SETTINGS};
    }
}

export function saveSettings(settings) {
    try {
        globalThis.localStorage?.setItem(KEY, JSON.stringify({...settings, version: VERSION}));
    } catch {
        /* storage unavailable */
    }
}

export function livesFromSetting(value) {
    if (value === 'inf' || value === Infinity) return Infinity;
    return Number(value) || 1;
}

/** Like livesFromSetting, but 0 is a legal (and meaningful) value: grace off. */
export function quantumLivesFromSetting(value) {
    if (value === 'inf' || value === Infinity) return Infinity;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Infinity;
}

/** Settings -> Grid adjacency-weight spec (Grid quantises to 0 / 0.5 / 1). */
export function weightsFromSettings(s) {
    return {face: 1, edge: s.edgeWeight, corner: s.cornerWeight};
}

/** Short human label, e.g. "6 + 12(½)" for the HUD / hints. */
export function adjacencyLabel(weights) {
    const part = (n, w) => (w === 0 ? null : w === 1 ? `${n}` : `${n}(½)`);
    return [part(6, weights.face), part(12, weights.edge), part(8, weights.corner)]
        .filter(Boolean)
        .join(' + ');
}