"use client";

import { Check } from "lucide-react";

import { ALLERGEN_LIST } from "@/lib/allergens";
import { useAllergenProfile } from "@/lib/hooks/useAllergenProfile";

/**
 * What you avoid.
 *
 * Big switch rows rather than checkboxes, because this gets tapped once, at a
 * table, possibly by somebody's parent, and a 24px hit target is not enough.
 * The list is ordered by how often each one comes up, not alphabetically.
 */

export function AllergyScreen() {
  const { profile, toggle, clear } = useAllergenProfile();
  const avoid = new Set(profile.avoid);

  return (
    <div className="px-4 pb-8">
      <header className="pb-5 pt-2">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
          Your allergies
        </h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
          Tap anything you avoid. Dishes that normally contain it get flagged.
        </p>
      </header>

      <ul className="card divide-y divide-line-soft overflow-hidden">
        {ALLERGEN_LIST.map((allergen) => {
          const on = avoid.has(allergen.key);
          return (
            <li key={allergen.key}>
              <button
                type="button"
                onClick={() => toggle(allergen.key)}
                aria-pressed={on}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-sunk"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-medium text-ink">
                    {allergen.label}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">
                    {allergen.description}
                  </span>
                </span>

                <span
                  className={[
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition",
                    on
                      ? "border-safe bg-safe text-card"
                      : "border-line bg-transparent",
                  ].join(" ")}
                  aria-hidden
                >
                  {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {profile.avoid.length > 0 ? (
        <button
          type="button"
          onClick={clear}
          className="mt-4 w-full rounded-control py-3 text-[15px] font-medium text-ink-2 transition active:bg-sunk"
        >
          Clear all
        </button>
      ) : null}

      <p className="mt-6 text-[13px] leading-relaxed text-ink-3">
        This list stays on your phone. It is never sent anywhere and there is no
        account it could be attached to.
      </p>
    </div>
  );
}
