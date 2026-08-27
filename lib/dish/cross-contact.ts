import { ALLERGEN_CATALOG } from "@/lib/allergens";
import type { AllergenKey } from "@/lib/types";

/**
 * The risk no menu prints and no model can read.
 *
 * Everything else in this app is about what is *in* a dish. This is about what
 * gets into it on the way out of the kitchen: the fryer the chips share with
 * breaded fish, the grill the prawns came off, the board the bread was cut on.
 *
 * It is the most common way somebody with a real allergy actually gets hurt,
 * and it is invisible to a photograph. So it is not a guess and not a model
 * output: it is a standing, permanently true statement, shown to anyone who
 * avoids one of the allergens where trace exposure genuinely matters.
 *
 * It appears most importantly on the dishes that came back clear. "Nothing you
 * avoid" on a plate of chips is exactly the screen where somebody needs to be
 * told the fryer is shared.
 */

/**
 * Only the allergens where a trace does damage.
 *
 * Deliberately not all fourteen. A shared spoon is a real problem for peanut
 * anaphylaxis and coeliac disease, and is not why anybody avoids celery. Put
 * this on every allergen and it becomes a banner people scroll past, which
 * would cost exactly the readers it is here for.
 */
const MECHANISM: Partial<Record<AllergenKey, string>> = {
  gluten:
    "chips and breaded food usually go in the same fryer, and bread is cut on the same board",
  peanuts:
    "the same fryer oil, the same tongs, and a garnish scattered over the pass",
  tree_nuts:
    "the same fryer oil, and nuts scattered over dishes at the pass",
  shellfish:
    "prawns and fish come off the same grill and out of the same fryer",
  fish:
    "the same grill and fryer, and fish sauce turns up in things that do not mention it",
  sesame:
    "flour and seeds carry through a bakery, and tahini is on a lot of pass surfaces",
  molluscs:
    "the same grill and fryer as everything else from the sea",
};

export interface CrossContactNote {
  keys: AllergenKey[];
  /** One sentence naming what actually happens in a kitchen. */
  because: string;
}

/**
 * The note for this diner, or null when nothing they avoid carries the risk.
 *
 * Grouped into one line rather than one per allergen: three stacked warnings
 * saying almost the same thing is how a warning stops being read.
 */
export function crossContactFor(
  avoid: readonly AllergenKey[],
): CrossContactNote | null {
  const relevant = avoid.filter((key) => key in MECHANISM);
  if (relevant.length === 0) return null;

  // Longest mechanism first, so the group's line is the most concrete one.
  const lead = [...relevant].sort(
    (a, b) => (MECHANISM[b]?.length ?? 0) - (MECHANISM[a]?.length ?? 0),
  )[0] as AllergenKey;

  return { keys: relevant, because: MECHANISM[lead] ?? "" };
}

/** "gluten and peanuts" / "gluten, peanuts and shellfish". */
export function listAllergens(keys: readonly AllergenKey[]): string {
  const names = keys.map((key) => ALLERGEN_CATALOG[key].label.toLowerCase());
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
