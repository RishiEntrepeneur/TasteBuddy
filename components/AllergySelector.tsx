"use client";

import { Check, Loader2, ShieldAlert, Sparkles } from "lucide-react";
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
    label: "Peanuts / Tree nuts",
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
        "relative isolate overflow-hidden rounded-2xl",
        "border border-slate-800 bg-slate-950 text-slate-100",
        "shadow-[0_0_0_1px_rgba(34,211,238,0.06),0_24px_60px_-24px_rgba(0,0,0,0.9)]",
        className,
      ].join(" ")}
    >
      {/*
        Grid field. Two repeating-linear-gradients masked by a radial fade, so
        the whole effect is one painted layer — no SVG, no canvas, nothing to
        composite per frame. `pointer-events-none` keeps it clear of the
        switches stacked above it.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(148,163,184,0.09)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.09)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-48 w-[22rem] -translate-x-1/2 rounded-full bg-cyan-400/12 blur-3xl"
      />

      <header className="flex items-start justify-between gap-4 border-b border-slate-800/80 px-5 py-4">
        <div className="min-w-0">
          <h2
            id="allergy-selector-heading"
            className="text-[15px] font-semibold tracking-tight text-slate-50"
          >
            {title}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
            Saved on this device only. Flagged dishes are marked in the menu and
            over the dish in AR.
          </p>
        </div>

        <span
          className={[
            "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors",
            activeCount > 0
              ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
              : "border-slate-700 text-slate-500",
          ].join(" ")}
        >
          {activeCount}/{ALLERGY_OPTIONS.length}
        </span>
      </header>

      <ul className="divide-y divide-slate-800/70">
        {ALLERGY_OPTIONS.map((option) => {
          const active = isActive(option);
          return (
            <li key={option.id}>
              <button
                type="button"
                role="switch"
                aria-checked={active}
                onClick={() => setAllergens(option.keys, !active)}
                // `touch-manipulation` drops the 300ms tap delay on mobile
                // Safari; the row is a full-width 64px target.
                className={[
                  "group flex w-full touch-manipulation items-center gap-4 px-5 py-4 text-left",
                  "transition-colors duration-150 outline-none",
                  "focus-visible:bg-slate-900 active:bg-slate-900/70",
                  active ? "bg-cyan-400/[0.04]" : "hover:bg-slate-900/50",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors duration-150",
                    active
                      ? "border-cyan-400 bg-cyan-400 text-slate-950"
                      : "border-slate-700 bg-slate-900 text-transparent group-hover:border-slate-600",
                  ].join(" ")}
                >
                  <Check className="size-4" strokeWidth={3} />
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      "block text-[15px] font-medium transition-colors duration-150",
                      active ? "text-cyan-300" : "text-slate-200",
                    ].join(" ")}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-slate-500">
                    {option.detail}
                  </span>
                </span>

                <span
                  aria-hidden
                  className={[
                    "shrink-0 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150",
                    active ? "bg-pink-500/15 text-pink-400" : "text-slate-600",
                  ].join(" ")}
                >
                  {active ? "Flagged" : "Off"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-slate-800/80 px-5 py-4">
        <label className="flex touch-manipulation items-start gap-3">
          <input
            type="checkbox"
            checked={profile.strict}
            onChange={(event) => setStrict(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-pink-500"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-slate-200">
              Flag cross-contamination
            </span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-slate-500">
              Also warns on shared fryers and prep surfaces. Leave on for a
              severe allergy.
            </span>
          </span>
        </label>
      </div>

      {activeCount > 0 ? (
        <p
          role="status"
          className="flex items-start gap-2 border-t border-pink-500/20 bg-pink-500/[0.07] px-5 py-3 text-[12px] leading-relaxed text-pink-200"
        >
          <ShieldAlert
            className="mt-px size-3.5 shrink-0 text-pink-400"
            aria-hidden
          />
          <span>
            AR view will overlay a warning on any dish matching these
            ingredients.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 border-t border-slate-800/80 px-5 py-3 text-[12px] leading-relaxed text-slate-500">
          <Sparkles className="mt-px size-3.5 shrink-0" aria-hidden />
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
      className="flex h-[22rem] items-center justify-center rounded-2xl border border-slate-800 bg-slate-950"
    >
      <Loader2 className="size-5 animate-spin text-slate-700" />
    </div>
  );
}

export default AllergySelector;
