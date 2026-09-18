import { getTessellation } from './Tessellation.js';

export const CUSTOM_LIMITS = { min: 3, max: 40 };

/** The vault you get when nothing else has been chosen. */
export const DEFAULT_LEVEL = Object.freeze({ w: 8, d: 8, h: 8, mines: 30, tess: 'cubic' });

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Sanitises a board spec so it is always playable. */
export function customLevel({ w, d, h, mines, tess } = {}) {
  const width = clamp(
    Math.round(Number(w) || DEFAULT_LEVEL.w),
    CUSTOM_LIMITS.min,
    CUSTOM_LIMITS.max
  );
  const depth = clamp(Math.round(Number(d) || width), CUSTOM_LIMITS.min, CUSTOM_LIMITS.max);
  const height = clamp(Math.round(Number(h) || DEFAULT_LEVEL.h), 1, CUSTOM_LIMITS.max);
  const cells = width * depth * height;
  // Keep mineCount + 27 <= cellCount where possible so safe-first-strike can always relocate.
  const maxMines = Math.max(1, Math.min(cells - 28, cells - 1));
  const wanted =
    Number(mines) ||
    Math.round(
      (cells * DEFAULT_LEVEL.mines) / (DEFAULT_LEVEL.w * DEFAULT_LEVEL.d * DEFAULT_LEVEL.h)
    );
  const mineCount = clamp(Math.round(wanted), 1, maxMines);
  const tessellation = getTessellation(tess);
  return {
    id: `${tessellation.id}-${width}x${depth}x${height}-${mineCount}`,
    name: `${tessellation.name} ${width}×${depth}×${height}`,
    w: width,
    d: depth,
    h: height,
    mines: mineCount,
    tess: tessellation.id,
    // Rough par: a bit over half a second per safe block plus two per mine.
    par: Math.round(0.6 * (cells - mineCount) + 2 * mineCount),
    custom: true,
  };
}
