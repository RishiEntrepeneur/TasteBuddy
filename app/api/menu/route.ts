import { NextResponse } from "next/server";

import { parseAllergenKeys } from "@/lib/allergens";
import { getMenuItems, getRestaurant } from "@/lib/db/repository";
import { evaluateMenu } from "@/lib/menu-filter";
import { parseNutritionThresholds } from "@/lib/nutrition";
import type {
  AllergenProfile,
  ApiError,
  MenuFilterMode,
  MenuResponse,
} from "@/lib/types";

/**
 * GET /api/menu
 *
 * Returns a restaurant's menu, dynamically filtered against the diner's
 * allergen profile and nutritional ceilings.
 *
 * Query parameters
 * ----------------
 *   restaurant   (required) UUID or QR slug, e.g. `aurelia-kitchen`
 *   allergens    comma-separated allergen keys, e.g. `peanuts,dairy,gluten`
 *   strict       `true` (default) also treats "may contain" as a conflict
 *   mode         `flag` (default) annotates conflicts | `exclude` hides them
 *   category     restrict to one course, e.g. `mains`
 *   q            fuzzy name/description search
 *   portions     `itemId:multiplier` pairs, e.g. `itm_pho_bo:1.5,itm_bun_cha:0.75`
 *   maxCalories / maxProtein / maxCarbs / maxFat / maxSugar / maxSodium / maxFiber
 *                upper bounds, evaluated against the *scaled* portion
 *
 * Example
 * -------
 *   /api/menu?restaurant=hanoi-house&allergens=peanuts,shellfish&maxSodium=1500&mode=exclude
 */

// The diner's profile lives entirely in the query string, so responses are
// cacheable per-URL but must never be shared across profiles.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MENU_CATEGORIES = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
] as const;

type MenuCategoryParam = (typeof MENU_CATEGORIES)[number];

function isCategory(value: string): value is MenuCategoryParam {
  return (MENU_CATEGORIES as readonly string[]).includes(value);
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/**
 * Parses `portions=itemId:1.5,otherId:0.75`. Malformed pairs are skipped so a
 * stale link degrades to default portions instead of 400-ing the whole menu.
 */
function parsePortions(raw: string | null): Record<string, number> {
  if (!raw) return {};
  const portions: Record<string, number> = {};
  for (const pair of raw.split(",")) {
    const separator = pair.lastIndexOf(":");
    if (separator <= 0) continue;
    const id = pair.slice(0, separator).trim();
    const value = Number(pair.slice(separator + 1));
    if (!id || !Number.isFinite(value) || value <= 0) continue;
    portions[id] = value;
  }
  return portions;
}

function parseMode(raw: string | null): MenuFilterMode {
  return raw === "exclude" ? "exclude" : "flag";
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;

  const restaurantRef = params.get("restaurant")?.trim();
  if (!restaurantRef) {
    return errorResponse(
      400,
      "missing_restaurant",
      "The `restaurant` query parameter is required.",
      { restaurant: "Pass a restaurant UUID or QR slug." },
    );
  }

  const category = params.get("category")?.trim().toLowerCase();
  if (category && !isCategory(category)) {
    return errorResponse(
      400,
      "invalid_category",
      `Unknown category "${category}".`,
      { category: `Expected one of: ${MENU_CATEGORIES.join(", ")}.` },
    );
  }

  const profile: AllergenProfile = {
    avoid: parseAllergenKeys(params.get("allergens")),
    // Strict is the safe default: only an explicit `strict=false` relaxes it.
    strict: params.get("strict") !== "false",
  };

  const thresholds = parseNutritionThresholds(params);
  const portions = parsePortions(params.get("portions"));
  const mode = parseMode(params.get("mode"));
  const search = params.get("q")?.trim().toLowerCase() ?? "";

  try {
    const restaurant = await getRestaurant(restaurantRef);
    if (!restaurant) {
      return errorResponse(
        404,
        "restaurant_not_found",
        `No restaurant matches "${restaurantRef}".`,
      );
    }

    const allItems = await getMenuItems(restaurant.id);

    const scoped = allItems.filter((item) => {
      if (category && item.category !== category) return false;
      if (!search) return true;
      return (
        item.name.toLowerCase().includes(search) ||
        item.description.toLowerCase().includes(search)
      );
    });

    const { items, hiddenItems } = evaluateMenu(scoped, {
      profile,
      thresholds,
      portions,
      mode,
    });

    const body: MenuResponse = {
      restaurant,
      items,
      meta: {
        totalItems: scoped.length,
        returnedItems: items.length,
        hiddenItems,
        appliedProfile: profile,
        appliedThresholds: thresholds,
        mode,
      },
    };

    return NextResponse.json<MenuResponse>(body, {
      status: 200,
      headers: {
        // Per-diner data — safe to reuse in the diner's own browser briefly,
        // never in a shared cache.
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("[api/menu] failed to build menu", error);
    return errorResponse(
      500,
      "menu_unavailable",
      "The menu could not be loaded. Please try again.",
    );
  }
}
