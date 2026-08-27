/**
 * Runs a real menu photo through the real model and scores what comes back.
 *
 *     npm run try:menu                          # the bundled fixture
 *     npm run try:menu -- path/to/your-menu.jpg # your own photo
 *
 * This is the test the mocked ones cannot be. Everything up to here proves the
 * plumbing: that a photo reaches the model, that the schema is the shape we
 * meant, that a failure comes back as words somebody can act on. None of it
 * proves the thing that actually matters, which is whether the answers are any
 * good. That needs a real photo, a real call, and something to check it
 * against.
 *
 * Where a `<photo>.expected.json` sits beside the image, the run is scored
 * against it and the exit code says whether it passed. Where one does not, the
 * run just prints what came back for a person to read.
 */

import fs from "node:fs";
import path from "node:path";

import {
  explainDish,
  isConfigured,
  readMenuPhoto,
  type VisionMediaType,
} from "../lib/dish/explain";
import type { DishSummary } from "../lib/dish/types";

const DEFAULT_PHOTO = "fixtures/menu-photo.jpg";

interface Expected {
  note?: string;
  language: string;
  dishes: { name: string; price: string; englishHint: string[] }[];
  allergensItMustCatch: { dish: string; key: string; why: string }[];
  dietaryItShouldGet: { dish: string; dietary: string; why: string }[];
}

const MEDIA: Record<string, VisionMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/* -------------------------------------------------------------------------- */
/*  Comparing                                                                  */
/* -------------------------------------------------------------------------- */

/** Diacritics and case are display; a name matches when the letters do. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findDish(dishes: DishSummary[], name: string): DishSummary | null {
  const want = fold(name);
  return (
    dishes.find((dish) => fold(dish.printedName) === want) ??
    dishes.find(
      (dish) =>
        fold(dish.printedName).includes(want) ||
        want.includes(fold(dish.printedName)),
    ) ??
    null
  );
}

/** Digits only, so 85.000₫ and 85,000 VND and "85000" all agree. */
function digits(text: string): string {
  return text.replace(/\D/g, "");
}

const tick = (ok: boolean) => (ok ? "  ok  " : " FAIL ");

/* -------------------------------------------------------------------------- */
/*  Run                                                                        */
/* -------------------------------------------------------------------------- */

async function main(): Promise<number> {
  if (!isConfigured()) {
    console.error(
      "\nNo ANTHROPIC_API_KEY, so there is nothing real to test against.\n\n" +
        "  export ANTHROPIC_API_KEY=sk-ant-...\n" +
        "  npm run try:menu\n\n" +
        "Get one at https://console.anthropic.com → Settings → API keys.\n" +
        "This run costs a fraction of a penny.\n",
    );
    return 2;
  }

  const photoPath = process.argv[2] ?? DEFAULT_PHOTO;
  if (!fs.existsSync(photoPath)) {
    console.error(`No such photo: ${photoPath}`);
    return 2;
  }

  const mediaType = MEDIA[path.extname(photoPath).toLowerCase()];
  if (!mediaType) {
    console.error(`${photoPath} is not a JPEG, PNG or WebP.`);
    return 2;
  }

  const bytes = new Uint8Array(fs.readFileSync(photoPath));
  console.log(
    `\nReading ${photoPath} (${(bytes.byteLength / 1024).toFixed(0)} KB)…\n`,
  );

  const started = Date.now();
  const reading = await readMenuPhoto({ bytes, mediaType });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `${reading.language} · ${reading.dishes.length} dishes · ${seconds}s · ` +
      `${reading.usage.inputTokens} in / ${reading.usage.outputTokens} out`,
  );
  for (const note of reading.notes) console.log(`  note: ${note}`);
  console.log();

  for (const dish of reading.dishes) {
    const allergens = dish.likelyAllergens
      .map((a) => `${a.key}/${a.likelihood}`)
      .join(" ");
    console.log(
      `  ${dish.printedName}\n` +
        `    ${dish.englishName || "(already English)"} · ${dish.priceText || "no price"} · ` +
        `${dish.course} · ${dish.dietary}${dish.recognised ? "" : " · NOT RECOGNISED"}\n` +
        `    ${dish.oneLine}` +
        (allergens ? `\n    ${allergens}` : ""),
    );
  }

  /* ---- scored, where there is something to score against ---------------- */

  const expectedPath = photoPath.replace(/\.[^.]+$/, ".expected.json");
  if (!fs.existsSync(expectedPath)) {
    console.log(
      `\nNo ${path.basename(expectedPath)} beside this photo, so nothing was scored.\n`,
    );
    return 0;
  }

  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as Expected;
  let passed = 0;
  const failures: string[] = [];

  console.log(`\n${"─".repeat(60)}\nScored against ${path.basename(expectedPath)}\n`);

  const langOk = fold(reading.language).includes(fold(expected.language));
  console.log(`${tick(langOk)} language is ${expected.language}`);
  if (langOk) passed += 1;
  else failures.push(`language came back "${reading.language}"`);

  console.log(`\n  Dishes\n`);
  for (const want of expected.dishes) {
    const got = findDish(reading.dishes, want.name);
    if (!got) {
      console.log(`${tick(false)} ${want.name} — missing entirely`);
      failures.push(`missed ${want.name}`);
      continue;
    }
    passed += 1;

    // The trap: prices sit on the line above their dish in this photo.
    const priceOk = digits(got.priceText) === digits(want.price);
    console.log(
      `${tick(priceOk)} ${want.name} · ${got.priceText || "no price"}` +
        (priceOk ? "" : ` (should be ${want.price})`),
    );
    if (priceOk) passed += 1;
    else {
      failures.push(
        `${want.name} priced ${got.priceText || "nothing"}, not ${want.price}`,
      );
    }

    const english = fold(`${got.englishName} ${got.oneLine}`);
    const englishOk = want.englishHint.some((hint) => english.includes(fold(hint)));
    if (englishOk) passed += 1;
    else
      failures.push(
        `${want.name} translated as "${got.englishName}" — expected one of ${want.englishHint.join(", ")}`,
      );
  }

  const extra = reading.dishes.filter(
    (dish) => !expected.dishes.some((want) => findDish([dish], want.name)),
  );
  console.log(
    `\n${tick(extra.length === 0)} nothing invented` +
      (extra.length ? ` — got ${extra.map((d) => d.printedName).join(", ")}` : ""),
  );
  if (extra.length === 0) passed += 1;
  else failures.push(`invented ${extra.length} dish(es)`);

  console.log(`\n  Allergens it has to catch\n`);
  for (const want of expected.allergensItMustCatch) {
    const got = findDish(reading.dishes, want.dish);
    const hit = got?.likelyAllergens.find((a) => a.key === want.key);
    console.log(
      `${tick(Boolean(hit))} ${want.dish} → ${want.key}` +
        (hit ? ` (${hit.likelihood}, from ${hit.from})` : ` — ${want.why}`),
    );
    if (hit) passed += 1;
    else failures.push(`missed ${want.key} on ${want.dish}`);
  }

  console.log(`\n  Dietary\n`);
  for (const want of expected.dietaryItShouldGet) {
    const got = findDish(reading.dishes, want.dish);
    // Vegan satisfies a vegetarian expectation; the reverse does not.
    const ok =
      got?.dietary === want.dietary ||
      (want.dietary === "vegetarian" && got?.dietary === "vegan");
    console.log(
      `${tick(ok)} ${want.dish} is ${want.dietary}` +
        (ok ? "" : ` — came back ${got?.dietary ?? "missing"}`),
    );
    if (ok) passed += 1;
    else failures.push(`${want.dish} came back ${got?.dietary}`);
  }

  /* ---- and one dish opened in full -------------------------------------- */

  const sample = reading.dishes[0];
  if (sample) {
    console.log(`\n${"─".repeat(60)}\nOpening "${sample.printedName}"\n`);
    const full = await explainDish(
      sample.printedName,
      `${sample.englishName} ${sample.oneLine}`,
    );
    console.log(`  ${full.englishName} · ${full.origin} · ${full.servedAs}`);
    console.log(`\n  ${full.whatItIs}`);
    console.log(`\n  Tastes like: ${full.tastesLike}`);
    console.log(`  Made with:   ${full.madeWith.join(", ")}`);
    for (const a of full.likelyAllergens) {
      console.log(`  ${a.likelihood.padEnd(9)} ${a.key} — ${a.from}`);
    }
    console.log(
      `\n  ${full.usage.inputTokens} in / ${full.usage.outputTokens} out`,
    );

    const saysContains = /\bcontains\b/i.test(
      JSON.stringify(full.likelyAllergens),
    );
    console.log(
      `\n${tick(!saysContains)} no allergen claims certainty about this kitchen`,
    );
    if (saysContains) {
      failures.push("an allergen came back phrased as a certainty");
    } else {
      passed += 1;
    }
  }

  /* ---- verdict ----------------------------------------------------------- */

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed} checks passed`);
  if (failures.length) {
    console.log(`\n${failures.length} failed:`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    return 1;
  }
  console.log("\nEverything the photo says, the app got.\n");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error("\nThe run itself failed:\n", error);
    process.exit(2);
  },
);
