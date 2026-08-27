"use client";

import { ChevronRight, Loader2, Search } from "lucide-react";
import { useState } from "react";

import { VerdictPill } from "@/components/app/Verdict";
import { clashesWith, verdictFor } from "@/lib/dish/clash";
import type { HistoryEntry } from "@/lib/hooks/useHistory";
import type { AllergenKey } from "@/lib/types";

/**
 * What the app opens on.
 *
 * A log, not an empty box. The second time somebody uses this they are usually
 * asking about a dish they have already met, and re-opening it from here costs
 * nothing and asks the model nothing.
 */

function when(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

interface HomeScreenProps {
  entries: readonly HistoryEntry[];
  avoid: readonly AllergenKey[];
  searching: boolean;
  onOpen: (entry: HistoryEntry) => void;
  onSearch: (name: string) => void;
}

export function HomeScreen({
  entries,
  avoid,
  searching,
  onOpen,
  onSearch,
}: HomeScreenProps) {
  const [typed, setTyped] = useState("");

  return (
    <div className="px-4 pb-6">
      <header className="pb-4 pt-2">
        <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.025em] text-ink">
          What is that on
          <br />
          the menu?
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          Photograph a menu you cannot read, or type one dish.
        </p>
      </header>

      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          const name = typed.trim();
          if (name.length >= 2) {
            onSearch(name);
            setTyped("");
          }
        }}
      >
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-ink-3"
          aria-hidden
        />
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Type a dish, like bún chả"
          maxLength={120}
          enterKeyHint="search"
          aria-label="Type a dish"
          className="w-full rounded-full border border-line bg-card py-3.5 pl-11 pr-12 text-[16px] text-ink outline-none transition placeholder:text-ink-3 focus:border-ink"
        />
        {typed.trim().length >= 2 ? (
          <button
            type="submit"
            disabled={searching}
            className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-card transition disabled:opacity-60"
            aria-label="Look it up"
          >
            {searching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden />
            )}
          </button>
        ) : null}
      </form>

      {entries.length === 0 ? (
        <div className="card mt-5 px-5 py-6">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Nothing looked up yet. Tap the camera below and point it at a menu:
            it reads every dish, tells you what each one is, and flags anything
            that clashes with your allergies.
          </p>
        </div>
      ) : (
        <>
          <h2 className="mb-2.5 mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
            Recently
          </h2>
          <ul className="space-y-2">
            {entries.map((entry) => {
              const clashes = clashesWith(entry.dish, avoid);
              const verdict = verdictFor(clashes, avoid.length > 0, entry.dish.recognised);

              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    className="card flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:scale-[0.99]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-display text-[18px] leading-snug text-ink">
                          {entry.dish.printedName}
                        </span>
                        <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                          {when(entry.at)}
                        </span>
                      </span>
                      {entry.dish.englishName ? (
                        <span className="mt-0.5 block truncate text-[14px] text-ink-2">
                          {entry.dish.englishName}
                        </span>
                      ) : null}
                      {/* A dish nobody recognised still says so. "Allergies not set" on
                      every row would be noise; "not known" on the one row it
                      applies to is the opposite. */}
                  {verdict !== "unknown" || !entry.dish.recognised ? (
                        <span className="mt-2 block">
                          <VerdictPill
                            verdict={verdict}
                            clashes={clashes}
                        unknownReason={
                          entry.dish.recognised ? "no_profile" : "unrecognised"
                        }
                            size="compact"
                          />
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-ink-3"
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
