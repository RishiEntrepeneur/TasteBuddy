"use client";

import {
  AlertTriangle,
  Download,
  Loader2,
  LogOut,
  Printer,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  VenueForm,
  type VenueDraftForm,
} from "@/components/admin/VenueForm";

/**
 * A venue's own settings, and the two things onboarding ends with: the card
 * that goes on the table, and handing the venue over.
 */

interface TableCardResponse {
  svg: string;
  url: string;
  modules: number;
  moduleMm: number;
  publiclyReachable: boolean;
  originSource: "configured" | "request";
}

interface VenueSettingsProps {
  draft: VenueDraftForm;
  venueName: string;
  /** Whether this key holds more than one venue, so leaving is possible. */
  canLeave: boolean;
  onSaved: (name: string) => void;
  onLeft: () => void;
  onClose: () => void;
}

export function VenueSettings({
  draft: initial,
  venueName,
  canLeave,
  onSaved,
  onLeft,
  onClose,
}: VenueSettingsProps) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [card, setCard] = useState<TableCardResponse | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/table-card", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((body: TableCardResponse) => {
        if (!controller.signal.aborted) setCard(body);
      })
      .catch(() => {
        /* The card is not the point of this screen; settings still work. */
      });
    return () => controller.abort();
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setErrorField(null);
    try {
      const response = await fetch("/api/admin/venues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json()) as {
        venue?: { name: string };
        warnings?: string[];
        field?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        setErrorField(body.field ?? null);
        throw new Error(body.error?.message ?? "That could not be saved.");
      }
      setNotice(
        body.warnings?.length ? body.warnings.join(" ") : "Saved.",
      );
      onSaved(draft.name);
      // Colours changed, so the card's ground did too.
      const refreshed = await fetch("/api/admin/table-card");
      if (refreshed.ok) setCard((await refreshed.json()) as TableCardResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved]);

  const leave = useCallback(async () => {
    setLeaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/venues", { method: "DELETE" });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "That could not be saved.");
      }
      onLeft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be saved.");
    } finally {
      setLeaving(false);
    }
  }, [onLeft]);

  const printCard = useCallback(() => {
    if (!card) return;
    const frame = window.open("", "_blank", "width=640,height=800");
    if (!frame) return;
    frame.document.write(
      `<!doctype html><title>${venueName} table card</title>` +
        `<style>@page{size:A6;margin:0}body{margin:0;display:grid;place-items:center;min-height:100vh}svg{max-width:100%;height:auto}</style>` +
        card.svg,
    );
    frame.document.close();
    frame.focus();
    frame.print();
  }, [card, venueName]);

  return (
    <section className="rounded-card border border-border bg-surface-raised">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="font-display text-xl text-ink">Venue settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-control px-2 py-1 text-sm text-ink-muted transition hover:text-ink"
        >
          Done
        </button>
      </header>

      <div className="px-5 py-5">
        {notice ? (
          <p role="status" className="mb-4 border-l-2 border-sage pl-3 text-sm text-ink">
            {notice}
          </p>
        ) : null}

        <VenueForm
          draft={draft}
          isNew={false}
          saving={saving}
          error={error}
          errorField={errorField}
          onChange={setDraft}
          onSave={() => void save()}
          onCancel={onClose}
        />

        {/* ---- the card that goes on the table ---------------------------- */}
        <div className="mt-8 border-t border-border pt-5">
          <h3 className="font-display text-lg text-ink">Table card</h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted">
            One per table. Print at A6 or bigger, in the venue&rsquo;s own
            colours.
          </p>

          {card === null ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Drawing the code
            </p>
          ) : (
            <>
              {!card.publiclyReachable ? (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-control border border-terracotta/40 bg-terracotta-soft px-3 py-2.5 text-sm leading-relaxed text-ink"
                >
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-terracotta"
                    aria-hidden
                  />
                  <span>
                    This code points at{" "}
                    <span className="font-mono text-[13px]">{card.url}</span>,
                    which a diner&rsquo;s phone will not reach. Set{" "}
                    <span className="font-mono text-[13px]">
                      NEXT_PUBLIC_APP_URL
                    </span>{" "}
                    before printing anything.
                  </span>
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-start gap-5">
                <div
                  className="w-44 shrink-0 overflow-hidden rounded-control border border-border [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: card.svg }}
                />

                <div className="min-w-0 flex-1">
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-ink-muted">Opens</dt>
                      <dd className="min-w-0 break-all font-mono text-[13px] text-ink">
                        {card.url}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-ink-muted">Symbol</dt>
                      <dd className="tabular-nums text-ink">
                        {card.modules}&times;{card.modules} at{" "}
                        {card.moduleMm}mm
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={printCard}
                      disabled={!card.publiclyReachable}
                      className="flex items-center gap-2 rounded-control bg-ink px-4 py-2 text-sm font-medium text-surface transition disabled:opacity-40"
                    >
                      <Printer className="size-3.5" aria-hidden />
                      Print
                    </button>
                    <a
                      href="/api/admin/table-card?download=1"
                      className="flex items-center gap-2 rounded-control border border-border px-4 py-2 text-sm text-ink transition hover:border-ink"
                    >
                      <Download className="size-3.5" aria-hidden />
                      Download SVG
                    </a>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ---- hand over -------------------------------------------------- */}
        {canLeave ? (
          <div className="mt-8 border-t border-border pt-5">
            <h3 className="font-display text-lg text-ink">Hand this over</h3>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted">
              Once {venueName} has its own key, drop yours. You will stop seeing
              it in the switcher and they keep everything.
            </p>
            <button
              type="button"
              onClick={() => void leave()}
              disabled={leaving}
              className="mt-3 flex items-center gap-2 rounded-control border border-border px-4 py-2 text-sm text-ink-muted transition hover:border-terracotta hover:text-terracotta disabled:opacity-50"
            >
              {leaving ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <LogOut className="size-3.5" aria-hidden />
              )}
              Leave {venueName}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
