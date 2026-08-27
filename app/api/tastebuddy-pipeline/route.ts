import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { STAFF_COOKIE, readSession } from "@/lib/auth/staff-session";
import {
  ownsMenuItem,
  persistGeneratedAsset,
  type GeneratedAsset,
} from "@/lib/db/admin-repository";

import {
  IMMUTABLE_ASSET_CACHE_CONTROL,
  assetUrlsForChecksum,
  lookupCachedAsset,
  storeCachedAsset,
} from "@/lib/pipeline/cdn";
import {
  completeJob,
  estimateFileSize,
  failJob,
  getJob,
  putJob,
  submitGenerationJob,
  verifySignature,
  type GenerationJob,
} from "@/lib/pipeline/generator";
import { LOD_PROFILES, planAllTiers } from "@/lib/pipeline/lod";
import { validateImageUpload } from "@/lib/pipeline/validation";
import type { ApiError, AssetStatus, LodTier } from "@/lib/types";

/**
 * /api/tastebuddy-pipeline — the 2D-to-3D asset pipeline.
 *
 *   POST   multipart/form-data  Upload a dish photo and start a mesh job.
 *   GET    ?jobId=…             Poll a job's status.
 *   PUT    (signed JSON)        Generator webhook callback.
 *
 * Flow
 * ----
 *   1. Validate the upload (magic bytes, size, dimensions) — cheap rejections
 *      happen before any money is spent.
 *   2. Hash the photo. A checksum hit returns the cached CDN paths and the
 *      request costs nothing.
 *   3. Otherwise submit the job, decimate the result per `lib/pipeline/lod.ts`
 *      and write the immutable, content-addressed CDN paths back.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Mesh generation is slow; the upload leg still needs headroom to hash a 12 MB
// photo and hand it off.
export const maxDuration = 60;

/** Multipart bodies are streamed to disk by the platform, but cap them anyway. */
const DEFAULT_REAL_WORLD_SCALE_M = 0.22;

interface PipelineAssetPayload {
  status: AssetStatus;
  jobId: string;
  menuItemId: string;
  checksum: string;
  glbUrl: string | null;
  lodUrls: Partial<Record<LodTier, string>>;
  triangleCount: number | null;
  fileSizeBytes: number | null;
  sourceImageUrl: string;
  realWorldScaleM: number;
  /** True when this response was served entirely from the asset cache. */
  cached: boolean;
  tiers: {
    tier: LodTier;
    targetTriangles: number;
    textureSize: number;
    estimatedBytes: number;
    withinBudget: boolean;
    url: string | null;
  }[];
  failureReason: string | null;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/** Shapes a job into the wire payload, including per-tier budget accounting. */
function toPayload(job: GenerationJob): PipelineAssetPayload {
  const plans = job.plans.length
    ? job.plans
    : planAllTiers(job.sourceTriangles ?? 0);

  const tiers = plans.map((plan) => {
    const estimatedBytes = estimateFileSize(plan);
    return {
      tier: plan.tier,
      targetTriangles: plan.targetTriangles,
      textureSize: plan.textureSize,
      estimatedBytes,
      withinBudget: estimatedBytes <= LOD_PROFILES[plan.tier].maxFileSizeBytes,
      url: job.lodUrls[plan.tier] ?? null,
    };
  });

  const mediumPlan = plans.find((plan) => plan.tier === "medium") ?? null;

  return {
    status: job.status,
    jobId: job.jobId,
    menuItemId: job.menuItemId,
    checksum: job.checksum,
    glbUrl: job.lodUrls.medium ?? null,
    lodUrls: job.lodUrls,
    triangleCount: mediumPlan?.targetTriangles ?? null,
    fileSizeBytes: mediumPlan ? estimateFileSize(mediumPlan) : null,
    sourceImageUrl: job.sourceUrl,
    realWorldScaleM: job.realWorldScaleM,
    cached: job.cached,
    tiers,
    failureReason: job.failureReason,
  };
}

/** Shapes a finished job into the asset row the diner's menu query reads. */
function toGeneratedAsset(payload: PipelineAssetPayload): GeneratedAsset {
  return {
    status:
      payload.status === "ready"
        ? "ready"
        : payload.status === "failed"
          ? "failed"
          : "processing",
    glbUrl: payload.glbUrl,
    lodUrls: payload.lodUrls as Record<string, string>,
    triangleCount: payload.triangleCount,
    fileSizeBytes: payload.fileSizeBytes,
    sourceImageUrl: payload.sourceImageUrl,
    sourceChecksum: payload.checksum,
    realWorldScaleM: payload.realWorldScaleM,
    generatorJobId: payload.jobId,
    failureReason: payload.failureReason,
  };
}

/**
 * Records an outcome against the dish, never failing the request over it.
 *
 * The mesh already exists on the CDN at this point; a write failure here means
 * the diner falls back to procedural geometry, which is a degraded view rather
 * than a lost job, and the next upload will overwrite the row anyway.
 */
async function recordAsset(payload: PipelineAssetPayload): Promise<void> {
  try {
    await persistGeneratedAsset(payload.menuItemId, toGeneratedAsset(payload));
  } catch (error) {
    console.error("[api/tastebuddy-pipeline] could not record asset", error);
  }
}

/* -------------------------------------------------------------------------- */
/*  POST — upload a dish photo                                                 */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request): Promise<NextResponse> {
  const store = await cookies();
  const session = readSession(store.get(STAFF_COOKIE)?.value);
  if (!session) {
    return errorResponse(
      401,
      "not_signed_in",
      "Sign in with your venue access key to generate 3D assets.",
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send the dish photo as multipart/form-data with an `image` field.",
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(
      400,
      "malformed_multipart",
      "The multipart body could not be parsed.",
    );
  }

  const menuItemId = String(form.get("menuItemId") ?? "").trim();
  if (!menuItemId) {
    return errorResponse(
      400,
      "missing_menu_item",
      "A `menuItemId` field is required so the finished mesh can be attached to a dish.",
    );
  }

  const rawScale = Number(form.get("realWorldScaleM"));
  const realWorldScaleM =
    Number.isFinite(rawScale) && rawScale > 0 && rawScale < 2
      ? rawScale
      : DEFAULT_REAL_WORLD_SCALE_M;

  // Checked before validation work and long before the generator is called:
  // a dish from another venue must not even cost us a hash.
  if (!(await ownsMenuItem(session.restaurantId, menuItemId))) {
    return errorResponse(
      404,
      "menu_item_not_found",
      "That dish is not on your menu.",
    );
  }

  const imageField = form.get("image");
  const validation = await validateImageUpload(
    imageField instanceof File ? imageField : null,
  );

  if (!validation.ok) {
    const status = validation.code === "file_too_large" ? 413 : 400;
    return errorResponse(status, validation.code, validation.message, {
      image: validation.message,
    });
  }

  const { image } = validation;

  /* ---- 2. Cache lookup: same photo, same mesh, no generation cost --------- */

  const cached = lookupCachedAsset(image.checksum);
  if (cached) {
    const plans = planAllTiers(cached.triangleCount);
    const payload = toPayload({
      jobId: `job_${image.checksum.slice(0, 16)}`,
      menuItemId,
      checksum: image.checksum,
      status: "ready",
      sourceTriangles: cached.triangleCount,
      plans,
      lodUrls: cached.lodUrls,
      sourceUrl: cached.sourceUrl,
      realWorldScaleM,
      createdAt: cached.cachedAt,
      completedAt: cached.cachedAt,
      failureReason: null,
      cached: true,
    });

    // A cache hit still has to attach the mesh to *this* dish — the bytes are
    // shared, the association is not.
    await recordAsset(payload);

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "X-TasteBuddy-Cache": "hit",
        "Cache-Control": IMMUTABLE_ASSET_CACHE_CONTROL,
      },
    });
  }

  /* ---- 3. Submit for generation ------------------------------------------ */

  const callbackUrl = new URL(
    "/api/tastebuddy-pipeline",
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
  ).toString();

  const job = await submitGenerationJob({
    menuItemId,
    image,
    realWorldScaleM,
    callbackUrl,
  });

  if (job.status === "failed") {
    return NextResponse.json(toPayload(job), {
      status: 502,
      headers: { "X-TasteBuddy-Cache": "miss" },
    });
  }

  // The mock generator resolves synchronously; the real one calls back later.
  if (job.status === "ready") {
    cacheFinishedJob(job);
  }

  // Recorded either way: a `processing` row is what tells the menu card to show
  // "Building 3D model…" rather than "No 3D model yet".
  await recordAsset(toPayload(job));

  return NextResponse.json(toPayload(job), {
    status: job.status === "ready" ? 201 : 202,
    headers: {
      "X-TasteBuddy-Cache": "miss",
      Location: `/api/tastebuddy-pipeline?jobId=${encodeURIComponent(job.jobId)}`,
    },
  });
}

/** Writes a finished job's CDN paths into the content-addressed cache. */
function cacheFinishedJob(job: GenerationJob): void {
  const mediumPlan = job.plans.find((plan) => plan.tier === "medium");
  if (!mediumPlan) return;

  storeCachedAsset({
    checksum: job.checksum,
    lodUrls: assetUrlsForChecksum(job.checksum),
    triangleCount: mediumPlan.targetTriangles,
    fileSizeBytes: estimateFileSize(mediumPlan),
    sourceUrl: job.sourceUrl,
    cachedAt: Date.now(),
  });
}

/* -------------------------------------------------------------------------- */
/*  GET — poll a job                                                           */
/* -------------------------------------------------------------------------- */

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const jobId = params.get("jobId")?.trim();

  if (!jobId) {
    // No job id: report the pipeline's own configuration. Useful for a health
    // check and for the ops dashboard.
    return NextResponse.json({
      generator: process.env.GENERATOR_WEBHOOK_URL ? "live" : "mock",
      lodProfiles: LOD_PROFILES,
      limits: {
        maxUploadBytes: 12 * 1024 * 1024,
        acceptedFormats: ["jpeg", "png", "webp", "heic"],
      },
    });
  }

  const job = getJob(jobId);
  if (!job) {
    return errorResponse(404, "job_not_found", `No pipeline job "${jobId}".`);
  }

  return NextResponse.json(toPayload(job), {
    status: 200,
    headers: {
      // A finished job is immutable; a running one must not be cached.
      "Cache-Control":
        job.status === "ready" ? IMMUTABLE_ASSET_CACHE_CONTROL : "no-store",
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  PUT — generator webhook callback                                           */
/* -------------------------------------------------------------------------- */

interface GeneratorCallback {
  job_id?: string;
  status?: "succeeded" | "failed";
  /** Triangle count of the raw mesh the generator produced. */
  source_triangles?: number;
  error?: string;
}

export async function PUT(request: Request): Promise<NextResponse> {
  // Read the raw body first — the signature covers the exact bytes sent.
  const rawBody = await request.text();

  const signatureValid = await verifySignature(
    rawBody,
    request.headers.get("x-tastebuddy-signature"),
  );

  if (!signatureValid) {
    return errorResponse(
      401,
      "invalid_signature",
      "The callback signature did not verify.",
    );
  }

  let payload: GeneratorCallback;
  try {
    payload = JSON.parse(rawBody) as GeneratorCallback;
  } catch {
    return errorResponse(
      400,
      "malformed_callback",
      "Callback body was not valid JSON.",
    );
  }

  const jobId = payload.job_id?.trim();
  if (!jobId) {
    return errorResponse(
      400,
      "missing_job_id",
      "Callback did not include `job_id`.",
    );
  }

  const job = getJob(jobId);
  if (!job) {
    return errorResponse(404, "job_not_found", `No pipeline job "${jobId}".`);
  }

  // Callbacks can be retried by the generator; completing twice is a no-op.
  if (job.status === "ready" || job.status === "failed") {
    return NextResponse.json(toPayload(job), { status: 200 });
  }

  if (payload.status === "failed") {
    const failed = toPayload(
      putJob(failJob(job, payload.error ?? "Generation failed.")),
    );
    await recordAsset(failed);
    return NextResponse.json(failed, { status: 200 });
  }

  const sourceTriangles = Number(payload.source_triangles);
  if (!Number.isFinite(sourceTriangles) || sourceTriangles <= 0) {
    return errorResponse(
      400,
      "missing_triangle_count",
      "A successful callback must report a positive `source_triangles`.",
    );
  }

  const finished = putJob(completeJob(job, sourceTriangles));
  cacheFinishedJob(finished);

  const payloadOut = toPayload(finished);
  await recordAsset(payloadOut);

  return NextResponse.json(payloadOut, { status: 200 });
}
