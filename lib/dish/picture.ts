/**
 * A drawing of a dish.
 *
 * The 3D model on the dish screen is built out of the dish's own words, and
 * that has a ceiling: it can tell a roll from a flatbread from a bowl of soup,
 * and it will never look like food. This fetches a picture instead.
 *
 * ── Why a drawing and not a photograph ─────────────────────────────────────
 *
 * Everything else in this app is built so that a guess cannot be mistaken for
 * a fact, and an image is the easiest place to lose that. A photorealistic
 * plate of food, sitting directly above a line about peanuts, is read as *this
 * restaurant's plate* — which nobody has seen. So the prompt asks for an
 * illustration and says so on the screen. A drawing is obviously a drawing.
 *
 * Nothing is drawn at all for a dish the model did not recognise, for the same
 * reason the 3D leaves the plate empty: a picture is believed faster than a
 * sentence.
 */

/**
 * Where the drawings come from. Free, no key, no account.
 *
 * Overridable so the run can be pointed at a different generator, or at a
 * stand-in — this app cannot verify a service it is not allowed to reach.
 */
function host(): string {
  const override = process.env.DISH_IMAGE_HOST?.trim();
  return override && override.length > 0
    ? override
    : "https://image.pollinations.ai/prompt/";
}

/** Long enough to be recognisable in a card, small enough to arrive quickly. */
export const PICTURE_WIDTH = 768;
export const PICTURE_HEIGHT = 576;

/** Pollinations is free, and free things are sometimes slow. */
export const PICTURE_TIMEOUT_MS = 20_000;

export class PictureError extends Error {
  constructor(
    readonly code: "bad_name" | "upstream" | "timeout" | "off",
    message: string,
  ) {
    super(message);
    this.name = "PictureError";
  }
}

/** Off by setting `DISH_IMAGES=off`; on otherwise. */
export function picturesEnabled(): boolean {
  return process.env.DISH_IMAGES?.trim().toLowerCase() !== "off";
}

/**
 * Strips a dish name down to something safe to put in a prompt.
 *
 * The name reaches this from the model, which read it off a photograph of a
 * menu somebody else printed — so it is not trusted input, and it is about to
 * be concatenated into an instruction for another generator. Letters, digits,
 * spaces and the punctuation that appears inside real dish names survive;
 * everything else, newlines included, does not.
 *
 * `\p{M}` is in there with `\p{L}` and is not optional: the vowel signs in
 * मसाला दोसा are combining marks rather than letters, and dropping them turns
 * a dish name into मस ल द स. The same goes for Thai, and for Arabic and Hebrew
 * pointing.
 *
 * A run of hyphens collapses to one. A single hyphen belongs in plenty of real
 * names; a double is how several image generators are told to take an
 * instruction, and no menu has ever printed one.
 */
export function cleanDishName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}\s'’\-()]/gu, " ")
    .replace(/-{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Same dish, same drawing, every time and for everybody. */
function seedFor(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The instruction, which is mostly a list of things not to draw.
 *
 * No text, because a generator asked for food writes gibberish letters on the
 * plate and a diner reading a menu they cannot read does not need more of
 * those. No hands and no people, because the dish is the subject. And "flat
 * illustration" rather than any photographic word, for the reason at the top.
 */
export function promptFor(dish: string): string {
  return [
    `${dish}, a single serving of the dish on a plain plate`,
    "flat illustration, gouache and coloured pencil, soft matte colour",
    "three-quarter view from slightly above, centred, plain warm neutral background",
    "no text, no words, no letters, no logo, no people, no hands, no menu",
  ].join(", ");
}

export interface Picture {
  bytes: ArrayBuffer;
  mediaType: string;
}

/** Fetches the drawing. Throws `PictureError`; the caller falls back to the 3D. */
export async function drawDish(dish: string): Promise<Picture> {
  if (!picturesEnabled()) {
    throw new PictureError("off", "Dish pictures are switched off.");
  }

  const name = cleanDishName(dish);
  if (name.length < 2) {
    throw new PictureError("bad_name", "That is not a dish name.");
  }

  const url = new URL(host() + encodeURIComponent(promptFor(name)));
  url.searchParams.set("width", String(PICTURE_WIDTH));
  url.searchParams.set("height", String(PICTURE_HEIGHT));
  url.searchParams.set("seed", String(seedFor(name)));
  url.searchParams.set("nologo", "true");
  // No referrer, no account, nothing about the diner: only the dish's name
  // leaves, and it came off a printed menu in the first place.
  url.searchParams.set("safe", "true");

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PICTURE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { signal: abort.signal, cache: "no-store" });
  } catch (error) {
    throw new PictureError(
      abort.signal.aborted ? "timeout" : "upstream",
      abort.signal.aborted
        ? "The drawing took too long."
        : `Could not reach the drawing service: ${String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new PictureError("upstream", `Drawing service said ${response.status}.`);
  }

  const mediaType = response.headers.get("content-type") ?? "";
  if (!mediaType.startsWith("image/")) {
    throw new PictureError("upstream", `Drawing service sent ${mediaType || "nothing"}.`);
  }

  return { bytes: await response.arrayBuffer(), mediaType };
}
