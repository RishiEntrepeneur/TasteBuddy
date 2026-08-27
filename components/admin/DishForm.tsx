"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { DishPhotoUpload } from "@/components/admin/DishPhotoUpload";
import { ALLERGEN_LIST } from "@/lib/allergens";
import { NUTRITION_LABELS, NUTRITION_UNITS } from "@/lib/nutrition";
import {
  NUTRITION_KEYS,
  type AllergenKey,
  type AllergenSeverity,
  type MenuCategory,
  type MenuItem,
  type NutritionFacts,
} from "@/lib/types";

export interface CatalogueEntry {
  slug: string;
  name: string;
  category: string;
  allergens: AllergenKey[];
}

export interface DishDraft {
  id?: string;
  name: string;
  description: string;
  category: MenuCategory;
  priceCents: number;
  basePortionGrams: number;
  nutrition: NutritionFacts;
  isAvailable: boolean;
  allergens: { key: AllergenKey; severity: AllergenSeverity; note?: string }[];
  ingredients: {
    slug: string;
    quantityG: number | null;
    isOptional: boolean;
  }[];
}

const CATEGORIES: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];

const EMPTY_NUTRITION: NutritionFacts = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  sugar_g: 0,
  sodium_mg: 0,
  fiber_g: 0,
};

export function draftFromItem(item: MenuItem | null): DishDraft {
  if (!item) {
    return {
      name: "",
      description: "",
      category: "mains",
      priceCents: 0,
      basePortionGrams: 200,
      nutrition: { ...EMPTY_NUTRITION },
      isAvailable: true,
      allergens: [],
      ingredients: [],
    };
  }
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    category: item.category,
    priceCents: item.priceCents,
    basePortionGrams: item.basePortionGrams,
    nutrition: { ...item.nutrition },
    isAvailable: item.isAvailable,
    // Only hand-declared rows are editable; ingredient-derived allergens are a
    // consequence of the ingredient list and are shown read-only alongside.
    allergens: item.allergens.map((a) => ({
      key: a.key,
      severity: a.severity,
      note: a.note,
    })),
    ingredients: item.ingredients.map((line) => ({
      slug: line.ingredient.slug,
      quantityG: line.quantityG,
      isOptional: line.isOptional,
    })),
  };
}

interface DishFormProps {
  draft: DishDraft;
  catalogue: readonly CatalogueEntry[];
  saving: boolean;
  error: string | null;
  onChange: (draft: DishDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (() => void) | null;
}

const field =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sage focus:ring-2 focus:ring-sage/25";
const labelClass =
  "block text-xs font-medium uppercase tracking-wide text-ink-muted";

export function DishForm({
  draft,
  catalogue,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: DishFormProps) {
  const [ingredientQuery, setIngredientQuery] = useState("");

  const patch = useCallback(
    (partial: Partial<DishDraft>) => onChange({ ...draft, ...partial }),
    [draft, onChange],
  );

  const chosen = useMemo(
    () => new Set(draft.ingredients.map((line) => line.slug)),
    [draft.ingredients],
  );

  const matches = useMemo(() => {
    const q = ingredientQuery.trim().toLowerCase();
    if (!q) return [];
    return catalogue
      .filter(
        (entry) =>
          !chosen.has(entry.slug) && entry.name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [catalogue, chosen, ingredientQuery]);

  /**
   * Allergens the ingredient list already implies. Shown so nobody re-declares
   * them by hand — the derived set is authoritative and always current.
   */
  const derived = useMemo(() => {
    const bySlug = new Map(catalogue.map((entry) => [entry.slug, entry]));
    const found = new Map<AllergenKey, boolean>();
    for (const line of draft.ingredients) {
      for (const key of bySlug.get(line.slug)?.allergens ?? []) {
        found.set(key, (found.get(key) ?? true) && line.isOptional);
      }
    }
    return found;
  }, [catalogue, draft.ingredients]);

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={labelClass}>Dish name</span>
          <input
            className={`mt-1 ${field}`}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            required
            maxLength={120}
          />
        </label>

        <label className="sm:col-span-2">
          <span className={labelClass}>Description</span>
          <textarea
            className={`mt-1 ${field} min-h-20 resize-y`}
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            maxLength={600}
          />
        </label>

        <label>
          <span className={labelClass}>Course</span>
          <select
            className={`mt-1 ${field}`}
            value={draft.category}
            onChange={(e) =>
              patch({ category: e.target.value as MenuCategory })
            }
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={labelClass}>Price (pence)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className={`mt-1 ${field} tabular-nums`}
            value={draft.priceCents}
            onChange={(e) =>
              patch({
                priceCents: Math.max(
                  0,
                  Math.round(Number(e.target.value) || 0),
                ),
              })
            }
          />
        </label>

        <label>
          <span className={labelClass}>Portion weight (g)</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={5000}
            className={`mt-1 ${field} tabular-nums`}
            value={draft.basePortionGrams}
            onChange={(e) =>
              patch({
                basePortionGrams: Math.max(1, Number(e.target.value) || 1),
              })
            }
          />
        </label>

        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            checked={draft.isAvailable}
            onChange={(e) => patch({ isAvailable: e.target.checked })}
            className="size-4 accent-[var(--color-sage)]"
          />
          <span className="text-sm text-ink">On the menu today</span>
        </label>
      </div>

      {/* Nutrition, per base portion — scaled on read, never re-entered. */}
      <fieldset>
        <legend className={labelClass}>Nutrition, per portion</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {NUTRITION_KEYS.map((key) => (
            <label key={key}>
              <span className="text-[11px] text-ink-muted">
                {NUTRITION_LABELS[key]} ({NUTRITION_UNITS[key]})
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.1"
                className={`mt-0.5 ${field} tabular-nums`}
                value={draft.nutrition[key]}
                onChange={(e) =>
                  patch({
                    nutrition: {
                      ...draft.nutrition,
                      [key]: Math.max(0, Number(e.target.value) || 0),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
      </fieldset>

      {/* Ingredients */}
      <fieldset>
        <legend className={labelClass}>Ingredients</legend>

        <ul className="mt-2 space-y-2">
          {draft.ingredients.map((line, index) => {
            const entry = catalogue.find((c) => c.slug === line.slug);
            return (
              <li key={line.slug} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {entry?.name ?? line.slug}
                  {entry?.allergens.length ? (
                    <span className="ml-1.5 text-xs text-terracotta">
                      {entry.allergens.join(", ")}
                    </span>
                  ) : null}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  placeholder="g"
                  aria-label={`Grams of ${entry?.name ?? line.slug}`}
                  className={`${field} w-20 shrink-0 tabular-nums`}
                  value={line.quantityG ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const next = [...draft.ingredients];
                    next[index] = {
                      ...line,
                      quantityG: raw === "" ? null : Number(raw),
                    };
                    patch({ ingredients: next });
                  }}
                />
                <label className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={line.isOptional}
                    onChange={(e) => {
                      const next = [...draft.ingredients];
                      next[index] = { ...line, isOptional: e.target.checked };
                      patch({ ingredients: next });
                    }}
                    className="size-3.5 accent-[var(--color-sage)]"
                  />
                  optional
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${entry?.name ?? line.slug}`}
                  onClick={() =>
                    patch({
                      ingredients: draft.ingredients.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted transition-colors hover:border-terracotta hover:text-terracotta"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="relative mt-2">
          <input
            className={field}
            placeholder="Add an ingredient…"
            value={ingredientQuery}
            onChange={(e) => setIngredientQuery(e.target.value)}
            aria-label="Search ingredients"
          />
          {matches.length ? (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg">
              {matches.map((entry) => (
                <li key={entry.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      patch({
                        ingredients: [
                          ...draft.ingredients,
                          {
                            slug: entry.slug,
                            quantityG: null,
                            isOptional: false,
                          },
                        ],
                      });
                      setIngredientQuery("");
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                  >
                    <span>{entry.name}</span>
                    {entry.allergens.length ? (
                      <span className="text-xs text-terracotta">
                        {entry.allergens.join(", ")}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {derived.size ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            Declared automatically from these ingredients:{" "}
            <span className="text-terracotta">
              {[...derived.entries()]
                .map(
                  ([key, optional]) =>
                    `${key}${optional ? " (removable)" : ""}`,
                )
                .join(", ")}
            </span>
            . You do not need to add them below.
          </p>
        ) : null}
      </fieldset>

      {/* 3D asset */}
      <fieldset>
        <legend className={labelClass}>3D model</legend>
        <p className="mt-1 mb-2 text-xs leading-relaxed text-ink-muted">
          A photo becomes the model diners see in AR. The same photo is only
          ever generated once, however many dishes use it.
        </p>
        <DishPhotoUpload menuItemId={draft.id} />
      </fieldset>

      {/* Hand-declared allergens: the facts no ingredient can imply. */}
      <fieldset>
        <legend className={labelClass}>Extra allergen declarations</legend>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          For what the ingredient list cannot know — a shared fryer, a shared
          prep surface, a supplier warning.
        </p>

        <ul className="mt-2 space-y-2">
          {draft.allergens.map((entry, index) => (
            <li
              key={`${entry.key}-${index}`}
              className="flex items-center gap-2"
            >
              <select
                className={`${field} flex-1`}
                aria-label="Allergen"
                value={entry.key}
                onChange={(e) => {
                  const next = [...draft.allergens];
                  next[index] = {
                    ...entry,
                    key: e.target.value as AllergenKey,
                  };
                  patch({ allergens: next });
                }}
              >
                {ALLERGEN_LIST.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select
                className={`${field} w-36 shrink-0`}
                aria-label="Severity"
                value={entry.severity}
                onChange={(e) => {
                  const next = [...draft.allergens];
                  next[index] = {
                    ...entry,
                    severity: e.target.value as AllergenSeverity,
                  };
                  patch({ allergens: next });
                }}
              >
                <option value="contains">Contains</option>
                <option value="may_contain">May contain</option>
                <option value="removable">Removable</option>
              </select>
              <button
                type="button"
                aria-label="Remove declaration"
                onClick={() =>
                  patch({
                    allergens: draft.allergens.filter((_, i) => i !== index),
                  })
                }
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted transition-colors hover:border-terracotta hover:text-terracotta"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            patch({
              allergens: [
                ...draft.allergens,
                { key: "peanuts", severity: "may_contain" },
              ],
            })
          }
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-ink-muted transition-colors hover:border-ink hover:text-ink"
        >
          <Plus className="size-3.5" aria-hidden />
          Add declaration
        </button>
      </fieldset>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-terracotta/40 bg-terracotta-soft px-3 py-2 text-sm text-ink"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-sage px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {saving ? "Saving…" : draft.id ? "Save changes" : "Add to menu"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-2.5 text-sm text-ink-muted transition hover:text-ink"
        >
          Cancel
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto flex items-center gap-1.5 rounded-full border border-border px-4 py-2.5 text-sm text-ink-muted transition hover:border-terracotta hover:text-terracotta"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete dish
          </button>
        ) : null}
      </div>
    </form>
  );
}
