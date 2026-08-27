"use client";

import {
  AlertTriangle,
  Camera,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { DishCard, clashes } from "@/components/dish/DishCard";
import { DishDetail } from "@/components/dish/DishDetail";
import type { DishExplanation, DishSummary } from "@/lib/dish/types";
import { useAllergenProfile } from "@/lib/hooks/useAllergenProfile";
import { useDinerToken } from "@/lib/hooks/useSavedDishes";

/**
 * The whole app, from a diner's side.
 *
 * Someone is standing in a restaurant holding a menu they cannot read. There
 * is no sign-in, no restaurant to have joined first, and nothing to install:
 * photograph the menu, or type the one word you cannot place.
 */

type View =
  | { name: "start" }
  | { name: "list" }
  | { name: "dish"; from: "list" | "start" };

interface MenuResult {
  language: string;
  dishes: DishSummary[];
  notes: string[];
}

export function DishFinder() {
  const { profile } = useAllergenProfile();
  const token = useDinerToken();

  const [view, setView] = useState<View>({ name: "start" });
  const [busy, setBusy] = useState<"photo" | "dish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuResult | null>(null);
  const [dish, setDish] = useState<DishExplanation | null>(null);
  const [typed, setTyped] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);

  const avoid = profile.avoid;

  /* ---- photograph a menu ------------------------------------------------ */

  const readPhoto = useCallback(
    async (file: File) => {
      if (!token) return;
      setBusy("photo");
      setError(null);
      try {
        const body = new FormData();
        body.set("token", token);
        body.set("photo", file);
        const response = await fetch("/api/read-menu", {
          method: "POST",
          body,
        });
        const payload = (await response.json()) as MenuResult & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "That did not work.");
        }
        setMenu(payload);
        setView({ name: "list" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "That did not work.");
      } finally {
        setBusy(null);
      }
    },
    [token],
  );

  /* ---- one dish --------------------------------------------------------- */

  const openDish = useCallback(
    async (name: string, context: string, from: "list" | "start") => {
      if (!token) return;
      setBusy("dish");
      setError(null);
      try {
        const response = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, name, context }),
        });
        const payload = (await response.json()) as DishExplanation & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "That did not work.");
        }
        setDish(payload);
        setView({ name: "dish", from });
      } catch (err) {
        setError(err instanceof Error ? err.message : "That did not work.");
      } finally {
        setBusy(null);
      }
    },
    [token],
  );

  /* ---- one dish, opened ------------------------------------------------- */

  if (view.name === "dish" && dish) {
    return (
      <DishDetail
        dish={dish}
        avoid={avoid}
        backLabel={view.from === "list" ? "Back to the menu" : "Look up another"}
        onBack={() => {
          setDish(null);
          setView(view.from === "list" ? { name: "list" } : { name: "start" });
        }}
      />
    );
  }

  /* ---- a menu, read ----------------------------------------------------- */

  if (view.name === "list" && menu) {
    const flagged = menu.dishes.filter(
      (entry) => clashes(entry, avoid).length > 0,
    ).length;

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setMenu(null);
            setView({ name: "start" });
          }}
          className="py-2 text-sm text-ink-muted transition hover:text-ink"
        >
          Read another menu
        </button>

        <h1 className="mt-2 font-display text-[2rem] leading-[1.1] tracking-tight text-ink">
          {menu.dishes.length} dishes
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {menu.language === "English"
            ? "From your photo."
            : `Translated from ${menu.language}.`}
          {avoid.length > 0
            ? flagged > 0
              ? ` ${flagged} of them clash with your allergies.`
              : " None of them clash with your allergies."
            : ""}
        </p>

        {avoid.length === 0 ? (
          <Link
            href="/profile"
            className="mt-3 flex items-center gap-2 rounded-control border border-border px-3 py-2.5 text-sm text-ink transition hover:border-ink"
          >
            <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
            Tell it your allergies and it will flag what clashes
          </Link>
        ) : null}

        {menu.notes.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {menu.notes.map((note, index) => (
              <li
                key={index}
                className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted"
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                {note}
              </li>
            ))}
          </ul>
        ) : null}

        {busy === "dish" ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Looking it up
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-4 border-l-2 border-terracotta pl-3 text-sm text-ink"
          >
            {error}
          </p>
        ) : null}

        <ul className="mt-4 border-t border-border/70">
          {menu.dishes.map((entry) => (
            <DishCard
              key={entry.printedName}
              dish={entry}
              avoid={avoid}
              onOpen={() =>
                void openDish(
                  entry.printedName,
                  `${entry.englishName} ${entry.oneLine}`,
                  "list",
                )
              }
            />
          ))}
        </ul>

        <p className="mt-8 border-t border-border pt-5 text-sm leading-relaxed text-ink-muted">
          This is what these dishes normally are, not what this kitchen made.
          With a serious allergy, always tell your server.
        </p>
      </div>
    );
  }

  /* ---- the front door --------------------------------------------------- */

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-ink-muted">
        TasteBuddy
      </p>
      <h1 className="mt-2 font-display text-[2.6rem] leading-[1.02] tracking-tight text-ink">
        What is that on the menu?
      </h1>
      <p className="mt-3 max-w-prose text-[17px] leading-relaxed text-ink-muted">
        Photograph a menu you cannot read and it will tell you what every dish
        is. Or type one name you cannot place.
      </p>

      <div className="mt-7 space-y-3">
        <button
          type="button"
          onClick={() => photoInput.current?.click()}
          disabled={busy !== null || !token}
          className="flex w-full items-center justify-center gap-2.5 rounded-control bg-ink px-5 py-4 text-base font-medium text-surface transition disabled:opacity-50"
        >
          {busy === "photo" ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-5" aria-hidden />
          )}
          {busy === "photo" ? "Reading the menu" : "Photograph a menu"}
        </button>

        <input
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void readPhoto(file);
          }}
        />

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim().length >= 2) {
              void openDish(typed.trim(), "", "start");
            }
          }}
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="or type a dish, like bún chả"
            maxLength={120}
            className="min-w-0 flex-1 rounded-control border border-border bg-surface px-3.5 py-3 text-base text-ink outline-none focus:border-sage focus:ring-2 focus:ring-sage/20"
          />
          <button
            type="submit"
            disabled={busy !== null || typed.trim().length < 2 || !token}
            className="flex shrink-0 items-center gap-2 rounded-control border border-border px-4 py-3 text-base text-ink transition hover:border-ink disabled:opacity-40"
          >
            {busy === "dish" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            <span className="sr-only sm:not-sr-only">Look up</span>
          </button>
        </form>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-terracotta pl-3 text-sm leading-relaxed text-ink"
        >
          {error}
        </p>
      ) : null}

      <Link
        href="/profile"
        className="mt-6 flex items-center gap-2 text-sm text-ink-muted transition hover:text-ink"
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        {avoid.length > 0
          ? `Avoiding ${avoid.length} ${avoid.length === 1 ? "thing" : "things"}`
          : "Tell it your allergies"}
      </Link>

      <p className="mt-10 border-t border-border pt-5 text-sm leading-relaxed text-ink-muted">
        Your allergies stay on this phone. Everything the app says about a dish
        is how that dish is normally made, not what this kitchen put in theirs.
      </p>
    </div>
  );
}
