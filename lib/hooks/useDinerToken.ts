"use client";

import { useSyncExternalStore } from "react";

/**
 * The browser's own token.
 *
 * There are no accounts. This is not one either: it identifies nobody, is
 * never shown, and exists so the server has something to count lookups
 * against. Clearing your browser data mints a new one and nothing is lost,
 * because nothing about you is kept beside it.
 */

const TOKEN_KEY = "tastebuddy.diner-token.v1";

/** Matches the CHECK constraint on `lookups.diner_token`. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** Base64url of 24 random bytes: 32 characters, inside the server's pattern. */
function mint(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function read(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing && TOKEN_PATTERN.test(existing)) return existing;
    const minted = mint();
    window.localStorage.setItem(TOKEN_KEY, minted);
    return minted;
  } catch {
    // Private mode. The app still works; the limit just counts this browser as
    // a new one every time, which the daily total already covers.
    return null;
  }
}

/**
 * Read once and cached, because it never changes for the life of the tab, and
 * because a server render has no token to have.
 */
let cached: string | null | undefined;

function subscribe(): () => void {
  return () => {};
}

function snapshot(): string | null {
  if (cached === undefined) cached = read();
  return cached;
}

function serverSnapshot(): null {
  return null;
}

export function useDinerToken(): string | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
