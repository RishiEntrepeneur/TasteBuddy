import {
  ALLERGEN_KEYS,
  type Allergen,
  type AllergenKey,
  type AllergenProfile,
  type AllergenSeverity,
  type MenuItemAllergen,
} from "@/lib/types";

/** Consumer-facing copy for every allergen we track. */
export const ALLERGEN_CATALOG: Readonly<Record<AllergenKey, Allergen>> = {
  peanuts: {
    key: "peanuts",
    label: "Peanuts",
    description: "Groundnuts, peanut oil, satay and peanut flour.",
  },
  tree_nuts: {
    key: "tree_nuts",
    label: "Tree nuts",
    description: "Almond, cashew, walnut, pecan, pistachio, hazelnut.",
  },
  dairy: {
    key: "dairy",
    label: "Dairy",
    description: "Milk, butter, cream, cheese, yoghurt, whey and casein.",
  },
  eggs: {
    key: "eggs",
    label: "Eggs",
    description: "Whole egg, albumen, mayonnaise and egg wash.",
  },
  gluten: {
    key: "gluten",
    label: "Gluten",
    description: "Wheat, barley, rye, spelt and malt.",
  },
  soy: {
    key: "soy",
    label: "Soy",
    description: "Soybean, tofu, edamame, miso and soy sauce.",
  },
  fish: {
    key: "fish",
    label: "Fish",
    description: "Finned fish, fish sauce, anchovy and bonito.",
  },
  shellfish: {
    key: "shellfish",
    label: "Shellfish",
    description: "Prawn, crab, lobster, crayfish and shrimp paste.",
  },
  sesame: {
    key: "sesame",
    label: "Sesame",
    description: "Sesame seed, tahini and sesame oil.",
  },
  mustard: {
    key: "mustard",
    label: "Mustard",
    description: "Mustard seed, powder and prepared mustard.",
  },
  celery: {
    key: "celery",
    label: "Celery",
    description: "Celery stalk, celeriac, leaves and celery salt.",
  },
  lupin: {
    key: "lupin",
    label: "Lupin",
    description: "Lupin flour and lupin seeds in baked goods.",
  },
  molluscs: {
    key: "molluscs",
    label: "Molluscs",
    description: "Mussel, clam, oyster, squid and octopus.",
  },
  sulphites: {
    key: "sulphites",
    label: "Sulphites",
    description:
      "Preservatives above 10 mg/kg, common in wine and dried fruit.",
  },
};

export const ALLERGEN_LIST: readonly Allergen[] = ALLERGEN_KEYS.map(
  (key) => ALLERGEN_CATALOG[key],
);

/** Narrowing type guard used when parsing untrusted query strings. */
export function isAllergenKey(value: string): value is AllergenKey {
  return (ALLERGEN_KEYS as readonly string[]).includes(value);
}

/**
 * Parses a comma-separated allergen list (`?allergens=peanuts,dairy`).
 * Unknown tokens are dropped rather than rejected so a stale client link keeps
 * working after we rename a slug.
 */
export function parseAllergenKeys(raw: string | null): AllergenKey[] {
  if (!raw) return [];
  const seen = new Set<AllergenKey>();
  for (const token of raw.split(",")) {
    const normalised = token.trim().toLowerCase();
    if (isAllergenKey(normalised)) seen.add(normalised);
  }
  return [...seen];
}

/**
 * Decides whether a dish's allergen entry conflicts with the diner's profile.
 *
 * - `contains` always conflicts.
 * - `may_contain` conflicts only in strict mode (the default).
 * - `removable` never hard-conflicts; it is surfaced as an advisory instead.
 */
export function severityConflicts(
  severity: AllergenSeverity,
  strict: boolean,
): boolean {
  if (severity === "contains") return true;
  if (severity === "may_contain") return strict;
  return false;
}

export function describeSeverity(severity: AllergenSeverity): string {
  switch (severity) {
    case "contains":
      return "Contains";
    case "may_contain":
      return "May contain";
    case "removable":
      return "Can be served without";
  }
}

/** Every allergen on the dish that the diner has asked to avoid. */
export function matchProfile(
  itemAllergens: readonly MenuItemAllergen[],
  profile: AllergenProfile,
): MenuItemAllergen[] {
  if (profile.avoid.length === 0) return [];
  const avoid = new Set(profile.avoid);
  return itemAllergens.filter((entry) => avoid.has(entry.key));
}
