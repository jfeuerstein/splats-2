// The district palette: 16 colours. Every on-screen pixel is one of these (the post pass
// decodes a palette index per pixel; it never quantises arbitrary RGB).

export const PALETTE_HEX = [
  0xf4efe6, // 0 lit plaster
  0xe3dccf, // 1 mid
  0xc9c6c4, // 2 shade
  0xa9aab3, // 3 windows / deep shade
  0xbfe3ee, // 4 sky light
  0x8fcbe6, // 5 sky
  0xd9623b, // 6 terracotta
  0xf0a23a, // 7 orange
  0xf7d354, // 8 yellow
  0x5fb56a, // 9 green
  0x2f9c95, // 10 teal
  0x3b6fc4, // 11 blue
  0x2b2a4a, // 12 indigo (darkest)
  0xe0568c, // 13 pink
  0x8a4a3c, // 14 brown
  0xffffff, // 15 white
] as const;

export const enum C {
  Lit = 0, Mid = 1, Shade = 2, Deep = 3, SkyLight = 4, Sky = 5,
  Terracotta = 6, Orange = 7, Yellow = 8, Green = 9, Teal = 10, Blue = 11,
  Indigo = 12, Pink = 13, Brown = 14, White = 15,
}

/** sRGB bytes, 16 x [r, g, b]. */
export const PALETTE_RGB: readonly (readonly [number, number, number])[] = PALETTE_HEX.map(
  (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255] as const,
);

/** Flat Float32Array of 16 sRGB colours in 0..1 (for shader uniforms). */
export function paletteFloats(): Float32Array {
  const f = new Float32Array(48);
  PALETTE_RGB.forEach((c, i) => { f[i * 3] = c[0] / 255; f[i * 3 + 1] = c[1] / 255; f[i * 3 + 2] = c[2] / 255; });
  return f;
}

/** Nearest palette index for an sRGB byte colour (tools / tests). */
export function nearestIndex(r: number, g: number, b: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 16; i++) {
    const c = PALETTE_RGB[i];
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Hue families for painted buildings: [lit, mid, shade]. */
export const FAMILIES: readonly (readonly [number, number, number])[] = [
  [C.Yellow, C.Orange, C.Terracotta],
  [C.Orange, C.Terracotta, C.Brown],
  [C.Green, C.Teal, C.Blue],
  [C.Teal, C.Blue, C.Indigo],
  [C.Green, C.Teal, C.Indigo],
  [C.Yellow, C.Green, C.Teal],
  [C.Pink, C.Terracotta, C.Brown],
];

/** Family for a lot tint, and a contrasting family for its roof. */
export function wallFamily(tint: number): readonly [number, number, number] {
  return FAMILIES[tint % FAMILIES.length];
}
export function roofFamily(tint: number): readonly [number, number, number] {
  return FAMILIES[(tint % FAMILIES.length + 3) % FAMILIES.length];
}
/** Window colour for a family: indigo unless the family already uses it. */
export function windowColour(f: readonly number[]): number {
  if (!f.includes(C.Indigo)) return C.Indigo;
  return f.includes(C.Blue) ? C.Brown : C.Blue;
}
