import { NextResponse } from "next/server";

import { ExplainError, explainDish } from "@/lib/dish/explain";
import { errorResponse, explainErrorResponse, gate } from "@/lib/dish/guard";
import { recordLookup } from "@/lib/dish/rate-limit";

/**
 * /api/explain — one dish name, to everything the app can say about it.
 *
 * Reached two ways: tapping a dish read off a photo, and typing a name in.
 * `context` carries whatever else was on the menu line, which is what separates
 * a Margherita at a pizzeria from one at a cocktail bar.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One dish is quick, but not always ten-seconds quick. See /api/read-menu. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  let payload: { token?: unknown; name?: unknown; context?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const allowed = await gate(payload.token);
  if (!allowed.ok) return allowed.response;

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    return errorResponse(
      400,
      "missing_name",
      "Type the name of a dish, at least two characters.",
    );
  }

  const context =
    typeof payload.context === "string" ? payload.context.trim().slice(0, 300) : "";

  try {
    const dish = await explainDish(name, context);
    await recordLookup(allowed.token, "dish", dish.usage);

    // Token counts are the app owner's business, not the diner's.
    return NextResponse.json(
      {
        printedName: dish.printedName,
        englishName: dish.englishName,
        oneLine: dish.oneLine,
        priceText: dish.priceText,
        course: dish.course,
        dietary: dish.dietary,
        spice: dish.spice,
        likelyAllergens: dish.likelyAllergens,
        recognised: dish.recognised,
        whatItIs: dish.whatItIs,
        tastesLike: dish.tastesLike,
        origin: dish.origin,
        madeWith: dish.madeWith,
        servedAs: dish.servedAs,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ExplainError && error.usage) {
      await recordLookup(allowed.token, "dish", error.usage);
    }
    return explainErrorResponse(error);
  }
}
