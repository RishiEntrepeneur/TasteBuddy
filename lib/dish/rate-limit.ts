import { isDatabaseConfigured, query } from "@/lib/db/client";

/**
 * Keeping an open, sign-in-free app from becoming an open bill.
 *
 * Two limits, doing different jobs. The per-browser one is the fair-use rule:
 * a person reading a menu takes a handful of looks, and a hundred in an hour
 * is a stuck loop. The daily total across everyone is the backstop, because
 * the per-browser handle is a token anybody can mint a fresh one of.
 *
 * The daily cap is deliberately a hard stop rather than a queue. An app that
 * silently spends more than its owner meant to is worse than one that says
 * "come back tomorrow", especially when its owner is one person.
 */

export const PER_BROWSER_HOURLY = 40;
export const EVERYONE_DAILY = 2_000;

export type LookupKind = "menu_photo" | "dish";

export type LimitDecision =
  | { ok: true }
  | { ok: false; reason: "too_many_here" | "app_is_at_its_limit" };

/**
 * Without a database the counters live in memory: per-container and gone on
 * restart, which is honest for the zero-setup mode and not a real limit. The
 * SQL path is the one that holds.
 */
declare global {
  var __tasteBuddyLookups: { token: string; at: number }[] | undefined;
}

function memory(): { token: string; at: number }[] {
  globalThis.__tasteBuddyLookups ??= [];
  const day = Date.now() - 86_400_000;
  const kept = globalThis.__tasteBuddyLookups.filter((row) => row.at > day);
  globalThis.__tasteBuddyLookups = kept;
  return kept;
}

export async function checkLimit(token: string): Promise<LimitDecision> {
  if (!isDatabaseConfigured()) {
    const rows = memory();
    const hour = Date.now() - 3_600_000;
    const mine = rows.filter(
      (row) => row.token === token && row.at > hour,
    ).length;
    if (mine >= PER_BROWSER_HOURLY) {
      return { ok: false, reason: "too_many_here" };
    }
    if (rows.length >= EVERYONE_DAILY) {
      return { ok: false, reason: "app_is_at_its_limit" };
    }
    return { ok: true };
  }

  // One round trip for both counts; neither is worth a second.
  const rows = await query<{ mine: string; everyone: string }>(
    `SELECT
       count(*) FILTER (
         WHERE diner_token = $1 AND created_at > now() - interval '1 hour'
       )::text AS mine,
       count(*)::text AS everyone
     FROM lookups
     WHERE created_at > now() - interval '1 day'`,
    [token],
  );

  const counts = rows[0];
  if (Number(counts?.mine ?? 0) >= PER_BROWSER_HOURLY) {
    return { ok: false, reason: "too_many_here" };
  }
  if (Number(counts?.everyone ?? 0) >= EVERYONE_DAILY) {
    return { ok: false, reason: "app_is_at_its_limit" };
  }
  return { ok: true };
}

/**
 * Records one lookup. Best effort: losing the count is not a reason to fail a
 * request the model has already answered and been paid for.
 */
export async function recordLookup(
  token: string,
  kind: LookupKind,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  if (!isDatabaseConfigured()) {
    memory().push({ token, at: Date.now() });
    return;
  }

  await query(
    `INSERT INTO lookups (diner_token, kind, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4)`,
    [token, kind, usage.inputTokens, usage.outputTokens],
  ).catch((error) => {
    console.error("[dish/rate-limit] lookup not recorded", error);
  });
}
