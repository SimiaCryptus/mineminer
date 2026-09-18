// Bridge between the CSS palette (themes.css) and three.js.
//
// The tokens are written in oklch(), which THREE.Color cannot parse, and
// getComputedStyle returns custom properties verbatim rather than resolved. So we
// let the browser do the conversion: paint one pixel on a 1×1 canvas and read it
// back as sRGB bytes.

const probe = globalThis.document?.createElement?.('canvas') ?? null;
if (probe) probe.width = probe.height = 1;
const ctx = probe?.getContext?.('2d', { willReadFrequently: true }) ?? null;

/** Any CSS colour string -> 0xrrggbb, or `fallback` when the browser cannot parse it. */
export function cssColourToHex(value, fallback = 0x000000) {
  const text = String(value ?? '').trim();
  if (!ctx || !text) return fallback;
  // fillStyle keeps its previous value when handed something unparseable, so two
  // different sentinels tell "invalid" apart from "legitimately that colour".
  ctx.fillStyle = '#000000';
  ctx.fillStyle = text;
  const a = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = text;
  if (ctx.fillStyle !== a) return fallback;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return (r << 16) | (g << 8) | b;
  } catch {
    return fallback;
  }
}

/** Value of a custom property on <html>, as 0xrrggbb. */
export function themeColour(name, fallback = 0x000000) {
  if (typeof globalThis.getComputedStyle !== 'function') return fallback;
  const root = globalThis.document.documentElement;
  return cssColourToHex(getComputedStyle(root).getPropertyValue(name), fallback);
}
