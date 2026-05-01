import { Vibrant } from "node-vibrant/browser";

const LIGHTNESS_FLOOR = 0.62;
const SATURATION_FLOOR = 0.35;

export async function extractGlowColor(img: HTMLImageElement): Promise<string | null> {
  const palette = await Vibrant.from(img).getPalette();
  const swatch = palette.Vibrant ?? palette.LightVibrant ?? palette.Muted ?? palette.LightMuted;
  if (!swatch) return null;
  const [h, s, l] = swatch.hsl;
  const lifted = liftForDarkUi(h, s, l);
  return `rgb(${lifted[0]}, ${lifted[1]}, ${lifted[2]})`;
}

function liftForDarkUi(h: number, s: number, l: number): [number, number, number] {
  const liftedL = Math.max(l, LIGHTNESS_FLOOR);
  const liftedS = Math.max(s, SATURATION_FLOOR);
  return hslToRgb(h, liftedS, liftedL);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

function hueToRgb(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}
