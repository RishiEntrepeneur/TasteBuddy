"use client";

import {
  AlertTriangle,
  Bookmark,
  Box,
  Check,
  Loader2,
  Scan,
} from "lucide-react";

import { IngredientList } from "@/components/IngredientList";
import { PortionSlider } from "@/components/PortionSlider";
import { readableInk } from "@/lib/brand";
import { NUTRITION_LABELS, formatNutrient, formatPrice } from "@/lib/nutrition";
import type {
  AllergenKey,
  EvaluatedMenuItem,
  NutritionKey,
  Restaurant,
} from "@/lib/types";

/** Nutrients shown on the card. The rest live behind the nutrition sheet. */
const SUMMARY_NUTRIENTS: readonly NutritionKey[] = [
  "calories",
  "protein_g",
  "carbs_g",
  "fat_g",
];

interface MenuItemCardProps {
  item: EvaluatedMenuItem;
  restaurant: Restaurant;
  portion: number;
  onPortionChange: (portion: number) => void;
  onOpenAr: () => void;
  /** Allergens the diner avoids, so ingredients can point at the culprit. */
  avoided: readonly AllergenKey[];
  isSaved: boolean;
  onToggleSaved: () => void;
}

export function MenuItemCard({
  item,
  restaurant,
  portion,
  onPortionChange,
  onOpenAr,
  avoided,
  isSaved,
  onToggleSaved,
}: MenuItemCardProps) {
  const allergenConflicts = item.conflicts.filter((c) => c.type === "allergen");
  const nutritionConflicts = item.conflicts.filter(
    (c) => c.type === "nutrition",
  );

  const assetStatus = item.asset?.status ?? null;
  const arReady = assetStatus === "ready";
  const arPending = assetStatus === "processing" || assetStatus === "pending";

  return (
    <article
      className={[
        "transition",
        // The border and fill are the alarm, not the frame. A menu where every
        // dish sits in an identical box gives a diner nothing to look at; one
        // where only the unsafe dish is boxed says the thing at a glance.
        item.hasAllergenConflict
          ? "rounded-card border border-danger/60 bg-danger-soft p-4"
          : "border-b border-border py-5 last:border-b-0",
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-[19px] leading-snug">{item.name}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            {item.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleSaved}
            aria-pressed={isSaved}
            aria-label={
              isSaved ? `Remove ${item.name} from saved` : `Save ${item.name}`
            }
            className={[
              "flex size-8 items-center justify-center rounded-control border transition-colors",
              isSaved
                ? "border-sage bg-sage text-white"
                : "border-border text-ink-muted hover:border-ink hover:text-ink",
            ].join(" ")}
          >
            <Bookmark
              className="size-4"
              fill={isSaved ? "currentColor" : "none"}
              aria-hidden
            />
          </button>
          <p className="text-sm font-semibold tabular-nums">
            {formatPrice(
              Math.round(item.priceCents * portion),
              restaurant.currency,
              restaurant.locale,
            )}
          </p>
        </div>
      </header>

      {/* Conflicts. Allergens first — they are the reason this product exists. */}
      {allergenConflicts.length > 0 ? (
        <div
          role="alert"
          className="mt-3 rounded-control border border-danger/50 bg-danger/10 px-3 py-2"
        >
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-danger">
            <AlertTriangle className="size-3.5" aria-hidden />
            {item.hasAllergenConflict ? "Not safe for you" : "Heads up"}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink">
            {allergenConflicts.map((conflict) => (
              <li key={String(conflict.key)}>{conflict.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {nutritionConflicts.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-sm text-ink-muted">
          {nutritionConflicts.map((conflict) => (
            <li key={String(conflict.key)} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {conflict.message}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Only shown to a diner who has actually set a profile. On an empty
        profile it confirmed nothing, on every dish, which is how a reassurance
        stops being read at all.
      */}
      {item.conflicts.length === 0 && avoided.length > 0 ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-safe">
          <Check className="size-3.5" aria-hidden />
          No {avoided.length === 1 ? "conflict" : "conflicts"} with your profile
        </p>
      ) : null}

      <div className="mt-4">
        <PortionSlider
          value={portion}
          range={item.portionRange}
          basePortionGrams={item.basePortionGrams}
          onChange={onPortionChange}
        />
      </div>

      <IngredientList
        ingredients={item.ingredients}
        avoided={avoided}
        portion={portion}
        nutrition={
          <dl className="mt-2 grid grid-cols-4 gap-2 pb-1">
            {SUMMARY_NUTRIENTS.map((key) => (
              <div key={key}>
                <dt className="text-[11px] uppercase tracking-wide text-ink-muted">
                  {NUTRITION_LABELS[key]}
                </dt>
                <dd className="text-sm tabular-nums text-ink">
                  {formatNutrient(key, item.scaledNutrition[key])}
                </dd>
              </div>
            ))}
          </dl>
        }
      />

      {/*
        The venue's accent, with a foreground measured against it rather than
        assumed. This button used to be white on whatever the restaurant chose,
        which for the seeded orange was 3.1:1 and failed AA at 14px.
      */}
      <button
        type="button"
        onClick={onOpenAr}
        disabled={!arReady && !arPending}
        className={[
          "mt-4 flex w-full items-center justify-center gap-2 rounded-control px-4 py-3 text-[13px] font-semibold uppercase tracking-[0.08em] transition",
          "disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-muted disabled:ring-1 disabled:ring-border",
        ].join(" ")}
        style={
          arReady || arPending
            ? {
                backgroundColor: restaurant.branding.accentColor,
                color: readableInk(restaurant.branding.accentColor),
              }
            : undefined
        }
      >
        {arReady ? (
          <>
            <Scan className="size-4" aria-hidden />
            TasteBuddy AR View
          </>
        ) : arPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Building 3D model…
          </>
        ) : (
          <>
            <Box className="size-4" aria-hidden />
            No 3D model yet
          </>
        )}
      </button>
    </article>
  );
}
