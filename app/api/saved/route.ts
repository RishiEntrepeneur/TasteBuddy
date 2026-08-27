import { NextResponse } from "next/server";

import { getSavedDishDetails, saveDish, unsaveDish } from "@/lib/db/repository";
import type { ApiError } from "@/lib/types";

/**
 * /api/saved — the diner's kept dishes.
 *
 *   GET     ?token=…                    List, hydrated into full menu items.
 *   POST    { token, menuItemId, note } Save. Idempotent.
 *   DELETE  ?token=…&menuItemId=…       Remove.
 *
 * Authorisation
 * -------------
 * There are no accounts. The token *is* the credential: whoever holds it can
 * read and change that list, so it is required to be high-entropy and nothing
 * identifying is stored beside it. That is an acceptable trade for a
 * favourites list and would not be for anything else — which is also why the
 * allergen profile is never sent here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches the CHECK constraint on `saved_dishes.diner_token`. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

function errorResponse(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

function readToken(value: string | null | undefined): string | null {
  const token = value?.trim();
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = readToken(new URL(request.url).searchParams.get("token"));
  if (!token) {
    return errorResponse(400, "invalid_token", "A valid `token` is required.");
  }

  try {
    const details = await getSavedDishDetails(token);
    return NextResponse.json(
      {
        items: details.map(({ saved, item, restaurant }) => ({
          savedAt: saved.savedAt,
          note: saved.note,
          item,
          restaurant: {
            id: restaurant.id,
            slug: restaurant.slug,
            name: restaurant.name,
          },
        })),
        count: details.length,
      },
      // A personal list — cacheable in the diner's own browser, nowhere else.
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[api/saved] list failed", error);
    return errorResponse(
      500,
      "saved_unavailable",
      "Your saved dishes could not be loaded.",
    );
  }
}

interface SavePayload {
  token?: unknown;
  menuItemId?: unknown;
  note?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: SavePayload;
  try {
    payload = (await request.json()) as SavePayload;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const token = readToken(
    typeof payload.token === "string" ? payload.token : null,
  );
  if (!token) {
    return errorResponse(400, "invalid_token", "A valid `token` is required.");
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

  // Free text goes to the kitchen's screen eventually; cap it here.
  const note =
    typeof payload.note === "string" && payload.note.trim()
      ? payload.note.trim().slice(0, 280)
      : null;

  try {
    const saved = await saveDish(token, menuItemId, note);
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    console.error("[api/saved] save failed", error);
    return errorResponse(500, "save_failed", "That dish could not be saved.");
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const token = readToken(params.get("token"));
  const menuItemId = params.get("menuItemId")?.trim();

  if (!token) {
    return errorResponse(400, "invalid_token", "A valid `token` is required.");
  }
  if (!menuItemId) {
    return errorResponse(
      400,
      "missing_menu_item",
      "A `menuItemId` is required.",
    );
  }

  try {
    const removed = await unsaveDish(token, menuItemId);
    return NextResponse.json({ removed }, { status: 200 });
  } catch (error) {
    console.error("[api/saved] remove failed", error);
    return errorResponse(
      500,
      "remove_failed",
      "That dish could not be removed.",
    );
  }
}
