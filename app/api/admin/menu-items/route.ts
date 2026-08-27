import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isAllergenKey } from "@/lib/allergens";
import { STAFF_COOKIE, readSession } from "@/lib/auth/staff-session";
import {
  deleteMenuItem,
  listIngredientCatalogue,
  saveMenuItem,
  setMenuItemAvailability,
  type MenuItemDraft,
} from "@/lib/db/admin-repository";
import { getMenuItems, getRestaurant } from "@/lib/db/repository";
import {
  NUTRITION_KEYS,
  type AllergenSeverity,
  type ApiError,
  type MenuCategory,
  type MenuItemAllergen,
  type NutritionFacts,
} from "@/lib/types";

/**
 * /api/admin/menu-items — the editor's write surface.
 *
 *   GET     Every dish for the signed-in venue, plus the ingredient catalogue.
 *   POST    Create or update a dish.
 *   PATCH   Toggle availability (the one edit staff make mid-service).
 *   DELETE  Remove a dish.
 *
 * The venue is always taken from the session cookie. No route reads a
 * restaurant id from the caller, so there is no request shape that reaches
 * another venue's data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];
const SEVERITIES: readonly AllergenSeverity[] = [
  "contains",
  "may_contain",
  "removable",
];

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/** Resolves the signed-in venue, or null when there is no valid session. */
async function currentRestaurantId(): Promise<string | null> {
  const store = await cookies();
  return readSession(store.get(STAFF_COOKIE)?.value)?.restaurantId ?? null;
}

function unauthorised() {
  return errorResponse(
    401,
    "not_signed_in",
    "Sign in with your venue access key.",
  );
}

/* -------------------------------------------------------------------------- */
/*  Validation                                                                 */
/* -------------------------------------------------------------------------- */

interface DraftPayload {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  category?: unknown;
  priceCents?: unknown;
  basePortionGrams?: unknown;
  nutrition?: unknown;
  isAvailable?: unknown;
  allergens?: unknown;
  ingredients?: unknown;
}

type Validated =
  | { ok: true; draft: MenuItemDraft }
  | { ok: false; message: string };

/**
 * Validates a submitted dish.
 *
 * Strict on anything a diner's safety depends on — an allergen key that is not
 * recognised is rejected rather than dropped, because a silently discarded
 * declaration is exactly the failure this product exists to prevent.
 */
function validateDraft(payload: DraftPayload): Validated {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    return {
      ok: false,
      message: "A dish needs a name between 2 and 120 characters.",
    };
  }

  const description =
    typeof payload.description === "string"
      ? payload.description.trim().slice(0, 600)
      : "";

  const category = payload.category;
  if (
    typeof category !== "string" ||
    !CATEGORIES.includes(category as MenuCategory)
  ) {
    return {
      ok: false,
      message: `Category must be one of: ${CATEGORIES.join(", ")}.`,
    };
  }

  const priceCents = Number(payload.priceCents);
  if (
    !Number.isInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > 10_000_00
  ) {
    return {
      ok: false,
      message: "Price must be a whole number of pence between 0 and 1,000,000.",
    };
  }

  const basePortionGrams = Number(payload.basePortionGrams);
  if (
    !Number.isFinite(basePortionGrams) ||
    basePortionGrams <= 0 ||
    basePortionGrams > 5000
  ) {
    return {
      ok: false,
      message: "Portion weight must be between 1 and 5000 grams.",
    };
  }

  const rawNutrition = (payload.nutrition ?? {}) as Record<string, unknown>;
  const nutrition = {} as NutritionFacts;
  for (const key of NUTRITION_KEYS) {
    const value = Number(rawNutrition[key] ?? 0);
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, message: `${key} must be zero or more.` };
    }
    nutrition[key] = value;
  }

  const allergens: MenuItemAllergen[] = [];
  if (payload.allergens !== undefined) {
    if (!Array.isArray(payload.allergens)) {
      return { ok: false, message: "`allergens` must be a list." };
    }
    for (const raw of payload.allergens) {
      const entry = raw as {
        key?: unknown;
        severity?: unknown;
        note?: unknown;
      };
      if (typeof entry.key !== "string" || !isAllergenKey(entry.key)) {
        return {
          ok: false,
          message: `Unknown allergen "${String(entry.key)}".`,
        };
      }
      if (
        typeof entry.severity !== "string" ||
        !SEVERITIES.includes(entry.severity as AllergenSeverity)
      ) {
        return {
          ok: false,
          message: `Severity must be one of: ${SEVERITIES.join(", ")}.`,
        };
      }
      allergens.push({
        key: entry.key,
        severity: entry.severity as AllergenSeverity,
        note:
          typeof entry.note === "string" && entry.note.trim()
            ? entry.note.trim().slice(0, 200)
            : undefined,
      });
    }
  }

  const ingredients: MenuItemDraft["ingredients"] = [];
  if (payload.ingredients !== undefined) {
    if (!Array.isArray(payload.ingredients)) {
      return { ok: false, message: "`ingredients` must be a list." };
    }
    for (const raw of payload.ingredients) {
      const line = raw as {
        slug?: unknown;
        quantityG?: unknown;
        isOptional?: unknown;
      };
      if (
        typeof line.slug !== "string" ||
        !/^[a-z0-9][a-z0-9-]{1,62}$/.test(line.slug)
      ) {
        return {
          ok: false,
          message: `Invalid ingredient "${String(line.slug)}".`,
        };
      }
      const quantity =
        line.quantityG === null || line.quantityG === undefined
          ? null
          : Number(line.quantityG);
      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
        return {
          ok: false,
          message: `Quantity for "${line.slug}" must be positive or blank.`,
        };
      }
      ingredients.push({
        slug: line.slug,
        quantityG: quantity,
        isOptional: line.isOptional === true,
      });
    }
  }

  return {
    ok: true,
    draft: {
      id:
        typeof payload.id === "string" && payload.id.trim()
          ? payload.id.trim()
          : undefined,
      name,
      description,
      category: category as MenuCategory,
      priceCents,
      basePortionGrams,
      nutrition,
      isAvailable: payload.isAvailable !== false,
      allergens,
      ingredients,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                     */
/* -------------------------------------------------------------------------- */

export async function GET(): Promise<NextResponse> {
  const restaurantId = await currentRestaurantId();
  if (!restaurantId) return unauthorised();

  try {
    const [restaurant, items, catalogue] = await Promise.all([
      getRestaurant(restaurantId),
      getMenuItems(restaurantId, { includeUnavailable: true }),
      listIngredientCatalogue(),
    ]);

    return NextResponse.json(
      { restaurant, items, catalogue },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[api/admin/menu-items] list failed", error);
    return errorResponse(500, "load_failed", "The menu could not be loaded.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const restaurantId = await currentRestaurantId();
  if (!restaurantId) return unauthorised();

  let payload: DraftPayload;
  try {
    payload = (await request.json()) as DraftPayload;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const validated = validateDraft(payload);
  if (!validated.ok) {
    return errorResponse(400, "invalid_dish", validated.message);
  }

  try {
    const result = await saveMenuItem(restaurantId, validated.draft);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "menu_item_not_found") {
      // Either genuinely gone, or belongs to another venue. Same answer either
      // way — confirming existence would leak another venue's ids.
      return errorResponse(
        404,
        "menu_item_not_found",
        "That dish is not on your menu.",
      );
    }
    console.error("[api/admin/menu-items] save failed", error);
    return errorResponse(500, "save_failed", "That dish could not be saved.");
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const restaurantId = await currentRestaurantId();
  if (!restaurantId) return unauthorised();

  let payload: { menuItemId?: unknown; isAvailable?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const menuItemId =
    typeof payload.menuItemId === "string" ? payload.menuItemId.trim() : "";
  if (!menuItemId) {
    return errorResponse(
      400,
      "missing_menu_item",
      "A `menuItemId` is required.",
    );
  }
  if (typeof payload.isAvailable !== "boolean") {
    return errorResponse(
      400,
      "missing_availability",
      "`isAvailable` must be true or false.",
    );
  }

  try {
    const changed = await setMenuItemAvailability(
      restaurantId,
      menuItemId,
      payload.isAvailable,
    );
    if (!changed) {
      return errorResponse(
        404,
        "menu_item_not_found",
        "That dish is not on your menu.",
      );
    }
    return NextResponse.json({ menuItemId, isAvailable: payload.isAvailable });
  } catch (error) {
    console.error("[api/admin/menu-items] availability failed", error);
    return errorResponse(
      500,
      "update_failed",
      "That change could not be saved.",
    );
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const restaurantId = await currentRestaurantId();
  if (!restaurantId) return unauthorised();

  const menuItemId = new URL(request.url).searchParams
    .get("menuItemId")
    ?.trim();
  if (!menuItemId) {
    return errorResponse(
      400,
      "missing_menu_item",
      "A `menuItemId` is required.",
    );
  }

  try {
    const removed = await deleteMenuItem(restaurantId, menuItemId);
    if (!removed) {
      return errorResponse(
        404,
        "menu_item_not_found",
        "That dish is not on your menu.",
      );
    }
    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error("[api/admin/menu-items] delete failed", error);
    return errorResponse(
      500,
      "delete_failed",
      "That dish could not be removed.",
    );
  }
}
