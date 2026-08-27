import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { STAFF_COOKIE, readSession } from "@/lib/auth/staff-session";
import { staffContext, type StaffIdentity } from "@/lib/db/admin-repository";
import type { ApiError } from "@/lib/types";

/**
 * The one gate every admin route goes through.
 *
 * Two checks, not one. The cookie's signature proves nobody forged it; the
 * database read proves the key behind it is still live and still reaches the
 * venue in question. Only the first can be done offline, and only the second
 * survives a key being revoked ten minutes ago.
 *
 * The venue always comes from the cookie. No admin route reads a restaurant id
 * from the caller, so there is no request shape that reaches another venue's
 * data.
 */

export interface StaffContext extends StaffIdentity {
  /** The venue being edited right now. */
  restaurantId: string;
}

export function unauthorised(): NextResponse {
  return NextResponse.json<ApiError>(
    {
      error: {
        code: "not_signed_in",
        message: "Sign in with your venue access key.",
      },
    },
    { status: 401 },
  );
}

/** Resolves the signed-in staff context, or null when there is not one. */
export async function currentStaff(): Promise<StaffContext | null> {
  const store = await cookies();
  const session = readSession(store.get(STAFF_COOKIE)?.value);
  if (!session) return null;

  const identity = await staffContext(session.keyId, session.restaurantId);
  if (!identity) return null;

  return { ...identity, restaurantId: session.restaurantId };
}
