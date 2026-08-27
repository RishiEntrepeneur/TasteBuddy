import {
  bestContrast,
  canCarryText,
  contrastRatio,
  parseHex,
  readableInk,
} from "@/lib/brand";

/**
 * Checking a venue before it exists.
 *
 * Onboarding is the one moment where getting a field wrong is expensive later:
 * the slug ends up printed on every table, and the brand colours end up under
 * the text of a menu somebody is reading to decide whether they can safely eat.
 * Both are checked here rather than left to be discovered.
 */

export interface VenueDraft {
  slug: string;
  name: string;
  tagline: string;
  currency: string;
  locale: string;
  primaryColor: string;
  accentColor: string;
}

export type VenueValidation =
  | { ok: true; draft: VenueDraft; warnings: string[] }
  | { ok: false; field: keyof VenueDraft | "body"; message: string };

/**
 * Slugs that would shadow a route.
 *
 * `/restaurant/<slug>` is its own segment so nothing here can actually
 * collide today, but a venue called "api" or "admin" is a trap laid for the
 * first person to move the diner menu to the root.
 */
const RESERVED_SLUGS = new Set([
  "api",
  "admin",
  "assets",
  "favicon",
  "profile",
  "restaurant",
  "robots",
  "saved",
  "sitemap",
  "static",
  "_next",
]);

const SLUG_FORMAT = /^[a-z0-9][a-z0-9-]{1,62}$/;
const HEX_FORMAT = /^#[0-9a-f]{6}$/i;

/** A venue name to a slug candidate, the way the form suggests one. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * Real ISO 4217 codes only.
 *
 * `Intl.NumberFormat` is not the check it looks like: it accepts any
 * well-formed three-letter code and quietly prints it verbatim, so "XYZ" would
 * have sailed through and shipped a menu priced in XYZ.
 */
const CURRENCIES: ReadonlySet<string> = new Set(
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("currency")
    : // Older runtimes: the codes a European or North American venue is
      // realistically opening with, and nothing invented.
      ["GBP", "EUR", "USD", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK",
       "PLN", "CZK", "JPY", "SGD", "HKD", "AED", "ZAR", "INR", "VND"],
);

function isSupportedCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && CURRENCIES.has(code);
}

function isSupportedLocale(tag: string): boolean {
  try {
    // Both checks matter: `Intl.Locale` accepts a well-formed tag nobody has
    // data for, and the formatter is what actually renders a price.
    new Intl.Locale(tag);
    new Intl.NumberFormat(tag).format(1);
    return true;
  } catch {
    return false;
  }
}

function field(
  name: keyof VenueDraft,
  message: string,
): { ok: false; field: keyof VenueDraft; message: string } {
  return { ok: false, field: name, message };
}

/**
 * Validates a venue draft.
 *
 * Colours are the interesting part. A hex that parses is not the same as a
 * hex text can be read on, so each brand colour is measured against black and
 * white and rejected if neither clears AA. That check exists because white on
 * the sample venue's accent was 3.1:1 on the AR button of every dish, which
 * nobody noticed until it was measured.
 */
export function validateVenue(payload: Partial<VenueDraft>): VenueValidation {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    return field("name", "A venue needs a name between 2 and 120 characters.");
  }

  const slug =
    typeof payload.slug === "string" && payload.slug.trim()
      ? payload.slug.trim().toLowerCase()
      : slugify(name);

  if (!SLUG_FORMAT.test(slug)) {
    return field(
      "slug",
      "The web address can use lowercase letters, numbers and hyphens, and has to start with a letter or number.",
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    return field("slug", `"${slug}" is reserved. Pick another web address.`);
  }

  const tagline =
    typeof payload.tagline === "string" ? payload.tagline.trim().slice(0, 200) : "";

  const currency =
    typeof payload.currency === "string"
      ? payload.currency.trim().toUpperCase()
      : "";
  if (!isSupportedCurrency(currency)) {
    return field(
      "currency",
      "Use a three-letter currency code, like GBP, EUR or USD.",
    );
  }

  const locale = typeof payload.locale === "string" ? payload.locale.trim() : "";
  if (!isSupportedLocale(locale)) {
    return field(
      "locale",
      "Use a language tag, like en-GB, fr-FR or vi-VN. It decides how prices are written.",
    );
  }

  const warnings: string[] = [];
  const colours: [keyof VenueDraft, string][] = [
    ["primaryColor", typeof payload.primaryColor === "string" ? payload.primaryColor.trim() : ""],
    ["accentColor", typeof payload.accentColor === "string" ? payload.accentColor.trim() : ""],
  ];

  for (const [key, value] of colours) {
    if (!HEX_FORMAT.test(value) || !parseHex(value)) {
      return field(key, "Use a six-digit hex colour, like #1C1917.");
    }
    if (!canCarryText(value)) {
      return field(
        key,
        `Text has to sit on ${value.toUpperCase()}, and the best it manages is ${bestContrast(value).toFixed(1)}:1 against the two colours this app writes in. Go darker or lighter until it clears 4.5:1.`,
      );
    }
  }

  const primaryColor = colours[0][1].toLowerCase();
  const accentColor = colours[1][1].toLowerCase();

  // Not a rejection: the two can legitimately be close. But a header and a
  // primary action that read as one colour is usually a paste error.
  const between = contrastRatio(primaryColor, accentColor) ?? 1;
  if (between < 1.3) {
    warnings.push(
      "The header and accent colours are nearly identical, so the main action will not stand out from the header.",
    );
  }

  if (readableInk(accentColor) !== readableInk(primaryColor)) {
    warnings.push(
      `Text sits white on one of these and near-black on the other. That is fine, it just means the buttons will not match the header.`,
    );
  }

  return {
    ok: true,
    warnings,
    draft: {
      slug,
      name,
      tagline,
      currency,
      locale,
      primaryColor,
      accentColor,
    },
  };
}
