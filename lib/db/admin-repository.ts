import { hashStaffKey } from "@/lib/auth/staff-session";
import { isDatabaseConfigured, query, withTransaction } from "@/lib/db/client";
import { SEED_MENU_ITEMS } from "@/lib/db/seed";
import { deletedItems, menuOverlay } from "@/lib/db/seed-overlay";
import {
  DEFAULT_PORTION_RANGE,
  type AllergenKey,
  type AllergenSeverity,
  type MenuCategory,
  type MenuItem,
  type MenuItemAllergen,
  type NutritionFacts,
} from "@/lib/types";

/**
 * Writes for the restaurant menu editor.
 *
 * Kept apart from `lib/db/repository` on purpose: everything in there is read
 * by unauthenticated diner traffic, and everything here requires a verified
 * staff session. Mixing them makes it far too easy to expose a write by
 * importing the wrong module.
 *
 * Every function takes the `restaurantId` from the *session*, never from the
 * request body, and scopes its SQL to it — so a valid session for one venue
 * cannot reach another venue's rows even with a guessed dish id.
 */

/* -------------------------------------------------------------------------- */
/*  Authentication                                                             */
/* -------------------------------------------------------------------------- */

/** Development key for the seed venues, so the editor can be opened at once. */
const SEED_STAFF_KEY = "tastebuddy-dev-staff-key";

/**
 * Resolves an access key to the venue it may edit, or null.
 *
 * The restaurant comes from the stored row, never from the caller — a key
 * cannot be presented against a venue it was not issued for.
 */
export async function restaurantForStaffKey(
  key: string,
): Promise<string | null> {
  if (!isDatabaseConfigured()) {
    if (key !== SEED_STAFF_KEY) return null;
    return SEED_MENU_ITEMS[0]?.restaurantId ?? null;
  }

  const rows = await query<{ id: string; restaurant_id: string }>(
    `SELECT id, restaurant_id
       FROM restaurant_staff_keys
      WHERE key_hash = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [hashStaffKey(key)],
  );

  const row = rows[0];
  if (!row) return null;

  // Best effort: a failed touch must not fail the sign-in.
  void query(
    `UPDATE restaurant_staff_keys SET last_used_at = now() WHERE id = $1`,
    [row.id],
  ).catch(() => undefined);

  return row.restaurant_id;
}

/* -------------------------------------------------------------------------- */
/*  Menu item writes                                                           */
/* -------------------------------------------------------------------------- */

export interface MenuItemDraft {
  id?: string;
  name: string;
  description: string;
  category: MenuCategory;
  priceCents: number;
  basePortionGrams: number;
  nutrition: NutritionFacts;
  isAvailable: boolean;
  /** Cross-contamination and other facts no ingredient can imply. */
  allergens: MenuItemAllergen[];
  /** Ingredient slugs with their amounts. */
  ingredients: {
    slug: string;
    quantityG: number | null;
    isOptional: boolean;
  }[];
}

export interface SaveResult {
  id: string;
  created: boolean;
}

function draftToSeedItem(
  draft: MenuItemDraft,
  restaurantId: string,
  id: string,
): MenuItem {
  return {
    id,
    restaurantId,
    name: draft.name,
    description: draft.description,
    category: draft.category,
    priceCents: draft.priceCents,
    basePortionGrams: draft.basePortionGrams,
    portionRange: DEFAULT_PORTION_RANGE,
    nutrition: draft.nutrition,
    allergens: draft.allergens,
    ingredients: draft.ingredients.map((line) => ({
      ingredient: {
        id: `ingr_${line.slug}`,
        slug: line.slug,
        name: line.slug
          .replace(/-/g, " ")
          .replace(/^./, (c) => c.toUpperCase()),
        category: "other",
        allergens: [],
      },
      quantityG: line.quantityG,
      isOptional: line.isOptional,
      note: null,
    })),
    imageUrl: null,
    asset: null,
    isAvailable: draft.isAvailable,
  };
}

/**
 * Creates or updates a dish, along with its ingredients and declared
 * allergens, in a single transaction — a half-saved dish is worse than a
 * rejected one when the missing half is an allergen.
 */
export async function saveMenuItem(
  restaurantId: string,
  draft: MenuItemDraft,
): Promise<SaveResult> {
  if (!isDatabaseConfigured()) {
    const id = draft.id ?? `itm_new_${Math.random().toString(36).slice(2, 10)}`;
    const created = !draft.id;
    menuOverlay().set(id, draftToSeedItem(draft, restaurantId, id));
    deletedItems().delete(id);
    return { id, created };
  }

  return withTransaction(async (client) => {
    let id = draft.id ?? null;
    let created = false;

    if (id) {
      // The restaurant predicate is the tenancy boundary: an id from another
      // venue simply matches no row.
      const updated = await client.query<{ id: string }>(
        `UPDATE menu_items
            SET name = $3, description = $4, category = $5::menu_category,
                price_cents = $6, base_portion_grams = $7,
                calories = $8, protein_g = $9, carbs_g = $10, fat_g = $11,
                sugar_g = $12, sodium_mg = $13, fiber_g = $14,
                is_available = $15
          WHERE id = $1::uuid AND restaurant_id = $2::uuid
          RETURNING id`,
        [
          id,
          restaurantId,
          draft.name,
          draft.description,
          draft.category,
          draft.priceCents,
          draft.basePortionGrams,
          draft.nutrition.calories,
          draft.nutrition.protein_g,
          draft.nutrition.carbs_g,
          draft.nutrition.fat_g,
          draft.nutrition.sugar_g,
          draft.nutrition.sodium_mg,
          draft.nutrition.fiber_g,
          draft.isAvailable,
        ],
      );
      if (updated.rowCount === 0) {
        throw new Error("menu_item_not_found");
      }
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO menu_items
           (restaurant_id, name, description, category, price_cents, base_portion_grams,
            calories, protein_g, carbs_g, fat_g, sugar_g, sodium_mg, fiber_g, is_available)
         VALUES ($1::uuid, $2, $3, $4::menu_category, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          restaurantId,
          draft.name,
          draft.description,
          draft.category,
          draft.priceCents,
          draft.basePortionGrams,
          draft.nutrition.calories,
          draft.nutrition.protein_g,
          draft.nutrition.carbs_g,
          draft.nutrition.fat_g,
          draft.nutrition.sugar_g,
          draft.nutrition.sodium_mg,
          draft.nutrition.fiber_g,
          draft.isAvailable,
        ],
      );
      id = inserted.rows[0].id;
      created = true;
    }

    // Replace rather than diff: the editor always submits the whole list, and
    // a diff that drops a delete leaves a stale allergen on the plate.
    await client.query(
      `DELETE FROM menu_item_allergens WHERE menu_item_id = $1::uuid`,
      [id],
    );
    for (const entry of draft.allergens) {
      await client.query(
        `INSERT INTO menu_item_allergens (menu_item_id, allergen_key, severity, note)
              VALUES ($1::uuid, $2, $3::allergen_severity, $4)
         ON CONFLICT DO NOTHING`,
        [id, entry.key, entry.severity, entry.note ?? null],
      );
    }

    await client.query(
      `DELETE FROM menu_item_ingredients WHERE menu_item_id = $1::uuid`,
      [id],
    );
    let order = 0;
    for (const line of draft.ingredients) {
      order += 1;
      await client.query(
        `INSERT INTO menu_item_ingredients
           (menu_item_id, ingredient_id, quantity_g, is_optional, sort_order)
         SELECT $1::uuid, i.id, $3, $4, $5
           FROM ingredients i
          WHERE i.slug = $2
         ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE
           SET quantity_g = EXCLUDED.quantity_g,
               is_optional = EXCLUDED.is_optional,
               sort_order = EXCLUDED.sort_order`,
        [id, line.slug, line.quantityG, line.isOptional, order],
      );
    }

    return { id: id as string, created };
  });
}

export async function deleteMenuItem(
  restaurantId: string,
  menuItemId: string,
): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    const known =
      menuOverlay().has(menuItemId) ||
      SEED_MENU_ITEMS.some((item) => item.id === menuItemId);
    if (!known) return false;
    menuOverlay().delete(menuItemId);
    deletedItems().add(menuItemId);
    return true;
  }

  const rows = await query<{ id: string }>(
    `DELETE FROM menu_items
      WHERE id = $1::uuid AND restaurant_id = $2::uuid
      RETURNING id`,
    [menuItemId, restaurantId],
  );
  return rows.length > 0;
}

export async function setMenuItemAvailability(
  restaurantId: string,
  menuItemId: string,
  isAvailable: boolean,
): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    const current =
      menuOverlay().get(menuItemId) ??
      SEED_MENU_ITEMS.find((item) => item.id === menuItemId);
    if (!current) return false;
    menuOverlay().set(menuItemId, { ...current, isAvailable });
    return true;
  }

  const rows = await query<{ id: string }>(
    `UPDATE menu_items SET is_available = $3
      WHERE id = $1::uuid AND restaurant_id = $2::uuid
      RETURNING id`,
    [menuItemId, restaurantId, isAvailable],
  );
  return rows.length > 0;
}

/** The ingredient catalogue, for the editor's picker. */
export async function listIngredientCatalogue(): Promise<
  { slug: string; name: string; category: string; allergens: AllergenKey[] }[]
> {
  if (!isDatabaseConfigured()) {
    const seen = new Map<
      string,
      { slug: string; name: string; category: string; allergens: AllergenKey[] }
    >();
    for (const item of SEED_MENU_ITEMS) {
      for (const line of item.ingredients) {
        seen.set(line.ingredient.slug, {
          slug: line.ingredient.slug,
          name: line.ingredient.name,
          category: line.ingredient.category,
          allergens: line.ingredient.allergens,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const rows = await query<{
    slug: string;
    name: string;
    category: string;
    allergens: AllergenKey[] | null;
  }>(
    `SELECT i.slug, i.name, i.category,
            COALESCE(
              array_agg(ia.allergen_key ORDER BY ia.allergen_key)
                FILTER (WHERE ia.allergen_key IS NOT NULL),
              ARRAY[]::text[]
            ) AS allergens
       FROM ingredients i
       LEFT JOIN ingredient_allergens ia ON ia.ingredient_id = i.id
      GROUP BY i.id
      ORDER BY i.name`,
  );

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    category: row.category,
    allergens: row.allergens ?? [],
  }));
}

export const ALLERGEN_SEVERITIES: readonly AllergenSeverity[] = [
  "contains",
  "may_contain",
  "removable",
];

/* -------------------------------------------------------------------------- */
/*  Generated 3D assets                                                        */
/* -------------------------------------------------------------------------- */

/** Confirms a dish belongs to the venue before anything is spent on it. */
export async function ownsMenuItem(
  restaurantId: string,
  menuItemId: string,
): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    const item =
      menuOverlay().get(menuItemId) ??
      SEED_MENU_ITEMS.find((entry) => entry.id === menuItemId);
    return (
      item?.restaurantId === restaurantId && !deletedItems().has(menuItemId)
    );
  }

  const rows = await query<{ id: string }>(
    `SELECT id FROM menu_items
      WHERE id = $1::uuid AND restaurant_id = $2::uuid
      LIMIT 1`,
    [menuItemId, restaurantId],
  );
  return rows.length > 0;
}

export interface GeneratedAsset {
  status: "processing" | "ready" | "failed";
  glbUrl: string | null;
  lodUrls: Record<string, string>;
  triangleCount: number | null;
  fileSizeBytes: number | null;
  sourceImageUrl: string | null;
  sourceChecksum: string | null;
  realWorldScaleM: number;
  generatorJobId: string | null;
  failureReason: string | null;
}

/**
 * Records the outcome of a mesh job against its dish.
 *
 * Until this existed the pipeline produced CDN paths that nothing ever read —
 * a job could succeed and the diner's AR view would still fall back to
 * procedural geometry, because no `asset_3d` row was ever written.
 *
 * Not scoped by restaurant on purpose: the two callers are the upload route,
 * which checks ownership *before* submitting, and the generator's callback,
 * which is authenticated by its HMAC signature and has no session to scope by.
 */
export async function persistGeneratedAsset(
  menuItemId: string,
  asset: GeneratedAsset,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    const current =
      menuOverlay().get(menuItemId) ??
      SEED_MENU_ITEMS.find((entry) => entry.id === menuItemId);
    if (!current) return;
    menuOverlay().set(menuItemId, {
      ...current,
      asset: {
        id: `asset_${menuItemId}`,
        menuItemId,
        status: asset.status,
        glbUrl: asset.glbUrl,
        lodUrls: asset.lodUrls,
        triangleCount: asset.triangleCount,
        fileSizeBytes: asset.fileSizeBytes,
        sourceImageUrl: asset.sourceImageUrl,
        sourceChecksum: asset.sourceChecksum,
        realWorldScaleM: asset.realWorldScaleM,
        createdAt: new Date().toISOString(),
        readyAt: asset.status === "ready" ? new Date().toISOString() : null,
        failureReason: asset.failureReason,
      },
    });
    return;
  }

  await withTransaction(async (client) => {
    // One live asset per dish, so the previous attempt is retired rather than
    // left to collide with the partial unique index.
    await client.query(
      `DELETE FROM asset_3d
        WHERE menu_item_id = $1::uuid
          AND status IN ('ready', 'processing', 'pending')`,
      [menuItemId],
    );

    await client.query(
      `INSERT INTO asset_3d
         (menu_item_id, status, glb_url, lod_urls, triangle_count, file_size_bytes,
          source_image_url, source_checksum, real_world_scale_m, generator_job_id,
          failure_reason, ready_at)
       VALUES ($1::uuid, $2::asset_status, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11,
               CASE WHEN $2 = 'ready' THEN now() ELSE NULL END)`,
      [
        menuItemId,
        asset.status,
        asset.glbUrl,
        JSON.stringify(asset.lodUrls),
        asset.triangleCount,
        asset.fileSizeBytes,
        asset.sourceImageUrl,
        asset.sourceChecksum,
        asset.realWorldScaleM,
        asset.generatorJobId,
        asset.failureReason,
      ],
    );
  });
}
