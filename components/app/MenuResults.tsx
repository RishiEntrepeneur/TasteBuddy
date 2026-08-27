"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Loader2,
  MessageCircleWarning,
} from "lucide-react";

import { VerdictPill } from "@/components/app/Verdict";
import { clashesWith, verdictFor } from "@/lib/dish/clash";
import { crossContactFor, listAllergens } from "@/lib/dish/cross-contact";
import type { DishSummary } from "@/lib/dish/types";
import type { AllergenKey } from "@/lib/types";

/**
 * A photographed menu, read.
 *
 * Every row carries its own verdict, because the whole point of pointing a
 * camera at a menu is to find out which of these you can have. The ones that
 * clash sort to the top of nothing — the menu's own order is kept, since
 * somebody is holding the paper version and matching it line for line.
 */

export interface MenuReadingView {
  language: string;
  dishes: DishSummary[];
  notes: string[];
}

interface MenuResultsProps {
  reading: MenuReadingView;
  avoid: readonly AllergenKey[];
  opening: string | null;
  onOpen: (dish: DishSummary) => void;
  onBack: () => void;
}

export function MenuResults({
  reading,
  avoid,
  opening,
  onOpen,
  onBack,
}: MenuResultsProps) {
  const flagged = reading.dishes.filter(
    (dish) => clashesWith(dish, avoid).length > 0,
  ).length;
  const crossContact = crossContactFor(avoid);

  return (
    <div className="pb-8">
      <div className="px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 flex size-10 items-center justify-center rounded-full text-ink transition active:bg-sunk"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
      </div>

      <header className="px-4 pb-4">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
          {reading.dishes.length}{" "}
          {reading.dishes.length === 1 ? "dish" : "dishes"}
        </h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
          {reading.language.toLowerCase() === "english"
            ? "Read off your photo."
            : `Translated from ${reading.language}.`}
          {avoid.length > 0
            ? flagged > 0
              ? ` ${flagged} ${flagged === 1 ? "clashes" : "clash"} with yours.`
              : " None clash with yours."
            : ""}
        </p>

        {/*
          Once, at the top, rather than on every row. This list is where
          somebody picks the dish that looked safe, and the rows it applies to
          hardest are the ones with a green tick on them.
        */}
        {crossContact ? (
          <p className="mt-3 flex items-start gap-2 rounded-tile bg-caution-wash px-3.5 py-3 text-[14px] leading-relaxed text-ink">
            <MessageCircleWarning
              className="mt-0.5 size-4 shrink-0 text-caution"
              aria-hidden
            />
            <span>
              Even where nothing is flagged, ask about{" "}
              {listAllergens(crossContact.keys)}: no menu prints what a kitchen
              shares.
            </span>
          </p>
        ) : null}

        {reading.notes.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {reading.notes.map((note, index) => (
              <li
                key={index}
                className="flex items-start gap-1.5 text-[13px] leading-relaxed text-ink-3"
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <ul className="space-y-2 px-4">
        {reading.dishes.map((dish) => {
          const clashes = clashesWith(dish, avoid);
          const verdict = verdictFor(clashes, avoid.length > 0, dish.recognised);
          const busy = opening === dish.printedName;

          return (
            <li key={dish.printedName}>
              <button
                type="button"
                onClick={() => onOpen(dish)}
                disabled={opening !== null}
                className="card flex w-full items-start gap-3 px-4 py-4 text-left transition active:scale-[0.99] disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-display text-[19px] leading-snug text-ink">
                      {dish.printedName}
                    </span>
                    {dish.priceText ? (
                      <span className="shrink-0 text-[14px] tabular-nums text-ink-3">
                        {dish.priceText}
                      </span>
                    ) : null}
                  </span>

                  {dish.englishName ? (
                    <span className="mt-0.5 block truncate text-[14px] text-ink-2">
                      {dish.englishName}
                    </span>
                  ) : null}

                  <span className="mt-1.5 block text-[15px] leading-relaxed text-ink">
                    {dish.oneLine}
                  </span>

                  {/* A dish nobody recognised still says so. "Allergies not set" on
                      every row would be noise; "not known" on the one row it
                      applies to is the opposite. */}
                  {verdict !== "unknown" || !dish.recognised ? (
                    <span className="mt-2.5 block">
                      <VerdictPill
                        verdict={verdict}
                        clashes={clashes}
                        unknownReason={
                          dish.recognised ? "no_profile" : "unrecognised"
                        }
                        size="compact"
                      />
                    </span>
                  ) : null}
                </span>

                {busy ? (
                  <Loader2
                    className="mt-1 size-4 shrink-0 animate-spin text-ink-3"
                    aria-hidden
                  />
                ) : (
                  <ChevronRight
                    className="mt-1 size-4 shrink-0 text-ink-3"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 px-5 text-[13px] leading-relaxed text-ink-3">
        This is how these dishes are normally made, not what this kitchen put in
        them. With a serious allergy, always tell your server.
      </p>
    </div>
  );
}
