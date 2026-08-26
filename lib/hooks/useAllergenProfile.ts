"use client";

import { useCallback, useSyncExternalStore } from "react";

import { isAllergenKey } from "@/lib/allergens";
import {
  EMPTY_ALLERGEN_PROFILE,
  NUTRITION_KEYS,
  type AllergenKey,
  type AllergenProfile,
  type NutritionKey,
  type NutritionThresholds,
} from "@/lib/types";

/**
 * The diner's allergen profile, backed by `localStorage`.
 *
 * Health data, so it is deliberately never persisted server-side: TasteBuddy
 * has no accounts to attach it to. It travels as a query string to `/api/menu`
 * for the duration of one request and nothing more.
 *
 * Implemented as a small external store read through `useSyncExternalStore`
 * rather than as `useState` + a hydration effect. That gets three things:
 * a correct server snapshot (the empty profile) with no hydration mismatch,
 * no cascading render on mount, and cross-tab sync for free via the `storage`
 * event.
 */

/**
 * Avoided allergens persist as a bare `string[]` — `["peanuts","dairy"]` — so
 * the stored value is inspectable and portable on its own. `strict` is a
 * separate scalar rather than a field on a wrapper object, which keeps that
 * array the single, unambiguous record of what the diner selected.
 */
const ALLERGENS_STORAGE_KEY = "tastebuddy.allergens.v1";
const STRICT_STORAGE_KEY = "tastebuddy.allergen-strict.v1";
const THRESHOLD_STORAGE_KEY = "tastebuddy.nutrition-thresholds.v1";

/** Pre-split shape, read once so an existing diner keeps their selections. */
const LEGACY_PROFILE_STORAGE_KEY = "tastebuddy.allergen-profile.v1";

const EMPTY_THRESHOLDS: NutritionThresholds = Object.freeze({});

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                    */
/* -------------------------------------------------------------------------- */

/** Parses the persisted `string[]`, dropping anything not a known allergen. */
function parseAllergenArray(raw: string | null): AllergenKey[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (key): key is AllergenKey =>
        typeof key === "string" && isAllergenKey(key),
    );
  } catch {
    // Corrupt storage must never block the menu.
    return [];
  }
}

function parseThresholds(raw: string | null): NutritionThresholds {
  if (!raw) return EMPTY_THRESHOLDS;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const thresholds: NutritionThresholds = {};
    for (const key of NUTRITION_KEYS) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        thresholds[key] = value;
      }
    }
    return thresholds;
  } catch {
    return EMPTY_THRESHOLDS;
  }
}

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Snapshot caches.
 *
 * `useSyncExternalStore` compares snapshots by identity, so parsing on every
 * read would loop forever. Each snapshot is therefore re-parsed only when the
 * underlying raw string actually changes.
 */
let allergensRaw: string | null = null;
let strictRaw: string | null = null;
let profileSnapshot: AllergenProfile = EMPTY_ALLERGEN_PROFILE;
let thresholdRaw: string | null = null;
let thresholdSnapshot: NutritionThresholds = EMPTY_THRESHOLDS;
let migrationChecked = false;

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode or blocked storage — behave as if nothing was saved.
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota or private mode: the session still works, it is just not remembered.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // `storage` fires in *other* tabs, which gives cross-tab sync at no cost.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Lifts a pre-split profile object into the current keys, once per session.
 * Runs on read rather than as a startup effect so it costs nothing on a fresh
 * install and cannot race the first render.
 */
function migrateLegacyProfile(): void {
  if (migrationChecked) return;
  migrationChecked = true;

  if (readRaw(ALLERGENS_STORAGE_KEY) !== null) return;

  const legacy = readRaw(LEGACY_PROFILE_STORAGE_KEY);
  if (!legacy) return;

  try {
    const parsed = JSON.parse(legacy) as { avoid?: unknown; strict?: unknown };
    const avoid = Array.isArray(parsed.avoid)
      ? parsed.avoid.filter(
          (key): key is AllergenKey =>
            typeof key === "string" && isAllergenKey(key),
        )
      : [];
    writeRaw(ALLERGENS_STORAGE_KEY, JSON.stringify(avoid));
    writeRaw(STRICT_STORAGE_KEY, parsed.strict === false ? "false" : "true");
  } catch {
    // An unreadable legacy value is simply dropped; the diner re-selects.
  }
}

function getProfileSnapshot(): AllergenProfile {
  migrateLegacyProfile();

  const nextAllergens = readRaw(ALLERGENS_STORAGE_KEY);
  const nextStrict = readRaw(STRICT_STORAGE_KEY);

  // Re-parse only when a raw value actually changed: `useSyncExternalStore`
  // compares snapshots by identity, so parsing on every read would loop.
  if (nextAllergens !== allergensRaw || nextStrict !== strictRaw) {
    allergensRaw = nextAllergens;
    strictRaw = nextStrict;
    profileSnapshot = {
      avoid: parseAllergenArray(nextAllergens),
      // Strict is the safe default; only an explicit "false" relaxes it.
      strict: nextStrict !== "false",
    };
  }

  return profileSnapshot;
}

function getThresholdSnapshot(): NutritionThresholds {
  const raw = readRaw(THRESHOLD_STORAGE_KEY);
  if (raw !== thresholdRaw) {
    thresholdRaw = raw;
    thresholdSnapshot = parseThresholds(raw);
  }
  return thresholdSnapshot;
}

/** The server has no storage, so it always renders the empty profile. */
function getServerProfileSnapshot(): AllergenProfile {
  return EMPTY_ALLERGEN_PROFILE;
}

function getServerThresholdSnapshot(): NutritionThresholds {
  return EMPTY_THRESHOLDS;
}

/** Persists the avoided set as a plain array of allergen keys. */
function setAvoided(avoid: readonly AllergenKey[]): void {
  writeRaw(ALLERGENS_STORAGE_KEY, JSON.stringify([...avoid]));
  emit();
}

function setStrictFlag(strict: boolean): void {
  writeRaw(STRICT_STORAGE_KEY, strict ? "true" : "false");
  emit();
}

function setThresholds(next: NutritionThresholds): void {
  writeRaw(THRESHOLD_STORAGE_KEY, JSON.stringify(next));
  emit();
}

/* -------------------------------------------------------------------------- */
/*  Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseAllergenProfileResult {
  profile: AllergenProfile;
  thresholds: NutritionThresholds;
  toggleAllergen: (key: AllergenKey) => void;
  /**
   * Sets several allergens at once. A single UI control can stand for more than
   * one key — "Peanuts / Tree nuts" is one switch over two allergens — and
   * toggling them one at a time would leave the group half-on whenever the two
   * started out disagreeing.
   */
  setAllergens: (keys: readonly AllergenKey[], avoided: boolean) => void;
  setStrict: (strict: boolean) => void;
  setThreshold: (key: NutritionKey, value: number | null) => void;
  clearProfile: () => void;
}

export function useAllergenProfile(): UseAllergenProfileResult {
  const profile = useSyncExternalStore(
    subscribe,
    getProfileSnapshot,
    getServerProfileSnapshot,
  );

  const thresholds = useSyncExternalStore(
    subscribe,
    getThresholdSnapshot,
    getServerThresholdSnapshot,
  );

  const setAllergens = useCallback(
    (keys: readonly AllergenKey[], avoided: boolean) => {
      const current = new Set(getProfileSnapshot().avoid);
      for (const key of keys) {
        if (avoided) current.add(key);
        else current.delete(key);
      }
      setAvoided([...current]);
    },
    [],
  );

  const toggleAllergen = useCallback(
    (key: AllergenKey) => {
      setAllergens([key], !getProfileSnapshot().avoid.includes(key));
    },
    [setAllergens],
  );

  const setStrict = useCallback((strict: boolean) => {
    setStrictFlag(strict);
  }, []);

  const setThreshold = useCallback(
    (key: NutritionKey, value: number | null) => {
      const next = { ...getThresholdSnapshot() };
      if (value === null || !Number.isFinite(value) || value < 0) {
        delete next[key];
      } else {
        next[key] = value;
      }
      setThresholds(next);
    },
    [],
  );

  const clearProfile = useCallback(() => {
    setAvoided([]);
    setStrictFlag(true);
    setThresholds(EMPTY_THRESHOLDS);
  }, []);

  return {
    profile,
    thresholds,
    toggleAllergen,
    setAllergens,
    setStrict,
    setThreshold,
    clearProfile,
  };
}
