import { NextResponse } from "next/server";

import {
  ExplainError,
  MAX_PHOTO_BYTES,
  readMenuPhoto,
  type VisionMediaType,
} from "@/lib/dish/explain";
import { errorResponse, explainErrorResponse, gate } from "@/lib/dish/guard";
import { recordLookup } from "@/lib/dish/rate-limit";
import { validateImageUpload } from "@/lib/pipeline/validation";

/**
 * /api/read-menu — a photograph of a menu, to a list of dishes.
 *
 * No sign-in. Someone standing in a restaurant holding a menu they cannot read
 * is not going to make an account first, so the only handle is the anonymous
 * token the browser already keeps, and the limits hang off that.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** HEIC is not accepted upstream, and iPhones shoot it by default. */
const READABLE: Readonly<Record<string, VisionMediaType>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "malformed_body", "Send the photo as form data.");
  }

  const allowed = await gate(form.get("token"));
  if (!allowed.ok) return allowed.response;

  const upload = form.get("photo");
  const validation = await validateImageUpload(
    upload instanceof File ? upload : null,
  );
  if (!validation.ok) {
    return errorResponse(400, validation.code, validation.message);
  }

  const { image } = validation;
  const mediaType = READABLE[image.format];
  if (!mediaType) {
    return errorResponse(
      400,
      "unsupported_format",
      "That photo is in a format this cannot read. On an iPhone, set Camera to 'Most Compatible' and take it again.",
    );
  }
  if (image.sizeBytes > MAX_PHOTO_BYTES) {
    return errorResponse(
      400,
      "file_too_large",
      `That photo is ${(image.sizeBytes / 1024 / 1024).toFixed(1)} MB, which is too big. A photo of a menu does not need full camera resolution.`,
    );
  }

  try {
    const reading = await readMenuPhoto({ bytes: image.bytes, mediaType });
    await recordLookup(allowed.token, "menu_photo", reading.usage);

    if (!reading.looksLikeMenu) {
      return errorResponse(
        422,
        "not_a_menu",
        "That does not look like a menu. Try again with the menu filling the frame.",
      );
    }
    if (reading.dishes.length === 0) {
      return errorResponse(
        422,
        "nothing_readable",
        "Nothing could be read off that. Try getting closer, or a page at a time.",
      );
    }

    return NextResponse.json(
      {
        language: reading.language,
        dishes: reading.dishes,
        notes: reading.notes,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    // A failure that was still billed for counts against the limit; otherwise
    // a menu too long to read is a way to spend without bound.
    if (error instanceof ExplainError && error.usage) {
      await recordLookup(allowed.token, "menu_photo", error.usage);
    }
    return explainErrorResponse(error);
  }
}
