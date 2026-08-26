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

const PROFILE_STORAGE_KEY = "tastebuddy.allergen-profile.v1";
const THRESHOLD_STORAGE_KEY = "tastebuddy.nutrition-thresholds.v1";

const EMPTY_THRESHOLDS: NutritionThresholds = Object.freeze({});

/* -------------------------------------------------------------------------- */
/*  Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function parseProfile(raw: string | null): AllergenProfile {
  if (!raw) return EMPTY_ALLERGEN_PROFILE;
  try {
    const parsed = JSON.parse(raw) as Partial<AllergenProfile>;
    const avoid = Array.isArray(parsed.avoid)
      ? parsed.avoid.filter(
          (key): key is AllergenKey =>
            typeof key === "string" && isAllergenKey(key),
        )
      : [];
    // Strict is the safe default; only an explicit `false` relaxes it.
    return { avoid, strict: parsed.strict !== false };
  } catch {
    // Corrupt storage must never block the menu.
    return EMPTY_ALLERGEN_PROFILE;
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
let profileRaw: string | null = null;
let profileSnapshot: AllergenProfile = EMPTY_ALLERGEN_PROFILE;
let thresholdRaw: string | null = null;
let thresholdSnapshot: NutritionThresholds = EMPTY_THRESHOLDS;

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

function getProfileSnapshot(): AllergenProfile {
  const raw = readRaw(PROFILE_STORAGE_KEY);
  if (raw !== profileRaw) {
    profileRaw = raw;
    profileSnapshot = parseProfile(raw);
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

function setProfile(next: AllergenProfile): void {
  writeRaw(PROFILE_STORAGE_KEY, JSON.stringify(next));
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

  const toggleAllergen = useCallback((key: AllergenKey) => {
    const current = getProfileSnapshot();
    setProfile({
      ...current,
      avoid: current.avoid.includes(key)
        ? current.avoid.filter((entry) => entry !== key)
        : [...current.avoid, key],
    });
  }, []);

  const setStrict = useCallback((strict: boolean) => {
    setProfile({ ...getProfileSnapshot(), strict });
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
    setProfile(EMPTY_ALLERGEN_PROFILE);
    setThresholds(EMPTY_THRESHOLDS);
  }, []);

  return {
    profile,
    thresholds,
    toggleAllergen,
    setStrict,
    setThreshold,
    clearProfile,
  };
}
