/**
 * Reading a photographed menu.
 *
 * A venue joining TasteBuddy already has a menu; asking them to retype forty
 * dishes before they see anything is the reason most of them would never
 * finish onboarding. This turns a photo of the printed menu into a set of
 * drafts they can correct, which is a very different job from turning it into
 * a live menu — see the safety boundary below.
 *
 * ── The safety boundary ────────────────────────────────────────────────────
 *
 * The model is asked to transcribe, never to conclude. Specifically it is not
 * asked what a dish contains, and its output has no field that could carry an
 * allergen declaration into the database. That is not a limitation of the
 * model; it is the correct division of responsibility. "Pesto probably has
 * pine nuts and parmesan" is a good guess and a good guess is not what someone
 * with an anaphylactic allergy is relying on when they read this app. Only a
 * human who knows the kitchen can make that call, so allergens are declared in
 * the editor, by them, afterwards.
 *
 * Two mechanisms enforce that rather than merely documenting it:
 *
 *   1. `ExtractedDish` has no allergen field. There is no shape this module
 *      can return that a caller could persist as a declaration.
 *   2. Imported dishes are written with `isAvailable: false`, so a dish with
 *      no declarations is off the menu until a person turns it on. A silently
 *      published dish declaring nothing reads to a diner as "safe", which is
 *      the single worst failure this product could have.
 *
 * Prices are transcribed as printed and converted to pence in `./price`, in
 * ordinary code — the one part of the job where a model has no advantage and a
 * silent failure mode.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { MenuCategory } from "@/lib/types";

import { parseMenuPrice, type PriceCurrency } from "./price";

/** Media types the Messages API accepts. HEIC has to be converted first. */
export const VISION_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type VisionMediaType = (typeof VISION_MEDIA_TYPES)[number];

/** The API's own per-image ceiling, below our 12 MB upload limit. */
export const MAX_VISION_BYTES = 5 * 1024 * 1024;

const MODEL = "claude-opus-5";

const CATEGORIES: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];

export interface ExtractedDish {
  name: string;
  description: string;
  /** The price exactly as printed, e.g. "£14.50" or "" when none is shown. */
  priceText: string;
  /** Parsed from `priceText` in code. Null when it was not unambiguous. */
  priceCents: number | null;
  currency: PriceCurrency;
  category: MenuCategory;
  /**
   * Wording printed alongside the dish — "(v)", "contains nuts", "gf on
   * request". Shown to staff as a reading aid while they declare allergens
   * themselves. Never mapped to an allergen key, never persisted.
   */
  printedNotes: string;
  /** Whether the entry was cleanly legible, or partly guessed from a blur. */
  legibility: "clear" | "unclear";
  /** Free-text reason set whenever a human needs to look closely. */
  reviewNote: string | null;
}

export interface MenuReadResult {
  looksLikeMenu: boolean;
  dishes: ExtractedDish[];
  /** Whole-photo problems: glare, a cropped column, a second page. */
  warnings: string[];
  usage: { inputTokens: number; outputTokens: number };
}

export type MenuReadFailureCode =
  | "not_configured"
  | "image_rejected"
  | "rate_limited"
  | "upstream_error"
  | "unreadable_response";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export class MenuReadError extends Error {
  readonly code: MenuReadFailureCode;
  /** Seconds to wait, when the upstream said so. */
  readonly retryAfterSeconds: number | null;
  /**
   * Set when the model ran and was billed for despite the failure — a menu
   * too long to fit in one response, most of all. Carried out so the caller
   * can count it against the venue's hourly limit; a failure that costs money
   * but does not count is a way to spend without limit.
   */
  readonly usage: TokenUsage | null;

  constructor(
    code: MenuReadFailureCode,
    message: string,
    options: {
      retryAfterSeconds?: number | null;
      usage?: TokenUsage | null;
    } = {},
  ) {
    super(message);
    this.name = "MenuReadError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.usage = options.usage ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Schema                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Note what is absent: there is no allergen field, and no field for anything
 * the model would have to reason about rather than read. `printedNotes` is
 * transcription of ink on paper, which is exactly what vision is good at.
 */
const MENU_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["looksLikeMenu", "warnings", "dishes"],
  properties: {
    looksLikeMenu: {
      type: "boolean",
      description:
        "True only if this image is a food or drink menu. False for anything else, including a photo of a single plated dish.",
    },
    warnings: {
      type: "array",
      description:
        "Problems affecting the whole photo: glare, a cut-off column, a second page not shown, handwriting that could not be read. Empty when the photo is clean.",
      items: { type: "string" },
      maxItems: 8,
    },
    dishes: {
      type: "array",
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "description",
          "priceText",
          "category",
          "printedNotes",
          "legibility",
        ],
        properties: {
          name: {
            type: "string",
            description: "The dish name exactly as printed.",
          },
          description: {
            type: "string",
            description:
              "The description printed under the dish, verbatim. Empty string if the menu prints none — never write one.",
          },
          priceText: {
            type: "string",
            description:
              "The price exactly as printed, including its currency symbol, e.g. '£14.50'. Empty string if no price is shown. Do not convert, round or calculate.",
          },
          category: {
            type: "string",
            enum: [...CATEGORIES],
            description:
              "Which course this dish sits under, taken from the menu's own headings where it has them.",
          },
          printedNotes: {
            type: "string",
            description:
              "Any wording or symbol printed beside this dish about diet or ingredients — '(v)', 'contains nuts', 'gf'. Copy it exactly. Empty string if there is none. Do not add anything the menu does not print.",
          },
          legibility: {
            type: "string",
            enum: ["clear", "unclear"],
            description:
              "'unclear' if any part of this entry was blurred, cropped, glared over or otherwise hard to read.",
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You transcribe restaurant menus from photographs for a menu-management tool. A member of the venue's staff reviews and corrects everything you return before any of it is published.

Transcribe what is printed. Do not interpret, complete or improve it.

- Copy names, descriptions and prices exactly as they appear, including spelling and capitalisation the menu uses.
- Where a menu prints no description, return an empty string. Never write one from your knowledge of the dish.
- Never state or imply what a dish contains beyond the words printed. You are not being asked what is in the food, and a person with a food allergy will be relying on the venue's own declaration rather than on anything you return.
- Copy dietary markings such as "(v)" or "contains nuts" into printedNotes verbatim, as ink on the page. Do not expand, translate or infer them.
- Mark an entry "unclear" rather than guessing at it. A flagged entry gets a careful second look; a confident wrong one does not.
- Set looksLikeMenu to false if the image is not a menu, and return no dishes.`;

const USER_PROMPT = `Transcribe every dish and drink on this menu.`;

/* -------------------------------------------------------------------------- */
/*  Response validation                                                        */
/* -------------------------------------------------------------------------- */

function asString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/**
 * Re-validates the model's output.
 *
 * Structured outputs make a schema violation very unlikely, but "very
 * unlikely" is the wrong standard for something that writes to a restaurant's
 * menu. Anything malformed is dropped rather than repaired.
 */
function normaliseDishes(raw: unknown): ExtractedDish[] {
  if (!Array.isArray(raw)) return [];

  const dishes: ExtractedDish[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const name = asString(record.name, 120);
    if (name.length < 2) continue;

    // A menu that prints "Bread" twice under two sections is one dish to us;
    // a duplicate row is just work for whoever is reviewing.
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const category = CATEGORIES.includes(record.category as MenuCategory)
      ? (record.category as MenuCategory)
      : "mains";

    const priceText = asString(record.priceText, 40);
    const price = parseMenuPrice(priceText);

    const legibility = record.legibility === "unclear" ? "unclear" : "clear";

    const reviewNote =
      legibility === "unclear"
        ? "Part of this entry was hard to read — check it against the menu."
        : price.note;

    dishes.push({
      name,
      description: asString(record.description, 600),
      priceText,
      priceCents: price.amountMinor,
      currency: price.currency,
      category,
      printedNotes: asString(record.printedNotes, 200),
      legibility,
      reviewNote,
    });
  }

  return dishes;
}

function normaliseWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => asString(entry, 200))
    .filter((entry) => entry.length > 0)
    .slice(0, 8);
}

/* -------------------------------------------------------------------------- */
/*  The call                                                                   */
/* -------------------------------------------------------------------------- */

export function isVisionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let cachedClient: Anthropic | null = null;

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new MenuReadError(
      "not_configured",
      "Menu import is not switched on for this deployment.",
    );
  }
  // One client per container; it holds a connection pool worth reusing.
  cachedClient ??= new Anthropic({ apiKey, maxRetries: 2 });
  return cachedClient;
}

export interface MenuPhoto {
  bytes: Uint8Array;
  mediaType: VisionMediaType;
}

/**
 * Sends one menu photo to Claude and returns the dishes it could read.
 *
 * Streamed rather than awaited whole: a two-page menu can run to several
 * thousand output tokens on top of adaptive thinking, and a non-streaming
 * request that long risks the HTTP timeout in a serverless container.
 */
export async function readMenuPhoto(photo: MenuPhoto): Promise<MenuReadResult> {
  if (photo.bytes.byteLength > MAX_VISION_BYTES) {
    throw new MenuReadError(
      "image_rejected",
      `That photo is ${(photo.bytes.byteLength / 1024 / 1024).toFixed(1)} MB; menu import accepts up to ${MAX_VISION_BYTES / 1024 / 1024} MB.`,
    );
  }

  const data = Buffer.from(photo.bytes).toString("base64");

  let message;
  try {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: MENU_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: photo.mediaType, data },
            },
            { type: "text", text: USER_PROMPT },
          ],
        },
      ],
    });
    message = await stream.finalMessage();
  } catch (error) {
    throw toMenuReadError(error);
  }

  // A very long menu can run past `max_tokens`, which truncates the JSON
  // mid-object. Caught before parsing, because "invalid JSON" would send the
  // venue off retaking a photo that was never the problem.
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };

  if (message.stop_reason === "max_tokens") {
    throw new MenuReadError(
      "unreadable_response",
      "That menu is longer than can be read in one go. Photograph it a page or a section at a time.",
      { usage },
    );
  }

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MenuReadError(
      "unreadable_response",
      "The menu could not be read from that photo. Try a straighter, better-lit shot.",
      { usage },
    );
  }

  const body = (parsed ?? {}) as Record<string, unknown>;

  return {
    looksLikeMenu: body.looksLikeMenu === true,
    dishes: body.looksLikeMenu === true ? normaliseDishes(body.dishes) : [],
    warnings: normaliseWarnings(body.warnings),
    usage,
  };
}

/** Maps SDK errors onto something the editor can show a chef. */
function toMenuReadError(error: unknown): MenuReadError {
  if (error instanceof MenuReadError) return error;

  if (error instanceof Anthropic.RateLimitError) {
    const header = error.headers?.get("retry-after");
    const seconds = header ? Number(header) : NaN;
    return new MenuReadError(
      "rate_limited",
      "Menu import is busy right now. Try again in a moment.",
      { retryAfterSeconds: Number.isFinite(seconds) ? seconds : null },
    );
  }

  if (error instanceof Anthropic.AuthenticationError) {
    // The venue cannot fix this and should not be told to try again.
    console.error("[vision/menu-reader] API key rejected", error.message);
    return new MenuReadError(
      "not_configured",
      "Menu import is not switched on for this deployment.",
    );
  }

  if (error instanceof Anthropic.BadRequestError) {
    console.error("[vision/menu-reader] request rejected", error.message);
    return new MenuReadError(
      "image_rejected",
      "That photo could not be read. Try a JPEG or PNG of the whole menu, shot straight on.",
    );
  }

  if (error instanceof Anthropic.APIError) {
    console.error("[vision/menu-reader] upstream error", error.message);
    return new MenuReadError(
      "upstream_error",
      "The menu reader is unavailable right now. Your menu is unchanged.",
    );
  }

  console.error("[vision/menu-reader] unexpected failure", error);
  return new MenuReadError(
    "upstream_error",
    "The menu reader is unavailable right now. Your menu is unchanged.",
  );
}
