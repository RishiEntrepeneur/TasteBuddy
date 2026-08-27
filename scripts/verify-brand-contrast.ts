/**
 * Checks that every colour the app draws text on can actually carry it.
 *
 * The safety colours are the reason this exists: an alert nobody can read is
 * worse than no alert, and "it looks fine on my screen" is not a measurement.
 * Run with `npm run verify:contrast`.
 */

import { bestContrast, contrastRatio, readableInk } from "../lib/brand";
import { PALETTE } from "../lib/palette";

let passed = 0;
const failures: string[] = [];

function near(actual: number | null, expected: number, label: string) {
  if (actual !== null && Math.abs(actual - expected) < 0.05) passed += 1;
  else
    failures.push(
      `${label}: ${actual?.toFixed(2) ?? "null"} (expected ~${expected})`,
    );
}

/* ---- reference values the maths has to agree with ------------------------ */
near(contrastRatio("#ffffff", "#000000"), 21, "white on black");
near(contrastRatio("#ffffff", "#ffffff"), 1, "white on white");
near(contrastRatio("#fff", "#000"), 21, "short hex");

/* ---- the foreground picker ------------------------------------------------ */
{
  const cases: [string, string][] = [
    ["#e07a3f", "#1c1917"], // mid-tone orange wants dark text
    ["#1c1917", "#ffffff"],
    ["#ffffff", "#1c1917"],
    ["#0b3d2e", "#ffffff"],
    ["#f5e6c8", "#1c1917"],
  ];
  for (const [background, expected] of cases) {
    if (readableInk(background) === expected) passed += 1;
    else
      failures.push(
        `readableInk(${background}) = ${readableInk(background)}, expected ${expected}`,
      );
    const ratio = contrastRatio(background, readableInk(background)) ?? 0;
    if (ratio >= 4.5) passed += 1;
    else failures.push(`${background} best foreground is ${ratio.toFixed(2)}:1`);
  }
}

/* ---- malformed input never throws ----------------------------------------- */
for (const bad of ["", "nonsense", "#12", "#1234567", "rgb(1,2,3)"]) {
  if (contrastRatio(bad, "#ffffff") === null && readableInk(bad) === "#1c1917") {
    passed += 1;
  } else {
    failures.push(`malformed input ${JSON.stringify(bad)} was not handled`);
  }
}

/* ---- every palette colour can carry the text drawn on it ------------------- */
for (const [name, colour] of Object.entries(PALETTE)) {
  const best = bestContrast(colour);
  if (best >= 4.5) passed += 1;
  else failures.push(`${name} ${colour} tops out at ${best.toFixed(2)}:1`);

  // And on the page's own grounds, where these appear as text rather than fill.
  for (const [ground, label] of [
    ["#ffffff", "the card"],
    ["#f7f7f5", "the page"],
  ] as const) {
    const ratio = contrastRatio(colour, ground) ?? 0;
    if (ratio >= 4.5) passed += 1;
    else
      failures.push(
        `${name} ${colour} on ${label} is only ${ratio.toFixed(2)}:1`,
      );
  }
}

/* ---- report ---------------------------------------------------------------- */
console.log(`palette contrast: ${passed} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
