"use client";

import { ArrowLeft, Flame, Leaf, ShieldAlert, Utensils } from "lucide-react";

import { DishPreview3D } from "@/components/dish/DishPreview3D";
import { clashSentence, clashes } from "@/components/dish/DishCard";
import { ALLERGEN_CATALOG } from "@/lib/allergens";
import type { DishExplanation } from "@/lib/dish/types";
import type { AllergenKey } from "@/lib/types";

/**
 * Everything the app can say about one dish.
 *
 * The order is the order somebody actually wants it: is it a problem for me,
 * what is it, what does it taste like, what is in it. The 3D view sits under
 * the words rather than above them, because "what is this" is a question words
 * answer better and a picture only helps once you have the answer.
 */

interface DishDetailProps {
  dish: DishExplanation;
  avoid: readonly AllergenKey[];
  onBack: () => void;
  backLabel: string;
}

export function DishDetail({ dish, avoid, onBack, backLabel }: DishDetailProps) {
  const hits = clashes(dish, avoid);
  const serious = hits.some((hit) => hit.likelihood === "usually");

  return (
    <article>
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 py-2 text-sm text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {backLabel}
      </button>

      <header className="mt-2">
        <h1 className="font-display text-[2rem] leading-[1.1] tracking-tight text-ink">
          {dish.printedName}
        </h1>
        {dish.englishName &&
        dish.englishName.toLowerCase() !== dish.printedName.toLowerCase() ? (
          <p className="mt-1 text-base text-ink-muted">{dish.englishName}</p>
        ) : null}

        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          {dish.origin ? <span>{dish.origin}</span> : null}
          {dish.servedAs ? (
            <span className="flex items-center gap-1">
              <Utensils className="size-3.5" aria-hidden />
              {dish.servedAs}
            </span>
          ) : null}
          {dish.dietary === "vegan" || dish.dietary === "vegetarian" ? (
            <span className="flex items-center gap-1 text-sage">
              <Leaf className="size-3.5" aria-hidden />
              {dish.dietary}
            </span>
          ) : null}
          {dish.spice !== "none" && dish.spice !== "varies" ? (
            <span className="flex items-center gap-1">
              <Flame className="size-3.5" aria-hidden />
              {dish.spice}
            </span>
          ) : null}
        </p>
      </header>

      {/* Is this a problem for me. First, because it is why some people are here. */}
      {hits.length > 0 ? (
        <div
          role="alert"
          className={[
            "mt-5 rounded-card border px-4 py-3.5",
            serious
              ? "border-terracotta/60 bg-terracotta-soft"
              : "border-border bg-surface-raised",
          ].join(" ")}
        >
          <p className="flex items-start gap-2 text-sm font-semibold text-ink">
            <ShieldAlert
              className="mt-0.5 size-4 shrink-0 text-terracotta"
              aria-hidden
            />
            {clashSentence(hits)}
          </p>
          <ul className="mt-2 space-y-1 pl-6">
            {hits.map((hit) => (
              <li key={hit.key} className="text-sm text-ink">
                {ALLERGEN_CATALOG[hit.key].label}
                {hit.from ? (
                  <span className="text-ink-muted"> from {hit.from}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 pl-6 text-sm leading-relaxed text-ink">
            This is how the dish is normally made. Only the kitchen knows what
            went into theirs, so tell your server before you order.
          </p>
        </div>
      ) : null}

      {!dish.recognised ? (
        <p className="mt-5 rounded-card border border-border bg-surface-raised px-4 py-3 text-sm leading-relaxed text-ink-muted">
          This one is not a dish I know, so what follows is a guess from the
          name. Ask your server.
        </p>
      ) : null}

      <section className="mt-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted">
          What it is
        </h2>
        <p className="mt-2 text-[17px] leading-relaxed text-ink">
          {dish.whatItIs || dish.oneLine}
        </p>
      </section>

      {dish.tastesLike ? (
        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted">
            Tastes like
          </h2>
          <p className="mt-2 text-[17px] leading-relaxed text-ink">
            {dish.tastesLike}
          </p>
        </section>
      ) : null}

      {dish.madeWith.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted">
            Usually made with
          </h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {dish.madeWith.map((item) => (
              <li
                key={item}
                className="rounded-control border border-border px-2.5 py-1 text-sm text-ink"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Allergens the diner did not ask about, so they can still see them. */}
      {dish.likelyAllergens.length > hits.length ? (
        <section className="mt-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted">
            Also normally has
          </h2>
          <ul className="mt-2 space-y-1">
            {dish.likelyAllergens
              .filter((entry) => !hits.some((hit) => hit.key === entry.key))
              .map((entry) => (
                <li key={entry.key} className="text-sm text-ink-muted">
                  <span className="text-ink">
                    {ALLERGEN_CATALOG[entry.key].label}
                  </span>
                  {entry.likelihood === "sometimes" ? ", sometimes" : ""}
                  {entry.from ? `, from ${entry.from}` : ""}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-7">
        <DishPreview3D
          text={`${dish.printedName} ${dish.englishName} ${dish.whatItIs}`}
        />
      </section>

      <p className="mt-8 border-t border-border pt-5 text-sm leading-relaxed text-ink-muted">
        Everything here is what this dish normally is, not what this kitchen
        made. With a serious allergy, always say so to your server.
      </p>
    </article>
  );
}
