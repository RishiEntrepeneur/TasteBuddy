"use client";

import { ArrowLeft, Bookmark, Loader2, QrCode, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAllergenProfile } from "@/lib/hooks/useAllergenProfile";
import { useDinerToken } from "@/lib/hooks/useSavedDishes";
import { evaluateMenuItem } from "@/lib/menu-filter";
import { formatPrice } from "@/lib/nutrition";
import type { MenuItem } from "@/lib/types";

interface SavedEntry {
  savedAt: string;
  note: string | null;
  item: MenuItem;
  restaurant: { id: string; slug: string; name: string };
}

export function SavedDishesView() {
  const { profile, thresholds } = useAllergenProfile();
  const token = useDinerToken();
  const [entries, setEntries] = useState<SavedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch(`/api/saved?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(response.status),
      )
      .then((body: { items: SavedEntry[] }) => {
        if (!controller.signal.aborted) setEntries(body.items);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Your saved dishes could not be loaded.");
          setEntries([]);
        }
      });
    return () => controller.abort();
  }, [token]);

  const remove = useCallback(
    async (menuItemId: string) => {
      if (!token) return;
      const previous = entries;
      setEntries(
        (current) => current?.filter((e) => e.item.id !== menuItemId) ?? null,
      );
      try {
        const response = await fetch(
          `/api/saved?token=${encodeURIComponent(token)}&menuItemId=${encodeURIComponent(menuItemId)}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error(String(response.status));
      } catch {
        setEntries(previous ?? null);
        setError("That dish could not be removed.");
      }
    },
    [token, entries],
  );

  return (
    <div className="min-h-dvh bg-surface">
      <div className="safe-top mx-auto w-full max-w-md px-5 pb-16">
        <header className="flex items-center justify-between py-5">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </Link>
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            <QrCode className="size-3" aria-hidden />
            TasteBuddy
          </span>
        </header>

        <h1 className="mt-3 font-display text-[2rem] leading-[1.1] tracking-tight text-ink">
          Saved dishes
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-muted">
          Kept across every venue you have scanned, and re-checked against your
          current allergen profile each time you open this.
        </p>

        {error ? (
          <p role="status" className="mt-4 text-sm text-terracotta">
            {error}
          </p>
        ) : null}

        {entries === null ? (
          <p className="flex items-center gap-2 py-12 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading your list…
          </p>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <Bookmark className="mx-auto size-7 text-ink-muted" aria-hidden />
            <p className="mt-4 font-medium text-ink">Nothing saved yet</p>
            <p className="mt-1 text-sm text-ink-muted">
              Tap the bookmark on any dish and it will be waiting here.
            </p>
          </div>
        ) : (
          <ul className="mt-7 space-y-3">
            {entries.map((entry) => {
              // Re-evaluated now, not when it was saved: a diner who has since
              // added an allergen must see the dish they kept turn unsafe.
              const evaluated = evaluateMenuItem(entry.item, {
                profile,
                thresholds,
              });
              return (
                <li
                  key={entry.item.id}
                  className={[
                    "rounded-card border p-4",
                    evaluated.hasAllergenConflict
                      ? "border-terracotta/60 bg-terracotta-soft"
                      : "border-border bg-surface-raised",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-[17px] leading-snug text-ink">
                        {entry.item.name}
                      </p>
                      <Link
                        href={`/restaurant/${entry.restaurant.slug}`}
                        className="mt-0.5 block text-sm text-ink-muted underline-offset-2 hover:underline"
                      >
                        {entry.restaurant.name}
                      </Link>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {formatPrice(entry.item.priceCents, "USD", "en-US")}
                      </span>
                      <button
                        type="button"
                        onClick={() => void remove(entry.item.id)}
                        aria-label={`Remove ${entry.item.name}`}
                        className="flex size-8 items-center justify-center rounded-control border border-border text-ink-muted transition-colors hover:border-terracotta hover:text-terracotta"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </div>

                  {evaluated.hasAllergenConflict ? (
                    <p role="alert" className="mt-2.5 text-sm text-ink">
                      <span className="font-semibold text-terracotta">
                        No longer safe for you.{" "}
                      </span>
                      {evaluated.conflicts
                        .filter((conflict) => conflict.type === "allergen")
                        .map((conflict) => conflict.message)
                        .join(" ")}
                    </p>
                  ) : null}

                  {entry.item.ingredients.length ? (
                    <p className="mt-2 truncate text-[13px] text-ink-muted">
                      {entry.item.ingredients
                        .map((line) => line.ingredient.name)
                        .join(" · ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
