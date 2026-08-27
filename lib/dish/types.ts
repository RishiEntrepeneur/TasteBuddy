import type { AllergenKey, MenuCategory } from "@/lib/types";

/**
 * What the app can tell a diner about a dish.
 *
 * ── Why this is allowed to guess, when the restaurant side is not ──────────
 *
 * `lib/vision/menu-reader.ts` refuses to say anything about allergens, and
 * that is still right: it feeds a restaurant's published menu, where a guess
 * would arrive at a diner wearing the venue's authority.
 *
 * This module answers a different question. A diner standing in front of a
 * menu they cannot read is asking "what is này?", and the honest, useful
 * answer to "what is pad thai" includes "it is normally made with peanuts".
 * Refusing to say that would not make anyone safer; it would send someone with
 * a peanut allergy to order it blind.
 *
 * So the guess is allowed, and the whole shape of it is built to stay a guess:
 *
 *   `likelihood` is "usually" or "sometimes", never "contains". The app has no
 *   word for certainty about a kitchen it has never seen.
 *
 *   `from` names which part of the dish carries it, because "the peanut sauce"
 *   is something a diner can actually ask about, and "peanuts" is not.
 *
 *   `recognised` is false when the model does not actually know the dish, so
 *   the app can say so instead of inventing a plausible description.
 *
 * The interface deliberately has no field that means "this dish is safe".
 */

export type Likelihood = "usually" | "sometimes";

export interface LikelyAllergen {
  key: AllergenKey;
  likelihood: Likelihood;
  /** The part of the dish it comes from, e.g. "the peanut sauce". */
  from: string;
}

export type Dietary = "meat" | "fish" | "vegetarian" | "vegan" | "varies";
export type SpiceLevel = "none" | "mild" | "medium" | "hot" | "varies";

/** A dish as it appears in a list, read off a photographed menu. */
export interface DishSummary {
  /** Exactly as printed, in the menu's own language and spelling. */
  printedName: string;
  /** What it is called in English. Empty when the printed name already is. */
  englishName: string;
  /** One sentence a hungry person can read at a glance. */
  oneLine: string;
  /** As printed, e.g. "€14,50". Empty when the menu shows none. */
  priceText: string;
  course: MenuCategory;
  dietary: Dietary;
  spice: SpiceLevel;
  likelyAllergens: LikelyAllergen[];
  /** False when the model does not actually know this dish. */
  recognised: boolean;
}

/** Everything the app can say about one dish. */
export interface DishExplanation extends DishSummary {
  /** Two or three sentences: what arrives, and what it is made of. */
  whatItIs: string;
  /** Flavour and texture, in words a twelve-year-old would use. */
  tastesLike: string;
  /** Where the dish is from. Empty when it has no particular home. */
  origin: string;
  /** The main things in it, five or six at most. */
  madeWith: string[];
  /** How it usually turns up: "a shared bowl", "on a skewer". */
  servedAs: string;
}

export interface MenuReading {
  /** The language the menu is written in, in English, e.g. "Vietnamese". */
  language: string;
  /** False when the photo is not a menu at all. */
  looksLikeMenu: boolean;
  dishes: DishSummary[];
  /** Whole-photo problems: glare, a cut-off column, handwriting. */
  notes: string[];
}
