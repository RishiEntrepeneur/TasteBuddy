"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * The diner's saved dishes.
 *
 * Unlike the allergen profile, this list *is* stored server-side — a diner
 * who saves a dish expects to find it again from another device, and a
 * favourites list is not health data. It is keyed by an opaque token the
 * browser generates once: the token is the only credential, so it is 192 bits
 * of randomness and nothing identifying is stored beside it.
 */

const TOKEN_KEY = "tastebuddy.diner-token.v1";

/** Base64url of 24 random bytes — 32 characters, inside the server's pattern. */
function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/**
 * Reads the token, minting one on first use.
 *
 * Returns null until the browser has it, so a server render never invents a
 * token and no request goes out before there is a real one to send.
 */
export function readDinerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing && TOKEN_PATTERN.test(existing)) return existing;
    const minted = mintToken();
    window.localStorage.setItem(TOKEN_KEY, minted);
    return minted;
  } catch {
    // Private mode: saving simply will not persist, and that is survivable.
    return null;
  }
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The token never changes for the life of the tab, so it is read once through
 * a snapshot rather than set from an effect — which also keeps the server
 * render honest, since there is no token there to have.
 */
let cachedToken: string | null | undefined;

function subscribeToken(): () => void {
  return () => {};
}

function tokenSnapshot(): string | null {
  if (cachedToken === undefined) cachedToken = readDinerToken();
  return cachedToken;
}

function serverTokenSnapshot(): null {
  return null;
}

/** The diner's token, read once. Null on the server and in private mode. */
export function useDinerToken(): string | null {
  return useSyncExternalStore(
    subscribeToken,
    tokenSnapshot,
    serverTokenSnapshot,
  );
}

export interface UseSavedDishesResult {
  /** Menu item ids currently saved. */
  saved: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  isSaved: (menuItemId: string) => boolean;
  toggle: (menuItemId: string) => Promise<void>;
}

export function useSavedDishes(): UseSavedDishesResult {
  const token = useDinerToken();

  // Null until the list has been fetched, which is also how `loading` is
  // derived — no state is written synchronously inside an effect.
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();
    fetch(`/api/saved?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(response.status),
      )
      .then((body: { items: { item: { id: string } }[] }) => {
        if (controller.signal.aborted) return;
        setIds(new Set(body.items.map((entry) => entry.item.id)));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A failed load must not leave the menu looking like nothing was saved
        // *and* stay silent about it.
        setIds(EMPTY);
        setError("Saved dishes could not be loaded.");
      });

    return () => controller.abort();
  }, [token]);

  const saved = ids ?? EMPTY;
  const loading = token !== null && ids === null;

  const isSaved = useCallback(
    (menuItemId: string) => saved.has(menuItemId),
    [saved],
  );

  const toggle = useCallback(
    async (menuItemId: string) => {
      if (!token) return;
      const wasSaved = saved.has(menuItemId);

      // Optimistic: a save button that waits on a round trip feels broken.
      setIds(() => {
        const next = new Set(saved);
        if (wasSaved) next.delete(menuItemId);
        else next.add(menuItemId);
        return next;
      });
      setError(null);

      try {
        const response = wasSaved
          ? await fetch(
              `/api/saved?token=${encodeURIComponent(token)}&menuItemId=${encodeURIComponent(menuItemId)}`,
              { method: "DELETE" },
            )
          : await fetch("/api/saved", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, menuItemId }),
            });
        if (!response.ok) throw new Error(String(response.status));
      } catch {
        // Roll back to what the server still believes.
        setIds(() => {
          const next = new Set(saved);
          if (wasSaved) next.add(menuItemId);
          else next.delete(menuItemId);
          return next;
        });
        setError("That change could not be saved.");
      }
    },
    [token, saved],
  );

  return { saved, loading, error, isSaved, toggle };
}
