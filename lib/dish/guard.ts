import { NextResponse } from "next/server";

import { ExplainError, isConfigured } from "@/lib/dish/explain";
import { checkLimit } from "@/lib/dish/rate-limit";
import type { ApiError } from "@/lib/types";

/**
 * What both diner routes have to do before they spend anything.
 *
 * No sign-in, so the only thing standing between the app and an open bill is
 * the token check and the limit, and both happen before a single byte reaches
 * the model.
 */

/** Matches the CHECK constraint on `lookups.diner_token`. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>(
    { error: { code, message } },
    { status, headers },
  );
}

export type GateResult =
  | { ok: true; token: string }
  | { ok: false; response: NextResponse<ApiError> };

export async function gate(rawToken: unknown): Promise<GateResult> {
  if (!isConfigured()) {
    return {
      ok: false,
      response: errorResponse(
        503,
        "not_configured",
        "This app is not switched on yet.",
      ),
    };
  }

  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "missing_token",
        "Reload the page and try again.",
      ),
    };
  }

  let decision;
  try {
    decision = await checkLimit(token);
  } catch (error) {
    console.error("[dish/guard] limit check failed", error);
    return {
      ok: false,
      response: errorResponse(
        500,
        "unavailable",
        "That did not work. Try again in a moment.",
      ),
    };
  }

  if (!decision.ok) {
    return {
      ok: false,
      response: errorResponse(
        429,
        decision.reason,
        decision.reason === "too_many_here"
          ? "That is a lot of looking up in one hour. Give it a little while."
          : "The app has hit its spending limit for today. It will come back tomorrow.",
        { "Retry-After": "3600" },
      ),
    };
  }

  return { ok: true, token };
}

/** Maps a failure from the model onto something a diner can act on. */
export function explainErrorResponse(error: unknown): NextResponse<ApiError> {
  if (error instanceof ExplainError) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "not_configured"
          ? 503
          : error.code === "photo_rejected"
            ? 400
            : 502;
    return errorResponse(
      status,
      error.code,
      error.message,
      error.retryAfterSeconds
        ? { "Retry-After": String(Math.ceil(error.retryAfterSeconds)) }
        : undefined,
    );
  }
  console.error("[dish] unexpected failure", error);
  return errorResponse(
    502,
    "unavailable",
    "That did not work. Try again in a moment.",
  );
}
