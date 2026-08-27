"use client";

import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Loader2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LodTier } from "@/lib/types";

/**
 * Turns a dish photo into a 3D model.
 *
 * The upload posts to `/api/tastebuddy-pipeline`, which validates the image,
 * checks its checksum against everything already generated, and only then
 * spends a generation. A repeat photo comes back instantly and costs nothing,
 * which the panel says out loud — knowing an upload was free is the difference
 * between a venue re-photographing freely and rationing it.
 *
 * A live generator answers asynchronously, so a `processing` job is polled
 * until it settles.
 */

interface TierReport {
  tier: LodTier;
  targetTriangles: number;
  textureSize: number;
  estimatedBytes: number;
  withinBudget: boolean;
  url: string | null;
}

interface PipelineResult {
  status: "pending" | "processing" | "ready" | "failed";
  jobId: string;
  glbUrl: string | null;
  triangleCount: number | null;
  fileSizeBytes: number | null;
  cached: boolean;
  tiers: TierReport[];
  failureReason: string | null;
}

interface DishPhotoUploadProps {
  menuItemId: string | undefined;
  /** Longest real-world edge of the plated dish, in metres. */
  realWorldScaleM?: number;
}

const MAX_BYTES = 12 * 1024 * 1024;
const POLL_MS = 2500;

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function DishPhotoUpload({
  menuItemId,
  realWorldScaleM = 0.22,
}: DishPhotoUploadProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs are a leak if the component unmounts mid-preview.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  /** Polls a live generator until the job settles. */
  useEffect(() => {
    if (result?.status !== "processing") return;

    const controller = new AbortController();
    const timer = setInterval(() => {
      fetch(
        `/api/tastebuddy-pipeline?jobId=${encodeURIComponent(result.jobId)}`,
        {
          signal: controller.signal,
        },
      )
        .then((response) =>
          response.ok ? response.json() : Promise.reject(response.status),
        )
        .then((body: PipelineResult) => {
          if (!controller.signal.aborted) setResult(body);
        })
        .catch(() => {
          /* Transient poll failures are not worth surfacing; the next tick retries. */
        });
    }, POLL_MS);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [result?.status, result?.jobId]);

  const upload = useCallback(
    async (file: File) => {
      if (!menuItemId) return;

      // Rejected here as well as on the server so an 12 MB mistake does not
      // ride up a restaurant's uplink before being told no.
      if (file.size > MAX_BYTES) {
        setError(
          `That image is ${formatBytes(file.size)}; the limit is 12 MB.`,
        );
        return;
      }

      setBusy(true);
      setError(null);
      setResult(null);

      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));

      const body = new FormData();
      body.set("menuItemId", menuItemId);
      body.set("realWorldScaleM", String(realWorldScaleM));
      body.set("image", file);

      try {
        const response = await fetch("/api/tastebuddy-pipeline", {
          method: "POST",
          body,
        });
        const payload = (await response.json()) as PipelineResult & {
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(
            payload.error?.message ?? "That photo could not be processed.",
          );
        }
        setResult(payload);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "That photo could not be processed.",
        );
      } finally {
        setBusy(false);
      }
    },
    [menuItemId, realWorldScaleM, preview],
  );

  if (!menuItemId) {
    return (
      <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
        Save the dish first — a photo has to attach to something.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            className="size-16 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : null}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-ink transition hover:border-ink disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {busy ? "Uploading…" : preview ? "Replace photo" : "Upload a photo"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so re-picking the same file still fires a change.
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        JPEG, PNG, WebP or HEIC, at least 512px square. Shot straight down on a
        plain plate gives the cleanest mesh.
      </p>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-terracotta/40 bg-terracotta-soft px-3 py-2 text-sm text-ink"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-terracotta"
            aria-hidden
          />
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            {result.status === "ready" ? (
              <CheckCircle2 className="size-4 text-sage" aria-hidden />
            ) : result.status === "failed" ? (
              <AlertTriangle className="size-4 text-terracotta" aria-hidden />
            ) : (
              <Loader2
                className="size-4 animate-spin text-ink-muted"
                aria-hidden
              />
            )}
            {result.status === "ready"
              ? "3D model ready"
              : result.status === "failed"
                ? "Generation failed"
                : "Building the model…"}
            {result.cached ? (
              <span className="rounded-full bg-sage-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sage">
                already generated · free
              </span>
            ) : null}
          </p>

          {result.failureReason ? (
            <p className="mt-1 text-sm text-ink-muted">
              {result.failureReason}
            </p>
          ) : null}

          {result.status === "ready" && result.tiers.length ? (
            <ul className="mt-2 space-y-1">
              {result.tiers.map((tier) => (
                <li
                  key={tier.tier}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="flex items-center gap-1.5 text-ink">
                    <Box className="size-3 text-ink-muted" aria-hidden />
                    {tier.tier}
                  </span>
                  <span className="tabular-nums text-ink-muted">
                    {tier.targetTriangles.toLocaleString()} tris ·{" "}
                    {tier.textureSize}px · {formatBytes(tier.estimatedBytes)}
                    {tier.withinBudget ? "" : " · over budget"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
