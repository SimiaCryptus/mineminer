Done:

- The levels dialog and the preselectable levels are gone. The vault (cell shape, width,
  depth, height, mines, seed) is configured in the main settings menu and dug from there.
- Corner-adjacent indicator scoring defaults to 0.5.
- The default vault is 8×8×8 with 30 mines.
- Non-cubic spatial tessellations: hexagonal prisms, rhombic dodecahedra and truncated
  octahedra (see `src/game/Tessellation.js`).
- `themes.css` (the solved Point-CAD palette pack) is wired in:
   * `index.html` loads it before the stylesheets and restores the saved strand inline,
     before first paint, so there is no flash of the default vault.
   * `styles/main.css` keeps the old `--bg/--fg/--accent/...` aliases but they now read
     `--color-*` tokens (with the original literals as fallbacks). `hud.css` uses
     `color-mix()` for the five translucent plates. No other file mentions a colour.
   * `src/render/cssColour.js` converts a resolved `oklch()` token to `0xrrggbb` through a
     1×1 canvas, and `SceneRig.applyTheme()` uses it for the scene background, fog, the
     warm point light, the hemisphere light and the vault's steel tint.
   * Selector UI: a grouped dropdown in *Settings › Display*, the 🎨 HUD button, and
     `T` / `Shift+T` to cycle. The choice is persisted as `settings.theme`; `auto` removes
     `data-theme` so `:root` + `prefers-color-scheme` decide.
Known issue (palette, not plumbing): several tokens in the generated `themes.css` are
degenerate — negative lightness or wildly out-of-gamut chroma, e.g.
`--color-surface-hover` in most dark strands, and `--color-text-muted` in `marrakech`.
CSS clamps those, so the affected element renders black/over-saturated rather than
breaking, but the strands want re-solving: open `styles/theme_design.html`, press
*Solve themes*, check for `0 unmet` per theme and *Save CSS* over `themes.css`.
Digit colours (`src/render/DigitAtlas.js`) are deliberately still the classic
Minesweeper ramp and do not follow the theme.