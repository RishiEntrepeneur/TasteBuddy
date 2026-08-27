import { NextResponse } from "next/server";

import { currentStaff, unauthorised } from "@/lib/admin/staff-guard";
import {
  issueStaffKey,
  listStaffKeys,
  revokeStaffKey,
} from "@/lib/db/admin-repository";
import { isDatabaseConfigured } from "@/lib/db/client";
import type { ApiError } from "@/lib/types";

/**
 * /api/admin/keys — who can get into this venue's menu.
 *
 *   GET      Live keys reaching the current venue.
 *   POST     Issue one. The plaintext is in the response and nowhere else.
 *   DELETE   Revoke one.
 *
 * Issuing is bounded by the caller's own grants: a key can pass on access it
 * holds and no more, so a manager at one site cannot mint themselves a key for
 * the group. Revoking refuses the two moves that would strand someone.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LABEL = 60;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

export async function GET(): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();

  try {
    const keys = await listStaffKeys(staff.restaurantId, staff.keyId);
    return NextResponse.json(
      {
        keys,
        // Which venue is being viewed, so the list can say what *else* a key
        // reaches rather than repeating where you already are.
        currentVenueId: staff.restaurantId,
        // Which venues this caller may put on a new key. Sent so the form can
        // only offer what the server would accept.
        grantableVenues: staff.venues,
        canIssue: isDatabaseConfigured(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[api/admin/keys] list failed", error);
    return errorResponse(500, "load_failed", "Keys could not be loaded.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();

  if (!isDatabaseConfigured()) {
    return errorResponse(
      503,
      "no_database",
      "Issuing keys needs a database. This deployment is running on the built-in sample menu.",
    );
  }

  let payload: { label?: unknown; venueIds?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  const label =
    typeof payload.label === "string" ? payload.label.trim().slice(0, MAX_LABEL) : "";
  if (label.length < 2) {
    return errorResponse(
      400,
      "missing_label",
      "Name the key after where it lives, like “Pass iPad” or “Ana, head chef”.",
    );
  }

  // Defaults to the venue being edited, which is what a single-site venue wants
  // and what a group manager gets if they tick nothing.
  const requested = Array.isArray(payload.venueIds)
    ? payload.venueIds.filter((id): id is string => typeof id === "string")
    : [staff.restaurantId];

  try {
    const issued = await issueStaffKey(
      label,
      requested,
      staff.venues.map((venue) => venue.id),
    );
    if (!issued) {
      return errorResponse(
        400,
        "no_venues",
        "Pick at least one venue your own key reaches.",
      );
    }
    return NextResponse.json(issued, { status: 201 });
  } catch (error) {
    console.error("[api/admin/keys] issue failed", error);
    return errorResponse(500, "issue_failed", "That key could not be issued.");
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const staff = await currentStaff();
  if (!staff) return unauthorised();

  const keyId = new URL(request.url).searchParams.get("keyId")?.trim();
  if (!keyId) {
    return errorResponse(400, "missing_key", "A `keyId` is required.");
  }

  try {
    const outcome = await revokeStaffKey(
      staff.restaurantId,
      keyId,
      staff.keyId,
    );
    if (outcome.ok) return NextResponse.json({ revoked: true });

    switch (outcome.reason) {
      case "is_current":
        return errorResponse(
          409,
          "is_current",
          "That is the key you are signed in with. Sign in with another one first.",
        );
      case "last_key":
        return errorResponse(
          409,
          "last_key",
          "That is the only key left for at least one venue it reaches. Issue a replacement before revoking it.",
        );
      default:
        // Same answer for a key that never existed and one belonging to a
        // venue this caller cannot reach.
        return errorResponse(404, "not_found", "No such key at this venue.");
    }
  } catch (error) {
    console.error("[api/admin/keys] revoke failed", error);
    return errorResponse(500, "revoke_failed", "That key could not be revoked.");
  }
}
