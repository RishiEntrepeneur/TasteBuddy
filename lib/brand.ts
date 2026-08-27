/**
 * Reading text on a venue's own colours.
 *
 * Branding is data: each restaurant sets a primary and an accent, and neither
 * this code nor the designer gets to see them in advance. Hard-coding white
 * text on top of whatever arrives is how a venue with a mid-tone accent ends
 * up with a menu button nobody can read. Every foreground over a brand colour
 * is chosen here instead, by measuring.
 *
 * WCAG 2.1 relative luminance and contrast ratio, which is the same maths the
 * allergen palette was checked against.
 */

const INK = "#1c1917";
const PAPER = "#ffffff";

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parses `#rgb` and `#rrggbb`. Returns null for anything else. */
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
 * The readable foreground for a brand background: obsidian or white,
 * whichever has more contrast against it.
 *
 * Note what this does not do: it never rejects a venue's colour. A brand that
 * fails both is a brand nobody should set text on at all, and the caller's job
 * is then to keep the colour as a border or a mark rather than a fill.
 */
export function readableInk(background: string): string {
  const onInk = contrastRatio(background, INK);
  const onPaper = contrastRatio(background, PAPER);
  if (onInk === null || onPaper === null) return INK;
  return onInk >= onPaper ? INK : PAPER;
}

/** Whether a brand colour can carry body-sized text at all (AA is 4.5:1). */
export function canCarryText(background: string): boolean {
  const best = Math.max(
    contrastRatio(background, INK) ?? 0,
    contrastRatio(background, PAPER) ?? 0,
  );
  return best >= 4.5;
}
