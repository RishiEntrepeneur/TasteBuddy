import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  STAFF_COOKIE,
  mintSession,
  readSession,
  sessionCookieOptions,
} from "@/lib/auth/staff-session";
import { restaurantForStaffKey } from "@/lib/db/admin-repository";
import { getRestaurant } from "@/lib/db/repository";
import type { ApiError } from "@/lib/types";

/**
 * /api/admin/session — staff sign-in for the menu editor.
 *
 *   POST   { key }  Exchange an access key for a session cookie.
 *   GET             Who am I? Used by the editor to decide what to render.
 *   DELETE          Sign out.
 *
 * The venue a session grants is taken from the key's stored row, never from
 * the request — so a key cannot be presented against a venue it was not
 * issued for, and the client cannot ask for more than it has.
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

  const restaurantId = await restaurantForStaffKey(key.trim());
  if (!restaurantId) {
    // Deliberately identical to a malformed key: distinguishing them tells an
    // attacker which half of a guess was right.
    return errorResponse(
      401,
      "invalid_key",
      "That access key was not recognised.",
    );
  }

  const restaurant = await getRestaurant(restaurantId);
  if (!restaurant) {
    return errorResponse(
      404,
      "restaurant_not_found",
      "That venue no longer exists.",
    );
  }

  const store = await cookies();
  store.set(STAFF_COOKIE, mintSession(restaurantId), sessionCookieOptions());

  return NextResponse.json({
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
    },
  });
}

export async function GET(): Promise<NextResponse> {
  const store = await cookies();
  const session = readSession(store.get(STAFF_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ signedIn: false }, { status: 200 });
  }

  const restaurant = await getRestaurant(session.restaurantId);
  if (!restaurant) {
    return NextResponse.json({ signedIn: false }, { status: 200 });
  }

  return NextResponse.json({
    signedIn: true,
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
    },
    expiresAt: session.expiresAt,
  });
}

export async function DELETE(): Promise<NextResponse> {
  const store = await cookies();
  store.delete(STAFF_COOKIE);
  return NextResponse.json({ signedOut: true });
}
