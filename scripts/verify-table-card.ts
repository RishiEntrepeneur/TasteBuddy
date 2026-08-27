/**
 * Proves the table card's QR code actually decodes.
 *
 * A code that renders but does not scan is a silent failure that only surfaces
 * when a diner is standing at a table holding a phone, so it is checked here:
 * the card is rasterised the way a printer would, and read back with an
 * independent decoder. Run with `npm run verify:qr`.
 */

import jsQR from "jsqr";

import { renderTableCard } from "../lib/onboarding/table-card";

let passed = 0;
const failures: string[] = [];

/**
 * Rasterises the symbol straight from the module grid at a given scale, which
 * is what a printer resolves the vector path to. Rendering the SVG through a
 * browser would test the browser; this tests the geometry.
 */
function rasterise(
  svg: string,
  scale: number,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  // The symbol is one path of `M x y h s v s h-s z` subpaths on a translated
  // group; recover the module grid from it.
  const translate = svg.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
  const path = svg.match(/<path d="([^"]+)"/);
  const moduleMatch = svg.match(/M([\d.]+) ([\d.]+)h([\d.]+)/);
  if (!translate || !path || !moduleMatch) return null;

  const moduleMm = Number(moduleMatch[3]) - 0.02;
  const squares: [number, number][] = [];
  for (const m of path[1].matchAll(/M([\d.]+) ([\d.]+)h/g)) {
    squares.push([
      Math.round(Number(m[1]) / moduleMm),
      Math.round(Number(m[2]) / moduleMm),
    ]);
  }

  const size = Math.max(...squares.map(([x]) => x)) + 1;
  // A quiet zone of four modules is required by the spec, and the card's
  // margin provides it in print; the raster has to include it or the decoder
  // will refuse a symbol it would read fine on paper.
  const quiet = 4;
  const grid = size + quiet * 2;
  const width = grid * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);

  for (const [mx, my] of squares) {
    for (let py = 0; py < scale; py += 1) {
      for (let px = 0; px < scale; px += 1) {
        const x = (mx + quiet) * scale + px;
        const y = (my + quiet) * scale + py;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, width, height: width };
}

function check(url: string, label: string, venueName = label) {
  const card = renderTableCard({
    venueName,
    url,
    displayUrl: url.replace(/^https?:\/\//, ""),
    ink: "#1c1917",
    ground: "#fdfbf7",
    invitation: "Scan to see every dish in 3D",
  });

  const raster = rasterise(card.svg, 6);
  if (!raster) {
    failures.push(`${label}: the card did not render a readable symbol path`);
    return;
  }

  const decoded = jsQR(raster.data, raster.width, raster.height);
  if (!decoded) {
    failures.push(`${label}: the QR code did not decode`);
    return;
  }
  if (decoded.data !== url) {
    failures.push(`${label}: decoded ${JSON.stringify(decoded.data)}`);
    return;
  }
  passed += 1;

  // A code read across a table wants modules no smaller than about 1.5mm at
  // arm's length; anything under that is a card people hold up to their face.
  if (card.moduleMm >= 1.5) passed += 1;
  else failures.push(`${label}: modules are only ${card.moduleMm}mm`);

  // And it has to fit the card, in both directions, with room under it for
  // the address and the footnote.
  const symbolMm = card.modules * card.moduleMm;
  if (symbolMm <= 105 - 24) passed += 1;
  else failures.push(`${label}: the symbol is wider than the card margins`);
  if (46 + symbolMm <= 148 - 24) passed += 1;
  else failures.push(`${label}: the symbol leaves no room for the address`);

  // Every line of text has to stay inside the card, at whatever size and
  // across however many lines it ended up using.
  const CARD_WIDTH = 105;
  const lines = [...card.svg.matchAll(
    /font-family="([^"]+)" font-size="([\d.]+)"[^>]*>([^<]*)</g,
  )];
  let overflowing = 0;
  for (const [, family, size, text] of lines) {
    const ratio = family.startsWith("Georgia") ? 0.5 : 0.55;
    if (text.length * ratio * Number(size) > CARD_WIDTH - 12) overflowing += 1;
  }
  if (overflowing === 0) passed += 1;
  else failures.push(`${label}: ${overflowing} line(s) run off the card`);

  // Nothing may be drawn below the card's bottom edge.
  const lowest = Math.max(
    ...[...card.svg.matchAll(/ y="([\d.]+)"/g)].map((m) => Number(m[1])),
  );
  if (lowest <= 148 - 4) passed += 1;
  else failures.push(`${label}: text sits at ${lowest}mm on a 148mm card`);
}

check("https://tastebuddy.app/restaurant/aurelia-kitchen", "short slug");
check("https://tastebuddy.app/restaurant/hanoi-house", "another short slug");
check(
  "https://tastebuddy-staging-eu-west-2.example.com/restaurant/the-anchor-and-hope-southwark",
  "long host and slug",
);
check("http://192.168.1.24:3000/restaurant/cafe-munchen", "local network URL");
check(
  "https://tastebuddy.app/restaurant/the-anchor-and-hope-southwark",
  "long venue name",
  "The Anchor and Hope, Southwark",
);
check(
  "https://tastebuddy.app/restaurant/g",
  "single long word",
  "Gastronomiewirtschaftsbetrieb",
);
check("https://tastebuddy.app/restaurant/pho", "unicode name", "Ph\u1edf B\xf2");
check(
  "https://tastebuddy.app/restaurant/" + "a".repeat(62),
  "maximum-length slug",
);

console.log(`table card: ${passed} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} failed:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
