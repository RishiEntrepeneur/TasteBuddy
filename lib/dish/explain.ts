import Anthropic from "@anthropic-ai/sdk";

import { ALLERGEN_KEYS, type AllergenKey, type MenuCategory } from "@/lib/types";

import type {
  Dietary,
  DishExplanation,
  DishSummary,
  Likelihood,
  LikelyAllergen,
  MenuReading,
  SpiceLevel,
} from "./types";

/**
 * Working out what a dish is.
 *
 * Two entry points, one job: someone is looking at a name they do not
 * recognise and wants to know what would arrive if they ordered it.
 *
 *   `readMenuPhoto`  a photographed menu, in any language, to a list
 *   `explainDish`    one name, typed, to everything the app can say
 *
 * The safety rules live in `./types`, next to the shape that enforces them.
 * The short version: this is allowed to say what a dish is *normally* made
 * with, and has no vocabulary for what this kitchen actually did.
 */

const MODEL = "claude-opus-5";

export const VISION_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type VisionMediaType = (typeof VISION_MEDIA_TYPES)[number];

/** The API's per-image ceiling. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const COURSES: readonly MenuCategory[] = [
  "starters",
  "mains",
  "sides",
  "desserts",
  "drinks",
];

const DIETARY: readonly Dietary[] = [
  "meat",
  "fish",
  "vegetarian",
  "vegan",
  "varies",
];
const SPICE: readonly SpiceLevel[] = [
  "none",
  "mild",
  "medium",
  "hot",
  "varies",
];

export type ExplainFailureCode =
  | "not_configured"
  | "photo_rejected"
  | "rate_limited"
  | "upstream_error"
  | "unreadable_response";

export class ExplainError extends Error {
  readonly code: ExplainFailureCode;
  readonly retryAfterSeconds: number | null;
  readonly usage: { inputTokens: number; outputTokens: number } | null;

  constructor(
    code: ExplainFailureCode,
    message: string,
    options: {
      retryAfterSeconds?: number | null;
      usage?: { inputTokens: number; outputTokens: number } | null;
    } = {},
  ) {
    super(message);
    this.name = "ExplainError";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.usage = options.usage ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Schemas                                                                    */
/* -------------------------------------------------------------------------- */

const ALLERGEN_SCHEMA = {
  type: "array",
  maxItems: 8,
  description:
    "Allergens this dish is normally or sometimes made with. Judge the dish as it is usually cooked, not this kitchen. Leave it empty rather than listing something far-fetched.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["key", "likelihood", "from"],
    properties: {
      key: { type: "string", enum: [...ALLERGEN_KEYS] },
      likelihood: {
        type: "string",
        enum: ["usually", "sometimes"],
        description:
          "'usually' when the standard recipe has it, 'sometimes' when it varies by kitchen or region.",
      },
      from: {
        type: "string",
        description:
          "The part of the dish it comes from, in three or four words, e.g. 'the peanut sauce'. This is what someone will point at when they ask their server.",
      },
    },
  },
} as const;

const SUMMARY_PROPERTIES = {
  printedName: {
    type: "string",
    description: "The dish name exactly as printed, in its own language.",
  },
  englishName: {
    type: "string",
    description:
      "What English speakers call it, or a plain translation. Empty string if the printed name is already English.",
  },
  oneLine: {
    type: "string",
    description:
      "One short sentence saying what arrives. Plain words, no menu-speak, under about twenty words.",
  },
  priceText: {
    type: "string",
    description:
      "The price exactly as printed, with its symbol. Empty string if none is shown.",
  },
  course: { type: "string", enum: [...COURSES] },
  dietary: { type: "string", enum: [...DIETARY] },
  spice: { type: "string", enum: [...SPICE] },
  likelyAllergens: ALLERGEN_SCHEMA,
  recognised: {
    type: "boolean",
    description:
      "False if you do not actually know this dish. Say so rather than inventing something plausible.",
  },
} as const;

const SUMMARY_REQUIRED = [
  "printedName",
  "englishName",
  "oneLine",
  "priceText",
  "course",
  "dietary",
  "spice",
  "likelyAllergens",
  "recognised",
];

const MENU_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["looksLikeMenu", "language", "notes", "dishes"],
  properties: {
    looksLikeMenu: { type: "boolean" },
    language: {
      type: "string",
      description: "The language the menu is written in, named in English.",
    },
    notes: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
      description:
        "Problems with the photo itself: glare, a column cut off, handwriting you could not read. Empty when it is clean.",
    },
    dishes: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        required: SUMMARY_REQUIRED,
        properties: SUMMARY_PROPERTIES,
      },
    },
  },
} as const;

const DISH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    ...SUMMARY_REQUIRED,
    "whatItIs",
    "tastesLike",
    "origin",
    "madeWith",
    "servedAs",
  ],
  properties: {
    ...SUMMARY_PROPERTIES,
    whatItIs: {
      type: "string",
      description:
        "Two or three sentences: what actually arrives on the plate and what it is made of.",
    },
    tastesLike: {
      type: "string",
      description:
        "Flavour and texture, one sentence, in words a twelve-year-old would use.",
    },
    origin: {
      type: "string",
      description:
        "Where the dish comes from, a few words. Empty string if it has no particular home.",
    },
    madeWith: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
      description: "The main things in it, in plain English.",
    },
    servedAs: {
      type: "string",
      description:
        "How it turns up: 'a shared bowl', 'on a skewer', 'one large plate'. A few words.",
    },
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  Prompts                                                                    */
/* -------------------------------------------------------------------------- */

const VOICE = `You explain restaurant dishes to someone standing in front of a menu they cannot read. They may be twelve, or abroad, or both.

Write the way a well-travelled friend would explain it across the table:

- Plain words. "Raw fish on rice", not "delicate crudo preparation".
- Say what actually arrives. If it is a whole fish with the head on, say so. If it is offal, say so. People would rather know.
- Do not sell it. You are not writing the menu, you are translating it.
- If you do not know a dish, set recognised to false and say so in oneLine. A confident invention is worse than an honest "I do not know this one".

On allergies, which is why some people are reading this at all:

- Say what the dish is NORMALLY made with. "Usually" for the standard recipe, "sometimes" when it varies by kitchen or region.
- You have no way of knowing what this particular kitchen did, and the app tells the reader so. Your job is the normal case.
- Name where it comes from in the dish, so they can point at it and ask.
- Do not pad the list with far-fetched possibilities. A list of eight allergens for a green salad is noise, and noise is what gets ignored on the day it matters.`;

/* -------------------------------------------------------------------------- */
/*  Validation                                                                 */
/* -------------------------------------------------------------------------- */

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normaliseAllergens(raw: unknown): LikelyAllergen[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LikelyAllergen[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const key = record.key;
    if (
      typeof key !== "string" ||
      !(ALLERGEN_KEYS as readonly string[]).includes(key) ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    out.push({
      key: key as AllergenKey,
      likelihood: oneOf<Likelihood>(
        record.likelihood,
        ["usually", "sometimes"],
        "sometimes",
      ),
      from: text(record.from, 60),
    });
  }
  return out;
}

function normaliseSummary(raw: unknown): DishSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const printedName = text(record.printedName, 120);
  if (printedName.length < 2) return null;

  return {
    printedName,
    englishName: text(record.englishName, 120),
    oneLine: text(record.oneLine, 300),
    priceText: text(record.priceText, 40),
    course: oneOf<MenuCategory>(record.course, COURSES, "mains"),
    dietary: oneOf<Dietary>(record.dietary, DIETARY, "varies"),
    spice: oneOf<SpiceLevel>(record.spice, SPICE, "none"),
    likelyAllergens: normaliseAllergens(record.likelyAllergens),
    recognised: record.recognised !== false,
  };
}

/* -------------------------------------------------------------------------- */
/*  The calls                                                                  */
/* -------------------------------------------------------------------------- */

export function isConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let cached: Anthropic | null = null;

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new ExplainError(
      "not_configured",
      "This app is not switched on yet.",
    );
  }
  cached ??= new Anthropic({ apiKey, maxRetries: 2 });
  return cached;
}

interface CallResult {
  parsed: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

async function call(
  schema: Record<string, unknown>,
  system: string,
  content: Anthropic.ContentBlockParam[],
  maxTokens: number,
): Promise<CallResult> {
  let message;
  try {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content }],
    });
    message = await stream.finalMessage();
  } catch (error) {
    throw toExplainError(error);
  }

  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };

  if (message.stop_reason === "max_tokens") {
    throw new ExplainError(
      "unreadable_response",
      "That menu is longer than this can read in one go. Try one page or one section at a time.",
      { usage },
    );
  }

  const body = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  try {
    return { parsed: JSON.parse(body), usage };
  } catch {
    throw new ExplainError(
      "unreadable_response",
      "Something went wrong reading that. Try again.",
      { usage },
    );
  }
}

export interface MenuPhoto {
  bytes: Uint8Array;
  mediaType: VisionMediaType;
}

export interface MenuReadingResult extends MenuReading {
  usage: { inputTokens: number; outputTokens: number };
}

/** Reads a photographed menu and says what each dish is. */
export async function readMenuPhoto(
  photo: MenuPhoto,
): Promise<MenuReadingResult> {
  if (photo.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new ExplainError(
      "photo_rejected",
      `That photo is ${(photo.bytes.byteLength / 1024 / 1024).toFixed(1)} MB. Try one under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`,
    );
  }

  const { parsed, usage } = await call(
    MENU_SCHEMA,
    VOICE,
    [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: photo.mediaType,
          data: Buffer.from(photo.bytes).toString("base64"),
        },
      },
      {
        type: "text",
        text: "Here is a menu. Read every dish on it and tell me what each one is. Keep the names exactly as printed, and give me the English name alongside.",
      },
    ],
    16000,
  );

  const body = (parsed ?? {}) as Record<string, unknown>;
  const looksLikeMenu = body.looksLikeMenu === true;

  return {
    looksLikeMenu,
    language: text(body.language, 40) || "English",
    notes: Array.isArray(body.notes)
      ? body.notes.map((n) => text(n, 200)).filter(Boolean).slice(0, 5)
      : [],
    dishes: looksLikeMenu
      ? dedupe(
          (Array.isArray(body.dishes) ? body.dishes : [])
            .map(normaliseSummary)
            .filter((dish): dish is DishSummary => dish !== null),
        )
      : [],
    usage,
  };
}

function dedupe(dishes: DishSummary[]): DishSummary[] {
  const seen = new Set<string>();
  return dishes.filter((dish) => {
    const key = dish.printedName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface DishExplanationResult extends DishExplanation {
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Explains one dish by name.
 *
 * `context` is whatever else was on the menu line, which is what separates a
 * "Margherita" at a pizzeria from one at a cocktail bar.
 */
export async function explainDish(
  name: string,
  context = "",
): Promise<DishExplanationResult> {
  const asked = name.trim().slice(0, 120);

  const { parsed, usage } = await call(
    DISH_SCHEMA,
    VOICE,
    [
      {
        type: "text",
        text: context
          ? `What is "${asked}"? It was on a menu, described as: ${context.slice(0, 300)}`
          : `What is "${asked}"? Someone typed it in, so it may be misspelled, missing its accents, or half-remembered. Answer for the dish they most likely mean, and put its proper name and spelling in printedName so they can see how it is really written.`,
      },
    ],
    4000,
  );

  const body = (parsed ?? {}) as Record<string, unknown>;
  // Falls back to what they typed if the model returned nothing usable, so a
  // dish always has a name on screen.
  const summary =
    normaliseSummary(body) ?? normaliseSummary({ ...body, printedName: asked });

  if (!summary) {
    throw new ExplainError(
      "unreadable_response",
      "Something went wrong looking that up. Try again.",
    );
  }

  return {
    ...summary,
    whatItIs: text(body.whatItIs, 800),
    tastesLike: text(body.tastesLike, 300),
    origin: text(body.origin, 80),
    madeWith: Array.isArray(body.madeWith)
      ? body.madeWith.map((m) => text(m, 60)).filter(Boolean).slice(0, 8)
      : [],
    servedAs: text(body.servedAs, 80),
    usage,
  };
}

/* -------------------------------------------------------------------------- */
/*  Errors                                                                     */
/* -------------------------------------------------------------------------- */

function toExplainError(error: unknown): ExplainError {
  if (error instanceof ExplainError) return error;

  if (error instanceof Anthropic.RateLimitError) {
    const header = error.headers?.get("retry-after");
    const seconds = header ? Number(header) : NaN;
    return new ExplainError("rate_limited", "Very busy right now. Try again in a moment.", {
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : null,
    });
  }

  if (error instanceof Anthropic.AuthenticationError) {
    console.error("[dish/explain] API key rejected", error.message);
    return new ExplainError("not_configured", "This app is not switched on yet.");
  }

  if (error instanceof Anthropic.BadRequestError) {
    console.error("[dish/explain] request rejected", error.message);
    return new ExplainError(
      "photo_rejected",
      "That photo could not be read. Try a JPEG or PNG, taken straight on.",
    );
  }

  if (error instanceof Anthropic.APIError) {
    console.error("[dish/explain] upstream error", error.message);
    return new ExplainError("upstream_error", "That did not work. Try again in a moment.");
  }

  console.error("[dish/explain] unexpected failure", error);
  return new ExplainError("upstream_error", "That did not work. Try again in a moment.");
}
