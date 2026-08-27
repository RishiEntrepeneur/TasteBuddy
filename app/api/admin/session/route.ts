import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { currentStaff } from "@/lib/admin/staff-guard";
import {
  STAFF_COOKIE,
  mintSession,
  sessionCookieOptions,
} from "@/lib/auth/staff-session";
import { identifyStaffKey } from "@/lib/db/admin-repository";
import type { ApiError } from "@/lib/types";

/**
 * /api/admin/session — staff sign-in for the menu editor.
 *
 *   POST    { key }         Exchange an access key for a session cookie.
 *   GET                     Who am I, and which venues can I reach?
 *   PATCH   { restaurantId} Switch to another venue the same key reaches.
 *   DELETE                  Sign out.
 *
 * The venues a session can reach are taken from the key's grants, never from
 * the request. Switching venues re-checks the grant and mints a fresh cookie,
 * so the cookie is always a claim the database agreed with at the time.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  let key: unknown;
  try {
    ({ key } = (await request.json()) as { key?: unknown });
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  if (typeof key !== "string" || key.trim().length < 8) {
    return errorResponse(400, "missing_key", "An access key is required.");
  }

  const identity = await identifyStaffKey(key);
  if (!identity) {
    // Deliberately identical to a malformed key: distinguishing them tells an
    // attacker which half of a guess was right.
    return errorResponse(
      401,
      "invalid_key",
      "That access key was not recognised.",
    );
  }

  // A group key lands on its first venue alphabetically; the switcher moves.
  const venue = identity.venues[0];
  if (!venue) {
    return errorResponse(
      403,
      "no_venues",
      "That key does not reach any venue yet.",
    );
  }

  const store = await cookies();
  store.set(
    STAFF_COOKIE,
    mintSession(identity.keyId, venue.id),
    sessionCookieOptions(),
  );

  return NextResponse.json({
    restaurant: venue,
    venues: identity.venues,
    keyLabel: identity.label,
  });
}

export async function GET(): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ signedIn: false }, { status: 200 });

  const venue = staff.venues.find((entry) => entry.id === staff.restaurantId);
  if (!venue) return NextResponse.json({ signedIn: false }, { status: 200 });

  return NextResponse.json({
    signedIn: true,
    restaurant: venue,
    venues: staff.venues,
    keyLabel: staff.label,
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return errorResponse(401, "not_signed_in", "Sign in first.");

  let restaurantId: unknown;
  try {
    ({ restaurantId } = (await request.json()) as { restaurantId?: unknown });
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const venue = staff.venues.find((entry) => entry.id === restaurantId);
  if (!venue) {
    // Not 403: naming which venues exist but are out of reach would map the
    // group for anyone holding one site's key.
    return errorResponse(
      404,
      "venue_not_found",
      "Your key does not reach that venue.",
    );
  }

  const store = await cookies();
  store.set(
    STAFF_COOKIE,
    mintSession(staff.keyId, venue.id),
    sessionCookieOptions(),
  );

  return NextResponse.json({ restaurant: venue, venues: staff.venues });
}

export async function DELETE(): Promise<NextResponse> {
  const store = await cookies();
  store.delete(STAFF_COOKIE);
  return NextResponse.json({ signedOut: true });
}
