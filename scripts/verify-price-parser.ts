/**
 * Checks the menu price parser against the ways prices actually appear on
 * menus. Run with `npm run verify:prices`.
 */

import { formatMinor, parseMenuPrice } from "../lib/vision/price";

let passed = 0;
const failures: string[] = [];

function check(
  input: string,
  expectedMinor: number | null,
  expectedCurrency: string,
) {
  const result = parseMenuPrice(input);
  const ok =
    result.amountMinor === expectedMinor &&
    result.currency === expectedCurrency;
  if (ok) {
    passed += 1;
  } else {
    failures.push(
      `${JSON.stringify(input)} → ${result.amountMinor} ${result.currency}` +
        ` (expected ${expectedMinor} ${expectedCurrency})`,
    );
  }
}

/* ---- plain British menu prices ------------------------------------------ */
check("£14.50", 1450, "GBP");
check("£14", 1400, "GBP");
check("14.50", 1450, "unknown");
check("£8.00", 800, "GBP");
check("  £24.95  ", 2495, "GBP");
check("£0.50", 50, "GBP");

/* ---- other currencies ---------------------------------------------------- */
check("€18,50", 1850, "EUR");
check("$22.00", 2200, "USD");
check("18.50 EUR", 1850, "EUR");
check("GBP 9.25", 925, "GBP");

/* ---- separator ambiguity -------------------------------------------------- */
// Both of these parse cleanly to 125000 minor units, which is over the
// extraction cap — a thousand-pound dish is far likelier an OCR slip than a
// real listing, and a reviewer can always type it in by hand.
check("£1,250.00", null, "GBP");
check("€1.250,00", null, "EUR");
check("14,50", 1450, "unknown"); // European decimal comma
check("£14.5", 1450, "GBP"); // one decimal place
check("£145", 14500, "GBP");

/* ---- things that are not a single price ----------------------------------- */
check("", null, "unknown");
check("market price", null, "unknown");
check("£12 / £18", null, "GBP"); // two sizes — reviewer decides
check("8.50 – 14.00", null, "unknown");
check("£10,000.00", null, "GBP"); // implausible
check("Ask your server", null, "unknown");

/* ---- the cap boundary ------------------------------------------------------ */
check("£1000.00", 100000, "GBP"); // exactly at the cap, allowed
check("£1000.01", null, "GBP"); // one penny over, rejected

/* ---- notes are set where a human has to intervene -------------------------- */
{
  const twoSizes = parseMenuPrice("£12 / £18");
  if (twoSizes.note) passed += 1;
  else failures.push("£12 / £18 should carry a note explaining the ambiguity");

  const clean = parseMenuPrice("£14.50");
  if (clean.note === null) passed += 1;
  else failures.push("a clean price should carry no note");
}

/* ---- formatting round-trips ------------------------------------------------ */
{
  const cases: [number, "GBP" | "EUR" | "USD" | "unknown", string][] = [
    [1450, "GBP", "£14.50"],
    [800, "EUR", "€8.00"],
    [2200, "USD", "$22.00"],
    [50, "unknown", "0.50"],
  ];
  for (const [minor, currency, expected] of cases) {
    const actual = formatMinor(minor, currency);
    if (actual === expected) passed += 1;
    else failures.push(`formatMinor(${minor}, ${currency}) → ${actual}`);
  }
}

/* ---- report ---------------------------------------------------------------- */
console.log(`price parser: ${passed} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
