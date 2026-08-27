import { ALLERGEN_CATALOG } from "@/lib/allergens";
import type { LikelyAllergen } from "@/lib/dish/types";
import type { AllergenKey } from "@/lib/types";

/**
 * Matching a dish against what somebody avoids.
 *
 * Done on the phone, against a list that never leaves it. The wording is here
 * rather than in a component because every screen has to say it the same way,
 * and because the one thing it must never say is "contains".
 */

export function clashesWith(
  dish: { likelyAllergens: readonly LikelyAllergen[] },
  avoid: readonly AllergenKey[],
): LikelyAllergen[] {
  const avoided = new Set(avoid);
  return dish.likelyAllergens.filter((entry) => avoided.has(entry.key));
}

export type Verdict = "clash" | "maybe" | "clear" | "unknown";

/**
 * How strongly to shout.
 *
 * "clear" is a claim, and there are two ways to fail to have earned it. An
 * empty profile has nothing to check against. A dish the model did not
 * recognise has an empty allergen list because it does not know, not because
 * there is nothing there — showing a green tick on that would be the app's
 * single worst possible lie. Both come back "unknown", which the pill renders
 * as a question rather than a reassurance.
 */
export function verdictFor(
  clashes: readonly LikelyAllergen[],
  hasProfile: boolean,
  recognised = true,
): Verdict {
  if (clashes.length > 0) {
    return clashes.some((entry) => entry.likelihood === "usually")
      ? "clash"
      : "maybe";
  }
  if (!hasProfile || !recognised) return "unknown";
  return "clear";
}

/**
 * "Usually made with peanuts and dairy, sometimes has sesame".
 *
 * The two likelihoods stay in separate clauses on purpose. Collapsing them
 * into one list makes a maybe read like a certainty, and that is how somebody
 * stops trusting the warnings before the day one matters.
 */
export function clashSentence(clashes: readonly LikelyAllergen[]): string {
  const names = (entries: readonly LikelyAllergen[]) =>
    entries
      .map((entry) => ALLERGEN_CATALOG[entry.key].label.toLowerCase())
      .join(" and ");

  const usually = clashes.filter((entry) => entry.likelihood === "usually");
  const sometimes = clashes.filter((entry) => entry.likelihood === "sometimes");

  const parts: string[] = [];
  if (usually.length) parts.push(`usually made with ${names(usually)}`);
  if (sometimes.length) parts.push(`sometimes has ${names(sometimes)}`);

  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The short form, for a pill with no room for a sentence. */
export function clashChip(clashes: readonly LikelyAllergen[]): string {
  const unique = [
    ...new Set(
      clashes.map((entry) => ALLERGEN_CATALOG[entry.key].label.toLowerCase()),
    ),
  ];
  if (unique.length === 1) return unique[0] ?? "";
  if (unique.length === 2) return unique.join(" + ");
  return `${unique.length} of yours`;
}
