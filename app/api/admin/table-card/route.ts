import { NextResponse } from "next/server";

import { currentStaff, unauthorised } from "@/lib/admin/staff-guard";
import { readableInk } from "@/lib/brand";
import { getRestaurant } from "@/lib/db/repository";
import { renderTableCard } from "@/lib/onboarding/table-card";
import type { ApiError } from "@/lib/types";

/**
 * /api/admin/table-card — the card a venue puts on the table.
 *
 *   GET              JSON: the card's SVG plus what it will point at.
 *   GET ?download=1  The SVG itself, as a file.
 *
 * The address on the card is the one thing worth being careful about, because
 * a card is printed once and lives on a table for a year. It comes from
 * `NEXT_PUBLIC_APP_URL` when that is set, and only falls back to the origin
 * the request arrived on. The response says which, so the editor can refuse to
 * let anyone print a hundred cards pointing at localhost.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/** Origins a diner's phone will never resolve. */
function isReachablePublicly(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:" && protocol !== "http:") return false;
    if (hostname === "localhost" || hostname === "127.0.0.1") return false;
    if (hostname.endsWith(".local")) return false;
    // RFC 1918 and link-local: fine on the venue's own wifi, wrong on a card.
    if (/^10\./.test(hostname)) return false;
    if (/^192\.168\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    if (/^169\.254\./.test(hostname)) return false;
    return hostname.includes(".");
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();

  const restaurant = await getRestaurant(staff.restaurantId);
  if (!restaurant) {
    return errorResponse(404, "venue_not_found", "That venue no longer exists.");
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const origin = configured || new URL(request.url).origin;
  const url = `${origin}/restaurant/${restaurant.slug}`;

  const card = renderTableCard({
    venueName: restaurant.name,
    url,
    displayUrl: url.replace(/^https?:\/\//, ""),
    // The card is printed, so it uses the venue's own colours with a
    // foreground measured against them rather than assumed.
    ground: restaurant.branding.primaryColor,
    ink: readableInk(restaurant.branding.primaryColor),
    invitation: "Scan to see every dish in 3D",
  });

  if (new URL(request.url).searchParams.get("download") === "1") {
    return new NextResponse(card.svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${restaurant.slug}-table-card.svg"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return NextResponse.json(
    {
      svg: card.svg,
      url,
      modules: card.modules,
      moduleMm: card.moduleMm,
      /** False means: do not print this yet. */
      publiclyReachable: isReachablePublicly(origin),
      originSource: configured ? "configured" : "request",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
