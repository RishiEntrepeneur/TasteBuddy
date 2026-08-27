import { NextResponse } from "next/server";

import { validateDraft, type DraftPayload } from "@/lib/admin/dish-validation";
import { currentStaff, unauthorised } from "@/lib/admin/staff-guard";
import {
  deleteMenuItem,
  listIngredientCatalogue,
  saveMenuItem,
  setMenuItemAvailability,
} from "@/lib/db/admin-repository";
import { getMenuItems, getRestaurant } from "@/lib/db/repository";
import { isVisionConfigured } from "@/lib/vision/menu-reader";
import type { ApiError } from "@/lib/types";

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

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                     */
/* -------------------------------------------------------------------------- */

export async function GET(): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();
  const { restaurantId } = staff;

  try {
    const [restaurant, items, catalogue] = await Promise.all([
      getRestaurant(restaurantId),
      getMenuItems(restaurantId, { includeUnavailable: true }),
      listIngredientCatalogue(),
    ]);

    return NextResponse.json(
      {
        restaurant,
        items,
        catalogue,
        // What this deployment can actually do, so the editor offers photo
        // import only where it is configured rather than showing a button
        // that answers 503.
        capabilities: { menuImport: isVisionConfigured() },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[api/admin/menu-items] list failed", error);
    return errorResponse(500, "load_failed", "The menu could not be loaded.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();
  const { restaurantId } = staff;

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
  const staff = await currentStaff();
  if (!staff) return unauthorised();
  const { restaurantId } = staff;

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
  const staff = await currentStaff();
  if (!staff) return unauthorised();
  const { restaurantId } = staff;

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
