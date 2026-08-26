/**
 * TasteBuddy domain model.
 *
 * These types are the single source of truth shared by the API routes, the
 * Postgres access layer (`lib/db`) and every React component. Nothing in the
 * app is allowed to invent its own shape for a menu item or an allergen.
 */

/* -------------------------------------------------------------------------- */
/*  Allergens                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The 14 allergens that must be declared under EU FIC 1169/2011, which is a
 * superset of the US "big 9". Stored as a lowercase slug in Postgres.
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

/** How strongly a dish is associated with an allergen. */
export type AllergenSeverity =
  /** The allergen is a listed ingredient. */
  | "contains"
  /** Shared fryer / shared prep surface — cross-contamination risk. */
  | "may_contain"
  /** Present only in an optional garnish or side that can be removed. */
  | "removable";

export interface Allergen {
  key: AllergenKey;
  /** Human readable label, e.g. "Peanuts". */
  label: string;
  /** Short consumer-facing explanation shown under the AR warning. */
  description: string;
}

export interface MenuItemAllergen {
  key: AllergenKey;
  severity: AllergenSeverity;
  /** Free-text detail, e.g. "fried in shared peanut oil". */
  note?: string;
}

/**
 * A diner's allergen profile. Held client-side (localStorage) and passed to the
 * menu API as a query string — we deliberately never persist it server-side.
 */
export interface AllergenProfile {
  /** Allergens the diner must avoid. */
  avoid: AllergenKey[];
  /**
   * When true, `may_contain` matches are treated as hard conflicts too.
   * Diners with anaphylactic allergies should keep this on.
   */
  strict: boolean;
}

export const EMPTY_ALLERGEN_PROFILE: AllergenProfile = {
  avoid: [],
  strict: true,
};

/* -------------------------------------------------------------------------- */
/*  Nutrition                                                                  */
/* -------------------------------------------------------------------------- */

/** Nutrition facts for one base portion of a dish. */
export interface NutritionFacts {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sugar_g: number;
  sodium_mg: number;
  fiber_g: number;
}

export const NUTRITION_KEYS = [
  "calories",
  "protein_g",
  "carbs_g",
  "fat_g",
  "sugar_g",
  "sodium_mg",
  "fiber_g",
] as const;

export type NutritionKey = (typeof NUTRITION_KEYS)[number];

/**
 * Upper bounds a diner can set per nutrient. A missing key means "no limit".
 * Evaluated against the *scaled* nutrition for the diner's chosen portion.
 */
export type NutritionThresholds = Partial<Record<NutritionKey, number>>;

/* -------------------------------------------------------------------------- */
/*  3D assets                                                                  */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a generated `.glb`, mirrored in the `asset_3d.status` column. */
export type AssetStatus = "pending" | "processing" | "ready" | "failed";

/**
 * Level-of-detail tier. We ship three decimated variants of every mesh and let
 * the client pick one from its device budget — see `lib/pipeline/lod.ts`.
 */
export type LodTier = "high" | "medium" | "low";

export interface Asset3D {
  id: string;
  menuItemId: string;
  status: AssetStatus;
  /** CDN URL of the default (medium) `.glb`. Null until status is `ready`. */
  glbUrl: string | null;
  /** Per-tier CDN URLs, present once the pipeline finishes decimating. */
  lodUrls: Partial<Record<LodTier, string>>;
  /** Triangle count of the default tier, after decimation. */
  triangleCount: number | null;
  /** Byte size of the default tier, gzip-on-the-wire excluded. */
  fileSizeBytes: number | null;
  /** Source 2D photo the mesh was generated from. */
  sourceImageUrl: string | null;
  /** SHA-256 of the source image — the pipeline's cache key. */
  sourceChecksum: string | null;
  /** Real-world longest edge in metres, used to scale the mesh in AR. */
  realWorldScaleM: number;
  createdAt: string;
  readyAt: string | null;
  failureReason: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Menu                                                                       */
/* -------------------------------------------------------------------------- */

export type MenuCategory =
  | "starters"
  | "mains"
  | "sides"
  | "desserts"
  | "drinks";

export interface PortionRange {
  /** Multiplier applied to base nutrition and to the AR mesh scale. */
  min: number;
  max: number;
  step: number;
  /** Where the slider starts. Always within [min, max]. */
  default: number;
}

export const DEFAULT_PORTION_RANGE: PortionRange = {
  min: 0.5,
  max: 2,
  step: 0.25,
  default: 1,
};

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  category: MenuCategory;
  /** Minor currency units (cents / pence) for the base portion. */
  priceCents: number;
  /** Grams on the plate at portion multiplier 1.0. */
  basePortionGrams: number;
  portionRange: PortionRange;
  nutrition: NutritionFacts;
  allergens: MenuItemAllergen[];
  imageUrl: string | null;
  asset: Asset3D | null;
  isAvailable: boolean;
}

export interface RestaurantBranding {
  /** Hex colour used for primary actions and the AR reticle. */
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
}

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  /** ISO 4217, drives price formatting. */
  currency: string;
  locale: string;
  branding: RestaurantBranding;
}

/* -------------------------------------------------------------------------- */
/*  API contracts                                                              */
/* -------------------------------------------------------------------------- */

/** Why a dish was hidden or flagged for this particular diner. */
export interface MenuItemConflict {
  type: "allergen" | "nutrition";
  /** `AllergenKey` for allergen conflicts, `NutritionKey` for nutrition ones. */
  key: AllergenKey | NutritionKey;
  severity: AllergenSeverity | "over_threshold";
  message: string;
}

/**
 * A menu item decorated with the outcome of evaluating the diner's profile
 * against it. `conflicts` is empty for a safe dish.
 */
export interface EvaluatedMenuItem extends MenuItem {
  conflicts: MenuItemConflict[];
  /** True when at least one conflict is an allergen the diner must avoid. */
  hasAllergenConflict: boolean;
  /** Nutrition recalculated for `appliedPortion`. */
  scaledNutrition: NutritionFacts;
  appliedPortion: number;
}

export interface MenuResponse {
  restaurant: Restaurant;
  items: EvaluatedMenuItem[];
  meta: {
    totalItems: number;
    returnedItems: number;
    /** Items removed because `mode=exclude` hid a conflicting dish. */
    hiddenItems: number;
    appliedProfile: AllergenProfile;
    appliedThresholds: NutritionThresholds;
    /** Echoes the filter mode so the client can render the right empty state. */
    mode: MenuFilterMode;
  };
}

/**
 * `flag` keeps conflicting dishes in the payload with `conflicts` populated so
 * the UI can strike them through; `exclude` drops them server-side.
 */
export type MenuFilterMode = "flag" | "exclude";

export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Field-level detail for 400s. */
    details?: Record<string, string>;
  };
}
