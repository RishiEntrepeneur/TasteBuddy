"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { ALLERGEN_CATALOG } from "@/lib/allergens";
import type { AllergenKey, MenuItemIngredient } from "@/lib/types";

interface IngredientListProps {
  ingredients: readonly MenuItemIngredient[];
  /** Allergens the diner avoids — matching ingredients are called out. */
  avoided: readonly AllergenKey[];
  portion: number;
  /**
   * Nutrition, rendered inside the same disclosure.
   *
   * It used to sit above as a permanent four-column grid on every dish, which
   * is not how anybody reads a menu: you choose by the dish and check the
   * numbers on the two you are deciding between. Behind the same toggle as the
   * ingredients, both are one tap away and neither is in the way.
   */
  nutrition?: React.ReactNode;
}

function formatQuantity(grams: number | null, portion: number): string {
  if (grams === null) return "to taste";
  const scaled = grams * portion;
  if (scaled < 1) return `${Math.round(scaled * 1000)} mg`;
  return `${Math.round(scaled * 10) / 10} g`;
}

/**
 * The ingredient list, collapsed by default.
 *
 * Ingredients carry their own allergens, so this is also where a diner sees
 * *which* component of a dish is the problem — "Contains dairy" is a verdict,
 * "Parmesan 30 g" is the reason, and the reason is what lets them ask the
 * kitchen a sensible question.
 */
export function IngredientList({
  ingredients,
  avoided,
  portion,
  nutrition,
}: IngredientListProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (ingredients.length === 0 && !nutrition) return null;

  const avoidSet = new Set(avoided);

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-2 text-left text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <span>
          {ingredients.length
            ? `${ingredients.length} ingredient${ingredients.length === 1 ? "" : "s"}`
            : "Nutrition"}
          {ingredients.length && nutrition ? " and nutrition" : ""}
        </span>
        <ChevronDown
          className={[
            "size-4 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden
        />
      </button>

      {open ? (
        <div id={id}>
          {nutrition}
          <ul className="mt-2 space-y-1">
          {ingredients.map(({ ingredient, quantityG, isOptional, note }) => {
            const flagged = ingredient.allergens.filter((key) =>
              avoidSet.has(key),
            );
            return (
              <li
                key={ingredient.id}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="min-w-0">
                  <span
                    className={
                      flagged.length
                        ? "font-medium text-terracotta"
                        : "text-ink"
                    }
                  >
                    {ingredient.name}
                  </span>
                  {isOptional ? (
                    <span className="ml-1.5 text-xs text-ink-muted">
                      optional
                    </span>
                  ) : null}
                  {flagged.length ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-terracotta">
                      <AlertTriangle className="size-3 shrink-0" aria-hidden />
                      {flagged
                        .map((key) => ALLERGEN_CATALOG[key].label)
                        .join(", ")}
                    </span>
                  ) : null}
                  {note ? (
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {note}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {formatQuantity(quantityG, portion)}
                </span>
              </li>
            );
          })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
