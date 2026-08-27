import {
  DEFAULT_PORTION_RANGE,
  type AllergenKey,
  type Asset3D,
  type IngredientCategory,
  type MenuItem,
  type MenuItemIngredient,
  type Restaurant,
} from "@/lib/types";

/**
 * Demo dataset.
 *
 * Used whenever `DATABASE_URL` is unset — local development, preview builds and
 * CI all run against this instead of a live Postgres instance, so `npm run dev`
 * works with zero infrastructure. Production sets `DATABASE_URL` and the
 * repository transparently switches to `lib/db/postgres.ts`.
 */

const CDN = process.env.NEXT_PUBLIC_ASSET_CDN_URL ?? "/assets";

function asset(
  menuItemId: string,
  slug: string,
  overrides: Partial<Asset3D> = {},
): Asset3D {
  return {
    id: `asset_${slug}`,
    menuItemId,
    status: "ready",
    glbUrl: `${CDN}/models/${slug}/medium.glb`,
    lodUrls: {
      high: `${CDN}/models/${slug}/high.glb`,
      medium: `${CDN}/models/${slug}/medium.glb`,
      low: `${CDN}/models/${slug}/low.glb`,
    },
    triangleCount: 24_000,
    fileSizeBytes: 780_000,
    sourceImageUrl: `${CDN}/source/${slug}.jpg`,
    sourceChecksum: null,
    realWorldScaleM: 0.22,
    createdAt: "2026-01-04T09:00:00.000Z",
    readyAt: "2026-01-04T09:02:11.000Z",
    failureReason: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/*  Ingredient catalogue                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Allergens live on the ingredient, not on the dish. Every dish using
 * `parmesan` inherits dairy without anyone remembering to tag it, which is the
 * whole point of a shared catalogue.
 */
const ING = {
  octopus: ["seafood", ["molluscs"]],
  prawn: ["seafood", ["shellfish"]],
  sea_bream: ["seafood", ["fish"]],
  fish_sauce: ["pantry", ["fish"]],
  lamb_shoulder: ["meat", []],
  beef_brisket: ["meat", []],
  pork_belly: ["meat", []],
  burrata: ["dairy", ["dairy"]],
  feta: ["dairy", ["dairy"]],
  parmesan: ["dairy", ["dairy"]],
  butter: ["dairy", ["dairy"]],
  cream_cheese: ["dairy", ["dairy"]],
  double_cream: ["dairy", ["dairy"]],
  condensed_milk: ["dairy", ["dairy"]],
  eggs: ["pantry", ["eggs"]],
  wheat_flour: ["grain", ["gluten"]],
  carnaroli_rice: ["grain", []],
  rice_noodles: ["grain", []],
  rice_vermicelli: ["grain", []],
  rice_paper: ["grain", []],
  pistachio: ["pantry", ["tree_nuts"]],
  hazelnut_praline: ["pantry", ["tree_nuts"]],
  peanut_sauce: ["pantry", ["peanuts"]],
  soy_sauce: ["pantry", ["soy"]],
  hoisin: ["pantry", ["soy"]],
  aged_balsamic: ["pantry", ["sulphites"]],
  white_wine: ["pantry", ["sulphites"]],
  olive_oil: ["pantry", []],
  sugar: ["pantry", []],
  salted_caramel: ["pantry", []],
  sea_salt: ["pantry", []],
  robusta_coffee: ["pantry", []],
  ice: ["other", []],
  peach: ["produce", []],
  basil: ["produce", []],
  mint: ["produce", []],
  parsley: ["produce", []],
  coriander: ["produce", []],
  lettuce: ["produce", []],
  spring_onion: ["produce", []],
  broccoli: ["produce", []],
  fennel: ["produce", []],
  garlic: ["produce", []],
  onion: ["produce", []],
  chilli: ["produce", []],
  lemon: ["produce", []],
  lime: ["produce", []],
  preserved_lemon: ["produce", []],
  capers: ["produce", []],
  ginger: ["produce", []],
  saffron: ["spice", []],
  smoked_paprika: ["spice", []],
  star_anise: ["spice", []],
} as const satisfies Record<
  string,
  readonly [IngredientCategory, readonly AllergenKey[]]
>;

type IngredientSlug = keyof typeof ING;

function label(slug: IngredientSlug): string {
  return slug
    .split("_")
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Builds one line of a dish's ingredient list. */
function ing(
  slug: IngredientSlug,
  quantityG: number | null,
  extra: { isOptional?: boolean; note?: string } = {},
): MenuItemIngredient {
  const [category, allergens] = ING[slug];
  return {
    ingredient: {
      id: `ingr_${slug}`,
      slug: slug.replace(/_/g, "-"),
      name: label(slug),
      category,
      allergens: [...allergens],
    },
    quantityG,
    isOptional: extra.isOptional ?? false,
    note: extra.note ?? null,
  };
}

const DISH_INGREDIENTS: Record<string, MenuItemIngredient[]> = {
  itm_charred_octopus: [
    ing("octopus", 140),
    ing("white_wine", 30, { note: "Braising liquor." }),
    ing("parsley", 8),
    ing("capers", 6),
    ing("smoked_paprika", 2),
    ing("garlic", 4),
    ing("olive_oil", 12),
  ],
  itm_burrata: [
    ing("burrata", 125),
    ing("peach", 60),
    ing("basil", 4),
    ing("aged_balsamic", 8),
    ing("pistachio", 10, { isOptional: true, note: "Left off on request." }),
    ing("olive_oil", 8),
  ],
  itm_lamb_shoulder: [
    ing("lamb_shoulder", 320),
    ing("feta", 45),
    ing("lemon", 20),
    ing("mint", 5),
    ing("parsley", 5),
    ing("garlic", 6),
    ing("olive_oil", 15),
  ],
  itm_saffron_risotto: [
    ing("carnaroli_rice", 90),
    ing("parmesan", 30),
    ing("butter", 25),
    ing("saffron", 0.2),
    ing("onion", 25),
    ing("white_wine", 40),
  ],
  itm_sea_bream: [
    ing("sea_bream", 320),
    ing("fennel", 40),
    ing("preserved_lemon", 15),
    ing("sea_salt", 200, { note: "Salt crust, not eaten." }),
    ing("olive_oil", 12),
  ],
  itm_charred_greens: [
    ing("broccoli", 140),
    ing("chilli", 3),
    ing("garlic", 5),
    ing("lemon", 8),
    ing("olive_oil", 10),
  ],
  itm_basque_cheesecake: [
    ing("cream_cheese", 70),
    ing("double_cream", 35),
    ing("eggs", 28),
    ing("sugar", 22),
    ing("wheat_flour", 6),
    ing("salted_caramel", 12),
    ing("hazelnut_praline", 10),
  ],
  itm_pho_bo: [
    ing("rice_noodles", 180),
    ing("beef_brisket", 90),
    ing("fish_sauce", 12),
    ing("star_anise", 1),
    ing("ginger", 6),
    ing("spring_onion", 10),
    ing("coriander", 6),
    ing("soy_sauce", 5, { isOptional: true, note: "Served alongside." }),
  ],
  itm_bun_cha: [
    ing("pork_belly", 140),
    ing("rice_vermicelli", 160),
    ing("fish_sauce", 18),
    ing("soy_sauce", 10),
    ing("sugar", 12),
    ing("garlic", 5),
    ing("mint", 8),
    ing("lime", 10),
  ],
  itm_goi_cuon: [
    ing("rice_paper", 30),
    ing("prawn", 60),
    ing("pork_belly", 30),
    ing("rice_vermicelli", 40),
    ing("mint", 5),
    ing("lettuce", 20),
    ing("peanut_sauce", 35),
    ing("hoisin", 10),
  ],
  itm_ca_phe: [
    ing("robusta_coffee", 30),
    ing("condensed_milk", 45),
    ing("ice", 160),
  ],
};

export const SEED_RESTAURANTS: Restaurant[] = [
  {
    id: "rst_aurelia",
    slug: "aurelia-kitchen",
    name: "Aurelia Kitchen",
    tagline: "Coastal Mediterranean, cooked over fire.",
    currency: "USD",
    locale: "en-US",
    branding: {
      primaryColor: "#1c1917",
      accentColor: "#e07a3f",
      logoUrl: null,
      heroImageUrl: null,
    },
  },
  {
    id: "rst_hanoi",
    slug: "hanoi-house",
    name: "Hanoi House",
    tagline: "Northern Vietnamese street food, all day.",
    currency: "USD",
    locale: "en-US",
    branding: {
      primaryColor: "#0f172a",
      accentColor: "#10b981",
      logoUrl: null,
      heroImageUrl: null,
    },
  },
];

export const SEED_MENU_ITEMS: MenuItem[] = [
  /* ---------------------------- Aurelia Kitchen --------------------------- */
  {
    id: "itm_charred_octopus",
    restaurantId: "rst_aurelia",
    name: "Charred Octopus",
    description:
      "Slow-braised octopus finished over embers, salsa verde, smoked paprika oil.",
    category: "starters",
    priceCents: 1900,
    basePortionGrams: 180,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 310,
      protein_g: 28,
      carbs_g: 9,
      fat_g: 18,
      sugar_g: 2,
      sodium_mg: 720,
      fiber_g: 2,
    },
    allergens: [
      { key: "molluscs", severity: "contains" },
      { key: "sulphites", severity: "may_contain", note: "Braising wine." },
    ],
    imageUrl: null,
    asset: asset("itm_charred_octopus", "charred-octopus"),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_charred_octopus ?? [],
  },
  {
    id: "itm_burrata",
    restaurantId: "rst_aurelia",
    name: "Burrata & Peach",
    description:
      "Whole burrata, grilled peach, basil, aged balsamic, toasted pistachio.",
    category: "starters",
    priceCents: 1600,
    basePortionGrams: 220,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 480,
      protein_g: 19,
      carbs_g: 22,
      fat_g: 34,
      sugar_g: 16,
      sodium_mg: 540,
      fiber_g: 3,
    },
    allergens: [
      { key: "dairy", severity: "contains" },
      {
        key: "tree_nuts",
        severity: "removable",
        note: "Pistachio can be omitted.",
      },
      { key: "sulphites", severity: "contains", note: "Aged balsamic." },
    ],
    imageUrl: null,
    asset: asset("itm_burrata", "burrata-peach", {
      triangleCount: 18_400,
      fileSizeBytes: 610_000,
    }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_burrata ?? [],
  },
  {
    id: "itm_lamb_shoulder",
    restaurantId: "rst_aurelia",
    name: "Fire-Roasted Lamb Shoulder",
    description:
      "Twelve-hour lamb shoulder, charred lemon, whipped feta, mint gremolata.",
    category: "mains",
    priceCents: 3800,
    basePortionGrams: 420,
    portionRange: { min: 0.5, max: 2.5, step: 0.25, default: 1 },
    nutrition: {
      calories: 940,
      protein_g: 62,
      carbs_g: 14,
      fat_g: 68,
      sugar_g: 5,
      sodium_mg: 1480,
      fiber_g: 3,
    },
    allergens: [{ key: "dairy", severity: "contains", note: "Whipped feta." }],
    imageUrl: null,
    asset: asset("itm_lamb_shoulder", "lamb-shoulder", {
      triangleCount: 31_200,
      fileSizeBytes: 1_140_000,
      realWorldScaleM: 0.28,
    }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_lamb_shoulder ?? [],
  },
  {
    id: "itm_saffron_risotto",
    restaurantId: "rst_aurelia",
    name: "Saffron Risotto",
    description: "Carnaroli rice, saffron, bone marrow butter, aged parmesan.",
    category: "mains",
    priceCents: 2600,
    basePortionGrams: 330,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 720,
      protein_g: 21,
      carbs_g: 88,
      fat_g: 30,
      sugar_g: 4,
      sodium_mg: 1120,
      fiber_g: 3,
    },
    allergens: [
      { key: "dairy", severity: "contains" },
      { key: "celery", severity: "may_contain" },
    ],
    imageUrl: null,
    asset: asset("itm_saffron_risotto", "saffron-risotto", {
      realWorldScaleM: 0.24,
    }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_saffron_risotto ?? [],
  },
  {
    id: "itm_sea_bream",
    restaurantId: "rst_aurelia",
    name: "Whole Sea Bream",
    description: "Salt-baked sea bream, fennel, preserved lemon, olive oil.",
    category: "mains",
    priceCents: 3400,
    basePortionGrams: 400,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 520,
      protein_g: 54,
      carbs_g: 6,
      fat_g: 30,
      sugar_g: 2,
      sodium_mg: 890,
      fiber_g: 2,
    },
    allergens: [{ key: "fish", severity: "contains" }],
    imageUrl: null,
    // Still being generated — exercises the "asset pending" UI path.
    asset: asset("itm_sea_bream", "sea-bream", {
      status: "processing",
      glbUrl: null,
      lodUrls: {},
      triangleCount: null,
      fileSizeBytes: null,
      readyAt: null,
    }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_sea_bream ?? [],
  },
  {
    id: "itm_charred_greens",
    restaurantId: "rst_aurelia",
    name: "Charred Greens",
    description: "Tenderstem broccoli, chilli, garlic, lemon. Vegan.",
    category: "sides",
    priceCents: 1100,
    basePortionGrams: 160,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 140,
      protein_g: 6,
      carbs_g: 12,
      fat_g: 8,
      sugar_g: 3,
      sodium_mg: 260,
      fiber_g: 6,
    },
    allergens: [],
    imageUrl: null,
    asset: asset("itm_charred_greens", "charred-greens", {
      triangleCount: 12_800,
      fileSizeBytes: 420_000,
      realWorldScaleM: 0.18,
    }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_charred_greens ?? [],
  },
  {
    id: "itm_basque_cheesecake",
    restaurantId: "rst_aurelia",
    name: "Basque Cheesecake",
    description: "Burnt-top cheesecake, salted caramel, hazelnut praline.",
    category: "desserts",
    priceCents: 1400,
    basePortionGrams: 150,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 610,
      protein_g: 11,
      carbs_g: 48,
      fat_g: 42,
      sugar_g: 39,
      sodium_mg: 380,
      fiber_g: 1,
    },
    allergens: [
      { key: "dairy", severity: "contains" },
      { key: "eggs", severity: "contains" },
      { key: "gluten", severity: "contains" },
      { key: "tree_nuts", severity: "contains", note: "Hazelnut praline." },
    ],
    imageUrl: null,
    asset: asset("itm_basque_cheesecake", "basque-cheesecake", {
      realWorldScaleM: 0.16,
    }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_basque_cheesecake ?? [],
  },

  /* ------------------------------ Hanoi House ----------------------------- */
  {
    id: "itm_pho_bo",
    restaurantId: "rst_hanoi",
    name: "Phở Bò",
    description: "Twelve-hour beef broth, rice noodles, brisket, herbs.",
    category: "mains",
    priceCents: 1800,
    basePortionGrams: 650,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 560,
      protein_g: 38,
      carbs_g: 66,
      fat_g: 16,
      sugar_g: 7,
      sodium_mg: 1980,
      fiber_g: 3,
    },
    allergens: [
      { key: "fish", severity: "contains", note: "Fish sauce in the broth." },
      { key: "soy", severity: "may_contain" },
    ],
    imageUrl: null,
    asset: asset("itm_pho_bo", "pho-bo", { realWorldScaleM: 0.25 }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_pho_bo ?? [],
  },
  {
    id: "itm_bun_cha",
    restaurantId: "rst_hanoi",
    name: "Bún Chả",
    description:
      "Charcoal pork patties, cold rice vermicelli, nước chấm, herbs.",
    category: "mains",
    priceCents: 1900,
    basePortionGrams: 520,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 690,
      protein_g: 34,
      carbs_g: 72,
      fat_g: 28,
      sugar_g: 18,
      sodium_mg: 1640,
      fiber_g: 4,
    },
    allergens: [
      { key: "fish", severity: "contains" },
      { key: "soy", severity: "contains" },
      {
        key: "peanuts",
        severity: "may_contain",
        note: "Shared wok and fryer.",
      },
    ],
    imageUrl: null,
    asset: asset("itm_bun_cha", "bun-cha"),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_bun_cha ?? [],
  },
  {
    id: "itm_goi_cuon",
    restaurantId: "rst_hanoi",
    name: "Gỏi Cuốn",
    description: "Fresh rice-paper rolls, prawn, mint, peanut dipping sauce.",
    category: "starters",
    priceCents: 1200,
    basePortionGrams: 200,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: {
      calories: 320,
      protein_g: 16,
      carbs_g: 40,
      fat_g: 11,
      sugar_g: 9,
      sodium_mg: 680,
      fiber_g: 3,
    },
    allergens: [
      { key: "peanuts", severity: "contains", note: "Peanut dipping sauce." },
      { key: "shellfish", severity: "contains" },
      { key: "soy", severity: "contains" },
    ],
    imageUrl: null,
    asset: asset("itm_goi_cuon", "goi-cuon", { realWorldScaleM: 0.19 }),
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_goi_cuon ?? [],
  },
  {
    id: "itm_ca_phe",
    restaurantId: "rst_hanoi",
    name: "Cà Phê Sữa Đá",
    description: "Robusta drip coffee over condensed milk and ice.",
    category: "drinks",
    priceCents: 600,
    basePortionGrams: 240,
    portionRange: { min: 1, max: 1, step: 1, default: 1 },
    nutrition: {
      calories: 180,
      protein_g: 4,
      carbs_g: 30,
      fat_g: 5,
      sugar_g: 29,
      sodium_mg: 60,
      fiber_g: 0,
    },
    allergens: [{ key: "dairy", severity: "contains" }],
    imageUrl: null,
    asset: null,
    isAvailable: true,
    ingredients: DISH_INGREDIENTS.itm_ca_phe ?? [],
  },
];
