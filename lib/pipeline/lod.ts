import type { LodTier } from "@/lib/types";

/**
 * Polygon reduction rules for web AR on phones.
 *
 * The raw mesh a 2D-to-3D generator returns is typically 150k–400k triangles
 * with a 4k texture — fine on a workstation, unusable over cellular on a phone
 * that also has to run a camera feed. Every mesh is therefore decimated into
 * three tiers and the client picks one at runtime.
 *
 * The budgets below are set by the tightest real constraint, which is mobile
 * Safari rather than Chrome:
 *
 *   - iOS Safari caps a single WebGL context's memory far below desktop, and
 *     a background tab can have its context dropped entirely. Keeping the
 *     draw call under ~35k triangles with a 1024px texture keeps the whole
 *     scene inside the budget alongside the camera texture.
 *   - Safari has no `KHR_texture_basisu` guarantee on older iOS, so textures
 *     are shipped as WebP inside the .glb rather than KTX2/Basis.
 *   - Chrome on Android is more permissive but spans much weaker hardware, so
 *     the low tier exists for devices reporting <= 4 GB of RAM.
 */

export interface LodProfile {
  tier: LodTier;
  /** Hard ceiling on triangles after decimation. */
  maxTriangles: number;
  /** Longest edge of the baked texture, in pixels (power of two). */
  textureSize: 512 | 1024 | 2048;
  /**
   * Target ratio handed to the decimator, as a fraction of the source mesh.
   * The decimator honours whichever of this and `maxTriangles` is stricter.
   */
  decimationRatio: number;
  /** Soft budget for the encoded .glb. Exceeding it re-runs at a lower ratio. */
  maxFileSizeBytes: number;
  /** Draco compression level, 0–10. Higher costs decode time on the phone. */
  dracoCompressionLevel: number;
  notes: string;
}

export const LOD_PROFILES: Readonly<Record<LodTier, LodProfile>> = {
  high: {
    tier: "high",
    maxTriangles: 65_000,
    textureSize: 2048,
    decimationRatio: 0.45,
    maxFileSizeBytes: 3 * 1024 * 1024,
    dracoCompressionLevel: 7,
    notes:
      "Desktop, iPad Pro and flagship Android on Wi-Fi. Never auto-selected on a phone.",
  },
  medium: {
    tier: "medium",
    maxTriangles: 35_000,
    textureSize: 1024,
    decimationRatio: 0.2,
    maxFileSizeBytes: 1_400_000,
    dracoCompressionLevel: 8,
    notes:
      "Default tier. Sized to stay inside the mobile Safari WebGL budget while " +
      "the camera feed holds its own texture.",
  },
  low: {
    tier: "low",
    maxTriangles: 12_000,
    textureSize: 512,
    decimationRatio: 0.08,
    maxFileSizeBytes: 500_000,
    dracoCompressionLevel: 9,
    notes:
      "Sub-4 GB Android devices, Save-Data headers and 3G. Silhouette holds up " +
      "at arm’s length on a plate, which is the only distance that matters.",
  },
};

export const DEFAULT_LOD_TIER: LodTier = "medium";

/** Order used when falling back from an unavailable tier. */
export const LOD_FALLBACK_ORDER: readonly LodTier[] = ["medium", "low", "high"];

export interface DecimationPlan {
  tier: LodTier;
  sourceTriangles: number;
  /** Triangle count the decimator should aim for. */
  targetTriangles: number;
  textureSize: number;
  dracoCompressionLevel: number;
  /** True when the source was already inside budget and needs no reduction. */
  passthrough: boolean;
}

/**
 * Builds the decimation plan for one tier.
 *
 * Applies the ratio first, then clamps to the tier's hard triangle ceiling —
 * so a 400k-triangle source and a 60k-triangle source both land inside budget,
 * and an already-small mesh is passed through untouched rather than being
 * needlessly destroyed.
 */
export function planDecimation(
  sourceTriangles: number,
  tier: LodTier,
): DecimationPlan {
  const profile = LOD_PROFILES[tier];
  const safeSource = Math.max(1, Math.round(sourceTriangles));

  const byRatio = Math.round(safeSource * profile.decimationRatio);
  const target = Math.max(
    // Never decimate below a floor, or the dish stops reading as itself.
    Math.min(safeSource, 1_500),
    Math.min(byRatio, profile.maxTriangles),
  );

  return {
    tier,
    sourceTriangles: safeSource,
    targetTriangles: Math.min(target, profile.maxTriangles),
    textureSize: profile.textureSize,
    dracoCompressionLevel: profile.dracoCompressionLevel,
    passthrough: safeSource <= profile.maxTriangles && safeSource <= byRatio,
  };
}

/** Decimation plans for all three tiers, high to low. */
export function planAllTiers(sourceTriangles: number): DecimationPlan[] {
  return (["high", "medium", "low"] as const).map((tier) =>
    planDecimation(sourceTriangles, tier),
  );
}

/* -------------------------------------------------------------------------- */
/*  Client-side tier selection                                                 */
/* -------------------------------------------------------------------------- */

export interface DeviceCapabilities {
  /** `navigator.deviceMemory`, in GB. Undefined on Safari, which never ships it. */
  deviceMemoryGb?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** True when the OS/browser asked for reduced data usage. */
  saveData?: boolean;
  /** `navigator.connection.effectiveType`, e.g. `4g`, `3g`. */
  effectiveType?: string;
  /** True for iOS/iPadOS Safari, which has the tightest WebGL budget. */
  isMobileSafari?: boolean;
}

/**
 * Picks the tier to download.
 *
 * Deliberately conservative: guessing too high costs a blank canvas and a
 * dropped WebGL context, guessing too low costs a slightly softer silhouette.
 */
export function selectLodTier(caps: DeviceCapabilities): LodTier {
  if (caps.saveData) return "low";

  if (
    caps.effectiveType &&
    ["slow-2g", "2g", "3g"].includes(caps.effectiveType)
  ) {
    return "low";
  }

  if (caps.deviceMemoryGb !== undefined && caps.deviceMemoryGb <= 4)
    return "low";
  if (caps.cores !== undefined && caps.cores <= 4) return "low";

  // Safari never exposes deviceMemory, so it is capped at medium on merit
  // rather than on a signal we cannot read.
  if (caps.isMobileSafari) return "medium";

  if (caps.deviceMemoryGb !== undefined && caps.deviceMemoryGb >= 8)
    return "high";

  return DEFAULT_LOD_TIER;
}

/** Reads the capability signals this browser actually exposes. */
export function readDeviceCapabilities(): DeviceCapabilities {
  if (typeof navigator === "undefined") return {};

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; saveData?: boolean };
  };

  const ua = nav.userAgent ?? "";
  const isIosLike =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; touch points disambiguate it.
    (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);

  return {
    deviceMemoryGb: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
    saveData: nav.connection?.saveData,
    effectiveType: nav.connection?.effectiveType,
    isMobileSafari: isIosLike && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua),
  };
}

/**
 * Resolves the best available URL for a tier, walking the fallback order when
 * the preferred tier has not been generated yet.
 */
export function resolveAssetUrl(
  lodUrls: Partial<Record<LodTier, string>>,
  preferred: LodTier,
  defaultUrl: string | null,
): string | null {
  if (lodUrls[preferred]) return lodUrls[preferred];
  for (const tier of LOD_FALLBACK_ORDER) {
    const url = lodUrls[tier];
    if (url) return url;
  }
  return defaultUrl;
}
