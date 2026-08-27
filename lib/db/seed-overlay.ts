import { SEED_MENU_ITEMS } from "@/lib/db/seed";
import type { MenuItem, Restaurant } from "@/lib/types";

/**
 * In-memory edits layered over the seed dataset.
 *
 * The seed is a frozen module constant, so the editor's writes go here when
 * `DATABASE_URL` is unset. Held on `globalThis` to survive Next's dev-mode
 * module reloading, per-process, and gone on restart.
 *
 * This exists so the editor can be tried without standing up Postgres — not as
 * a substitute for it. A menu editor genuinely needs durable storage.
 *
 * It lives in its own module rather than in `admin-repository` so the
 * diner-facing read path can apply edits without importing anything that can
 * write.
 */

declare global {
  var __tasteBuddyMenuOverlay: Map<string, MenuItem> | undefined;
  var __tasteBuddyDeleted: Set<string> | undefined;
  var __tasteBuddyRestaurantOverlay: Map<string, Restaurant> | undefined;
}

export function menuOverlay(): Map<string, MenuItem> {
  globalThis.__tasteBuddyMenuOverlay ??= new Map();
  return globalThis.__tasteBuddyMenuOverlay;
}

export function deletedItems(): Set<string> {
  globalThis.__tasteBuddyDeleted ??= new Set();
  return globalThis.__tasteBuddyDeleted;
}

/** Branding and name edits to the seed venues, same scope and lifetime. */
export function restaurantOverlay(): Map<string, Restaurant> {
  globalThis.__tasteBuddyRestaurantOverlay ??= new Map();
  return globalThis.__tasteBuddyRestaurantOverlay;
}

/** Seed items for a venue with edits applied and deletions removed. */
export function seedItemsWithEdits(restaurantId: string): MenuItem[] {
  const surviving = SEED_MENU_ITEMS.filter(
    (item) =>
      item.restaurantId === restaurantId && !deletedItems().has(item.id),
  ).map((item) => menuOverlay().get(item.id) ?? item);

  const added = [...menuOverlay().values()].filter(
    (item) =>
      item.restaurantId === restaurantId &&
      !deletedItems().has(item.id) &&
      !SEED_MENU_ITEMS.some((seed) => seed.id === item.id),
  );

  return [...surviving, ...added];
}

/** One item with edits applied, or null once deleted. */
export function seedItemWithEdits(menuItemId: string): MenuItem | null {
  if (deletedItems().has(menuItemId)) return null;
  return (
    menuOverlay().get(menuItemId) ??
    SEED_MENU_ITEMS.find((item) => item.id === menuItemId) ??
    null
  );
}
