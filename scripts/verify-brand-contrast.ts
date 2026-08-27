/**
 * Checks that every venue's brand colours carry readable text, and that the
 * contrast maths agrees with the values the palette was designed against.
 * Run with `npm run verify:contrast`.
 */

import { canCarryText, contrastRatio, readableInk } from "../lib/brand";
import { SEED_RESTAURANTS } from "../lib/db/seed";

let passed = 0;
const failures: string[] = [];

function near(actual: number | null, expected: number, label: string) {
  if (actual !== null && Math.abs(actual - expected) < 0.05) {
    passed += 1;
  } else {
    failures.push(`${label}: ${actual?.toFixed(2) ?? "null"} (expected ~${expected})`);
  }
}

/* ---- known reference values ---------------------------------------------- */
near(contrastRatio("#ffffff", "#000000"), 21, "white on black");
near(contrastRatio("#ffffff", "#ffffff"), 1, "white on white");
// The allergen palette, measured when it was chosen.
near(contrastRatio("#9c3b2e", "#ffffff"), 6.82, "white on terracotta");
near(contrastRatio("#5f6d50", "#ffffff"), 5.54, "white on sage");
near(contrastRatio("#9c3b2e", "#fdfbf7"), 6.6, "terracotta on alabaster");

/* ---- the foreground picker ------------------------------------------------ */
{
  const cases: [string, string][] = [
    ["#e07a3f", "#1c1917"], // mid-tone orange wants dark text
    ["#1c1917", "#ffffff"], // obsidian wants white
    ["#ffffff", "#1c1917"],
    ["#0b3d2e", "#ffffff"], // deep green wants white
    ["#f5e6c8", "#1c1917"], // pale cream wants dark
  ];
  for (const [background, expected] of cases) {
    const actual = readableInk(background);
    if (actual === expected) passed += 1;
    else failures.push(`readableInk(${background}) = ${actual}, expected ${expected}`);
  }

  // Whatever it picks must actually pass AA.
  for (const [background] of cases) {
    const ratio = contrastRatio(background, readableInk(background)) ?? 0;
    if (ratio >= 4.5) passed += 1;
    else failures.push(`${background} best foreground is only ${ratio.toFixed(2)}:1`);
  }
}

/* ---- malformed input does not throw --------------------------------------- */
{
  for (const bad of ["", "nonsense", "#12", "#1234567", "rgb(1,2,3)"]) {
    if (contrastRatio(bad, "#ffffff") === null && readableInk(bad) === "#1c1917") {
      passed += 1;
    } else {
      failures.push(`malformed input ${JSON.stringify(bad)} was not handled`);
    }
  }
  // Short hex is valid and must parse.
  near(contrastRatio("#fff", "#000"), 21, "short hex");
}

/* ---- every seeded venue can be read --------------------------------------- */
for (const restaurant of SEED_RESTAURANTS) {
  for (const [name, colour] of [
    ["primary", restaurant.branding.primaryColor],
    ["accent", restaurant.branding.accentColor],
  ] as const) {
    if (canCarryText(colour)) {
      passed += 1;
    } else {
      failures.push(
        `${restaurant.slug} ${name} ${colour} cannot carry body text at AA`,
      );
    }
    const ratio = contrastRatio(colour, readableInk(colour)) ?? 0;
    if (ratio >= 4.5) passed += 1;
    else failures.push(`${restaurant.slug} ${name} ${colour} → ${ratio.toFixed(2)}:1`);
  }
}

console.log(`brand contrast: ${passed} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
