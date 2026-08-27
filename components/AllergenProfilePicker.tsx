"use client";

import { Check, ShieldAlert, X } from "lucide-react";

import { ALLERGEN_LIST } from "@/lib/allergens";
import { NUTRITION_LABELS, NUTRITION_UNITS } from "@/lib/nutrition";
import type {
  AllergenKey,
  AllergenProfile,
  NutritionKey,
  NutritionThresholds,
} from "@/lib/types";

/** Nutrients worth exposing as a slider-free numeric ceiling on a phone. */
const THRESHOLD_FIELDS: readonly { key: NutritionKey; placeholder: number }[] =
  [
    { key: "calories", placeholder: 800 },
    { key: "sodium_mg", placeholder: 1500 },
    { key: "sugar_g", placeholder: 30 },
    { key: "fat_g", placeholder: 40 },
  ];

interface AllergenProfilePickerProps {
  profile: AllergenProfile;
  thresholds: NutritionThresholds;
  onToggleAllergen: (key: AllergenKey) => void;
  onStrictChange: (strict: boolean) => void;
  onThresholdChange: (key: NutritionKey, value: number | null) => void;
  onClear: () => void;
}

export function AllergenProfilePicker({
  profile,
  thresholds,
  onToggleAllergen,
  onStrictChange,
  onThresholdChange,
  onClear,
}: AllergenProfilePickerProps) {
  const hasProfile =
    profile.avoid.length > 0 || Object.keys(thresholds).length > 0;

  return (
    <section
      aria-labelledby="profile-heading"
      className="rounded-card border border-border bg-surface-raised p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="profile-heading"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <ShieldAlert className="size-4 text-danger" aria-hidden />
            Your profile
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Stays on this device. Dishes that clash are flagged in the menu and
            in AR.
          </p>
        </div>

        {hasProfile ? (
          <button
            type="button"
            onClick={onClear}
            className="flex shrink-0 items-center gap-1 rounded-control border border-border px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
          >
            <X className="size-3" aria-hidden />
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Avoid
        </h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {ALLERGEN_LIST.map((allergen) => {
            const active = profile.avoid.includes(allergen.key);
            return (
              <li key={allergen.key}>
                <button
                  type="button"
                  onClick={() => onToggleAllergen(allergen.key)}
                  aria-pressed={active}
                  title={allergen.description}
                  className={[
                    "flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-sm transition",
                    active
                      ? "border-danger bg-danger text-[var(--color-on-danger)]"
                      : "border-border text-ink-muted hover:border-ink hover:text-ink",
                  ].join(" ")}
                >
                  {active ? <Check className="size-3.5" aria-hidden /> : null}
                  {allergen.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <label className="mt-4 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={profile.strict}
          onChange={(event) => onStrictChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-danger)]"
        />
        <span>
          <span className="font-medium">Flag cross-contamination</span>
          <span className="block text-ink-muted">
            Also warns on shared fryers and prep surfaces. Leave on for a severe
            allergy.
          </span>
        </span>
      </label>

      <div className="mt-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Nutrition limits (per portion)
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {THRESHOLD_FIELDS.map(({ key, placeholder }) => (
            <label key={key} className="text-sm">
              <span className="text-ink-muted">
                Max {NUTRITION_LABELS[key].toLowerCase()}
              </span>
              <span className="mt-1 flex items-center gap-1 rounded-control border border-border px-2 py-1.5 focus-within:border-ink">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder={String(placeholder)}
                  value={thresholds[key] ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    onThresholdChange(key, raw === "" ? null : Number(raw));
                  }}
                  className="w-full min-w-0 bg-transparent tabular-nums outline-none"
                />
                <span className="shrink-0 text-xs text-ink-muted">
                  {NUTRITION_UNITS[key]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
