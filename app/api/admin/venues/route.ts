import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { currentStaff, unauthorised } from "@/lib/admin/staff-guard";
import { validateVenue, type VenueDraft } from "@/lib/admin/venue-validation";
import {
  STAFF_COOKIE,
  mintSession,
  sessionCookieOptions,
} from "@/lib/auth/staff-session";
import {
  createRestaurant,
  leaveVenue,
  updateRestaurant,
} from "@/lib/db/admin-repository";
import { isDatabaseConfigured } from "@/lib/db/client";
import { getRestaurant } from "@/lib/db/repository";
import type { ApiError } from "@/lib/types";

/**
 * /api/admin/venues — onboarding a restaurant.
 *
 *   POST     Create a venue. Operator keys only.
 *   PATCH    Edit the venue currently open. Any key that reaches it.
 *   DELETE   Drop your own grant to it: the hand-over.
 *
 * Creating a venue is a capability rather than something every key has, so
 * handing a restaurant their own key never hands them the platform. The
 * creator is granted the new venue and nothing else, and the session is moved
 * onto it so the next thing they do is fill in its menu.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();

  if (!staff.isOperator) {
    return errorResponse(
      403,
      "not_an_operator",
      "This key edits menus. Creating venues needs an operator key.",
    );
  }

  if (!isDatabaseConfigured()) {
    return errorResponse(
      503,
      "no_database",
      "Creating a venue needs a database. This deployment is running on the built-in sample menu.",
    );
  }

  let payload: Partial<VenueDraft>;
  try {
    payload = (await request.json()) as Partial<VenueDraft>;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const validated = validateVenue(payload);
  if (!validated.ok) {
    return NextResponse.json<ApiError & { field?: string }>(
      {
        error: { code: "invalid_venue", message: validated.message },
        field: validated.field,
      },
      { status: 400 },
    );
  }

  try {
    const outcome = await createRestaurant(validated.draft, staff.keyId);
    if (!outcome.ok) {
      if (outcome.reason === "slug_taken") {
        return NextResponse.json<ApiError & { field?: string }>(
          {
            error: {
              code: "slug_taken",
              message: `Another venue already uses /${validated.draft.slug}. Pick a different web address.`,
            },
            field: "slug",
          },
          { status: 409 },
        );
      }
      return errorResponse(
        503,
        "no_database",
        "Creating a venue needs a database.",
      );
    }

    // Move the session onto the new venue: the next step is its menu.
    const store = await cookies();
    store.set(
      STAFF_COOKIE,
      mintSession(staff.keyId, outcome.venue.id),
      sessionCookieOptions(),
    );

    return NextResponse.json(
      { venue: outcome.venue, warnings: validated.warnings },
      { status: 201 },
    );
  } catch (error) {
    console.error("[api/admin/venues] create failed", error);
    return errorResponse(
      500,
      "create_failed",
      "That venue could not be created.",
    );
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();

  let payload: Partial<VenueDraft>;
  try {
    payload = (await request.json()) as Partial<VenueDraft>;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const current = await getRestaurant(staff.restaurantId);
  if (!current) {
    return errorResponse(404, "venue_not_found", "That venue no longer exists.");
  }

  // The slug is not editable, so it is taken from the row rather than the
  // request: it is printed on every table card already in the room.
  const validated = validateVenue({ ...payload, slug: current.slug });
  if (!validated.ok) {
    return NextResponse.json<ApiError & { field?: string }>(
      {
        error: { code: "invalid_venue", message: validated.message },
        field: validated.field,
      },
      { status: 400 },
    );
  }

  try {
    const changed = await updateRestaurant(staff.restaurantId, {
      name: validated.draft.name,
      tagline: validated.draft.tagline,
      currency: validated.draft.currency,
      locale: validated.draft.locale,
      primaryColor: validated.draft.primaryColor,
      accentColor: validated.draft.accentColor,
    });
    if (!changed) {
      return errorResponse(
        404,
        "venue_not_found",
        "That venue no longer exists.",
      );
    }
    return NextResponse.json({
      venue: {
        id: staff.restaurantId,
        slug: current.slug,
        name: validated.draft.name,
      },
      warnings: validated.warnings,
    });
  } catch (error) {
    console.error("[api/admin/venues] update failed", error);
    return errorResponse(500, "update_failed", "That change could not be saved.");
  }
}

export async function DELETE(): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();

  try {
    const outcome = await leaveVenue(staff.keyId, staff.restaurantId);
    if (outcome.ok) {
      // The grant is gone, so the cookie now names a venue this key cannot
      // reach. Move it to one it can.
      const next = staff.venues.find(
        (venue) => venue.id !== staff.restaurantId,
      );
      const store = await cookies();
      if (next) {
        store.set(
          STAFF_COOKIE,
          mintSession(staff.keyId, next.id),
          sessionCookieOptions(),
        );
      } else {
        store.delete(STAFF_COOKIE);
      }
      return NextResponse.json({ left: true, movedTo: next ?? null });
    }

    switch (outcome.reason) {
      case "last_key":
        return errorResponse(
          409,
          "last_key",
          "Yours is the only key left for this venue. Issue theirs before handing it over.",
        );
      case "last_venue":
        return errorResponse(
          409,
          "last_venue",
          "This is the only venue your key reaches, so leaving it would lock you out.",
        );
      default:
        return errorResponse(
          404,
          "not_found",
          "Your key does not hold this venue.",
        );
    }
  } catch (error) {
    console.error("[api/admin/venues] leave failed", error);
    return errorResponse(500, "leave_failed", "That could not be saved.");
  }
}
