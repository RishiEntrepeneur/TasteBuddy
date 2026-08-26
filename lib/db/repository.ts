import { isDatabaseConfigured, query } from "@/lib/db/client";
import { SEED_MENU_ITEMS, SEED_RESTAURANTS } from "@/lib/db/seed";
import {
  type Asset3D,
  type AssetStatus,
  type AllergenSeverity,
  type LodTier,
  type MenuCategory,
  type MenuItem,
  type MenuItemAllergen,
  type Restaurant,
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
    SELECT json_agg(
             json_build_object('key', mia.allergen_key, 'severity', mia.severity, 'note', mia.note)
             ORDER BY mia.allergen_key
           ) AS allergens
    FROM menu_item_allergens mia
    WHERE mia.menu_item_id = mi.id
  ) ag ON TRUE
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
    return (
      SEED_RESTAURANTS.find((r) => r.id === idOrSlug || r.slug === idOrSlug) ??
      null
    );
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
  if (!isDatabaseConfigured()) return [...SEED_RESTAURANTS];

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
    return SEED_MENU_ITEMS.filter(
      (item) =>
        item.restaurantId === restaurantId &&
        (includeUnavailable || item.isAvailable),
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
    return SEED_MENU_ITEMS.find((item) => item.id === itemId) ?? null;
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
