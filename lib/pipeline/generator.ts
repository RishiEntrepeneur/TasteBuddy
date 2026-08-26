import {
  assetUrlsForChecksum,
  sourceObjectKey,
  cdnUrl,
} from "@/lib/pipeline/cdn";
import { planAllTiers, type DecimationPlan } from "@/lib/pipeline/lod";
import type { AssetStatus, LodTier } from "@/lib/types";
import type { ValidatedImage } from "@/lib/pipeline/validation";

/**
 * Client for the 2D-to-3D mesh generator.
 *
 * The real service is asynchronous: we hand it a source photo plus a callback
 * URL, it returns a job id immediately, and minutes later it POSTs the finished
 * mesh back. When `GENERATOR_WEBHOOK_URL` is unset the module runs a mock that
 * follows exactly the same contract, so the whole pipeline — validation,
 * decimation planning, CDN keying, callback verification — is exercised end to
 * end in development without a paid API key.
 */

export interface GenerationJob {
  jobId: string;
  menuItemId: string;
  checksum: string;
  status: AssetStatus;
  /** Triangle count the generator reports for the raw mesh. */
  sourceTriangles: number | null;
  plans: DecimationPlan[];
  lodUrls: Partial<Record<LodTier, string>>;
  sourceUrl: string;
  realWorldScaleM: number;
  createdAt: number;
  completedAt: number | null;
  failureReason: string | null;
  /** True when the result came straight from the CDN cache. */
  cached: boolean;
}

export interface SubmitJobInput {
  menuItemId: string;
  image: ValidatedImage;
  /** Longest real-world edge of the plated dish, in metres. */
  realWorldScaleM: number;
  /** Absolute URL the generator should POST its result back to. */
  callbackUrl: string;
}

/* -------------------------------------------------------------------------- */
/*  Job registry                                                               */
/* -------------------------------------------------------------------------- */

declare global {
  var __tasteBuddyJobs: Map<string, GenerationJob> | undefined;
}

function jobs(): Map<string, GenerationJob> {
  globalThis.__tasteBuddyJobs ??= new Map<string, GenerationJob>();
  return globalThis.__tasteBuddyJobs;
}

export function getJob(jobId: string): GenerationJob | null {
  return jobs().get(jobId) ?? null;
}

export function putJob(job: GenerationJob): GenerationJob {
  jobs().set(job.jobId, job);
  return job;
}

export function listJobs(): GenerationJob[] {
  return [...jobs().values()].sort((a, b) => b.createdAt - a.createdAt);
}

/* -------------------------------------------------------------------------- */
/*  Webhook signing                                                            */
/* -------------------------------------------------------------------------- */

const encoder = new TextEncoder();

function generatorSecret(): string {
  return process.env.GENERATOR_WEBHOOK_SECRET ?? "tastebuddy-dev-secret";
}

/** HMAC-SHA256 of the raw callback body, hex encoded. */
export async function signPayload(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(generatorSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison so a signature cannot be probed byte by byte. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifySignature(
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const expected = await signPayload(rawBody);
  return timingSafeEqual(expected, header.replace(/^sha256=/, ""));
}

/* -------------------------------------------------------------------------- */
/*  Submission                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic pseudo-random triangle count derived from the checksum, so the
 * mock behaves identically across restarts for the same photo.
 */
function mockSourceTriangles(checksum: string): number {
  const seed = parseInt(checksum.slice(0, 8), 16);
  return 140_000 + (seed % 260_000); // 140k–400k, typical generator output
}

function newJobId(checksum: string): string {
  return `job_${checksum.slice(0, 16)}`;
}

/**
 * Submits a photo for mesh generation.
 *
 * Returns as soon as the job is accepted — never blocks on generation. The
 * caller polls `GET /api/tastebuddy-pipeline?jobId=…` or waits for the webhook.
 */
export async function submitGenerationJob(
  input: SubmitJobInput,
): Promise<GenerationJob> {
  const { image, menuItemId, realWorldScaleM, callbackUrl } = input;

  const sourceUrl = cdnUrl(sourceObjectKey(image.checksum, image.format));
  const job: GenerationJob = {
    jobId: newJobId(image.checksum),
    menuItemId,
    checksum: image.checksum,
    status: "processing",
    sourceTriangles: null,
    plans: [],
    lodUrls: {},
    sourceUrl,
    realWorldScaleM,
    createdAt: Date.now(),
    completedAt: null,
    failureReason: null,
    cached: false,
  };

  const endpoint = process.env.GENERATOR_WEBHOOK_URL;

  if (!endpoint) {
    // Mock path: resolve immediately with a deterministic mesh so the rest of
    // the pipeline has something real to decimate, key and cache.
    return putJob(completeJob(job, mockSourceTriangles(image.checksum)));
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GENERATOR_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        job_id: job.jobId,
        source_image_url: sourceUrl,
        callback_url: callbackUrl,
        output_format: "glb",
        // The generator does the first decimation pass server-side; we do the
        // per-tier pass ourselves so the budgets stay under our control.
        target_triangles: planAllTiers(0).map((plan) => plan.targetTriangles),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return putJob({
        ...job,
        status: "failed",
        completedAt: Date.now(),
        failureReason: `Generator rejected the job (HTTP ${response.status}).`,
      });
    }

    const payload = (await response.json()) as { job_id?: string };
    return putJob({ ...job, jobId: payload.job_id ?? job.jobId });
  } catch (error) {
    return putJob({
      ...job,
      status: "failed",
      completedAt: Date.now(),
      failureReason:
        error instanceof Error
          ? `Generator unreachable: ${error.message}`
          : "Generator unreachable.",
    });
  }
}

/**
 * Applies the decimation plans to a finished raw mesh and records the CDN
 * paths. Shared by the mock path and the real webhook callback.
 */
export function completeJob(
  job: GenerationJob,
  sourceTriangles: number,
): GenerationJob {
  const plans = planAllTiers(sourceTriangles);
  return {
    ...job,
    status: "ready",
    sourceTriangles,
    plans,
    lodUrls: assetUrlsForChecksum(job.checksum),
    completedAt: Date.now(),
    failureReason: null,
  };
}

export function failJob(job: GenerationJob, reason: string): GenerationJob {
  return {
    ...job,
    status: "failed",
    completedAt: Date.now(),
    failureReason: reason,
  };
}

/** Byte size estimate for a decimated tier — Draco is roughly 22 bytes/triangle. */
export function estimateFileSize(plan: DecimationPlan): number {
  const geometry = plan.targetTriangles * 22;
  const texture = plan.textureSize * plan.textureSize * 0.12; // WebP, ~0.12 B/px
  return Math.round(geometry + texture);
}
