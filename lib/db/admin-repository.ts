import type { VenueDraft } from "@/lib/admin/venue-validation";
import {
  generateStaffKey,
  hashStaffKey,
  normaliseStaffKey,
} from "@/lib/auth/staff-session";
import { isDatabaseConfigured, query, withTransaction } from "@/lib/db/client";
import { SEED_MENU_ITEMS, SEED_RESTAURANTS } from "@/lib/db/seed";
import {
  deletedItems,
  menuOverlay,
  restaurantOverlay,
} from "@/lib/db/seed-overlay";
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
const SEED_KEY_ID = "seed-development-key";

export interface StaffVenue {
  id: string;
  slug: string;
  name: string;
}

export interface StaffIdentity {
  keyId: string;
  label: string;
  /** Every venue this key may edit, alphabetical. Never empty. */
  venues: StaffVenue[];
  /** Whether this key may create venues and mint other operator keys. */
  isOperator: boolean;
}

/** Seed mode has no grant table, so the dev key reaches every sample venue. */
function seedVenues(): StaffVenue[] {
  return SEED_RESTAURANTS.map((restaurant) => ({
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Exchanges an access key for the identity it carries.
 *
 * The venues come from the key's grants, never from the caller, so a key
 * cannot be presented against a site it was not issued for. Both the literal
 * key and its normalised form are checked in one query: grouping dashes and
 * capitals are display, and a key typed off a printout should work, but keys
 * issued before that rule existed still have to match on exactly what they
 * were.
 */
export async function identifyStaffKey(
  key: string,
): Promise<StaffIdentity | null> {
  const trimmed = key.trim();

  if (!isDatabaseConfigured()) {
    if (normaliseStaffKey(trimmed) !== normaliseStaffKey(SEED_STAFF_KEY)) {
      return null;
    }
    return {
      keyId: SEED_KEY_ID,
      label: "Development key",
      venues: seedVenues(),
      isOperator: true,
    };
  }

  const candidates = [...new Set([trimmed, normaliseStaffKey(trimmed)])].map(
    hashStaffKey,
  );

  const rows = await query<{
    id: string;
    label: string;
    is_operator: boolean;
    venues: StaffVenue[] | null;
  }>(
    `SELECT k.id,
            k.label,
            k.is_operator,
            (SELECT json_agg(json_build_object('id', r.id, 'slug', r.slug, 'name', r.name)
                             ORDER BY r.name)
               FROM staff_key_venues g
               JOIN restaurants r ON r.id = g.restaurant_id
              WHERE g.key_id = k.id) AS venues
       FROM restaurant_staff_keys k
      WHERE k.key_hash = ANY($1::char(64)[]) AND k.revoked_at IS NULL
      LIMIT 1`,
    [candidates],
  );

  const row = rows[0];
  if (!row) return null;

  const venues = row.venues ?? [];
  // A live key granting nothing is not a way in. It happens when every venue
  // it reached has been deleted, and signing in to an empty editor would be a
  // worse answer than being told the key is no good.
  if (venues.length === 0) return null;

  // Best effort: a failed touch must not fail the sign-in.
  void query(
    `UPDATE restaurant_staff_keys SET last_used_at = now() WHERE id = $1::uuid`,
    [row.id],
  ).catch(() => undefined);

  return {
    keyId: row.id,
    label: row.label,
    venues,
    isOperator: row.is_operator,
  };
}

/**
 * Re-checks a live session against the database.
 *
 * Called on every admin request. The cookie is signed and cannot be forged,
 * but it also cannot be taken back, and the reason a venue revokes a key is
 * usually that the device holding it is somewhere it should not be. Reading
 * the grant here is what makes revoking take effect on the current shift
 * rather than in eight hours.
 */
export async function staffContext(
  keyId: string,
  restaurantId: string,
): Promise<StaffIdentity | null> {
  if (!isDatabaseConfigured()) {
    if (keyId !== SEED_KEY_ID) return null;
    const venues = seedVenues();
    return venues.some((venue) => venue.id === restaurantId)
      ? {
          keyId: SEED_KEY_ID,
          label: "Development key",
          venues,
          isOperator: true,
        }
      : null;
  }

  if (!UUID.test(keyId) || !UUID.test(restaurantId)) return null;

  const rows = await query<{
    label: string;
    is_operator: boolean;
    venues: StaffVenue[] | null;
  }>(
    `SELECT k.label,
            k.is_operator,
            (SELECT json_agg(json_build_object('id', r.id, 'slug', r.slug, 'name', r.name)
                             ORDER BY r.name)
               FROM staff_key_venues g
               JOIN restaurants r ON r.id = g.restaurant_id
              WHERE g.key_id = k.id) AS venues
       FROM restaurant_staff_keys k
      WHERE k.id = $1::uuid AND k.revoked_at IS NULL
      LIMIT 1`,
    [keyId],
  );

  const row = rows[0];
  if (!row) return null;

  const venues = row.venues ?? [];
  if (!venues.some((venue) => venue.id === restaurantId)) return null;

  return {
    keyId,
    label: row.label,
    venues,
    isOperator: row.is_operator,
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* -------------------------------------------------------------------------- */
/*  Access key management                                                      */
/* -------------------------------------------------------------------------- */

export interface StaffKeySummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Every venue the key reaches, including ones the viewer cannot see. */
  venues: StaffVenue[];
  /** True for the key the viewer is currently signed in with. */
  isCurrent: boolean;
  isOperator: boolean;
}

/** Live keys that can reach this venue, newest first. */
export async function listStaffKeys(
  restaurantId: string,
  currentKeyId: string,
): Promise<StaffKeySummary[]> {
  if (!isDatabaseConfigured()) {
    return [
      {
        id: SEED_KEY_ID,
        label: "Development key",
        createdAt: new Date(0).toISOString(),
        lastUsedAt: null,
        venues: seedVenues(),
        isCurrent: currentKeyId === SEED_KEY_ID,
        isOperator: true,
      },
    ];
  }

  const rows = await query<{
    id: string;
    label: string;
    created_at: Date;
    last_used_at: Date | null;
    is_operator: boolean;
    venues: StaffVenue[] | null;
  }>(
    `SELECT k.id, k.label, k.created_at, k.last_used_at, k.is_operator,
            (SELECT json_agg(json_build_object('id', r.id, 'slug', r.slug, 'name', r.name)
                             ORDER BY r.name)
               FROM staff_key_venues g2
               JOIN restaurants r ON r.id = g2.restaurant_id
              WHERE g2.key_id = k.id) AS venues
       FROM restaurant_staff_keys k
       JOIN staff_key_venues g ON g.key_id = k.id
      WHERE g.restaurant_id = $1::uuid AND k.revoked_at IS NULL
      ORDER BY k.created_at DESC`,
    [restaurantId],
  );

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    venues: row.venues ?? [],
    isCurrent: row.id === currentKeyId,
    isOperator: row.is_operator,
  }));
}

export interface IssuedKey {
  id: string;
  label: string;
  /** The only time the plaintext exists outside the holder's hands. */
  key: string;
  venues: StaffVenue[];
  isOperator: boolean;
}

/**
 * Issues a key granting the given venues.
 *
 * `allowedVenueIds` is the issuer's own set, and the grant is intersected with
 * it: a key can hand on access it holds and no more. Without that, a manager
 * at one site could mint themselves a key for the whole group.
 */
export async function issueStaffKey(
  label: string,
  venueIds: string[],
  allowedVenueIds: string[],
  isOperator = false,
): Promise<IssuedKey | null> {
  const allowed = new Set(allowedVenueIds);
  const granted = [...new Set(venueIds)].filter((id) => allowed.has(id));
  if (granted.length === 0) return null;

  const key = generateStaffKey();

  if (!isDatabaseConfigured()) {
    // Seed mode has nowhere to store it, and pretending otherwise would hand
    // someone a key that stops working on the next reload.
    return null;
  }

  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO restaurant_staff_keys (key_hash, label, is_operator)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [hashStaffKey(normaliseStaffKey(key)), label, isOperator],
    );

    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("staff_key_not_issued");

    await client.query(
      `INSERT INTO staff_key_venues (key_id, restaurant_id)
       SELECT $1::uuid, r.id FROM restaurants r WHERE r.id = ANY($2::uuid[])`,
      [id, granted],
    );

    const venues = await client.query<StaffVenue>(
      `SELECT r.id, r.slug, r.name
         FROM staff_key_venues g
         JOIN restaurants r ON r.id = g.restaurant_id
        WHERE g.key_id = $1::uuid
        ORDER BY r.name`,
      [id],
    );

    return { id, label, key, venues: venues.rows, isOperator };
  });
}

export type RevokeOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "is_current" | "last_key" };

/**
 * Revokes a key, unless doing so locks someone out.
 *
 * Two refusals, both for the same reason: a key management screen that can
 * strand a venue with no way back in is worse than one that occasionally says
 * no. Revoking your own key ends your session mid-edit, and revoking the last
 * key for any venue the key reaches leaves that venue unreachable without a
 * database console.
 */
export async function revokeStaffKey(
  restaurantId: string,
  keyId: string,
  currentKeyId: string,
): Promise<RevokeOutcome> {
  if (keyId === currentKeyId) return { ok: false, reason: "is_current" };
  if (!isDatabaseConfigured()) return { ok: false, reason: "not_found" };
  if (!UUID.test(keyId)) return { ok: false, reason: "not_found" };

  return withTransaction(async (client) => {
    // Scoped through the grant table: a key id from a venue the caller cannot
    // reach is indistinguishable from one that does not exist.
    const visible = await client.query<{ id: string }>(
      `SELECT k.id
         FROM restaurant_staff_keys k
         JOIN staff_key_venues g ON g.key_id = k.id
        WHERE k.id = $1::uuid AND g.restaurant_id = $2::uuid
          AND k.revoked_at IS NULL
        LIMIT 1`,
      [keyId, restaurantId],
    );
    if (visible.rows.length === 0) return { ok: false, reason: "not_found" };

    const stranded = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM staff_key_venues g
        WHERE g.key_id = $1::uuid
          AND NOT EXISTS (
            SELECT 1
              FROM staff_key_venues other
              JOIN restaurant_staff_keys k ON k.id = other.key_id
             WHERE other.restaurant_id = g.restaurant_id
               AND other.key_id <> $1::uuid
               AND k.revoked_at IS NULL
          )`,
      [keyId],
    );
    if (Number(stranded.rows[0]?.count ?? 0) > 0) {
      return { ok: false, reason: "last_key" };
    }

    await client.query(
      `UPDATE restaurant_staff_keys SET revoked_at = now() WHERE id = $1::uuid`,
      [keyId],
    );
    return { ok: true };
  });
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

/* -------------------------------------------------------------------------- */
/*  Menu photo imports                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Reads per venue per hour.
 *
 * A vision call costs real money and the upload control accepts any photo a
 * phone can take, so an accidental loop or an over-enthusiastic member of
 * staff should cost a few pounds rather than an afternoon's revenue. Twelve is
 * generous for the real job — a menu is one to four photos — while capping the
 * damage.
 */
export const MENU_IMPORT_HOURLY_LIMIT = 12;

/** Reads by this venue in the last hour. Used to decide whether to spend. */
export async function recentImportCount(restaurantId: string): Promise<number> {
  if (!isDatabaseConfigured()) return devImportRuns.length;

  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM menu_import_runs
      WHERE restaurant_id = $1::uuid
        AND created_at > now() - interval '1 hour'`,
    [restaurantId],
  );
  return Number(rows[0]?.count ?? 0);
}

export interface ImportRunRecord {
  restaurantId: string;
  sourceChecksum: string;
  dishCount: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Without a database the editor still has to rate-limit, so runs are kept in
 * memory. Per-container and lost on restart, which is fine for the seed mode
 * this branch serves; the real limit is the SQL one above.
 */
const devImportRuns: { id: string; at: number }[] = [];

function pruneDevImportRuns(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (devImportRuns.length && (devImportRuns[0]?.at ?? 0) < cutoff) {
    devImportRuns.shift();
  }
}

/** Records a read and returns its id, which the commit step reports back. */
export async function recordImportRun(run: ImportRunRecord): Promise<string> {
  if (!isDatabaseConfigured()) {
    pruneDevImportRuns();
    const id = `import_${devImportRuns.length}_${Date.now().toString(36)}`;
    devImportRuns.push({ id, at: Date.now() });
    return id;
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO menu_import_runs
       (restaurant_id, source_checksum, dish_count, input_tokens, output_tokens)
     VALUES ($1::uuid, $2, $3, $4, $5)
     RETURNING id`,
    [
      run.restaurantId,
      run.sourceChecksum,
      run.dishCount,
      run.inputTokens,
      run.outputTokens,
    ],
  );

  const id = rows[0]?.id;
  if (!id) throw new Error("import_run_not_recorded");
  return id;
}

/**
 * Closes a run with what staff actually kept.
 *
 * Scoped by restaurant so a run id from another venue cannot be written to,
 * and best effort — losing the audit line is not a reason to fail an import
 * whose dishes are already saved.
 */
export async function closeImportRun(
  restaurantId: string,
  importId: string,
  committedCount: number,
): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return;

  await query(
    `UPDATE menu_import_runs
        SET committed_count = $3, committed_at = now()
      WHERE id = $2::uuid AND restaurant_id = $1::uuid`,
    [restaurantId, importId, committedCount],
  ).catch((error) => {
    console.error("[admin-repository] import run not closed", error);
  });
}

/* -------------------------------------------------------------------------- */
/*  Venues                                                                     */
/* -------------------------------------------------------------------------- */

export type CreateVenueOutcome =
  | { ok: true; venue: StaffVenue }
  | { ok: false; reason: "slug_taken" | "no_database" };

/**
 * Creates a venue and grants it to the key that created it.
 *
 * The grant is the point: an operator can only ever reach venues their key
 * holds, so creating one has to hand it over or the person who just onboarded
 * a restaurant could not open its menu. It grants that one venue and nothing
 * else, and the grant can be dropped again once the venue is handed over.
 */
export async function createRestaurant(
  draft: VenueDraft,
  operatorKeyId: string,
): Promise<CreateVenueOutcome> {
  if (!isDatabaseConfigured()) return { ok: false, reason: "no_database" };
  if (!UUID.test(operatorKeyId)) return { ok: false, reason: "no_database" };

  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query<StaffVenue>(
        `INSERT INTO restaurants
           (slug, name, tagline, currency, locale, primary_color, accent_color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, slug, name`,
        [
          draft.slug,
          draft.name,
          draft.tagline,
          draft.currency,
          draft.locale,
          draft.primaryColor,
          draft.accentColor,
        ],
      );

      const venue = inserted.rows[0];
      if (!venue) throw new Error("venue_not_created");

      await client.query(
        `INSERT INTO staff_key_venues (key_id, restaurant_id)
         VALUES ($1::uuid, $2::uuid)`,
        [operatorKeyId, venue.id],
      );

      return { ok: true as const, venue };
    });
  } catch (error) {
    // 23505 is the unique index on slug. Worth naming: two venues in a chain
    // called "The Anchor" is the normal case, not a fault.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "23505"
    ) {
      return { ok: false, reason: "slug_taken" };
    }
    throw error;
  }
}

/**
 * Updates a venue's name, tagline, currency, locale and branding.
 *
 * The slug is not in the list on purpose. It is the web address printed on
 * every table card in the room, so changing it silently breaks every code a
 * venue has already put out. Moving a venue to a new address is a job with a
 * redirect in it, not a text field.
 */
export async function updateRestaurant(
  restaurantId: string,
  draft: Omit<VenueDraft, "slug">,
): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    const current = restaurantOverlay().get(restaurantId);
    const base =
      current ?? SEED_RESTAURANTS.find((entry) => entry.id === restaurantId);
    if (!base) return false;
    restaurantOverlay().set(restaurantId, {
      ...base,
      name: draft.name,
      tagline: draft.tagline,
      currency: draft.currency,
      locale: draft.locale,
      branding: {
        ...base.branding,
        primaryColor: draft.primaryColor,
        accentColor: draft.accentColor,
      },
    });
    return true;
  }

  const rows = await query<{ id: string }>(
    `UPDATE restaurants
        SET name = $2, tagline = $3, currency = $4, locale = $5,
            primary_color = $6, accent_color = $7
      WHERE id = $1::uuid
      RETURNING id`,
    [
      restaurantId,
      draft.name,
      draft.tagline,
      draft.currency,
      draft.locale,
      draft.primaryColor,
      draft.accentColor,
    ],
  );
  return rows.length > 0;
}

export type LeaveOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "last_key" | "last_venue" };

/**
 * Drops this key's own grant to a venue: the hand-over.
 *
 * An operator who onboards fifty restaurants should not end up holding fifty
 * live grants, so once a venue has its own key the operator steps back out.
 * Two refusals, both to avoid stranding someone: leaving would take the
 * venue's last key with it, or it would leave this key reaching nothing and
 * unable to sign in at all.
 */
export async function leaveVenue(
  keyId: string,
  restaurantId: string,
): Promise<LeaveOutcome> {
  if (!isDatabaseConfigured()) return { ok: false, reason: "not_found" };
  if (!UUID.test(keyId) || !UUID.test(restaurantId)) {
    return { ok: false, reason: "not_found" };
  }

  return withTransaction(async (client) => {
    const held = await client.query<{ key_id: string }>(
      `SELECT key_id FROM staff_key_venues
        WHERE key_id = $1::uuid AND restaurant_id = $2::uuid`,
      [keyId, restaurantId],
    );
    if (held.rows.length === 0) return { ok: false, reason: "not_found" };

    const others = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM staff_key_venues g
         JOIN restaurant_staff_keys k ON k.id = g.key_id
        WHERE g.restaurant_id = $1::uuid
          AND g.key_id <> $2::uuid
          AND k.revoked_at IS NULL`,
      [restaurantId, keyId],
    );
    if (Number(others.rows[0]?.count ?? 0) === 0) {
      return { ok: false, reason: "last_key" };
    }

    const mine = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM staff_key_venues WHERE key_id = $1::uuid`,
      [keyId],
    );
    if (Number(mine.rows[0]?.count ?? 0) <= 1) {
      return { ok: false, reason: "last_venue" };
    }

    await client.query(
      `DELETE FROM staff_key_venues
        WHERE key_id = $1::uuid AND restaurant_id = $2::uuid`,
      [keyId, restaurantId],
    );
    return { ok: true };
  });
}
