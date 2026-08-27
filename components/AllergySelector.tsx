"use client";

import { Check, Leaf, Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useAllergenProfile } from "@/lib/hooks/useAllergenProfile";
import type { AllergenKey } from "@/lib/types";

/**
 * AllergySelector — the diner's allergy profile card.
 *
 * State
 * -----
 * Reads and writes the shared allergen store (`lib/hooks/useAllergenProfile`),
 * which persists to `localStorage` as a plain array of allergen keys and
 * publishes through `useSyncExternalStore`. That is the same store the menu and
 * `TasteBuddyARViewer` subscribe to, so a toggle here re-evaluates every dish
 * and updates the AR overlay's flagged ingredients on the next render — no
 * prop threading, no refetch, and correct across tabs via the `storage` event.
 *
 * Privacy
 * -------
 * Allergy data is health data. Nothing in this component reaches the network:
 * there is no fetch, no server action and no analytics call, and the store it
 * writes to is browser-local by construction. The only time an allergen leaves
 * the device is as a query parameter on a menu request the diner initiated,
 * which is never persisted server-side.
 *
 * Colour
 * ------
 * Built entirely from the shared stone-neutral tokens in `globals.css`, so the
 * card sits on the same alabaster and sandstone as the menu blocks. Sage olive
 * marks a selected switch. Terracotta is held back for warnings alone — the
 * FLAGGED badges and the cross-contamination notice — so the alert colour never
 * appears as decoration and keeps its meaning wherever it does show up.
 */

/**
 * One switch may stand for several allergen keys.
 *
 * "Peanuts / Tree nuts" is deliberately a single control: they are distinct
 * botanically but are cross-contaminated together in practice, and a diner who
 * avoids one almost always avoids the other. Splitting them into two switches
 * on a phone buys precision nobody asked for at the cost of a mis-tap.
 */
interface AllergyOption {
  id: string;
  label: string;
  /** Sub-label naming what the switch actually covers. */
  detail: string;
  keys: readonly AllergenKey[];
}

const ALLERGY_OPTIONS: readonly AllergyOption[] = [
  {
    id: "nuts",
    label: "Peanuts & tree nuts",
    detail: "Groundnut, almond, cashew, walnut, pistachio, hazelnut",
    keys: ["peanuts", "tree_nuts"],
  },
  {
    id: "dairy",
    label: "Dairy",
    detail: "Milk, butter, cream, cheese, whey, casein",
    keys: ["dairy"],
  },
  {
    id: "gluten",
    label: "Gluten",
    detail: "Wheat, barley, rye, spelt, malt",
    keys: ["gluten"],
  },
];

interface AllergySelectorProps {
  /** Optional heading override, e.g. per venue. */
  title?: string;
  className?: string;
}

export function AllergySelector({
  title = "Allergy profile",
  className = "",
}: AllergySelectorProps) {
  const { profile, setAllergens, setStrict } = useAllergenProfile();

  const avoided = useMemo(() => new Set(profile.avoid), [profile.avoid]);

  /** A group is on when *every* key it covers is being avoided. */
  const isActive = useCallback(
    (option: AllergyOption) => option.keys.every((key) => avoided.has(key)),
    [avoided],
  );

  const activeCount = ALLERGY_OPTIONS.filter(isActive).length;

  return (
    <section
      aria-labelledby="allergy-selector-heading"
      className={[
        "overflow-hidden rounded-card border border-border bg-surface-raised",
        className,
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <h2
            id="allergy-selector-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            Saved on this device only. Flagged dishes are marked in the menu and
            over the dish in AR.
          </p>
        </div>

        <span
          className={[
            "mt-0.5 shrink-0 rounded-control border px-2.5 py-1 text-xs tabular-nums transition-colors",
            activeCount > 0
              ? "border-sage/35 bg-sage-soft text-sage"
              : "border-border text-ink-muted",
          ].join(" ")}
        >
          {activeCount} of {ALLERGY_OPTIONS.length}
        </span>
      </header>

      <ul className="border-t border-border">
        {ALLERGY_OPTIONS.map((option, index) => {
          const active = isActive(option);
          return (
            <li
              key={option.id}
              className={index > 0 ? "border-t border-border/70" : undefined}
            >
              <button
                type="button"
                role="switch"
                aria-checked={active}
                onClick={() => setAllergens(option.keys, !active)}
                // `touch-manipulation` drops the 300ms tap delay on mobile
                // Safari; the row is a full-width 64px target.
                className={[
                  "group flex w-full touch-manipulation items-center gap-4 px-5 py-4 text-left",
                  "outline-none transition-colors duration-150",
                  "focus-visible:bg-surface-muted active:bg-surface-muted",
                  active ? "bg-sage-soft/45" : "hover:bg-surface-muted/60",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "flex size-[22px] shrink-0 items-center justify-center rounded-md border transition-colors duration-150",
                    active
                      ? "border-sage bg-sage text-white"
                      : "border-ink/20 bg-surface text-transparent group-hover:border-ink/35",
                  ].join(" ")}
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      "block text-[15px] font-medium transition-colors duration-150",
                      active ? "text-sage" : "text-ink",
                    ].join(" ")}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-muted">
                    {option.detail}
                  </span>
                </span>

                {active ? (
                  <span className="shrink-0 rounded-full bg-terracotta-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-terracotta">
                    Flagged
                  </span>
                ) : (
                  <span className="shrink-0 text-[13px] text-ink-muted/70">
                    Off
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border px-5 py-4">
        <label className="flex touch-manipulation items-start gap-3">
          <input
            type="checkbox"
            checked={profile.strict}
            onChange={(event) => setStrict(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-terracotta)]"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              Flag cross-contamination
            </span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-muted">
              Also warns on shared fryers and prep surfaces. Leave on for a
              severe allergy.
            </span>
          </span>
        </label>
      </div>

      {activeCount > 0 ? (
        <p
          role="status"
          className="flex items-start gap-2.5 border-t border-terracotta/20 bg-terracotta-soft px-5 py-3.5 text-[13px] leading-relaxed text-ink"
        >
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-terracotta"
            aria-hidden
          />
          <span>
            AR view will overlay a warning on any dish matching these
            ingredients.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2.5 border-t border-border px-5 py-3.5 text-[13px] leading-relaxed text-ink-muted">
          <Leaf className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Select anything you avoid and the whole menu re-checks itself.
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * Server-render placeholder.
 *
 * The store has no server snapshot beyond "nothing selected", so a page that
 * wants the card visible before hydration can render this to reserve the same
 * space and avoid a layout shift.
 */
export function AllergySelectorSkeleton() {
  return (
    <div
      aria-hidden
      className="flex h-[22rem] items-center justify-center rounded-card border border-border bg-surface-raised"
    >
      <Loader2 className="size-5 animate-spin text-ink-muted/50" />
    </div>
  );
}

export default AllergySelector;
