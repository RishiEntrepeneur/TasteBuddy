"use client";

import {
  AlertTriangle,
  Camera,
  Check,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import type { MenuCategory } from "@/lib/types";

/**
 * Importing a printed menu from a photo.
 *
 * The screen exists to be argued with. Everything on it is a proposal read off
 * a photograph, every field is editable before anything is saved, and the two
 * things a photo cannot tell anyone — what a dish contains, and what is in a
 * portion of it — are called out rather than left as convincing-looking
 * blanks.
 *
 * Imported dishes are saved switched off. That is enforced server-side, not
 * here: a dish with no allergen declarations reads to a diner as safe, so it
 * stays off the menu until a person has been through it.
 */

const CATEGORIES: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];

interface ExtractedDish {
  name: string;
  description: string;
  priceText: string;
  priceCents: number | null;
  currency: string;
  category: MenuCategory;
  printedNotes: string;
  legibility: "clear" | "unclear";
  reviewNote: string | null;
  alreadyOnMenu: boolean;
}

interface ReadResponse {
  importId: string | null;
  dishes: ExtractedDish[];
  warnings: string[];
  remainingReads: number;
}

interface CommitOutcome {
  name: string;
  saved: boolean;
  reason: string | null;
}

/** A row as the reviewer has it: the model's reading, plus their corrections. */
interface Row extends ExtractedDish {
  include: boolean;
  /** Price in whole pounds/euros as typed, so a half-typed "1" is not 1p. */
  priceInput: string;
}

interface MenuImportProps {
  /** The venue's currency and locale — what `priceCents` is denominated in. */
  currency: string;
  locale: string;
  onImported: (savedCount: number) => void;
  onCancel: () => void;
}

/**
 * The venue's own currency symbol. Prices are stored in the venue's currency
 * whatever the photo was printed in, so labelling the field with anything else
 * would be a lie about what is being typed.
 */
function currencySymbol(currency: string, locale: string): string {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? "";
}

const field =
  "w-full rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-sage focus:ring-2 focus:ring-sage/25";

function toRow(dish: ExtractedDish): Row {
  return {
    ...dish,
    // Two rows start unticked: one already on the menu, because re-importing
    // to pick up six new dishes should not mean unticking thirty old ones;
    // and one whose price could not be read, because a dish silently added at
    // zero is worse than one a chef has to look at.
    include: !dish.alreadyOnMenu && dish.priceCents !== null,
    priceInput: dish.priceCents === null ? "" : (dish.priceCents / 100).toFixed(2),
  };
}

/** Pounds as typed back to pence. Anything unparseable counts as no price. */
function inputToCents(input: string): number {
  const value = Number(input.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export function MenuImport({
  currency,
  locale,
  onImported,
  onCancel,
}: MenuImportProps) {
  const symbol = currencySymbol(currency, locale);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<ReadResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [outcomes, setOutcomes] = useState<CommitOutcome[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchRow = useCallback((index: number, patch: Partial<Row>) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }, []);

  /* ---- read the photo --------------------------------------------------- */

  const upload = useCallback(async (file: File) => {
    setReading(true);
    setError(null);
    setRead(null);
    setRows([]);
    setOutcomes(null);

    const body = new FormData();
    body.set("image", file);

    try {
      const response = await fetch("/api/admin/menu-import", {
        method: "POST",
        body,
      });
      const payload = (await response.json()) as ReadResponse & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "That photo could not be read.",
        );
      }
      if (payload.dishes.length === 0) {
        throw new Error(
          "No dishes could be read from that photo. Try filling the frame with the menu, shot straight on.",
        );
      }
      setRead(payload);
      setRows(payload.dishes.map(toRow));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That photo could not be read.",
      );
    } finally {
      setReading(false);
    }
  }, []);

  /* ---- save the reviewed rows ------------------------------------------- */

  const commit = useCallback(async () => {
    const chosen = rows.filter((row) => row.include);
    if (chosen.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/menu-import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importId: read?.importId ?? null,
          dishes: chosen.map((row) => ({
            name: row.name,
            description: row.description,
            category: row.category,
            priceCents: inputToCents(row.priceInput),
          })),
        }),
      });
      const payload = (await response.json()) as {
        savedCount: number;
        outcomes: CommitOutcome[];
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Those dishes could not be saved.",
        );
      }
      setOutcomes(payload.outcomes);
      onImported(payload.savedCount);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Those dishes could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }, [rows, read, onImported]);

  const includedCount = rows.filter((row) => row.include).length;
  // Unticked because the price could not be read, as opposed to unticked
  // because the dish is already on the menu — only the first needs an ask.
  const needsAttention = rows.filter(
    (row) => !row.include && !row.alreadyOnMenu && row.priceCents === null,
  ).length;

  /* ---- after saving ------------------------------------------------------ */

  if (outcomes) {
    const failed = outcomes.filter((outcome) => !outcome.saved);
    return (
      <section className="rounded-card border border-border bg-surface-raised p-5">
        <h2 className="text-lg font-semibold text-ink">
          {outcomes.length - failed.length} added as drafts
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          They are switched off and not visible to diners. Open each one to
          declare its allergens and portion, then turn it on.
        </p>

        {failed.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {failed.length} could not be added
            </p>
            <ul className="mt-2 space-y-1">
              {failed.map((outcome, index) => (
                <li key={index} className="text-sm text-ink">
                  <span className="font-medium">{outcome.name}</span>
                  {outcome.reason ? (
                    <span className="text-ink-muted">. {outcome.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onCancel}
          className="mt-5 rounded-control bg-ink px-5 py-2.5 text-sm font-semibold text-surface transition"
        >
          Back to the menu
        </button>
      </section>
    );
  }

  /* ---- before a photo ---------------------------------------------------- */

  if (!read) {
    return (
      <section className="rounded-card border border-border bg-surface-raised p-5">
        <h2 className="text-lg font-semibold text-ink">Import from a photo</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Photograph your printed menu and we will read the dish names,
          descriptions and prices off it. Nothing is added until you have been
          through what it read.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={reading}
            className="flex items-center gap-2 rounded-control bg-ink px-5 py-2.5 text-sm font-semibold text-surface transition disabled:opacity-50"
          >
            {reading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-4" aria-hidden />
            )}
            {reading ? "Reading the menu…" : "Choose a photo"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={reading}
            className="rounded-control border border-border px-4 py-2.5 text-sm text-ink-muted transition hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />

        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          JPEG, PNG or WebP, up to 5 MB. One page per photo, with the whole page
          in frame.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-control border border-terracotta/40 bg-terracotta-soft px-3 py-2 text-sm text-ink"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-terracotta"
              aria-hidden
            />
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  /* ---- the review table -------------------------------------------------- */

  return (
    <section className="rounded-card border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-semibold text-ink">
        {rows.length} dishes read from that photo
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        Correct anything that came out wrong, and untick anything that is not a
        dish. Nothing here is on your menu yet.
        {needsAttention > 0 ? (
          <>
            {" "}
            <span className="text-ink">
              {needsAttention === 1
                ? "One row has no price and is unticked."
                : `${needsAttention} rows have no price and are unticked.`}
            </span>
          </>
        ) : null}
      </p>

      {/* The one thing a photo cannot tell anyone. */}
      <div className="mt-4 flex items-start gap-2.5 rounded-control border border-terracotta/40 bg-terracotta-soft px-3.5 py-3">
        <ShieldAlert
          className="mt-0.5 size-4 shrink-0 text-terracotta"
          aria-hidden
        />
        <div>
          <p className="text-sm font-semibold text-ink">
            No allergens have been read from this menu
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink">
            We never guess what is in a dish. Only your kitchen knows that,
            and someone with an allergy is relying on the answer. Every dish
            below is saved switched off until you have opened it, declared its
            allergens and set the portion.
          </p>
        </div>
      </div>

      {read.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {read.warnings.map((warning, index) => (
            <li
              key={index}
              className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted"
            >
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-terracotta"
                aria-hidden
              />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="mt-4 space-y-2.5">
        {rows.map((row, index) => (
          <li
            key={index}
            className={`rounded-control border px-3 py-3 transition ${
              row.include
                ? "border-border bg-surface"
                : "border-border/60 bg-surface/40 opacity-60"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={row.include}
                onChange={(e) => patchRow(index, { include: e.target.checked })}
                className="mt-2 size-4 shrink-0 accent-[var(--color-sage)]"
                aria-label={`Add ${row.name || "this dish"} to the menu`}
              />

              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_7rem_9rem]">
                <input
                  className={field}
                  value={row.name}
                  onChange={(e) => patchRow(index, { name: e.target.value })}
                  maxLength={120}
                  aria-label="Dish name"
                />

                <div className="flex items-center gap-1">
                  <span className="text-sm text-ink-muted" aria-hidden>
                    {symbol}
                  </span>
                  <input
                    className={field}
                    value={row.priceInput}
                    onChange={(e) =>
                      patchRow(index, { priceInput: e.target.value })
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="Price"
                  />
                </div>

                <select
                  className={field}
                  value={row.category}
                  onChange={(e) =>
                    patchRow(index, {
                      category: e.target.value as MenuCategory,
                    })
                  }
                  aria-label="Course"
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>

                <textarea
                  className={`${field} min-h-14 resize-y sm:col-span-3`}
                  value={row.description}
                  onChange={(e) =>
                    patchRow(index, { description: e.target.value })
                  }
                  maxLength={600}
                  placeholder="No description printed"
                  aria-label="Description"
                />
              </div>
            </div>

            {/* Read off the page, kept as a reading aid and nothing more. */}
            {row.printedNotes ? (
              <p className="mt-2 pl-6.5 text-xs leading-relaxed text-ink-muted">
                Printed on the menu:{" "}
                <span className="text-ink">“{row.printedNotes}”</span>. You
                still declare the allergens yourself.
              </p>
            ) : null}

            {row.alreadyOnMenu ? (
              <p className="mt-2 pl-6.5 text-xs leading-relaxed text-ink-muted">
                Already on your menu. Ticking this will not overwrite it.
              </p>
            ) : null}

            {row.reviewNote ? (
              <p className="mt-1.5 flex items-start gap-1.5 pl-6.5 text-xs leading-relaxed text-terracotta">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                {row.reviewNote}
                {row.priceText ? ` (printed as “${row.priceText}”)` : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-control border border-terracotta/40 bg-terracotta-soft px-3 py-2 text-sm text-ink"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-terracotta"
            aria-hidden
          />
          {error}
        </p>
      ) : null}

      {includedCount === 0 ? (
        <p className="mt-4 rounded-control border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-ink-muted">
          Nothing is ticked. Every dish here is already on your menu, or has
          no price yet.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void commit()}
          disabled={saving || includedCount === 0}
          className="flex items-center gap-2 rounded-control bg-sage px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          {saving
            ? "Adding…"
            : `Add ${includedCount} ${includedCount === 1 ? "dish" : "dishes"} as drafts`}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-control border border-border px-4 py-2.5 text-sm text-ink-muted transition hover:text-ink disabled:opacity-50"
        >
          <X className="size-3.5" aria-hidden />
          Discard
        </button>

        <span className="ml-auto text-xs text-ink-muted">
          {read.remainingReads} more photos this hour
        </span>
      </div>
    </section>
  );
}
