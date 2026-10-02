/**
 * The themes defined in themes.css, grouped for the selector. 'auto' means "no
 * data-theme attribute": :root (dark) plus the prefers-color-scheme block win.
 */
export const THEME_GROUPS = Object.freeze([
  [
    'Core',
    [
      ['auto', 'Follow system'],
      ['dark', 'Vault dark · default'],
      ['light', 'Vault light'],
    ],
  ],
  [
    'Dark strands',
    [
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
    ],
  ],
  [
    'Light strands',
    [
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
    ],
  ],
]);

/** Flat id list, in selector order — used for cycling with the T key. */
export const THEMES = Object.freeze(THEME_GROUPS.flatMap(([, list]) => list.map(([id]) => id)));

export const LIGHT_THEMES = Object.freeze(
  new Set([
    'light',
    ...(THEME_GROUPS.find(([name]) => name === 'Light strands')?.[1].map(([id]) => id) ?? []),
  ])
);

export function isLightTheme(id) {
  return LIGHT_THEMES.has(id);
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
 * decide. Sets color-scheme so form controls and scrollbars match light/dark strands.
 * Returns the id actually applied.
 */
export function applyTheme(value) {
  const id = themeFromSetting(value);
  const root = globalThis.document?.documentElement;
  if (!root) return id;
  if (id === 'auto') {
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
  } else {
    root.dataset.theme = id;
    root.style.colorScheme = isLightTheme(id) ? 'light dark' : 'dark light';
  }
  return id;
}