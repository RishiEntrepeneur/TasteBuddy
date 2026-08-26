import {
  NUTRITION_KEYS,
  type NutritionFacts,
  type NutritionKey,
  type NutritionThresholds,
  type PortionRange,
} from "@/lib/types";

/** Query-string aliases so `?maxCalories=800` reads naturally. */
const THRESHOLD_QUERY_KEYS: Readonly<Record<NutritionKey, string>> = {
  calories: "maxCalories",
  protein_g: "maxProtein",
  carbs_g: "maxCarbs",
  fat_g: "maxFat",
  sugar_g: "maxSugar",
  sodium_mg: "maxSodium",
  fiber_g: "maxFiber",
};

export const NUTRITION_LABELS: Readonly<Record<NutritionKey, string>> = {
  calories: "Calories",
  protein_g: "Protein",
  carbs_g: "Carbs",
  fat_g: "Fat",
  sugar_g: "Sugar",
  sodium_mg: "Sodium",
  fiber_g: "Fibre",
};

export const NUTRITION_UNITS: Readonly<Record<NutritionKey, string>> = {
  calories: "kcal",
  protein_g: "g",
  carbs_g: "g",
  fat_g: "g",
  sugar_g: "g",
  sodium_mg: "mg",
  fiber_g: "g",
};

/**
 * Reads `maxCalories`, `maxSodium`, … out of a URL. Non-numeric and negative
 * values are ignored so a malformed threshold can never hide the whole menu.
 */
export function parseNutritionThresholds(
  params: URLSearchParams,
): NutritionThresholds {
  const thresholds: NutritionThresholds = {};
  for (const key of NUTRITION_KEYS) {
    const raw = params.get(THRESHOLD_QUERY_KEYS[key]);
    if (raw === null) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) continue;
    thresholds[key] = value;
  }
  return thresholds;
}

/** Clamps a requested portion multiplier onto the dish's allowed range. */
export function clampPortion(portion: number, range: PortionRange): number {
  if (!Number.isFinite(portion)) return range.default;
  const clamped = Math.min(range.max, Math.max(range.min, portion));
  // Snap to the slider's step so server and client agree on the exact value.
  const steps = Math.round((clamped - range.min) / range.step);
  const snapped = range.min + steps * range.step;
  return Number(Math.min(range.max, snapped).toFixed(4));
}

/** Nutrition scales linearly with plate volume. */
export function scaleNutrition(
  base: NutritionFacts,
  portion: number,
): NutritionFacts {
  const scaled = {} as NutritionFacts;
  for (const key of NUTRITION_KEYS) {
    scaled[key] = Math.round(base[key] * portion * 10) / 10;
  }
  return scaled;
}

/** Every nutrient whose scaled value exceeds the diner's ceiling. */
export function exceededThresholds(
  nutrition: NutritionFacts,
  thresholds: NutritionThresholds,
): { key: NutritionKey; value: number; limit: number }[] {
  const exceeded: { key: NutritionKey; value: number; limit: number }[] = [];
  for (const key of NUTRITION_KEYS) {
    const limit = thresholds[key];
    if (limit === undefined) continue;
    if (nutrition[key] > limit) {
      exceeded.push({ key, value: nutrition[key], limit });
    }
  }
  return exceeded;
}

export function formatNutrient(key: NutritionKey, value: number): string {
  const rounded =
    key === "calories" || key === "sodium_mg" ? Math.round(value) : value;
  return `${rounded}${NUTRITION_UNITS[key]}`;
}

export function formatPrice(
  priceCents: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(priceCents / 100);
}
