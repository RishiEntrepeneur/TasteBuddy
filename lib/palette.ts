/**
 * The colours anything meaningful is drawn in.
 *
 * Kept out of the stylesheet so the contrast between each of these and the
 * text that sits on it can be measured in a test rather than eyeballed. The
 * CSS in `app/globals.css` holds the same values; this file is what
 * `scripts/verify-brand-contrast.ts` reads.
 *
 * Only the colours that carry text are here. Backgrounds, hairlines and the
 * card ground have nothing written on them and nothing to prove.
 */
export const PALETTE = {
  /** Type, and the fill under the primary action. */
  ink: "#15181a",
  /** No clash with your profile. */
  safe: "#2f6b45",
  /** A clash, and nothing else, ever. */
  alert: "#a8321f",
  /** Worth a look but not an alarm. */
  caution: "#8a5a12",
} as const;

export type PaletteName = keyof typeof PALETTE;
