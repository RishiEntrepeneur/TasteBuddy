"use client";

import {
  Camera,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  DishForm,
  draftFromItem,
  type CatalogueEntry,
  type DishDraft,
} from "@/components/admin/DishForm";
import { AccessKeys } from "@/components/admin/AccessKeys";
import { MenuImport } from "@/components/admin/MenuImport";
import { formatPrice } from "@/lib/nutrition";
import type { MenuCategory, MenuItem, Restaurant } from "@/lib/types";

/**
 * The venue-side menu editor.
 *
 * Sign-in exchanges an access key for an httpOnly session cookie, so the key
 * itself never lives in client state after the first request. Every call below
 * relies on that cookie and sends no venue identifier. The server takes the
 * venue from the session, which is what keeps one venue out of another's menu,
 * including when a group key reaches several of them.
 */

interface Loaded {
  restaurant: Restaurant;
  items: MenuItem[];
  catalogue: CatalogueEntry[];
  capabilities?: { menuImport?: boolean };
}

const COURSE_ORDER: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];

interface Venue {
  id: string;
  slug: string;
  name: string;
}

export function MenuEditor() {
  const [checking, setChecking] = useState(true);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [switching, setSwitching] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [editing, setEditing] = useState<DishDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* ---- session ---------------------------------------------------------- */

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/session", { signal: controller.signal })
      .then((r) => r.json())
      .then(
        (body: {
          signedIn: boolean;
          restaurant?: Venue;
          venues?: Venue[];
        }) => {
          if (controller.signal.aborted) return;
          setVenue(body.signedIn ? (body.restaurant ?? null) : null);
          setVenues(body.venues ?? []);
          setChecking(false);
        },
      )
      .catch(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, []);

  // Bumped after a mutation to re-run the load effect below. Reloading this
  // way keeps every `setData` inside a promise callback rather than in an
  // effect body, which is also the only shape that cancels cleanly.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    if (!venue) return;

    const controller = new AbortController();
    fetch("/api/admin/menu-items", { signal: controller.signal })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(response.status),
      )
      .then((body: Loaded) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch(() => {
        /* A failed refresh leaves the last good menu on screen. */
      });

    return () => controller.abort();
  }, [venue, reloadNonce]);

  /* ---- mutations -------------------------------------------------------- */

  const save = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/admin/menu-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? "That dish could not be saved.");
      }
      setEditing(null);
      setNotice(editing.id ? "Dish updated." : "Dish added.");
      reload();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "That dish could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }, [editing, reload]);

  const remove = useCallback(async () => {
    if (!editing?.id) return;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/admin/menu-items?menuItemId=${encodeURIComponent(editing.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error();
      setEditing(null);
      setNotice("Dish removed.");
      reload();
    } catch {
      setFormError("That dish could not be removed.");
    } finally {
      setSaving(false);
    }
  }, [editing, reload]);

  const toggleAvailability = useCallback(
    async (item: MenuItem) => {
      // Optimistic: this is the one edit staff make mid-service, and it has to
      // feel instant when the kitchen runs out of something.
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) =>
                entry.id === item.id
                  ? { ...entry, isAvailable: !entry.isAvailable }
                  : entry,
              ),
            }
          : current,
      );
      try {
        const response = await fetch("/api/admin/menu-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            menuItemId: item.id,
            isAvailable: !item.isAvailable,
          }),
        });
        if (!response.ok) throw new Error();
      } catch {
        setNotice("That change could not be saved.");
        reload();
      }
    },
    [reload],
  );

  /** Moves the session to another venue the same key reaches. */
  const switchVenue = useCallback(async (next: Venue) => {
    setSwitching(false);
    setData(null);
    setEditing(null);
    setImporting(false);
    setShowKeys(false);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: next.id }),
      });
      if (!response.ok) throw new Error();
      setVenue(next);
    } catch {
      setNotice("That venue could not be opened.");
    }
  }, []);

  /* ---- sign in ---------------------------------------------------------- */

  if (checking) {
    return (
      <main className="grid min-h-dvh place-items-center bg-surface">
        <Loader2 className="size-5 animate-spin text-ink-muted" aria-hidden />
      </main>
    );
  }

  if (!venue) {
    return (
      <SignIn
        onSignedIn={(next, reachable) => {
          setVenue(next);
          setVenues(reachable);
        }}
      />
    );
  }

  /* ---- editor ----------------------------------------------------------- */

  const grouped = COURSE_ORDER.map((course) => ({
    course,
    items: (data?.items ?? []).filter((item) => item.category === course),
  })).filter((group) => group.items.length > 0);

  return (
    <main className="min-h-dvh bg-surface">
      <div className="mx-auto w-full max-w-2xl px-5 pb-24 safe-top">
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-ink/15 pt-8 pb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-ink-muted">
              TasteBuddy · Menu
            </p>

            {venues.length > 1 ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSwitching((open) => !open)}
                  aria-expanded={switching}
                  className="mt-1 flex items-center gap-2 text-left font-display text-3xl leading-tight tracking-tight text-ink"
                >
                  {venue.name}
                  <ChevronDown
                    className={`size-4 shrink-0 text-ink-muted transition ${switching ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>

                {switching ? (
                  <ul className="absolute left-0 top-full z-20 mt-1 min-w-56 overflow-hidden rounded-control border border-border bg-surface-raised shadow-lg">
                    {venues.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => void switchVenue(entry)}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-muted"
                        >
                          {entry.id === venue.id ? (
                            <Check className="size-3.5 text-sage" aria-hidden />
                          ) : (
                            <span className="size-3.5" aria-hidden />
                          )}
                          {entry.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <h1 className="mt-1 font-display text-3xl leading-tight tracking-tight text-ink">
                {venue.name}
              </h1>
            )}
          </div>

          <nav className="flex items-center gap-4 pb-1 text-sm text-ink-muted">
            <button
              type="button"
              onClick={() => {
                setShowKeys(true);
                setEditing(null);
                setImporting(false);
              }}
              className="flex items-center gap-1.5 transition hover:text-ink"
            >
              <KeyRound className="size-3.5" aria-hidden />
              Keys
            </button>
            <Link
              href={`/restaurant/${venue.slug}`}
              className="flex items-center gap-1.5 transition hover:text-ink"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Diner view
            </Link>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/admin/session", { method: "DELETE" });
                setVenue(null);
                setVenues([]);
                setData(null);
              }}
              className="flex items-center gap-1.5 transition hover:text-ink"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
          </nav>
        </header>

        {notice ? (
          <p
            role="status"
            className="mt-4 border-l-2 border-sage pl-3 text-sm text-ink"
          >
            {notice}
          </p>
        ) : null}

        {showKeys ? (
          <AccessKeys onClose={() => setShowKeys(false)} />
        ) : importing ? (
          <MenuImport
            currency={data?.restaurant.currency ?? "GBP"}
            locale={data?.restaurant.locale ?? "en-GB"}
            onImported={(count) => {
              setNotice(
                count === 1
                  ? "1 dish added as a draft. Declare its allergens before switching it on."
                  : `${count} dishes added as drafts. Declare their allergens before switching them on.`,
              );
              reload();
            }}
            onCancel={() => setImporting(false)}
          />
        ) : editing ? (
          <section className="mt-5 rounded-card border border-border bg-surface-raised p-5">
            <h2 className="mb-4 font-display text-xl text-ink">
              {editing.id ? editing.name || "Edit dish" : "New dish"}
            </h2>
            <DishForm
              draft={editing}
              catalogue={data?.catalogue ?? []}
              saving={saving}
              error={formError}
              onChange={setEditing}
              onSave={() => void save()}
              onCancel={() => {
                setEditing(null);
                setFormError(null);
              }}
              onDelete={editing.id ? () => void remove() : null}
            />
          </section>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(draftFromItem(null));
                  setNotice(null);
                }}
                className="flex items-center gap-2 rounded-control bg-ink px-4 py-2.5 text-sm font-medium text-surface transition"
              >
                <Plus className="size-4" aria-hidden />
                Add a dish
              </button>

              {data?.capabilities?.menuImport ? (
                <button
                  type="button"
                  onClick={() => {
                    setImporting(true);
                    setNotice(null);
                  }}
                  className="flex items-center gap-2 rounded-control border border-border px-4 py-2.5 text-sm font-medium text-ink transition hover:border-ink"
                >
                  <Camera className="size-4" aria-hidden />
                  Read a printed menu
                </button>
              ) : null}
            </div>

            {data === null ? (
              <p className="flex items-center gap-2 py-10 text-sm text-ink-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading
              </p>
            ) : grouped.length === 0 ? (
              <p className="py-16 text-sm text-ink-muted">
                Nothing on the menu yet.
              </p>
            ) : (
              grouped.map((group) => (
                <section key={group.course} className="pt-9">
                  <h2 className="border-b border-border pb-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-muted">
                    {group.course}
                  </h2>
                  <ul>
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className={[
                          "flex items-center gap-3 border-b border-border/70 py-3",
                          item.isAvailable ? "" : "opacity-55",
                        ].join(" ")}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-[17px] leading-snug text-ink">
                            {item.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs tabular-nums text-ink-muted">
                            {formatPrice(
                              item.priceCents,
                              data.restaurant.currency,
                              data.restaurant.locale,
                            )}
                            {" · "}
                            {item.basePortionGrams} g
                            {item.ingredients.length
                              ? ` · ${item.ingredients.length} ingredient${item.ingredients.length === 1 ? "" : "s"}`
                              : ""}
                            {item.allergens.length
                              ? ` · ${item.allergens.length} allergen${item.allergens.length === 1 ? "" : "s"}`
                              : ""}
                            {item.isAvailable ? "" : " · off"}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => void toggleAvailability(item)}
                          aria-pressed={item.isAvailable}
                          aria-label={
                            item.isAvailable
                              ? `Take ${item.name} off the menu`
                              : `Put ${item.name} back on the menu`
                          }
                          className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-muted hover:text-ink"
                        >
                          {item.isAvailable ? (
                            <Eye className="size-4" aria-hidden />
                          ) : (
                            <EyeOff className="size-4" aria-hidden />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setEditing(draftFromItem(item));
                            setNotice(null);
                          }}
                          aria-label={`Edit ${item.name}`}
                          className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-muted hover:text-ink"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sign in                                                                    */
/* -------------------------------------------------------------------------- */

function SignIn({
  onSignedIn,
}: {
  onSignedIn: (venue: Venue, venues: Venue[]) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-5">
      <form
        className="w-full max-w-sm rounded-card border border-border bg-surface-raised p-7"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const response = await fetch("/api/admin/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key }),
            });
            const body = (await response.json()) as {
              restaurant?: Venue;
              venues?: Venue[];
              error?: { message?: string };
            };
            if (!response.ok || !body.restaurant) {
              throw new Error(
                body.error?.message ?? "That access key was not recognised.",
              );
            }
            onSignedIn(body.restaurant, body.venues ?? [body.restaurant]);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign-in failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-ink-muted">
          TasteBuddy
        </p>
        <h1 className="mt-1 font-display text-3xl leading-tight tracking-tight text-ink">
          Menu editor
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Use the access key issued to your venue.
        </p>

        <label className="mt-6 block">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Access key
          </span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className="mt-1.5 w-full rounded-control border border-border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-sage focus:ring-2 focus:ring-sage/20"
            required
          />
        </label>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-terracotta">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || key.length < 8}
          className="mt-6 w-full rounded-control bg-ink px-4 py-2.5 text-sm font-medium text-surface transition disabled:opacity-50"
        >
          {busy ? "Checking" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
