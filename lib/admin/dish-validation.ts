import { isAllergenKey } from "@/lib/allergens";
import type { MenuItemDraft } from "@/lib/db/admin-repository";
import {
  NUTRITION_KEYS,
  type AllergenSeverity,
  type MenuCategory,
  type MenuItemAllergen,
  type NutritionFacts,
} from "@/lib/types";

/**
 * One place a dish is checked before it is written.
 *
 * Lifted out of the menu-items route once photo import gained its own write
 * path. Two validators over one table is how a rule ends up enforced on one
 * route and not the other, and the rule most worth not losing is the strict
 * one below: an allergen key that is not recognised is rejected rather than
 * quietly dropped.
 */

export const DISH_CATEGORIES: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];

const SEVERITIES: readonly AllergenSeverity[] = [
  "contains",
  "may_contain",
  "removable",
];

export interface DraftPayload {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  category?: unknown;
  priceCents?: unknown;
  basePortionGrams?: unknown;
  nutrition?: unknown;
  isAvailable?: unknown;
  allergens?: unknown;
  ingredients?: unknown;
}

export type Validated =
  | { ok: true; draft: MenuItemDraft }
  | { ok: false; message: string };

/**
 * Validates a submitted dish.
 *
 * Strict on anything a diner's safety depends on — an allergen key that is not
 * recognised is rejected rather than dropped, because a silently discarded
 * declaration is exactly the failure this product exists to prevent.
 */
export function validateDraft(payload: DraftPayload): Validated {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    return {
      ok: false,
      message: "A dish needs a name between 2 and 120 characters.",
    };
  }

  const description =
    typeof payload.description === "string"
      ? payload.description.trim().slice(0, 600)
      : "";

  const category = payload.category;
  if (
    typeof category !== "string" ||
    !DISH_CATEGORIES.includes(category as MenuCategory)
  ) {
    return {
      ok: false,
      message: `Category must be one of: ${DISH_CATEGORIES.join(", ")}.`,
    };
  }

  const priceCents = Number(payload.priceCents);
  if (
    !Number.isInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > 10_000_00
  ) {
    return {
      ok: false,
      message: "Price must be a whole number of pence between 0 and 1,000,000.",
    };
  }

  const basePortionGrams = Number(payload.basePortionGrams);
  if (
    !Number.isFinite(basePortionGrams) ||
    basePortionGrams <= 0 ||
    basePortionGrams > 5000
  ) {
    return {
      ok: false,
      message: "Portion weight must be between 1 and 5000 grams.",
    };
  }

  const rawNutrition = (payload.nutrition ?? {}) as Record<string, unknown>;
  const nutrition = {} as NutritionFacts;
  for (const key of NUTRITION_KEYS) {
    const value = Number(rawNutrition[key] ?? 0);
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, message: `${key} must be zero or more.` };
    }
    nutrition[key] = value;
  }

  const allergens: MenuItemAllergen[] = [];
  if (payload.allergens !== undefined) {
    if (!Array.isArray(payload.allergens)) {
      return { ok: false, message: "`allergens` must be a list." };
    }
    for (const raw of payload.allergens) {
      const entry = raw as {
        key?: unknown;
        severity?: unknown;
        note?: unknown;
      };
      if (typeof entry.key !== "string" || !isAllergenKey(entry.key)) {
        return {
          ok: false,
          message: `Unknown allergen "${String(entry.key)}".`,
        };
      }
      if (
        typeof entry.severity !== "string" ||
        !SEVERITIES.includes(entry.severity as AllergenSeverity)
      ) {
        return {
          ok: false,
          message: `Severity must be one of: ${SEVERITIES.join(", ")}.`,
        };
      }
      allergens.push({
        key: entry.key,
        severity: entry.severity as AllergenSeverity,
        note:
          typeof entry.note === "string" && entry.note.trim()
            ? entry.note.trim().slice(0, 200)
            : undefined,
      });
    }
  }

  const ingredients: MenuItemDraft["ingredients"] = [];
  if (payload.ingredients !== undefined) {
    if (!Array.isArray(payload.ingredients)) {
      return { ok: false, message: "`ingredients` must be a list." };
    }
    for (const raw of payload.ingredients) {
      const line = raw as {
        slug?: unknown;
        quantityG?: unknown;
        isOptional?: unknown;
      };
      if (
        typeof line.slug !== "string" ||
        !/^[a-z0-9][a-z0-9-]{1,62}$/.test(line.slug)
      ) {
        return {
          ok: false,
          message: `Invalid ingredient "${String(line.slug)}".`,
        };
      }
      const quantity =
        line.quantityG === null || line.quantityG === undefined
          ? null
          : Number(line.quantityG);
      if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
        return {
          ok: false,
          message: `Quantity for "${line.slug}" must be positive or blank.`,
        };
      }
      ingredients.push({
        slug: line.slug,
        quantityG: quantity,
        isOptional: line.isOptional === true,
      });
    }
  }

  return {
    ok: true,
    draft: {
      id:
        typeof payload.id === "string" && payload.id.trim()
          ? payload.id.trim()
          : undefined,
      name,
      description,
      category: category as MenuCategory,
      priceCents,
      basePortionGrams,
      nutrition,
      isAvailable: payload.isAvailable !== false,
      allergens,
      ingredients,
    },
  };
}
