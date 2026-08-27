"use client";

import {
  ArrowLeft,
  Flame,
  Leaf,
  MessageCircleWarning,
  ScanLine,
  Trash2,
  Utensils,
} from "lucide-react";

import { VerdictPill } from "@/components/app/Verdict";
import { DishFigure } from "@/components/dish/DishFigure";
import { ALLERGEN_CATALOG } from "@/lib/allergens";
import { clashSentence, clashesWith, verdictFor } from "@/lib/dish/clash";
import { crossContactFor, listAllergens } from "@/lib/dish/cross-contact";
import type { DishExplanation } from "@/lib/dish/types";
import type { AllergenKey } from "@/lib/types";

/**
 * One dish, opened.
 *
 * Ordered the way somebody actually wants it: the verdict, then what the thing
 * is, then what is in it. The 3D render sits above the words as the card's
 * photograph, which is what it stands in for — nothing here has a picture of
 * the real plate, and the caption says so.
 */

interface DishScreenProps {
  dish: DishExplanation;
  avoid: readonly AllergenKey[];
  onBack: () => void;
  onSeeOnPlate: () => void;
  onForget?: () => void;
}

export function DishScreen({
  dish,
  avoid,
  onBack,
  onSeeOnPlate,
  onForget,
}: DishScreenProps) {
  const clashes = clashesWith(dish, avoid);
  const verdict = verdictFor(clashes, avoid.length > 0, dish.recognised);
  const crossContact = crossContactFor(avoid);

  return (
    <div className="pb-8">
      <div className="flex items-center justify-between px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 flex size-10 items-center justify-center rounded-full text-ink transition active:bg-sunk"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        {onForget ? (
          <button
            type="button"
            onClick={onForget}
            className="-mr-2 flex size-10 items-center justify-center rounded-full text-ink-3 transition active:bg-sunk"
            aria-label={`Remove ${dish.printedName} from your history`}
          >
            <Trash2 className="size-4.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="px-4">
        <section className="card overflow-hidden rise">
          <DishFigure
            name={`${dish.printedName} ${dish.englishName}`.trim()}
            drawAs={dish.englishName || dish.printedName}
            description={dish.whatItIs}
            servedAs={dish.servedAs}
            recognised={dish.recognised}
          />

          <div className="px-5 pb-5 pt-4">
            <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.01em] text-ink">
              {dish.printedName}
            </h1>
            {dish.englishName &&
            dish.englishName.toLowerCase() !==
              dish.printedName.toLowerCase() ? (
              <p className="mt-1 text-[16px] text-ink-2">{dish.englishName}</p>
            ) : null}

            <div className="mt-3">
              <VerdictPill
                verdict={verdict}
                clashes={clashes}
                unknownReason={dish.recognised ? "no_profile" : "unrecognised"}
              />
            </div>

            <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
              {dish.origin ? <li>{dish.origin}</li> : null}
              {dish.servedAs ? (
                <li className="flex items-center gap-1.5">
                  <Utensils className="size-3.5" aria-hidden />
                  {dish.servedAs}
                </li>
              ) : null}
              {dish.dietary === "vegan" || dish.dietary === "vegetarian" ? (
                <li className="flex items-center gap-1.5 text-safe">
                  <Leaf className="size-3.5" aria-hidden />
                  {dish.dietary}
                </li>
              ) : null}
              {dish.spice !== "none" && dish.spice !== "varies" ? (
                <li className="flex items-center gap-1.5">
                  <Flame className="size-3.5" aria-hidden />
                  {dish.spice}
                </li>
              ) : null}
            </ul>
          </div>
        </section>

        {/* The clash, in full, right under the verdict that named it. */}
        {clashes.length > 0 ? (
          <section
            role="alert"
            className="card mt-3 border-l-4 border-alert px-5 py-4"
          >
            <p className="text-[15px] font-semibold text-ink">
              {clashSentence(clashes)}
            </p>
            <ul className="mt-2 space-y-1">
              {clashes.map((clash) => (
                <li key={clash.key} className="text-[15px] text-ink-2">
                  <span className="text-ink">
                    {ALLERGEN_CATALOG[clash.key].label}
                  </span>
                  {clash.from ? `, from ${clash.from}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              That is how the dish is normally made. Only the kitchen knows what
              went into theirs, so say it to your server before you order.
            </p>
          </section>
        ) : null}

        {/*
          Not a guess and not a model output: a standing fact about kitchens,
          shown to anyone who avoids something a trace of will hurt. It matters
          most on the dishes that came back clear, because "Nothing you avoid"
          on a plate of chips is exactly where somebody needs to hear that the
          fryer is shared.
        */}
        {crossContact ? (
          <section className="card mt-3 px-5 py-4">
            <p className="flex items-start gap-2.5 text-[15px] font-semibold text-ink">
              <MessageCircleWarning
                className="mt-0.5 size-4 shrink-0 text-caution"
                aria-hidden
              />
              Ask about {listAllergens(crossContact.keys)} even when nothing is
              flagged
            </p>
            <p className="mt-2 pl-6.5 text-[14px] leading-relaxed text-ink-2">
              No menu prints what a kitchen shares, and this app cannot see it
              either: {crossContact.because}. Your server can find out.
            </p>
          </section>
        ) : null}

        {!dish.recognised ? (
          <section className="card mt-3 px-5 py-4">
            <p className="text-[15px] leading-relaxed text-ink-2">
              This is not a dish I know, so the rest is a guess from the name.
              Ask your server.
            </p>
          </section>
        ) : null}

        <section className="card mt-3 px-5 py-5">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
            What it is
          </h2>
          <p className="mt-2 text-[16px] leading-relaxed text-ink">
            {dish.whatItIs || dish.oneLine}
          </p>

          {dish.tastesLike ? (
            <>
              <h2 className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
                Tastes like
              </h2>
              <p className="mt-2 text-[16px] leading-relaxed text-ink">
                {dish.tastesLike}
              </p>
            </>
          ) : null}

          {dish.madeWith.length > 0 ? (
            <>
              <h2 className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
                Usually made with
              </h2>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {dish.madeWith.map((item) => (
                  <li
                    key={item}
                    className="rounded-full bg-sunk px-3 py-1.5 text-[14px] text-ink"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {/* Allergens the diner did not ask about, so nothing is hidden. */}
          {dish.likelyAllergens.length > clashes.length ? (
            <>
              <h2 className="mt-5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
                Also normally has
              </h2>
              <ul className="mt-2 space-y-1">
                {dish.likelyAllergens
                  .filter(
                    (entry) => !clashes.some((clash) => clash.key === entry.key),
                  )
                  .map((entry) => (
                    <li key={entry.key} className="text-[15px] text-ink-2">
                      <span className="text-ink">
                        {ALLERGEN_CATALOG[entry.key].label}
                      </span>
                      {entry.likelihood === "sometimes" ? ", sometimes" : ""}
                      {entry.from ? `, from ${entry.from}` : ""}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
        </section>

        <button
          type="button"
          onClick={onSeeOnPlate}
          className="mt-3 flex w-full items-center justify-center gap-2.5 rounded-card bg-ink py-4 text-[16px] font-semibold text-card transition active:opacity-90"
        >
          <ScanLine className="size-5" aria-hidden />
          See it on your plate
        </button>

        <p className="mt-5 px-1 text-[13px] leading-relaxed text-ink-3">
          Everything here is how this dish is normally made, not what this
          kitchen put in theirs. With a serious allergy, always tell your
          server.
        </p>
      </div>
    </div>
  );
}
