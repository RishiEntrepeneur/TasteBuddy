import { NextResponse } from "next/server";

import { PictureError, cleanDishName, drawDish } from "@/lib/dish/picture";

/**
 * /api/dish-image?dish=Masala%20dosa — a drawing of one dish.
 *
 * Proxied rather than linked straight from the page, for three reasons. The
 * diner's browser never talks to the drawing service, so their address does
 * not go with the request. The response gets this app's own cache headers, so
 * a CDN holds each dish for a year and "masala dosa" is drawn once, ever, for
 * everybody — which is the whole cost story. And a failure comes back as this
 * app's failure, which the dish screen already knows how to fall back from.
 *
 * There is no rate limit here on purpose: it costs nothing, it is cached by
 * name rather than by diner, and the two routes that *do* spend money are
 * capped already.
 */

export const runtime = "nodejs";

/** A drawing takes a while to make and no time at all to serve again. */
export const maxDuration = 30;

const YEAR = 60 * 60 * 24 * 365;

export async function GET(request: Request): Promise<NextResponse> {
  const dish = cleanDishName(
    new URL(request.url).searchParams.get("dish") ?? "",
  );

  try {
    const picture = await drawDish(dish);
    return new NextResponse(picture.bytes, {
      headers: {
        "Content-Type": picture.mediaType,
        // Same dish, same seed, same drawing — so it never needs making twice.
        "Cache-Control": `public, max-age=${YEAR}, s-maxage=${YEAR}, immutable`,
      },
    }) as NextResponse;
  } catch (error) {
    const code = error instanceof PictureError ? error.code : "upstream";
    // The diner sees the 3D model and nothing else, which is the right outcome
    // for them and a silent one for whoever is running this. Say it in the log.
    if (code !== "off") {
      console.error("[dish-image] no drawing for", JSON.stringify(dish), error);
    }
    // The screen falls back to the model it built itself, so this is a
    // non-event for the diner and should not be cached as one.
    const status = code === "bad_name" ? 400 : code === "off" ? 503 : 502;
    return NextResponse.json(
      { error: { code, message: "No drawing for this one." } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
