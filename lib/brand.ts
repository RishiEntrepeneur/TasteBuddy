/**
 * Measuring whether text can be read on a colour.
 *
 * Every colour in `lib/palette.ts` has words drawn on it or in it, and two of
 * them carry allergen warnings. "It looks fine on my screen" is not a
 * measurement, so `scripts/verify-brand-contrast.ts` runs these numbers on
 * every one of them.
 *
 * WCAG 2.1 relative luminance and contrast ratio.
 */

/** The two foregrounds anything in this app is ever drawn in. */
export const BRAND_INK = "#1c1917";
export const BRAND_PAPER = "#ffffff";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parses `#rgb` and `#rrggbb`. Null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const text = hex.trim().replace(/^#/, "");
  const full =
    text.length === 3
      ? text
          .split("")
          .map((c) => c + c)
          .join("")
      : text;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 to 21. Null if either is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The best contrast a colour can manage against either foreground the app
 * actually uses. Measured against obsidian rather than pure black, because
 * obsidian is what gets drawn.
 */
export function bestContrast(background: string): number {
  return Math.max(
    contrastRatio(background, BRAND_INK) ?? 0,
    contrastRatio(background, BRAND_PAPER) ?? 0,
  );
}

/** Whichever of the two has more contrast against a fill. */
export function readableInk(background: string): string {
  const onInk = contrastRatio(background, BRAND_INK);
  const onPaper = contrastRatio(background, BRAND_PAPER);
  if (onInk === null || onPaper === null) return BRAND_INK;
  return onInk >= onPaper ? BRAND_INK : BRAND_PAPER;
}

/** Whether a colour can carry body-sized text at all (AA is 4.5:1). */
export function canCarryText(background: string): boolean {
  return bestContrast(background) >= 4.5;
}
