/**
 * The domain, such as it is.
 *
 * The app answers one question — what is this dish, and is it a problem for
 * me — so there are only two things worth naming: the allergens somebody
 * avoids, and the shape of an error.
 */

/* -------------------------------------------------------------------------- */
/*  Allergens                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The fourteen the EU requires a restaurant to declare, which is a superset of
 * the US "big nine". Ordered by how often they come up rather than
 * alphabetically, because this list is rendered as a set of switches and the
 * one somebody is looking for should be near the top.
 */
export const ALLERGEN_KEYS = [
  "peanuts",
  "tree_nuts",
  "dairy",
  "eggs",
  "gluten",
  "soy",
  "fish",
  "shellfish",
  "sesame",
  "mustard",
  "celery",
  "lupin",
  "molluscs",
  "sulphites",
] as const;

export type AllergenKey = (typeof ALLERGEN_KEYS)[number];

export interface Allergen {
  key: AllergenKey;
  label: string;
  /** What it hides in, so somebody can recognise it on an unfamiliar menu. */
  description: string;
}

/**
 * What somebody avoids.
 *
 * Held only in their own browser and never sent anywhere. It is health data,
 * and the app has no account to attach it to and no reason to want it.
 */
export interface AllergenProfile {
  avoid: AllergenKey[];
}

/** Which part of a meal a dish belongs to. */
export type MenuCategory =
  | "starters"
  | "mains"
  | "sides"
  | "desserts"
  | "drinks";

/* -------------------------------------------------------------------------- */
/*  API                                                                        */
/* -------------------------------------------------------------------------- */

export interface ApiError {
  error: {
    code: string;
    /** Written for whoever is holding the phone, not for a log. */
    message: string;
  };
}
