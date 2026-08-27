"use client";

import { Check, Copy, KeyRound, Loader2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Who can get into this venue's menu.
 *
 * A key is issued once and shown once. There is no "show key" button here and
 * no way to add one later: only the SHA-256 is stored, so by the time this
 * list renders the plaintext genuinely no longer exists anywhere. Staff who
 * lose one get a new one, which is also the behaviour you want when the reason
 * they lost it is that somebody else has it.
 */

interface StaffVenue {
  id: string;
  slug: string;
  name: string;
}

interface StaffKey {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  venues: StaffVenue[];
  isCurrent: boolean;
}

interface KeysResponse {
  keys: StaffKey[];
  currentVenueId: string;
  grantableVenues: StaffVenue[];
  canIssue: boolean;
}

interface IssuedKey {
  id: string;
  label: string;
  key: string;
  venues: StaffVenue[];
}

interface AccessKeysProps {
  onClose: () => void;
}

const field =
  "w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-sage focus:ring-2 focus:ring-sage/20";

function when(iso: string | null): string {
  if (!iso) return "never used";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AccessKeys({ onClose }: AccessKeysProps) {
  const [data, setData] = useState<KeysResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [label, setLabel] = useState("");
  const [venueIds, setVenueIds] = useState<string[] | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/keys", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((body: KeysResponse) => {
        if (!controller.signal.aborted) setData(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Keys could not be loaded.");
      });
    return () => controller.abort();
  }, [nonce]);

  const issue = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, venueIds: venueIds ?? undefined }),
      });
      const body = (await response.json()) as IssuedKey & {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "That key could not be issued.");
      }
      setIssued(body);
      setIssuing(false);
      setLabel("");
      setVenueIds(null);
      setNonce((n) => n + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That key could not be issued.",
      );
    } finally {
      setBusy(false);
    }
  }, [label, venueIds]);

  const revoke = useCallback(async (key: StaffKey) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/keys?keyId=${encodeURIComponent(key.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "That key could not be revoked.");
      }
      setNonce((n) => n + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That key could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const grantable = data?.grantableVenues ?? [];
  const selected = venueIds ?? grantable.slice(0, 1).map((v) => v.id);

  return (
    <section className="rounded-card border border-border bg-surface-raised">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-display text-xl text-ink">Access keys</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-control px-2 py-1 text-sm text-ink-muted transition hover:text-ink"
        >
          Done
        </button>
      </header>

      <div className="px-5 py-4">
        {/* Shown once, at issue time. */}
        {issued ? (
          <div className="mb-5 rounded-card border border-sage/40 bg-sage-soft p-4">
            <p className="text-sm font-semibold text-ink">
              {issued.label} is ready
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Copy it now. It is stored hashed, so this is the only time it can
              be read.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-control border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink">
                {issued.key}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(issued.key);
                  setCopied(true);
                }}
                className="flex shrink-0 items-center gap-1.5 self-start rounded-control border border-ink bg-ink px-3 py-2 text-sm font-medium text-surface transition"
              >
                {copied ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setIssued(null);
                setCopied(false);
              }}
              className="mt-3 text-sm text-ink-muted underline underline-offset-4 transition hover:text-ink"
            >
              I have it
            </button>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-control border border-terracotta/40 bg-terracotta-soft px-3 py-2 text-sm text-ink"
          >
            {error}
          </p>
        ) : null}

        {data === null ? (
          <p className="flex items-center gap-2 py-6 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {data.keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
              >
                <KeyRound
                  className="size-3.5 shrink-0 text-ink-muted"
                  aria-hidden
                />
                <span className="text-sm font-medium text-ink">
                  {key.label}
                </span>
                {key.isCurrent ? (
                  <span className="rounded-full bg-sage-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sage">
                    this device
                  </span>
                ) : null}

                <span className="ml-auto text-xs tabular-nums text-ink-muted">
                  {key.lastUsedAt ? `used ${when(key.lastUsedAt)}` : "never used"}
                </span>

                <button
                  type="button"
                  disabled={busy || key.isCurrent}
                  onClick={() => void revoke(key)}
                  className="rounded-control border border-border px-2.5 py-1 text-xs text-ink-muted transition hover:border-terracotta hover:text-terracotta disabled:opacity-40 disabled:hover:border-border disabled:hover:text-ink-muted"
                >
                  Revoke
                </button>

                {key.venues.length > 1 ? (
                  <p className="w-full pl-7 text-xs text-ink-muted">
                    Also opens{" "}
                    {key.venues
                      .filter((venue) => venue.id !== data.currentVenueId)
                      .map((venue) => venue.name)
                      .join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* Issue */}
        {data?.canIssue === false ? (
          <p className="mt-4 text-sm text-ink-muted">
            Issuing keys needs a database. This deployment is running on the
            built-in sample menu.
          </p>
        ) : issuing ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void issue();
            }}
          >
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wider text-ink-muted">
                Name it after where it lives
              </span>
              <input
                className={`mt-1.5 ${field}`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Pass iPad"
                maxLength={60}
                required
                autoFocus
              />
            </label>

            {grantable.length > 1 ? (
              <fieldset>
                <legend className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                  Venues this key opens
                </legend>
                <div className="mt-1.5 space-y-1.5">
                  {grantable.map((venue) => (
                    <label
                      key={venue.id}
                      className="flex items-center gap-2 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-sage)]"
                        checked={selected.includes(venue.id)}
                        onChange={(e) =>
                          setVenueIds(
                            e.target.checked
                              ? [...selected, venue.id]
                              : selected.filter((id) => id !== venue.id),
                          )
                        }
                      />
                      {venue.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={busy || selected.length === 0}
                className="flex items-center gap-2 rounded-control bg-sage px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                Issue key
              </button>
              <button
                type="button"
                onClick={() => setIssuing(false)}
                className="flex items-center gap-1.5 rounded-control px-3 py-2 text-sm text-ink-muted transition hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIssuing(true)}
            className="mt-4 flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-ink transition hover:border-ink"
          >
            <Plus className="size-3.5" aria-hidden />
            Issue a key
          </button>
        )}
      </div>
    </section>
  );
}
