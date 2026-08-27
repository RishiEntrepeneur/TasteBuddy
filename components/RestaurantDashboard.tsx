"use client";

import dynamic from "next/dynamic";
import {
  EyeOff,
  QrCode,
  SlidersHorizontal,
  UtensilsCrossed,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { AllergenProfilePicker } from "@/components/AllergenProfilePicker";
import { MenuItemCard } from "@/components/MenuItemCard";
import { readableInk } from "@/lib/brand";
import { useAllergenProfile } from "@/lib/hooks/useAllergenProfile";
import { useSavedDishes } from "@/lib/hooks/useSavedDishes";
import { evaluateMenuItem } from "@/lib/menu-filter";
import type {
  MenuCategory,
  MenuItem,
  NutritionKey,
  Restaurant,
} from "@/lib/types";

/**
 * Three.js and the AR viewer are ~500 KB of JavaScript that a diner only needs
 * once they tap "AR View", so the whole viewer is code-split and never runs on
 * the server — it has no meaning without a camera.
 */
const TasteBuddyARViewer = dynamic(
  () =>
    import("@/components/TasteBuddyARViewer").then((mod) => ({
      default: mod.TasteBuddyARViewer,
    })),
  { ssr: false },
);

const CATEGORY_LABELS: Readonly<Record<MenuCategory, string>> = {
  starters: "Starters",
  mains: "Mains",
  sides: "Sides",
  desserts: "Desserts",
  drinks: "Drinks",
};

const CATEGORY_ORDER: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];

interface RestaurantDashboardProps {
  restaurant: Restaurant;
  items: MenuItem[];
}

export function RestaurantDashboard({
  restaurant,
  items,
}: RestaurantDashboardProps) {
  const {
    profile,
    thresholds,
    toggleAllergen,
    setStrict,
    setThreshold,
    clearProfile,
  } = useAllergenProfile();

  const savedDishes = useSavedDishes();

  // The venue picks its own header colour; the text on it is measured against
  // that rather than assumed to be white.
  const headerInk = readableInk(restaurant.branding.primaryColor);

  const [portions, setPortions] = useState<Record<string, number>>({});
  const [hideUnsafe, setHideUnsafe] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [arItemId, setArItemId] = useState<string | null>(null);

  /**
   * Evaluated entirely on the client using the same pure function the API uses,
   * so toggling an allergen re-renders instantly instead of round-tripping.
   */
  const evaluated = useMemo(
    () =>
      items.map((item) =>
        evaluateMenuItem(item, { profile, thresholds, portions }),
      ),
    [items, profile, thresholds, portions],
  );

  const visible = useMemo(
    () =>
      hideUnsafe
        ? evaluated.filter(
            (item) =>
              !item.hasAllergenConflict &&
              !item.conflicts.some((conflict) => conflict.type === "nutrition"),
          )
        : evaluated,
    [evaluated, hideUnsafe],
  );

  const hiddenCount = evaluated.length - visible.length;
  const flaggedCount = evaluated.filter(
    (item) => item.hasAllergenConflict,
  ).length;

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: visible.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0);
  }, [visible]);

  const setPortion = useCallback((itemId: string, portion: number) => {
    setPortions((current) => ({ ...current, [itemId]: portion }));
  }, []);

  const arItem = useMemo(
    () => evaluated.find((item) => item.id === arItemId) ?? null,
    [evaluated, arItemId],
  );

  return (
    <div
      className="min-h-dvh bg-surface"
      // Restaurant branding is injected as CSS variables so every accent in the
      // subtree follows the venue without a Tailwind rebuild.
      style={
        {
          "--brand-accent": restaurant.branding.accentColor,
          "--brand-primary": restaurant.branding.primaryColor,
        } as React.CSSProperties
      }
    >
      {/* Same rule as the AR button: the foreground is measured, not assumed. */}
      <header
        className="safe-top px-4 pb-6"
        style={{
          backgroundColor: restaurant.branding.primaryColor,
          color: headerInk,
        }}
      >
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-widest opacity-60">
          <QrCode className="size-3" aria-hidden />
          TasteBuddy
        </p>

        <h1 className="mt-3 font-display text-[2rem] leading-[1.1] tracking-tight">
          {restaurant.name}
        </h1>
        <p className="mt-1 text-sm opacity-75">{restaurant.tagline}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            aria-expanded={profileOpen}
            className="flex items-center gap-1.5 rounded-control bg-white/15 px-3 py-2 text-sm backdrop-blur transition hover:bg-white/25"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            {profile.avoid.length > 0
              ? `${profile.avoid.length} allergen${profile.avoid.length === 1 ? "" : "s"} avoided`
              : "Set your allergies"}
          </button>

          <button
            type="button"
            onClick={() => setHideUnsafe((hide) => !hide)}
            aria-pressed={hideUnsafe}
            className={[
              "flex items-center gap-1.5 rounded-control px-3 py-2 text-sm backdrop-blur transition",
              hideUnsafe
                ? "bg-white text-black"
                : "bg-white/15 hover:bg-white/25",
            ].join(" ")}
          >
            <EyeOff className="size-3.5" aria-hidden />
            Hide unsafe
          </button>
        </div>

        {flaggedCount > 0 && !hideUnsafe ? (
          <p className="mt-3 text-sm text-white/85">
            {flaggedCount} dish{flaggedCount === 1 ? "" : "es"} on this menu
            clash with your profile.
          </p>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-16">
        {profileOpen ? (
          <div className="pt-4">
            <AllergenProfilePicker
              profile={profile}
              thresholds={thresholds}
              onToggleAllergen={toggleAllergen}
              onStrictChange={setStrict}
              onThresholdChange={(key: NutritionKey, value) =>
                setThreshold(key, value)
              }
              onClear={clearProfile}
            />
          </div>
        ) : null}

        {hideUnsafe && hiddenCount > 0 ? (
          <p className="pt-4 text-sm text-ink-muted">
            {hiddenCount} dish{hiddenCount === 1 ? "" : "es"} hidden by your
            filters.
          </p>
        ) : null}

        {savedDishes.error ? (
          <p role="status" className="pt-4 text-sm text-terracotta">
            {savedDishes.error}
          </p>
        ) : null}

        {grouped.length === 0 ? (
          <div className="py-20 text-center">
            <UtensilsCrossed
              className="mx-auto size-8 text-ink-muted"
              aria-hidden
            />
            <p className="mt-4 font-display text-xl">
              Nothing here fits your profile
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Loosen a filter, or ask your server what the kitchen can adapt.
            </p>
          </div>
        ) : (
          grouped.map((group) => (
            <section key={group.category} className="pt-8">
              <h2 className="border-b border-border pb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-muted">
                {CATEGORY_LABELS[group.category]}
              </h2>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    restaurant={restaurant}
                    portion={item.appliedPortion}
                    onPortionChange={(portion) => setPortion(item.id, portion)}
                    onOpenAr={() => setArItemId(item.id)}
                    avoided={profile.avoid}
                    isSaved={savedDishes.isSaved(item.id)}
                    onToggleSaved={() => void savedDishes.toggle(item.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        <p className="mt-12 border-t border-border pt-5 text-xs leading-relaxed text-ink-muted">
          Your profile stays on this device. Allergen information comes from{" "}
          {restaurant.name}. With a severe allergy, always confirm with your
          server.
        </p>
      </main>

      {arItem ? (
        <TasteBuddyARViewer
          item={arItem}
          portion={arItem.appliedPortion}
          onClose={() => setArItemId(null)}
        />
      ) : null}
    </div>
  );
}
