// Weather icons drawn by us (inline SVG), so a sunny day looks the same on every phone. The emoji they replace are drawn
// by each phone maker in a different style, size and colour. Pure functions, no DOM; the output is a trusted string that
// only this file builds (never user text), so it is safe to put in innerHTML.
//
// wxIcon(code, isDay) -> '<svg ...>' for a WMO weather code (the numbers Open-Meteo / RIMES use).
// Colours are flat and sit well on both the dark weather band and the light cards: clouds have a thin outline.

const SUN = "#ffcc3d", SUN_EDGE = "#f0a30a", MOON = "#f6e9b0", MOON_EDGE = "#d8c46c";
const CLOUD = "#f1f6f9", CLOUD_EDGE = "#8fa8b8", GREY = "#c5d2db", GREY_EDGE = "#7b93a4", DARK = "#9fb0bd", DARK_EDGE = "#5f7385";
const RAIN = "#3fa9ec", SNOW = "#d6ecfa", BOLT = "#ffd22e", BOLT_EDGE = "#e09c00", FOG = "#b4c4cd";
const CLOUD_PATH = "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z";   // 22 x 18 units, scaled with a transform

const cloud = (x, y, s, fill = CLOUD, edge = CLOUD_EDGE) =>
  `<path d="${CLOUD_PATH}" transform="translate(${x} ${y}) scale(${s})" fill="${fill}" stroke="${edge}" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;

const sun = (cx, cy, r) => {
  let rays = "";
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
    rays += `M${(cx + c * (r + 4)).toFixed(1)} ${(cy + s * (r + 4)).toFixed(1)}L${(cx + c * (r + 8)).toFixed(1)} ${(cy + s * (r + 8)).toFixed(1)}`;
  }
  return `<path d="${rays}" stroke="${SUN}" stroke-width="3.2" stroke-linecap="round" fill="none"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}" stroke="${SUN_EDGE}" stroke-width="1.5"/>`;
};

const moon = (cx, cy, r) => {
  // a crescent: a full disc minus a shifted disc, drawn as one path
  const k = r * 0.62;
  return `<path d="M${cx + r * 0.2} ${cy - r}A${r} ${r} 0 1 0 ${cx + r * 0.2} ${cy + r}A${r + k} ${r + k} 0 0 1 ${cx + r * 0.2} ${cy - r}z" fill="${MOON}" stroke="${MOON_EDGE}" stroke-width="1.5" stroke-linejoin="round"/>`;
};

const drops = (list, w = 3.4) =>
  `<path d="${list.map(([x, y, l]) => `M${x} ${y}l-2.4 ${l}`).join("")}" stroke="${RAIN}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;

const flakes = list =>
  list.map(([x, y]) => `<path d="M${x} ${y - 3.2}v6.4M${x - 2.8} ${y - 1.6}l5.6 3.2M${x + 2.8} ${y - 1.6}l-5.6 3.2" stroke="${SNOW}" stroke-width="1.7" stroke-linecap="round" fill="none"/>`).join("");

const bolt = (x, y) =>
  `<path d="M${x + 6} ${y}l-9 13h6l-3 10 11-14h-6l4-9z" fill="${BOLT}" stroke="${BOLT_EDGE}" stroke-width="1.4" stroke-linejoin="round"/>`;

const fogLines = () =>
  `<path d="M12 49h40M17 55h30M12 61h38" stroke="${FOG}" stroke-width="3.2" stroke-linecap="round" fill="none"/>`;

const body = (code, day) => {
  const star = day ? sun(32, 32, 12) : moon(32, 32, 14);
  switch (true) {
    case code === 0: return day ? sun(32, 32, 13) : moon(32, 32, 16);
    case code === 1: return (day ? sun(24, 24, 10) : moon(24, 24, 12)) + cloud(21, 24, 1.8);
    case code === 2: return (day ? sun(24, 22, 10) : moon(24, 22, 12)) + cloud(13, 20, 2.1);
    case code === 3: return cloud(2, 2, 1.9, GREY, GREY_EDGE) + cloud(11, 16, 2.15);
    case code === 45 || code === 48: return cloud(8, 3, 2.2) + fogLines().replace('d="M12 49h40M17 55h30M12 61h38"', 'd="M10 49h44M16 55h32M10 61h40"');
    case [51, 53, 55, 56, 57].includes(code): {
      const heavy = code === 55 || code === 57;
      return cloud(6, 2, 2.2) + drops(heavy ? [[24, 50, 7], [33, 50, 7], [42, 50, 7]] : [[27, 50, 6], [38, 50, 6]], 3);
    }
    case [61, 66].includes(code): return cloud(6, 2, 2.2, GREY, GREY_EDGE) + drops([[22, 49, 8], [33, 49, 8], [44, 49, 8]]);
    case [63, 67].includes(code): return cloud(6, 2, 2.2, GREY, GREY_EDGE) + drops([[20, 48, 9], [29, 51, 9], [38, 48, 9], [47, 51, 9]]);
    case code === 65: return cloud(6, 1, 2.2, DARK, DARK_EDGE) + drops([[18, 47, 11], [26, 50, 11], [34, 47, 11], [42, 50, 11], [50, 47, 11]]);
    case code === 80: return (day ? sun(23, 21, 9) : moon(23, 21, 11)) + cloud(12, 17, 2.0) + drops([[24, 52, 6], [34, 52, 6], [44, 52, 6]], 3);
    case code === 81: return cloud(6, 2, 2.2, GREY, GREY_EDGE) + drops([[20, 48, 9], [29, 51, 9], [38, 48, 9], [47, 51, 9]]);
    case code === 82: return cloud(6, 1, 2.2, DARK, DARK_EDGE) + drops([[18, 47, 11], [26, 50, 11], [34, 47, 11], [42, 50, 11], [50, 47, 11]]);
    case [71, 73, 75, 77, 85, 86].includes(code): return cloud(6, 2, 2.2, GREY, GREY_EDGE) + flakes([[22, 52], [32, 56], [42, 52]]);
    case [95, 96, 99].includes(code): return cloud(6, 0, 2.2, DARK, DARK_EDGE) + bolt(26, 38) + (code === 95 ? "" : drops([[19, 49, 8], [46, 49, 8]], 3));
    default: return star + cloud(21, 26, 1.7);
  }
};

/** An inline SVG (64 x 64) for a WMO weather code. `isDay` false draws a moon instead of the sun. */
export function wxIcon(code, isDay = true) {
  const c = Number(code);
  return `<svg class="wxi" viewBox="0 0 64 64" width="1em" height="1em" aria-hidden="true" focusable="false">${body(Number.isFinite(c) ? c : -1, isDay !== false)}</svg>`;
}

/** Local hour (0-23) of a "YYYY-MM-DDTHH:MM" wall-clock string, or NaN. Used to pick the sun or the moon for an hourly icon. */
export function isDayAtLocal(iso) {
  const h = Number(String(iso || "").slice(11, 13));
  return Number.isFinite(h) ? h >= 6 && h < 18 : true;
}
