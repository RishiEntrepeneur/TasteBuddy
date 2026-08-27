/**
 * Menu price parsing.
 *
 * The vision model transcribes the price exactly as it is printed and nothing
 * more; turning that string into pence happens here, in ordinary code. That
 * split is deliberate. Arithmetic is the one part of this job a language model
 * has no advantage at and a real failure mode in — a hallucinated `1450` looks
 * identical to a correct one, whereas a mistranscribed "£14.50" is visible to
 * the member of staff reviewing the import.
 *
 * Everything is returned in the smallest currency unit (pence, cents), which
 * is what `menu_items.price_cents` stores.
 */

export type PriceCurrency = "GBP" | "EUR" | "USD" | "unknown";

export interface ParsedPrice {
  /** Smallest currency unit. Null when nothing usable could be read. */
  amountMinor: number | null;
  currency: PriceCurrency;
  /** Set when the text was readable but not confidently a single price. */
  note: string | null;
}

const SYMBOL_CURRENCY: Readonly<Record<string, PriceCurrency>> = {
  "£": "GBP",
  "€": "EUR",
  $: "USD",
};

const CODE_CURRENCY: Readonly<Record<string, PriceCurrency>> = {
  GBP: "GBP",
  EUR: "EUR",
  USD: "USD",
};

/** Above this a "price" is almost certainly a phone number or a calorie count. */
const MAX_PLAUSIBLE_MINOR = 1_000_00;

function detectCurrency(text: string): PriceCurrency {
  for (const [symbol, currency] of Object.entries(SYMBOL_CURRENCY)) {
    if (text.includes(symbol)) return currency;
  }
  const code = text.toUpperCase().match(/\b(GBP|EUR|USD)\b/);
  if (code) return CODE_CURRENCY[code[1]];
  return "unknown";
}

/**
 * Reads one number out of a price fragment.
 *
 * Handles the separator ambiguity that actually shows up on menus: British and
 * American menus write `1,250.00`, much of Europe writes `1.250,00`, and both
 * write bare `12,50` or `12.50`. The rule used is that the *last* separator
 * followed by exactly two digits is the decimal point, and any separator
 * before it is a thousands mark.
 */
function readAmountMinor(fragment: string): number | null {
  const digits = fragment.replace(/[^\d.,]/g, "");
  if (!/\d/.test(digits)) return null;

  const decimalMatch = digits.match(/^(.*)[.,](\d{2})$/);

  let wholeText: string;
  let minorText: string;

  if (decimalMatch) {
    wholeText = decimalMatch[1] ?? "";
    minorText = decimalMatch[2] ?? "00";
  } else {
    wholeText = digits;
    minorText = "00";
  }

  // Whatever separators remain in the whole part are thousands marks. A stray
  // single one ("14.5" — a price written with one decimal place) is the
  // exception, and is treated as tenths.
  const strayDecimal = !decimalMatch && /^\d+[.,]\d$/.test(digits);
  if (strayDecimal) {
    const [whole = "0", tenths = "0"] = digits.split(/[.,]/);
    wholeText = whole;
    minorText = `${tenths}0`;
  } else {
    wholeText = wholeText.replace(/[.,]/g, "");
  }

  if (!wholeText) wholeText = "0";
  if (!/^\d+$/.test(wholeText)) return null;

  const minor = Number(wholeText) * 100 + Number(minorText);
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Parses a price as printed on a menu.
 *
 * Returns `amountMinor: null` rather than guessing whenever the text is not a
 * single unambiguous price — a dish that arrives with no price is obvious to
 * the reviewer, whereas a dish silently priced at zero is not.
 */
export function parseMenuPrice(raw: string | null | undefined): ParsedPrice {
  const text = (raw ?? "").trim();
  if (!text) return { amountMinor: null, currency: "unknown", note: null };

  const currency = detectCurrency(text);

  // "12 / 18" and "8.50 – 14.00" are one dish at two sizes. Taking either
  // number would misprice it, so the reviewer is asked instead.
  const numbers = text.match(/\d[\d.,]*/g) ?? [];
  if (numbers.length > 1) {
    return {
      amountMinor: null,
      currency,
      note: "More than one price is printed. Pick the one this dish lists at.",
    };
  }

  if (numbers.length === 0) {
    return {
      amountMinor: null,
      currency,
      note: "No price could be read.",
    };
  }

  const amountMinor = readAmountMinor(numbers[0] ?? "");
  if (amountMinor === null) {
    return { amountMinor: null, currency, note: "No price could be read." };
  }

  if (amountMinor > MAX_PLAUSIBLE_MINOR) {
    return {
      amountMinor: null,
      currency,
      note: "That price looks too large to be right. Check it against the menu.",
    };
  }

  return { amountMinor, currency, note: null };
}

/** Renders pence back to a human string for the review table. */
export function formatMinor(
  amountMinor: number,
  currency: PriceCurrency,
): string {
  const symbol =
    currency === "GBP"
      ? "£"
      : currency === "EUR"
        ? "€"
        : currency === "USD"
          ? "$"
          : "";
  return `${symbol}${(amountMinor / 100).toFixed(2)}`;
}
