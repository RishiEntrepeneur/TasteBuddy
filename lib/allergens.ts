import {
  ALLERGEN_KEYS,
  type Allergen,
  type AllergenKey,
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
