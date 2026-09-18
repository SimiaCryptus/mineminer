const KEY = 'mineminer.settings';
const VERSION = 7;

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
/**
  * The themes defined in themes.css, grouped for the selector. 'auto' means "no
  * data-theme attribute": :root (dark) plus the prefers-color-scheme block win.
  */
export const THEME_GROUPS = Object.freeze([
     ['Core', [
         ['auto', 'Follow system'],
         ['dark', 'Vault dark · default'],
         ['light', 'Vault light'],
     ]],
     ['Dark strands', [
         ['ukiyoe', 'Ukiyo-e · indigo nightfall'],
         ['kente', 'Kente · black cloth and gold'],
         ['marrakech', 'Marrakech · Majorelle blue'],
         ['isfahan', 'Isfahan · turquoise tilework'],
         ['byzantium', 'Byzantium · porphyry and mosaic'],
         ['nile', 'Nile · lapis and beaten gold'],
         ['aurora', 'Aurora · polar night'],
         ['paua', 'Pāua · shell teal and violet'],
         ['dreamtime', 'Dreamtime · ochre and charcoal'],
         ['andes', 'Andes · alpaca reds'],
         ['amazonia', 'Amazonia · canopy and macaw'],
         ['khokhloma', 'Khokhloma · lacquer and vermilion'],
         ['obangsaek', 'Obangsaek · five colours over ink'],
         ['peatfire', 'Peat fire · smoke and copper'],
         ['highland', 'Highland · bottle green sett'],
         ['batik', 'Batik · soga brown on indigo'],
         ['vaporwave', 'Vaporwave · mall neon'],
         ['voidsong', 'Voidsong · eldritch violet'],
         ['cyberdeck', 'Cyberdeck · phosphor green'],
         ['ironforge', 'Ironforge · basalt and lava'],
         ['nebula', 'Nebula · dust and ion teal'],
     ]],
     ['Light strands', [
         ['sakura', 'Sakura · washi and late plum'],
         ['azulejo', 'Azulejo · whitewash and cobalt'],
         ['talavera', 'Talavera · clay and marigold'],
         ['marigold', 'Marigold · garlands on sari pink'],
         ['aegean', 'Aegean · lime-wash and deep blue'],
         ['sapmi', 'Sápmi · snowfield gákti'],
         ['ndebele', 'Ndebele · whitewash outlined'],
         ['porcelain', 'Porcelain · qinghua blue'],
         ['cochineal', 'Cochineal · agave linen'],
         ['solarpunk', 'Solarpunk · living walls and brass'],
         ['lothlorien', 'Lothlórien · mallorn gold'],
         ['spice', 'Spice · desert glare'],
     ]],
]);
/** Flat id list, in selector order — used for cycling with the T key. */
export const THEMES = Object.freeze(THEME_GROUPS.flatMap(([, list]) => list.map(([id]) => id)));



export const DEFAULT_SETTINGS = Object.freeze({
    version: VERSION,
    // The vault: cell shape and size. Dug on demand from the settings panel.
    tessellation: 'cubic', // 'cubic' | 'hex' | 'fcc' | 'bcc' (see game/Tessellation.js)
    boardW: 8,
    boardD: 8,
    boardH: 8,
    boardMines: 30,
    cascade: 'on', // 'on' | 'off' | 'single-layer'
    // Face neighbours always count as 1. Edge- and corner-touching neighbours are
    // weighted 1 | 0.5 | 0 when summing a block's proximity number.
    edgeWeight: 1,
    cornerWeight: 0.5,
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
     // Colour theme: an id from themes.css, or 'auto' to follow the OS preference.
     theme: 'dark',
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
/** Unknown / missing ids fall back to 'auto'. */
export function themeFromSetting(value) {
     return THEMES.includes(value) ? value : 'auto';
}
/** Human label for a theme id (for the HUD flash). */
export function themeLabel(value) {
     for (const [, list] of THEME_GROUPS) {
         for (const [id, label] of list) if (id === value) return label;
     }
     return String(value);
}
/**
  * Writes the chosen theme onto <html>. themes.css then supplies every --color-*
  * token; 'auto' removes the attribute so :root plus the prefers-color-scheme block
  * decide. Returns the id actually applied.
  */
export function applyTheme(value) {
     const id = themeFromSetting(value);
     const root = globalThis.document?.documentElement;
     if (!root) return id;
     if (id === 'auto') root.removeAttribute('data-theme');
     else root.dataset.theme = id;
     return id;
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

/** Settings -> the board spec fields understood by customLevel(). */
export function boardFromSettings(s) {
    return {w: s.boardW, d: s.boardD, h: s.boardH, mines: s.boardMines, tess: s.tessellation};
}

/** Short human label, e.g. "6 + 12(½)" for the HUD / hints. */
export function adjacencyLabel(weights, classes = {face: 6, edge: 12, corner: 8}) {
    const part = (n, w) => (n === 0 || w === 0 ? null : w === 1 ? `${n}` : `${n}(½)`);
    return [part(classes.face, weights.face), part(classes.edge, weights.edge), part(classes.corner, weights.corner)]
        .filter(Boolean)
        .join(' + ');
}