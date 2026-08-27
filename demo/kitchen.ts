import type { DishExplanation, DishSummary } from "@/lib/dish/types";

import { DISHES, type DemoDish } from "./dishes";

/**
 * The server, for a build that has none.
 *
 * A published page cannot reach any host, so this stands in front of `fetch`
 * and answers the app's two endpoints out of `dishes.ts`. Nothing in
 * `components/` or `lib/` is modified or even aware of it: the app posts to
 * /api/explain exactly as it always does, and something answers.
 *
 * Two things are deliberately *not* faked. A dish that is not in the library
 * comes back `recognised: false` rather than invented, which is the same
 * answer the real model gives for a dish it does not know and which the
 * screens already handle. And the photo endpoint does not pretend to have read
 * your photo — it returns a fixed menu and says so in `notes`, which the menu
 * screen prints at the top.
 */

const SAMPLE_MENU_NOTE =
  "This copy has no way to reach the model, so it cannot read your photo. This is a fixed sample menu.";

/** Lower-cased, diacritics stripped, punctuation dropped. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Indexed {
  dish: DemoDish;
  keys: string[];
}

const INDEX: Indexed[] = DISHES.map((dish) => ({
  dish,
  keys: [dish.printedName, dish.englishName, ...dish.aliases]
    .filter(Boolean)
    .map(fold),
}));

/**
 * Finds a dish by name.
 *
 * Exact match first, then "the typed name is one of the known names with
 * something extra around it" — "chicken pad thai", "a plate of hummus". No
 * fuzzier than that: guessing which dish somebody meant is exactly the kind of
 * confident wrongness the app is built to avoid.
 */
export function findDish(typed: string): DemoDish | null {
  const wanted = fold(typed);
  if (wanted.length < 2) return null;

  for (const entry of INDEX) {
    if (entry.keys.includes(wanted)) return entry.dish;
  }
  for (const entry of INDEX) {
    if (entry.keys.some((key) => key.length >= 4 && wanted.includes(key))) {
      return entry.dish;
    }
  }
  return null;
}

/** What the app is told about a dish nobody here knows. */
function unknown(typed: string): DishExplanation {
  return {
    printedName: typed.slice(0, 60),
    englishName: "",
    oneLine:
      "This copy does not know this dish. It carries a fixed list of dishes rather than asking anything, so it cannot look this one up.",
    priceText: "",
    course: "mains",
    dietary: "varies",
    spice: "varies",
    recognised: false,
    likelyAllergens: [],
    whatItIs: "",
    tastesLike: "",
    origin: "",
    madeWith: [],
    servedAs: "",
  };
}

/** The menu the camera button returns, since it cannot read a real one. */
const SAMPLE: DishSummary[] = [
  "Bún chả",
  "Gỏi cuốn",
  "Phở bò",
  "Bánh mì",
].map((name, index) => {
  const dish = findDish(name);
  if (!dish) throw new Error(`sample menu names a dish that is not in the library: ${name}`);
  const prices = ["85.000₫", "45.000₫", "70.000₫", "35.000₫"];
  const { aliases: _aliases, ...rest } = dish;
  return { ...rest, priceText: prices[index] ?? "" };
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** How long a real lookup feels, so the loading states are not skipped past. */
const THINKING_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function installLocalKitchen(): void {
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url;

    if (url.includes("/api/explain")) {
      await wait(THINKING_MS);
      let name = "";
      try {
        name = (JSON.parse(String(init?.body ?? "{}")) as { name?: string }).name ?? "";
      } catch {
        return json({ error: { code: "malformed_body", message: "Body was not valid JSON." } }, 400);
      }
      const dish = findDish(name);
      if (!dish) return json(unknown(name));
      const { aliases: _aliases, ...rest } = dish;
      return json(rest);
    }

    if (url.includes("/api/read-menu")) {
      await wait(THINKING_MS * 2);
      return json({ language: "Vietnamese", dishes: SAMPLE, notes: [SAMPLE_MENU_NOTE] });
    }

    return original(input as RequestInfo, init);
  };
}
