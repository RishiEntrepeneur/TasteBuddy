"use client";

import { useCallback, useSyncExternalStore } from "react";

import { isAllergenKey } from "@/lib/allergens";
import type { AllergenKey, AllergenProfile } from "@/lib/types";

/**
 * What the diner avoids, kept in their own browser.
 *
 * This is health data and it never leaves the device. There is no account to
 * attach it to, no request that carries it, and no row anywhere that holds it.
 * Dishes are flagged on the phone, by comparing what the app was told about a
 * dish against this list.
 *
 * Built as a small external store read through `useSyncExternalStore` rather
 * than `useState` plus a hydration effect. That buys three things: a correct
 * server snapshot with no hydration mismatch, no cascading render on mount,
 * and cross-tab sync for free through the `storage` event.
 */

/**
 * Persisted as a bare `string[]` — `["peanuts","dairy"]` — so the stored value
 * is inspectable and portable on its own, and so somebody clearing it by hand
 * can see exactly what they are clearing.
 */
const STORAGE_KEY = "tastebuddy.allergens.v1";

/** Earlier shapes, read once so nobody loses selections they already made. */
const LEGACY_KEYS = [
  "tastebuddy.allergen-profile.v1",
  "tastebuddy.allergen-strict.v1",
] as const;

const EMPTY: AllergenProfile = Object.freeze({ avoid: [] });

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** Parses the persisted array, dropping anything that is not a known allergen. */
function parse(raw: string | null): AllergenKey[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (key): key is AllergenKey => typeof key === "string" && isAllergenKey(key),
    );
  } catch {
    // Corrupt storage must never block the app.
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * `useSyncExternalStore` compares snapshots by identity, so re-parsing on
 * every read would loop forever. The snapshot is re-parsed only when the
 * underlying string actually changes.
 */
let lastRaw: string | null = null;
let snapshot: AllergenProfile = EMPTY;
let migrated = false;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: behave as if nothing was saved.
    return null;
  }
}

function writeRaw(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Quota or private mode. The session still works, it is just not kept.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Pulls a pre-split profile across, once, then leaves the old keys alone. */
function migrateOnce(): void {
  if (migrated) return;
  migrated = true;
  if (readRaw() !== null) return;

  try {
    const legacy = window.localStorage.getItem(LEGACY_KEYS[0]);
    if (!legacy) return;
    const parsed = JSON.parse(legacy) as { avoid?: unknown };
    const avoid = Array.isArray(parsed?.avoid)
      ? parsed.avoid.filter(
          (key): key is AllergenKey =>
            typeof key === "string" && isAllergenKey(key),
        )
      : [];
    if (avoid.length) writeRaw(JSON.stringify(avoid));
  } catch {
    // A profile that will not migrate is one the diner can set again.
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === STORAGE_KEY) emit();
}

function getSnapshot(): AllergenProfile {
  migrateOnce();
  const raw = readRaw();
  if (raw !== lastRaw) {
    lastRaw = raw;
    snapshot = { avoid: parse(raw) };
  }
  return snapshot;
}

function getServerSnapshot(): AllergenProfile {
  return EMPTY;
}

function save(avoid: readonly AllergenKey[]): void {
  writeRaw(JSON.stringify(avoid));
  emit();
}

/* -------------------------------------------------------------------------- */
/*  Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseAllergenProfileResult {
  profile: AllergenProfile;
  toggle: (key: AllergenKey) => void;
  /**
   * Sets several at once. One control can stand for more than one key —
   * "Peanuts / tree nuts" is a single switch over two — and toggling them
   * separately leaves the group half-on whenever the two started out
   * disagreeing.
   */
  setMany: (keys: readonly AllergenKey[], avoided: boolean) => void;
  clear: () => void;
}

export function useAllergenProfile(): UseAllergenProfileResult {
  const profile = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const toggle = useCallback(
    (key: AllergenKey) => {
      const avoid = profile.avoid.includes(key)
        ? profile.avoid.filter((entry) => entry !== key)
        : [...profile.avoid, key];
      save(avoid);
    },
    [profile],
  );

  const setMany = useCallback(
    (keys: readonly AllergenKey[], avoided: boolean) => {
      const next = new Set(profile.avoid);
      for (const key of keys) {
        if (avoided) next.add(key);
        else next.delete(key);
      }
      save([...next]);
    },
    [profile],
  );

  const clear = useCallback(() => save([]), []);

  return { profile, toggle, setMany, clear };
}
