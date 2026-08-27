"use client";

import { AlertTriangle, ChevronRight, Flame, Leaf } from "lucide-react";

import { ALLERGEN_CATALOG } from "@/lib/allergens";
import type { DishSummary, LikelyAllergen } from "@/lib/dish/types";
import type { AllergenKey } from "@/lib/types";

/**
 * One dish in the list read off a menu.
 *
 * The clash is the first thing on the row and the only thing in colour,
 * because on the day it matters nobody is reading the rest.
 */

export function clashes(
  dish: { likelyAllergens: LikelyAllergen[] },
  avoid: readonly AllergenKey[],
): LikelyAllergen[] {
  const avoided = new Set(avoid);
  return dish.likelyAllergens.filter((entry) => avoided.has(entry.key));
}

/**
 * "Usually made with peanuts and dairy, sometimes has sesame".
 *
 * The two likelihoods stay in separate clauses on purpose. Collapsing them
 * into one list would make a maybe read like a certainty, and reading a maybe
 * as a certainty is how somebody stops trusting the warnings at all.
 */
export function clashSentence(hits: LikelyAllergen[]): string {
  const list = (entries: LikelyAllergen[]) =>
    entries
      .map((entry) => ALLERGEN_CATALOG[entry.key].label.toLowerCase())
      .join(" and ");

  const usually = hits.filter((h) => h.likelihood === "usually");
  const sometimes = hits.filter((h) => h.likelihood === "sometimes");

  const parts: string[] = [];
  if (usually.length) parts.push(`usually made with ${list(usually)}`);
  if (sometimes.length) parts.push(`sometimes has ${list(sometimes)}`);

  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

interface DishCardProps {
  dish: DishSummary;
  avoid: readonly AllergenKey[];
  onOpen: () => void;
}

export function DishCard({ dish, avoid, onOpen }: DishCardProps) {
  const hits = clashes(dish, avoid);
  const serious = hits.some((hit) => hit.likelihood === "usually");

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={[
          "flex w-full items-start gap-3 border-b border-border/70 px-1 py-3.5 text-left transition",
          "hover:bg-surface-raised",
          serious ? "bg-terracotta-soft/50" : "",
        ].join(" ")}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-[17px] leading-snug text-ink">
              {dish.printedName}
            </span>
            {dish.priceText ? (
              <span className="ml-auto shrink-0 text-sm tabular-nums text-ink-muted">
                {dish.priceText}
              </span>
            ) : null}
          </span>

          {dish.englishName ? (
            <span className="mt-0.5 block text-sm text-ink-muted">
              {dish.englishName}
            </span>
          ) : null}

          <span className="mt-1 block text-sm leading-relaxed text-ink">
            {dish.oneLine}
          </span>

          {hits.length > 0 ? (
            <span className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-terracotta">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {clashSentence(hits)}
            </span>
          ) : null}

          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            {dish.dietary === "vegan" || dish.dietary === "vegetarian" ? (
              <span className="flex items-center gap-1">
                <Leaf className="size-3 text-sage" aria-hidden />
                {dish.dietary}
              </span>
            ) : null}
            {dish.spice === "hot" || dish.spice === "medium" ? (
              <span className="flex items-center gap-1">
                <Flame className="size-3" aria-hidden />
                {dish.spice === "hot" ? "hot" : "a bit spicy"}
              </span>
            ) : null}
            {!dish.recognised ? <span>not sure about this one</span> : null}
          </span>
        </span>

        <ChevronRight
          className="mt-1 size-4 shrink-0 text-ink-muted"
          aria-hidden
        />
      </button>
    </li>
  );
}
