"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { bestContrast, readableInk } from "@/lib/brand";
import { slugify } from "@/lib/admin/venue-validation";

/**
 * Onboarding a restaurant, and editing one afterwards.
 *
 * Two fields here are worth more care than the rest, and both get it in the
 * form rather than in an error after saving:
 *
 *   The web address is printed on every table card in the room, so it is
 *   suggested from the name, editable while the venue is new, and permanently
 *   fixed afterwards.
 *
 *   The brand colours end up underneath the text of a menu somebody is reading
 *   to decide whether they can safely eat, so the contrast is measured live
 *   and shown as a ratio while it is being chosen.
 */

export interface VenueDraftForm {
  slug: string;
  name: string;
  tagline: string;
  currency: string;
  locale: string;
  primaryColor: string;
  accentColor: string;
}

export const NEW_VENUE: VenueDraftForm = {
  slug: "",
  name: "",
  tagline: "",
  currency: "GBP",
  locale: "en-GB",
  primaryColor: "#1c1917",
  accentColor: "#b4532e",
};

interface VenueFormProps {
  draft: VenueDraftForm;
  /** New venues can still choose an address; existing ones cannot. */
  isNew: boolean;
  saving: boolean;
  error: string | null;
  errorField: string | null;
  onChange: (draft: VenueDraftForm) => void;
  onSave: () => void;
  onCancel: () => void;
}

const field =
  "w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sage focus:ring-2 focus:ring-sage/20";
const labelClass =
  "block text-xs font-medium uppercase tracking-wider text-ink-muted";

/** Currencies a venue is realistically opening with, in rough order. */
const CURRENCIES = ["GBP", "EUR", "USD", "CAD", "AUD", "CHF", "SEK", "VND"];
const LOCALES = [
  ["en-GB", "English (UK)"],
  ["en-US", "English (US)"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["es-ES", "Spanish"],
  ["it-IT", "Italian"],
  ["vi-VN", "Vietnamese"],
] as const;

function ContrastReadout({ colour }: { colour: string }) {
  const ratio = useMemo(() => bestContrast(colour), [colour]);
  const ink = useMemo(() => readableInk(colour), [colour]);
  const ok = ratio >= 4.5;

  return (
    <span
      className={`mt-1.5 flex items-center gap-1.5 text-xs ${ok ? "text-ink-muted" : "text-terracotta"}`}
    >
      <span
        className="flex h-5 items-center rounded-control px-1.5 text-[10px] font-semibold"
        style={{ backgroundColor: colour, color: ink }}
      >
        Abc
      </span>
      <span className="tabular-nums">{ratio.toFixed(1)}:1</span>
      {ok ? null : <>needs 4.5:1</>}
    </span>
  );
}

export function VenueForm({
  draft,
  isNew,
  saving,
  error,
  errorField,
  onChange,
  onSave,
  onCancel,
}: VenueFormProps) {
  // Tracks whether the address has been typed by hand. Until it has, it
  // follows the name, which is what you want while a venue is being named and
  // deeply annoying the moment somebody has adjusted it.
  const [slugTouched, setSlugTouched] = useState(!isNew && draft.slug !== "");

  const patch = useCallback(
    (change: Partial<VenueDraftForm>) => onChange({ ...draft, ...change }),
    [draft, onChange],
  );

  const setName = useCallback(
    (name: string) =>
      onChange({
        ...draft,
        name,
        slug: slugTouched ? draft.slug : slugify(name),
      }),
    [draft, onChange, slugTouched],
  );

  const invalid = (name: string) =>
    errorField === name ? "border-terracotta" : "";

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
          <span className={labelClass}>Restaurant name</span>
          <input
            className={`mt-1.5 ${field} ${invalid("name")}`}
            value={draft.name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Anchor and Hope"
            maxLength={120}
            required
            autoFocus={isNew}
          />
        </label>

        <label className="sm:col-span-2">
          <span className={labelClass}>Web address</span>
          {isNew ? (
            <>
              <span className="mt-1.5 flex items-center gap-0 rounded-control border border-border bg-surface pl-3 focus-within:border-sage focus-within:ring-2 focus-within:ring-sage/20">
                <span className="shrink-0 py-2 font-mono text-sm text-ink-muted">
                  /restaurant/
                </span>
                <input
                  className={`min-w-0 flex-1 bg-transparent py-2 pr-3 font-mono text-sm text-ink outline-none ${invalid("slug")}`}
                  value={draft.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    patch({ slug: slugify(e.target.value) });
                  }}
                  maxLength={63}
                  required
                />
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">
                This goes on every table card, so it is fixed once the venue
                exists.
              </span>
            </>
          ) : (
            <span className="mt-1.5 block rounded-control border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-ink-muted">
              /restaurant/{draft.slug}
            </span>
          )}
        </label>

        <label className="sm:col-span-2">
          <span className={labelClass}>One line about the food</span>
          <input
            className={`mt-1.5 ${field}`}
            value={draft.tagline}
            onChange={(e) => patch({ tagline: e.target.value })}
            placeholder="Coastal Mediterranean, cooked over fire."
            maxLength={200}
          />
        </label>

        <label>
          <span className={labelClass}>Currency</span>
          <select
            className={`mt-1.5 ${field} ${invalid("currency")}`}
            value={draft.currency}
            onChange={(e) => patch({ currency: e.target.value })}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={labelClass}>Number and date format</span>
          <select
            className={`mt-1.5 ${field} ${invalid("locale")}`}
            value={draft.locale}
            onChange={(e) => patch({ locale: e.target.value })}
          >
            {LOCALES.map(([tag, label]) => (
              <option key={tag} value={tag}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="border-t border-border pt-4">
        <legend className={labelClass}>Colours</legend>
        <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-muted">
          Text gets drawn on both of these, so each one has to reach 4.5:1
          against black or white. The swatch shows what it will look like.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["primaryColor", "Header"],
              ["accentColor", "Buttons"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <span className={labelClass}>{label}</span>
              <span className="mt-1.5 flex items-center gap-2">
                <input
                  type="color"
                  value={draft[key]}
                  onChange={(e) => patch({ [key]: e.target.value })}
                  className="size-9 shrink-0 cursor-pointer rounded-control border border-border bg-surface p-0.5"
                  aria-label={`${label} colour`}
                />
                <input
                  className={`${field} font-mono uppercase ${invalid(key)}`}
                  value={draft[key]}
                  onChange={(e) => patch({ [key]: e.target.value })}
                  maxLength={7}
                  spellCheck={false}
                />
              </span>
              <ContrastReadout colour={draft[key]} />
            </div>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-control border border-terracotta/40 bg-terracotta-soft px-3 py-2 text-sm text-ink"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-terracotta"
            aria-hidden
          />
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          type="submit"
          disabled={saving || draft.name.trim().length < 2}
          className="flex items-center gap-2 rounded-control bg-ink px-5 py-2.5 text-sm font-medium text-surface transition disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          {isNew ? "Create venue" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-control px-4 py-2.5 text-sm text-ink-muted transition hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
