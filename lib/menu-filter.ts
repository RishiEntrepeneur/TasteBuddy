import {
  ALLERGEN_CATALOG,
  describeSeverity,
  matchProfile,
  severityConflicts,
} from "@/lib/allergens";
import {
  NUTRITION_LABELS,
  clampPortion,
  exceededThresholds,
  formatNutrient,
  scaleNutrition,
} from "@/lib/nutrition";
import type {
  AllergenProfile,
  EvaluatedMenuItem,
  MenuFilterMode,
  MenuItem,
  MenuItemConflict,
  NutritionThresholds,
} from "@/lib/types";

export interface EvaluateOptions {
  profile: AllergenProfile;
  thresholds: NutritionThresholds;
  /**
   * Portion multiplier per menu item id. Missing entries fall back to the
   * dish's own default, so a diner who never touched a slider still gets
   * thresholds evaluated against a realistic plate.
   */
  portions?: Readonly<Record<string, number>>;
}

/**
 * Decorates one dish with everything the client needs to render it for this
 * particular diner: scaled nutrition plus any allergen or nutrition conflicts.
 *
 * Pure, and shared by the API route, the dashboard and the AR viewer — a dish
 * can never be judged "safe" in one place and "unsafe" in another.
 */
export function evaluateMenuItem(
  item: MenuItem,
  options: EvaluateOptions,
): EvaluatedMenuItem {
  const { profile, thresholds, portions } = options;

  const requested = portions?.[item.id] ?? item.portionRange.default;
  const appliedPortion = clampPortion(requested, item.portionRange);
  const scaledNutrition = scaleNutrition(item.nutrition, appliedPortion);

  const conflicts: MenuItemConflict[] = [];
  let hasAllergenConflict = false;

  for (const entry of matchProfile(item.allergens, profile)) {
    const allergen = ALLERGEN_CATALOG[entry.key];
    // A `removable` garnish (or a `may_contain` for a non-strict diner) is an
    // advisory: still surfaced, but it does not make the dish unsafe.
    if (severityConflicts(entry.severity, profile.strict)) {
      hasAllergenConflict = true;
    }
    conflicts.push({
      type: "allergen",
      key: entry.key,
      severity: entry.severity,
      message: entry.note
        ? `${describeSeverity(entry.severity)} ${allergen.label.toLowerCase()}. ${entry.note}`
        : `${describeSeverity(entry.severity)} ${allergen.label.toLowerCase()}.`,
    });
  }

  for (const { key, value, limit } of exceededThresholds(
    scaledNutrition,
    thresholds,
  )) {
    conflicts.push({
      type: "nutrition",
      key,
      severity: "over_threshold",
      message: `${NUTRITION_LABELS[key]} ${formatNutrient(key, value)} exceeds your ${formatNutrient(key, limit)} limit.`,
    });
  }

  return {
    ...item,
    conflicts,
    hasAllergenConflict,
    scaledNutrition,
    appliedPortion,
  };
}

export interface EvaluatedMenu {
  items: EvaluatedMenuItem[];
  hiddenItems: number;
}

/**
 * Evaluates a whole menu.
 *
 * `flag` keeps every dish and lets the UI strike conflicting ones through;
 * `exclude` drops unsafe dishes before they reach the wire, which is what the
 * "hide unsafe dishes" toggle sends. Advisory-only conflicts never hide a dish.
 */
export function evaluateMenu(
  items: readonly MenuItem[],
  options: EvaluateOptions & { mode: MenuFilterMode },
): EvaluatedMenu {
  const evaluated = items.map((item) => evaluateMenuItem(item, options));

  if (options.mode === "flag") {
    return { items: evaluated, hiddenItems: 0 };
  }

  const safe = evaluated.filter(
    (item) =>
      !item.hasAllergenConflict &&
      !item.conflicts.some((conflict) => conflict.type === "nutrition"),
  );
  return { items: safe, hiddenItems: evaluated.length - safe.length };
}
