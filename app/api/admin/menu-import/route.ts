import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { validateDraft, type DraftPayload } from "@/lib/admin/dish-validation";
import { STAFF_COOKIE, readSession } from "@/lib/auth/staff-session";
import {
  MENU_IMPORT_HOURLY_LIMIT,
  closeImportRun,
  recentImportCount,
  recordImportRun,
  saveMenuItem,
} from "@/lib/db/admin-repository";
import { getMenuItems } from "@/lib/db/repository";
import { validateImageUpload } from "@/lib/pipeline/validation";
import type { ApiError } from "@/lib/types";
import {
  MAX_VISION_BYTES,
  MenuReadError,
  isVisionConfigured,
  readMenuPhoto,
  type VisionMediaType,
} from "@/lib/vision/menu-reader";

/**
 * /api/admin/menu-import — turning a photo of a printed menu into drafts.
 *
 *   POST   multipart `image`  Read the photo. Writes nothing to the menu.
 *   PUT    the reviewed rows  Save them as unavailable drafts.
 *
 * Split in two on purpose. A read costs money and produces a proposal; a write
 * changes a restaurant's menu. Keeping them apart is what makes the review step
 * structural rather than a screen staff can click past — there is no request
 * shape that reads a photo and publishes it in one go.
 *
 * What PUT accepts is the same `validateDraft` the hand-editor uses, so nothing
 * arriving from a photo skips a check a typed dish would face. It also forces
 * `isAvailable: false`: an imported dish has no allergen declarations yet, and
 * a dish declaring nothing reads to a diner as safe.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Menus are text; HEIC is not accepted upstream and is not worth transcoding. */
const VISION_FORMATS: Readonly<Record<string, VisionMediaType>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** One photo can hold a lot of dishes, but not a whole restaurant group's. */
const MAX_COMMIT_ROWS = 120;

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
) {
  return NextResponse.json<ApiError>(
    { error: { code, message } },
    { status, headers },
  );
}

async function currentRestaurantId(): Promise<string | null> {
  const store = await cookies();
  return readSession(store.get(STAFF_COOKIE)?.value)?.restaurantId ?? null;
}

function unauthorised() {
  return errorResponse(
    401,
    "not_signed_in",
    "Sign in with your venue access key.",
  );
}

/* -------------------------------------------------------------------------- */
/*  POST — read a photo                                                        */
/* -------------------------------------------------------------------------- */

export async function POST(request: Request): Promise<NextResponse> {
  const restaurantId = await currentRestaurantId();
  if (!restaurantId) return unauthorised();

  if (!isVisionConfigured()) {
    return errorResponse(
      503,
      "not_configured",
      "Menu import is not switched on for this deployment.",
    );
  }

  // Checked before the image is even parsed — the cheapest possible no.
  let recentReads: number;
  try {
    recentReads = await recentImportCount(restaurantId);
  } catch (error) {
    console.error("[api/admin/menu-import] rate check failed", error);
    return errorResponse(
      500,
      "import_failed",
      "Menu import is unavailable right now. Your menu is unchanged.",
    );
  }

  if (recentReads >= MENU_IMPORT_HOURLY_LIMIT) {
    return errorResponse(
      429,
      "rate_limited",
      `That is ${MENU_IMPORT_HOURLY_LIMIT} menu photos this hour, which is the limit. The dishes you have already imported are unaffected.`,
      { "Retry-After": "3600" },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(
      400,
      "malformed_body",
      "Upload the photo as multipart form data.",
    );
  }

  const upload = form.get("image");
  const validation = await validateImageUpload(
    upload instanceof File ? upload : null,
  );
  if (!validation.ok) {
    return errorResponse(400, validation.code, validation.message);
  }

  const { image } = validation;
  const mediaType = VISION_FORMATS[image.format];
  if (!mediaType) {
    return errorResponse(
      400,
      "unsupported_format",
      "Menu import reads JPEG, PNG and WebP. An iPhone photo saved as HEIC needs converting first — 'Most Compatible' in Camera settings does it at the source.",
    );
  }

  if (image.sizeBytes > MAX_VISION_BYTES) {
    return errorResponse(
      400,
      "file_too_large",
      `That photo is ${(image.sizeBytes / 1024 / 1024).toFixed(1)} MB; menu import accepts up to ${MAX_VISION_BYTES / 1024 / 1024} MB. A photo of a menu does not need full camera resolution.`,
    );
  }

  let result;
  try {
    result = await readMenuPhoto({ bytes: image.bytes, mediaType });
  } catch (error) {
    if (error instanceof MenuReadError) {
      // A failure that was still billed for counts against the hourly limit.
      // Otherwise a menu too long to read is a way to spend without bound.
      if (error.usage) {
        await recordImportRun({
          restaurantId,
          sourceChecksum: image.checksum,
          dishCount: 0,
          inputTokens: error.usage.inputTokens,
          outputTokens: error.usage.outputTokens,
        }).catch((cause) => {
          console.error("[api/admin/menu-import] run not recorded", cause);
        });
      }

      const status =
        error.code === "rate_limited"
          ? 429
          : error.code === "not_configured"
            ? 503
            : error.code === "image_rejected"
              ? 400
              : 502;
      return errorResponse(
        status,
        error.code,
        error.message,
        error.retryAfterSeconds
          ? { "Retry-After": String(Math.ceil(error.retryAfterSeconds)) }
          : undefined,
      );
    }
    console.error("[api/admin/menu-import] read failed", error);
    return errorResponse(
      502,
      "import_failed",
      "The menu reader is unavailable right now. Your menu is unchanged.",
    );
  }

  // Recorded whatever the outcome, including a photo that turned out not to be
  // a menu — it was paid for either way, and the limit has to reflect that.
  let importId: string | null = null;
  try {
    importId = await recordImportRun({
      restaurantId,
      sourceChecksum: image.checksum,
      dishCount: result.dishes.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
  } catch (error) {
    console.error("[api/admin/menu-import] run not recorded", error);
  }

  // A venue re-photographing a menu they have half-entered should be told so
  // in the review table, not met with a unique-constraint failure after they
  // have already ticked everything.
  let existingNames = new Set<string>();
  try {
    const items = await getMenuItems(restaurantId, {
      includeUnavailable: true,
    });
    existingNames = new Set(items.map((item) => item.name.toLowerCase()));
  } catch (error) {
    console.error("[api/admin/menu-import] existing names unavailable", error);
  }

  const dishes = result.dishes.map((dish) => ({
    ...dish,
    alreadyOnMenu: existingNames.has(dish.name.toLowerCase()),
  }));

  if (!result.looksLikeMenu) {
    return errorResponse(
      422,
      "not_a_menu",
      "That photo does not look like a menu. Shoot the printed menu itself, with the whole page in frame.",
    );
  }

  return NextResponse.json(
    {
      importId,
      dishes,
      warnings: result.warnings,
      remainingReads: Math.max(0, MENU_IMPORT_HOURLY_LIMIT - recentReads - 1),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/* -------------------------------------------------------------------------- */
/*  PUT — save the reviewed rows                                               */
/* -------------------------------------------------------------------------- */

interface CommitRow {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  priceCents?: unknown;
  basePortionGrams?: unknown;
}

interface CommitBody {
  importId?: unknown;
  dishes?: unknown;
}

export interface CommitOutcome {
  name: string;
  saved: boolean;
  reason: string | null;
}

export async function PUT(request: Request): Promise<NextResponse> {
  const restaurantId = await currentRestaurantId();
  if (!restaurantId) return unauthorised();

  let body: CommitBody;
  try {
    body = (await request.json()) as CommitBody;
  } catch {
    return errorResponse(400, "malformed_body", "Body was not valid JSON.");
  }

  if (!Array.isArray(body.dishes) || body.dishes.length === 0) {
    return errorResponse(
      400,
      "no_dishes",
      "Pick at least one dish to add to the menu.",
    );
  }
  if (body.dishes.length > MAX_COMMIT_ROWS) {
    return errorResponse(
      400,
      "too_many_dishes",
      `That is more than ${MAX_COMMIT_ROWS} dishes in one import. Split the menu across a few photos.`,
    );
  }

  const outcomes: CommitOutcome[] = [];

  for (const raw of body.dishes as CommitRow[]) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";

    // Every field a dish needs but a printed menu does not carry. Nutrition
    // starts at zero rather than at a guess, and the dish stays off the menu
    // until someone fills it in along with the allergens.
    const payload: DraftPayload = {
      name,
      description: raw?.description,
      category: raw?.category,
      priceCents: Number(raw?.priceCents ?? 0),
      basePortionGrams: Number(raw?.basePortionGrams ?? 200),
      nutrition: {},
      isAvailable: false,
      allergens: [],
      ingredients: [],
    };

    const validated = validateDraft(payload);
    if (!validated.ok) {
      outcomes.push({
        name: name || "Untitled dish",
        saved: false,
        reason: validated.message,
      });
      continue;
    }

    try {
      // Written one at a time rather than in a single transaction: a menu
      // where twenty-eight of thirty dishes landed is a useful result, and
      // rolling the lot back over one bad row would be worse for the venue
      // than telling them which two need another look.
      await saveMenuItem(restaurantId, validated.draft);
      outcomes.push({ name: validated.draft.name, saved: true, reason: null });
    } catch (error) {
      // 23505 is the unique index on (restaurant_id, name). Worth naming: on a
      // re-import it is the expected outcome, not a fault.
      const duplicate =
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "23505";

      if (!duplicate) {
        console.error("[api/admin/menu-import] dish not saved", error);
      }

      outcomes.push({
        name: validated.draft.name,
        saved: false,
        reason: duplicate
          ? "A dish with this name is already on your menu — it was left as it is."
          : "That dish could not be saved.",
      });
    }
  }

  const savedCount = outcomes.filter((outcome) => outcome.saved).length;

  if (typeof body.importId === "string" && body.importId) {
    await closeImportRun(restaurantId, body.importId, savedCount);
  }

  return NextResponse.json({ savedCount, outcomes });
}
