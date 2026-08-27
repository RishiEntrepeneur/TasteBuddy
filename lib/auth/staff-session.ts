import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Staff sessions for the menu editor.
 *
 * A venue signs in with an opaque access key; what it gets back is a signed,
 * httpOnly cookie naming the restaurant it may edit. The cookie is stateless —
 * an HMAC over the claims — so there is no session table to grow, expire or
 * replicate, and signing out is just clearing the cookie.
 *
 * The raw key never reaches client JavaScript after sign-in, and never lands
 * in a log: only its hash is compared, and only the cookie travels afterwards.
 */

export const STAFF_COOKIE = "tastebuddy_staff";

/** Eight hours — a shift, not a fortnight. */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * Signing secret.
 *
 * Hard failure in production rather than a shipped default: a known secret
 * lets anyone mint a session for any venue, which is the whole authorisation
 * boundary. Development gets a fixed value so reloads do not sign everyone out.
 */
function sessionSecret(): string {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "STAFF_SESSION_SECRET must be set (16+ characters) before staff sessions can be issued.",
    );
  }
  return "tastebuddy-development-session-secret";
}

/** Keys are high-entropy tokens, so a fast hash is correct here — see schema. */
export function hashStaffKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export interface StaffSession {
  restaurantId: string;
  /** Unix seconds. */
  expiresAt: number;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

/** Encodes a session as `<restaurantId>.<expiry>.<signature>`. */
export function mintSession(restaurantId: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${restaurantId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies a cookie value. Returns null for anything not currently valid —
 * malformed, tampered with, or expired — so callers have one thing to check.
 */
export function readSession(
  raw: string | undefined | null,
  now = Date.now(),
): StaffSession | null {
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  const [restaurantId, expiryText, signature] = parts;
  const expected = sign(`${restaurantId}.${expiryText}`);

  // Length check first: timingSafeEqual throws on a mismatch.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    return null;

  const expiresAt = Number(expiryText);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return null;

  return { restaurantId, expiresAt };
}

/** Cookie attributes. `secure` is dropped in dev so localhost still works. */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
