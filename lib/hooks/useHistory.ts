"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { DishExplanation } from "@/lib/dish/types";

/**
 * What you have looked up, kept on the phone.
 *
 * The app opens on this rather than on an empty box, because the second time
 * you use it you are usually asking about a dish you have already met. It is
 * also why nothing needs an account: the log lives where the person does.
 *
 * Stored whole, so an entry can be reopened without asking the model again.
 * That is the point — the cheapest lookup is the one already paid for.
 */

const STORAGE_KEY = "tastebuddy.history.v1";

/**
 * Enough that a fortnight of holidays fits, few enough that a phone with a
 * small storage quota never has to make a decision about it.
 */
const MAX_ENTRIES = 60;

export interface HistoryEntry {
  /** Stable within this browser; the storage key for one lookup. */
  id: string;
  /** Unix milliseconds. */
  at: number;
  dish: DishExplanation;
}

const EMPTY: readonly HistoryEntry[] = Object.freeze([]);

type Listener = () => void;
const listeners = new Set<Listener>();

let lastRaw: string | null = null;
let snapshot: readonly HistoryEntry[] = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // A full quota is survivable: the lookup still worked, it is just not kept.
  }
}

/** Anything that is not a recognisable entry is dropped rather than repaired. */
function parse(raw: string | null): readonly HistoryEntry[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(
      (entry): entry is HistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as HistoryEntry).id === "string" &&
        typeof (entry as HistoryEntry).at === "number" &&
        typeof (entry as HistoryEntry).dish?.printedName === "string",
    );
  } catch {
    return EMPTY;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === STORAGE_KEY) emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Re-parsed only when the stored string actually changes; see the profile hook. */
function getSnapshot(): readonly HistoryEntry[] {
  const raw = readRaw();
  if (raw !== lastRaw) {
    lastRaw = raw;
    snapshot = parse(raw);
  }
  return snapshot;
}

function getServerSnapshot(): readonly HistoryEntry[] {
  return EMPTY;
}

function save(entries: readonly HistoryEntry[]): void {
  writeRaw(JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  emit();
}

export interface UseHistoryResult {
  entries: readonly HistoryEntry[];
  /** Adds a lookup, or moves it back to the top if it is already there. */
  remember: (dish: DishExplanation) => HistoryEntry;
  forget: (id: string) => void;
  clear: () => void;
}

export function useHistory(): UseHistoryResult {
  const entries = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const remember = useCallback(
    (dish: DishExplanation): HistoryEntry => {
      const key = dish.printedName.trim().toLowerCase();
      const existing = entries.find(
        (entry) => entry.dish.printedName.trim().toLowerCase() === key,
      );

      // Looking the same dish up twice is one line in the log, moved to the
      // top, not two identical ones.
      const entry: HistoryEntry = {
        id: existing?.id ?? `h_${Date.now().toString(36)}_${key.slice(0, 24)}`,
        at: Date.now(),
        dish,
      };

      save([entry, ...entries.filter((other) => other.id !== entry.id)]);
      return entry;
    },
    [entries],
  );

  const forget = useCallback(
    (id: string) => save(entries.filter((entry) => entry.id !== id)),
    [entries],
  );

  const clear = useCallback(() => save([]), []);

  return { entries, remember, forget, clear };
}
