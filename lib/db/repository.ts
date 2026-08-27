import { isDatabaseConfigured, query } from "@/lib/db/client";
import { SEED_RESTAURANTS } from "@/lib/db/seed";
import {
  restaurantOverlay,
  seedItemWithEdits,
  seedItemsWithEdits,
} from "@/lib/db/seed-overlay";
import {
  type AllergenKey,
  type AllergenSeverity,
  type Asset3D,
  type AssetStatus,
  type LodTier,
  type MenuCategory,
  type Ingredient,
  type IngredientCategory,
  type MenuItem,
  type MenuItemAllergen,
  type MenuItemIngredient,
  type Restaurant,
  type SavedDish,
} from "@/lib/types";

/**
 * Data access for restaurants, menu items and their 3D assets.
 *
 * Two backends share one interface: Postgres when `DATABASE_URL` is present,
 * the seed dataset otherwise. Callers never branch on which is active.
 */

/* -------------------------------------------------------------------------- */
/*  Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

interface RestaurantRow {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  currency: string;
  locale: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  hero_image_url: string | null;
}

interface MenuItemRow {
  id: string;
  restaurant_id: string;
  name: string;
  description: string;
  category: MenuCategory;
  price_cents: number;
  base_portion_grams: number;
  portion_min: string;
  portion_max: string;
  portion_step: string;
  portion_default: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  sugar_g: string;
  sodium_mg: string;
  fiber_g: string;
  image_url: string | null;
  is_available: boolean;
  allergens: MenuItemAllergen[] | null;
  ingredients: RawIngredientRow[] | null;
  asset_id: string | null;
  asset_status: AssetStatus | null;
  glb_url: string | null;
  lod_urls: Partial<Record<LodTier, string>> | null;
  triangle_count: number | null;
  file_size_bytes: number | null;
  source_image_url: string | null;
  source_checksum: string | null;
  real_world_scale_m: string | null;
  asset_created_at: Date | null;
  ready_at: Date | null;
  failure_reason: string | null;
}

/** Shape json_agg produces for one ingredient line. */
interface RawIngredientRow {
  id: string;
  slug: string;
  name: string;
  category: IngredientCategory;
  allergens: AllergenKey[] | null;
  quantity_g: string | number | null;
  is_optional: boolean;
  note: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Row -> domain mapping                                                      */
/* -------------------------------------------------------------------------- */

/** `pg` returns NUMERIC as a string to preserve precision. */
function num(value: string | number | null, fallback = 0): number {
  if (value === null) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    currency: row.currency,
    locale: row.locale,
    branding: {
      primaryColor: row.primary_color,
      accentColor: row.accent_color,
      logoUrl: row.logo_url,
      heroImageUrl: row.hero_image_url,
    },
  };
}

function toAsset(row: MenuItemRow): Asset3D | null {
  if (!row.asset_id || !row.asset_status) return null;
  return {
    id: row.asset_id,
    menuItemId: row.id,
    status: row.asset_status,
    glbUrl: row.glb_url,
    lodUrls: row.lod_urls ?? {},
    triangleCount: row.triangle_count,
    fileSizeBytes: row.file_size_bytes,
    sourceImageUrl: row.source_image_url,
    sourceChecksum: row.source_checksum,
    realWorldScaleM: num(row.real_world_scale_m, 0.22),
    createdAt: (row.asset_created_at ?? new Date(0)).toISOString(),
    readyAt: row.ready_at ? row.ready_at.toISOString() : null,
    failureReason: row.failure_reason,
  };
}

function toIngredient(row: RawIngredientRow): MenuItemIngredient {
  const ingredient: Ingredient = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    allergens: row.allergens ?? [],
  };
  return {
    ingredient,
    quantityG: row.quantity_g === null ? null : num(row.quantity_g),
    isOptional: row.is_optional,
    note: row.note,
  };
}

function toMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    basePortionGrams: row.base_portion_grams,
    portionRange: {
      min: num(row.portion_min, 0.5),
      max: num(row.portion_max, 2),
      step: num(row.portion_step, 0.25),
      default: num(row.portion_default, 1),
    },
    nutrition: {
      calories: num(row.calories),
      protein_g: num(row.protein_g),
      carbs_g: num(row.carbs_g),
      fat_g: num(row.fat_g),
      sugar_g: num(row.sugar_g),
      sodium_mg: num(row.sodium_mg),
      fiber_g: num(row.fiber_g),
    },
    allergens: row.allergens ?? [],
    ingredients: (row.ingredients ?? []).map(toIngredient),
    imageUrl: row.image_url,
    asset: toAsset(row),
    isAvailable: row.is_available,
  };
}

/* -------------------------------------------------------------------------- */
/*  SQL                                                                        */
/* -------------------------------------------------------------------------- */

const RESTAURANT_COLUMNS = `
  id, slug, name, tagline, currency, locale,
  primary_color, accent_color, logo_url, hero_image_url
`;

/**
 * One round trip for the whole menu: allergens are aggregated into JSON and the
 * live 3D asset is joined in, so rendering a menu never N+1s.
 */
function menuQuery(where: string): string {
  return `
  SELECT
    mi.id,
    mi.restaurant_id,
    mi.name,
    mi.description,
    mi.category,
    mi.price_cents,
    mi.base_portion_grams,
    mi.portion_min,
    mi.portion_max,
    mi.portion_step,
    mi.portion_default,
    mi.calories,
    mi.protein_g,
    mi.carbs_g,
    mi.fat_g,
    mi.sugar_g,
    mi.sodium_mg,
    mi.fiber_g,
    mi.image_url,
    mi.is_available,
    COALESCE(ag.allergens, '[]'::json) AS allergens,
    COALESCE(ig.ingredients, '[]'::json) AS ingredients,
    a.id                 AS asset_id,
    a.status             AS asset_status,
    a.glb_url,
    a.lod_urls,
    a.triangle_count,
    a.file_size_bytes,
    a.source_image_url,
    a.source_checksum,
    a.real_world_scale_m,
    a.created_at         AS asset_created_at,
    a.ready_at,
    a.failure_reason
  FROM menu_items mi
  LEFT JOIN LATERAL (
    -- The view, not the raw table: allergens derived from ingredients are as
    -- binding as the hand-declared ones.
    SELECT json_agg(
             json_build_object('key', ea.allergen_key, 'severity', ea.severity, 'note', ea.note)
             ORDER BY ea.allergen_key
           ) AS allergens
    FROM menu_item_effective_allergens ea
    WHERE ea.menu_item_id = mi.id
  ) ag ON TRUE
  LEFT JOIN LATERAL (
    SELECT json_agg(
             json_build_object(
               'id', i.id, 'slug', i.slug, 'name', i.name, 'category', i.category,
               'allergens', COALESCE(ia.keys, ARRAY[]::text[]),
               'quantity_g', mii.quantity_g,
               'is_optional', mii.is_optional,
               'note', mii.note
             )
             ORDER BY mii.sort_order, i.name
           ) AS ingredients
    FROM menu_item_ingredients mii
    JOIN ingredients i ON i.id = mii.ingredient_id
    LEFT JOIN LATERAL (
      SELECT array_agg(allergen_key ORDER BY allergen_key) AS keys
      FROM ingredient_allergens
      WHERE ingredient_id = i.id
    ) ia ON TRUE
    WHERE mii.menu_item_id = mi.id
  ) ig ON TRUE
  LEFT JOIN LATERAL (
    SELECT *
    FROM asset_3d
    WHERE asset_3d.menu_item_id = mi.id
      AND asset_3d.status IN ('ready', 'processing', 'pending')
    ORDER BY asset_3d.created_at DESC
    LIMIT 1
  ) a ON TRUE
  WHERE ${where}
  ORDER BY
    array_position(
      ARRAY['starters','mains','sides','desserts','drinks']::menu_category[],
      mi.category
    ),
    mi.sort_order,
    mi.name
`;
}

/** Whole menu for one venue; `$2` opts unavailable dishes back in. */
const MENU_BY_RESTAURANT = menuQuery(
  "mi.restaurant_id = $1 AND (mi.is_available OR $2::boolean)",
);

/** Single dish by UUID, regardless of availability. */
const MENU_ITEM_BY_ID = menuQuery("mi.id = $1::uuid");

/* -------------------------------------------------------------------------- */
/*  Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Looks a restaurant up by either its UUID or its QR slug — the `[id]` route
 * segment accepts both so short links and canonical IDs both resolve.
 */
export async function getRestaurant(
  idOrSlug: string,
): Promise<Restaurant | null> {
  if (!isDatabaseConfigured()) {
    const seeded = SEED_RESTAURANTS.find(
      (r) => r.id === idOrSlug || r.slug === idOrSlug,
    );
    return seeded ? (restaurantOverlay().get(seeded.id) ?? seeded) : null;
  }

  const rows = await query<RestaurantRow>(
    `SELECT ${RESTAURANT_COLUMNS}
       FROM restaurants
      WHERE slug = $1
         OR (
              $1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND id = $1::uuid
            )
      LIMIT 1`,
    [idOrSlug],
  );

  return rows[0] ? toRestaurant(rows[0]) : null;
}

export async function listRestaurants(): Promise<Restaurant[]> {
  if (!isDatabaseConfigured()) {
    return SEED_RESTAURANTS.map(
      (entry) => restaurantOverlay().get(entry.id) ?? entry,
    );
  }

  const rows = await query<RestaurantRow>(
    `SELECT ${RESTAURANT_COLUMNS} FROM restaurants ORDER BY name`,
  );
  return rows.map(toRestaurant);
}

export async function getMenuItems(
  restaurantId: string,
  options: { includeUnavailable?: boolean } = {},
): Promise<MenuItem[]> {
  const includeUnavailable = options.includeUnavailable ?? false;

  if (!isDatabaseConfigured()) {
    return seedItemsWithEdits(restaurantId).filter(
      (item) => includeUnavailable || item.isAvailable,
    );
  }

  const rows = await query<MenuItemRow>(MENU_BY_RESTAURANT, [
    restaurantId,
    includeUnavailable,
  ]);
  return rows.map(toMenuItem);
}

export async function getMenuItem(itemId: string): Promise<MenuItem | null> {
  if (!isDatabaseConfigured()) {
    return seedItemWithEdits(itemId);
  }

  const rows = await query<MenuItemRow>(MENU_ITEM_BY_ID, [itemId]);
  return rows[0] ? toMenuItem(rows[0]) : null;
}

/** Severity ordering used when we need to show the worst conflict first. */
export const SEVERITY_RANK: Readonly<Record<AllergenSeverity, number>> = {
  contains: 3,
  may_contain: 2,
  removable: 1,
};

/* -------------------------------------------------------------------------- */
/*  Saved dishes                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Seed-mode store for saved dishes.
 *
 * Held on `globalThis` so Next's dev-mode module reloading does not empty it
 * between requests. It is per-process and disappears on restart — the seed
 * dataset exists so the app runs with no infrastructure, and a durable saved
 * list is exactly the thing that needs infrastructure. Set `DATABASE_URL` and
 * the rows go to Postgres.
 */
declare global {
  var __tasteBuddySaved: Map<string, Map<string, SavedDish>> | undefined;
}

function savedStore(): Map<string, Map<string, SavedDish>> {
  globalThis.__tasteBuddySaved ??= new Map();
  return globalThis.__tasteBuddySaved;
}

interface SavedRow {
  menu_item_id: string;
  note: string | null;
  saved_at: Date;
}

/** The diner's saved list, newest first. */
export async function listSavedDishes(token: string): Promise<SavedDish[]> {
  if (!isDatabaseConfigured()) {
    const forToken = savedStore().get(token);
    if (!forToken) return [];
    return [...forToken.values()].sort((a, b) =>
      b.savedAt.localeCompare(a.savedAt),
    );
  }

  const rows = await query<SavedRow>(
    `SELECT menu_item_id, note, saved_at
       FROM saved_dishes
      WHERE diner_token = $1
      ORDER BY saved_at DESC
      LIMIT 200`,
    [token],
  );

  return rows.map((row) => ({
    menuItemId: row.menu_item_id,
    note: row.note,
    savedAt: row.saved_at.toISOString(),
  }));
}

/** Idempotent: saving an already-saved dish just refreshes its note. */
export async function saveDish(
  token: string,
  menuItemId: string,
  note: string | null = null,
): Promise<SavedDish> {
  if (!isDatabaseConfigured()) {
    const forToken = savedStore().get(token) ?? new Map<string, SavedDish>();
    const existing = forToken.get(menuItemId);
    const entry: SavedDish = {
      menuItemId,
      note,
      savedAt: existing?.savedAt ?? new Date().toISOString(),
    };
    forToken.set(menuItemId, entry);
    savedStore().set(token, forToken);
    return entry;
  }

  const rows = await query<SavedRow>(
    `INSERT INTO saved_dishes (diner_token, menu_item_id, note)
          VALUES ($1, $2::uuid, $3)
     ON CONFLICT (diner_token, menu_item_id)
       DO UPDATE SET note = EXCLUDED.note
       RETURNING menu_item_id, note, saved_at`,
    [token, menuItemId, note],
  );

  const row = rows[0];
  return {
    menuItemId: row.menu_item_id,
    note: row.note,
    savedAt: row.saved_at.toISOString(),
  };
}

/** Returns false when the dish was not on the list to begin with. */
export async function unsaveDish(
  token: string,
  menuItemId: string,
): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    return savedStore().get(token)?.delete(menuItemId) ?? false;
  }

  const rows = await query<{ menu_item_id: string }>(
    `DELETE FROM saved_dishes
      WHERE diner_token = $1 AND menu_item_id = $2::uuid
      RETURNING menu_item_id`,
    [token, menuItemId],
  );
  return rows.length > 0;
}

/** Hydrates saved rows into full menu items, dropping any since delisted. */
export async function getSavedDishDetails(
  token: string,
): Promise<{ saved: SavedDish; item: MenuItem; restaurant: Restaurant }[]> {
  const saved = await listSavedDishes(token);
  if (saved.length === 0) return [];

  const details: {
    saved: SavedDish;
    item: MenuItem;
    restaurant: Restaurant;
  }[] = [];
  for (const entry of saved) {
    const item = await getMenuItem(entry.menuItemId);
    if (!item) continue;
    const restaurant = await getRestaurant(item.restaurantId);
    if (!restaurant) continue;
    details.push({ saved: entry, item, restaurant });
  }
  return details;
}
