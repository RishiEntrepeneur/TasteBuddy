import type { LodTier } from "@/lib/types";

/**
 * CDN asset paths and the pipeline's content-addressed cache.
 *
 * Every generated `.glb` is keyed by the SHA-256 of the *source photo*, so
 * re-uploading the same dish picture — from a re-run, a retry, or a second
 * venue in the same chain — resolves to the existing meshes instead of paying
 * for another generation. Paths are immutable, which lets the CDN cache them
 * for a year.
 */

const DEFAULT_CDN_BASE = "/assets";

export function cdnBaseUrl(): string {
  return (
    process.env.ASSET_CDN_URL ??
    process.env.NEXT_PUBLIC_ASSET_CDN_URL ??
    DEFAULT_CDN_BASE
  ).replace(/\/+$/, "");
}

/**
 * Content-addressed object key. The checksum prefix shards the bucket evenly,
 * which keeps listing and invalidation cheap once there are millions of dishes.
 */
export function assetObjectKey(checksum: string, tier: LodTier): string {
  const shard = checksum.slice(0, 2);
  return `models/${shard}/${checksum}/${tier}.glb`;
}

export function sourceObjectKey(checksum: string, extension: string): string {
  const shard = checksum.slice(0, 2);
  return `source/${shard}/${checksum}.${extension}`;
}

export function cdnUrl(objectKey: string): string {
  return `${cdnBaseUrl()}/${objectKey}`;
}

export function assetUrl(checksum: string, tier: LodTier): string {
  return cdnUrl(assetObjectKey(checksum, tier));
}

/** All three tier URLs for a checksum. */
export function assetUrlsForChecksum(
  checksum: string,
): Record<LodTier, string> {
  return {
    high: assetUrl(checksum, "high"),
    medium: assetUrl(checksum, "medium"),
    low: assetUrl(checksum, "low"),
  };
}

/**
 * Cache headers for an immutable, content-addressed asset. Safe to send from
 * the origin because the URL changes whenever the bytes do.
 */
export const IMMUTABLE_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

/* -------------------------------------------------------------------------- */
/*  Cache index                                                                */
/* -------------------------------------------------------------------------- */

export interface CachedAssetRecord {
  checksum: string;
  lodUrls: Record<LodTier, string>;
  triangleCount: number;
  fileSizeBytes: number;
  sourceUrl: string;
  cachedAt: number;
}

/**
 * Process-local cache index.
 *
 * In production the authoritative index is the partial unique index on
 * `asset_3d.source_checksum` (see `db/schema.sql`); this map is a warm-lambda
 * shortcut in front of it, and the only cache when running without a database.
 * It is stored on `globalThis` so Next's dev-mode module reloading does not
 * silently empty it between requests.
 */
declare global {
  var __tasteBuddyAssetCache: Map<string, CachedAssetRecord> | undefined;
}

function cache(): Map<string, CachedAssetRecord> {
  globalThis.__tasteBuddyAssetCache ??= new Map<string, CachedAssetRecord>();
  return globalThis.__tasteBuddyAssetCache;
}

export function lookupCachedAsset(checksum: string): CachedAssetRecord | null {
  return cache().get(checksum) ?? null;
}

export function storeCachedAsset(record: CachedAssetRecord): CachedAssetRecord {
  cache().set(record.checksum, record);
  return record;
}

export function cacheSize(): number {
  return cache().size;
}

/** Test/ops hook — clears the warm-lambda index without touching Postgres. */
export function clearAssetCache(): void {
  cache().clear();
}
