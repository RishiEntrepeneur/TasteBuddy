import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Staff sessions for the menu editor.
 *
 * A venue signs in with an opaque access key; what it gets back is a signed,
 * httpOnly cookie naming the key and the venue currently being edited. The
 * cookie is stateless (an HMAC over the claims), so there is no session table
 * to grow, expire or replicate, and signing out is just clearing the cookie.
 *
 * Stateless does not mean unrevokable. The cookie carries the key id, and
 * `staffContext` re-reads that key's grants on every admin request, so a
 * revoked key, or a venue taken off it, stops working within one request
 * rather than at the end of an eight-hour cookie.
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
  /** The key this session was minted from. */
  keyId: string;
  /** The venue currently being edited — one of the venues the key grants. */
  restaurantId: string;
  /** Unix seconds. */
  expiresAt: number;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
}

/**
 * Encodes a session as `<keyId>.<restaurantId>.<expiry>.<signature>`.
 *
 * The key id rides along because a signed cookie alone cannot be taken back.
 * Callers re-check the grant against the database, so revoking a key ends the
 * shift it is being used on rather than waiting out the eight hours — which is
 * the only behaviour worth having when the reason for revoking is a lost iPad.
 */
export function mintSession(
  keyId: string,
  restaurantId: string,
  now = Date.now(),
): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${keyId}.${restaurantId}.${expiresAt}`;
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
  if (parts.length !== 4) return null;

  const [keyId, restaurantId, expiryText, signature] = parts;
  if (!keyId || !restaurantId || !expiryText || !signature) return null;

  const expected = sign(`${keyId}.${restaurantId}.${expiryText}`);

  // Length check first: timingSafeEqual throws on a mismatch.
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    return null;

  const expiresAt = Number(expiryText);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return null;

  return { keyId, restaurantId, expiresAt };
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

/** Marks a TasteBuddy key on sight, in a log or a paste into the wrong window. */
export const STAFF_KEY_PREFIX = "tb";

/**
 * A fresh access key.
 *
 * 256 bits from the system CSPRNG, hex so it survives being read down a phone
 * or typed off a printout, and grouped in fives for the same reason: a key
 * gets transcribed by a person at least once, and an unbroken 64-character
 * run is where that goes wrong.
 */
export function generateStaffKey(): string {
  const hex = randomBytes(32).toString("hex");
  const groups = hex.match(/.{1,5}/g) ?? [];
  return `${STAFF_KEY_PREFIX}-${groups.join("-")}`;
}

/**
 * The comparable form of a key someone typed.
 *
 * Grouping dashes, stray spaces and capitals are display, not secret: a key
 * read off a printout and typed back in should work. Sign-in checks this form
 * as well as the literal one, so keys issued before the rule existed still
 * match on exactly what they were.
 */
export function normaliseStaffKey(key: string): string {
  return key.replace(/[\s-]/g, "").toLowerCase();
}
