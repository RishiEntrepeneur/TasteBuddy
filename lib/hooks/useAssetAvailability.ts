"use client";

import { useEffect, useState } from "react";

/**
 * Confirms a generated `.glb` is actually fetchable before it is handed to the
 * GLTF loader.
 *
 * Without this, a missing or expired CDN object makes `useGLTF` throw inside
 * Suspense. The error boundary in `DishModel` does catch that and swap in the
 * procedural dish, but the loader still leaves an unhandled promise rejection
 * behind, which trips error monitoring and browser error overlays for what is
 * a completely expected condition — a dish whose mesh has not been generated
 * yet, or an asset purged from the bucket.
 *
 * The probe is non-blocking: the caller renders the procedural dish
 * immediately and swaps in the real mesh only once the object is confirmed, so
 * this costs a cheap HEAD request and no first-paint latency.
 */

export type AssetAvailability = "idle" | "checking" | "available" | "missing";

/** The probe outcome, tagged with the URL it describes. */
interface ProbeResult {
  url: string;
  ok: boolean;
}

export function useAssetAvailability(url: string | null): AssetAvailability {
  const [result, setResult] = useState<ProbeResult | null>(null);

  useEffect(() => {
    if (!url) return;

    const controller = new AbortController();

    // HEAD first: the cheapest way to ask "does this object exist?", and every
    // CDN worth using answers it.
    fetch(url, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setResult({ url, ok: response.ok });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A network error, or a bucket that refuses HEAD, both mean "do not
        // hand this URL to the loader".
        setResult({ url, ok: false });
      });

    return () => controller.abort();
  }, [url]);

  // Derived rather than stored, so a result for a previous URL can never be
  // mistaken for the current one while the new probe is still in flight.
  if (!url) return "idle";
  if (result?.url !== url) return "checking";
  return result.ok ? "available" : "missing";
}
