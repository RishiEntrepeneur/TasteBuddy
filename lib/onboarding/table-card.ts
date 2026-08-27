import { encode } from "uqr";

/**
 * The card that goes on the table.
 *
 * TasteBuddy's first sentence is "scan the code on your table", so onboarding
 * a restaurant is not finished until they have something to put there. This
 * renders that card as a single SVG: venue name, the code, one line telling a
 * diner what will happen, and the address printed underneath for the phone
 * whose camera will not focus.
 *
 * SVG rather than PNG because the thing gets printed. A venue will run these
 * off on an office laser at whatever size their card stock is, and a raster at
 * the wrong DPI is exactly how a QR code stops scanning.
 */

/**
 * Error correction level M.
 *
 * L is smaller but these cards live on restaurant tables, where they get wet,
 * greasy and creased. M recovers about 15% of a damaged symbol, which is the
 * difference between a card that survives a service and one that gets
 * reprinted. H would be more robust still, but pushes the symbol denser than
 * a phone camera reads comfortably from across a table.
 */
const ECC = "M" as const;

export interface TableCardOptions {
  venueName: string;
  /** The full URL a diner's camera will open. */
  url: string;
  /** Printed under the code for anyone whose camera will not focus. */
  displayUrl: string;
  /** Card ink and ground; both come from the venue's own branding. */
  ink: string;
  ground: string;
  /** One line under the venue name. */
  invitation: string;
}

/** Card geometry in millimetres, laid out for A6 (105 × 148mm). */
const CARD = {
  width: 105,
  height: 148,
  margin: 12,
} as const;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders the QR symbol as one path.
 *
 * One `<path>` of many subpaths rather than a rect per module: a version-4
 * symbol is over a thousand modules, and a printer driver handed a thousand
 * rects behaves very differently from one handed a single path.
 */
function symbolPath(data: boolean[][], size: number, scale: number): string {
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = data[y];
    if (!row) continue;
    for (let x = 0; x < size; x += 1) {
      if (!row[x]) continue;
      // Half-unit overlap closes the hairline seams that some renderers draw
      // between adjacent modules, which is enough to break a scan.
      const px = (x * scale).toFixed(3);
      const py = (y * scale).toFixed(3);
      const s = (scale + 0.02).toFixed(3);
      parts.push(`M${px} ${py}h${s}v${s}h-${s}z`);
    }
  }
  return parts.join("");
}

/**
 * Fits a line of text to the card, shrinking and then wrapping.
 *
 * SVG text does not wrap, so a long name silently runs off both edges of the
 * card. Restaurant names are not something to truncate: "The Anchor and Hope,
 * Southwark" has to arrive intact, so it shrinks to a floor and then breaks
 * across two lines rather than losing a word.
 */
function fitText(
  text: string,
  maxWidth: number,
  idealSize: number,
  minSize: number,
  /** Average glyph width as a fraction of the point size, per family. */
  ratio: number,
): { lines: string[]; size: number } {
  const widthAt = (line: string, size: number) => line.length * ratio * size;

  if (widthAt(text, idealSize) <= maxWidth) {
    return { lines: [text], size: idealSize };
  }

  const shrunk = Math.max(minSize, maxWidth / (text.length * ratio));
  if (widthAt(text, shrunk) <= maxWidth) {
    return { lines: [text], size: shrunk };
  }

  // Break as near the middle as a space allows, so neither line is a stub.
  const words = text.split(/\s+/);
  let best = 1;
  let bestGap = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const gap = Math.abs(
      words.slice(0, i).join(" ").length - words.slice(i).join(" ").length,
    );
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  const lines =
    words.length > 1
      ? [words.slice(0, best).join(" "), words.slice(best).join(" ")]
      : [text];

  const longest = Math.max(...lines.map((line) => line.length));
  return {
    lines,
    size: Math.min(idealSize, maxWidth / (longest * ratio)),
  };
}

export interface TableCard {
  svg: string;
  /** Symbol size in modules, for the caller to report. */
  modules: number;
  /** Printed size of one module in millimetres. */
  moduleMm: number;
}

export function renderTableCard(options: TableCardOptions): TableCard {
  const qr = encode(options.url, { ecc: ECC, border: 0 });

  const symbolY = 46;
  /** Room kept under the symbol for the two lines of text. */
  const captionBlock = 24;

  // Bounded by both the card's width and what is left of its height. Sizing on
  // width alone put the last line of text on top of the address.
  const widest = CARD.width - CARD.margin * 2;
  const tallest = CARD.height - symbolY - captionBlock;
  // Snapped to a whole tenth of a millimetre so the modules stay on a
  // consistent grid when the printer rounds.
  const moduleMm = Math.floor((Math.min(widest, tallest) / qr.size) * 10) / 10;
  const symbolMm = moduleMm * qr.size;
  const symbolX = (CARD.width - symbolMm) / 2;
  const symbolEnd = symbolY + symbolMm;

  const path = symbolPath(qr.data, qr.size, moduleMm);

  const textWidth = CARD.width - 16;
  // Georgia sets wider than Helvetica at the same size; both ratios are the
  // average advance for mixed-case text in that family.
  const title = fitText(options.venueName, textWidth, 8.5, 5, 0.5);
  const address = fitText(options.displayUrl, textWidth, 3.2, 1.8, 0.55);
  const titleTop = title.lines.length > 1 ? 22 : 26;
  const footnote = fitText(
    "Tell us your allergies and we will flag what clashes.",
    textWidth,
    2.8,
    1.8,
    0.55,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}mm" height="${CARD.height}mm" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-label="Table card for ${escapeXml(options.venueName)}. Scan to open the menu at ${escapeXml(options.displayUrl)}.">
  <rect width="${CARD.width}" height="${CARD.height}" fill="${escapeXml(options.ground)}"/>
  ${title.lines
    .map(
      (line, index) =>
        `<text x="${CARD.width / 2}" y="${(titleTop + index * title.size * 1.15).toFixed(2)}" text-anchor="middle" fill="${escapeXml(options.ink)}" font-family="Georgia, 'Times New Roman', serif" font-size="${title.size.toFixed(2)}">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  <text x="${CARD.width / 2}" y="35" text-anchor="middle" fill="${escapeXml(options.ink)}" font-family="Helvetica, Arial, sans-serif" font-size="3.4" opacity="0.72">${escapeXml(options.invitation)}</text>
  <g transform="translate(${symbolX.toFixed(3)} ${symbolY})">
    <path d="${path}" fill="${escapeXml(options.ink)}" shape-rendering="crispEdges"/>
  </g>
  ${address.lines
    .map(
      (line, index) =>
        `<text x="${CARD.width / 2}" y="${(symbolEnd + 8 + index * address.size * 1.25).toFixed(2)}" text-anchor="middle" fill="${escapeXml(options.ink)}" font-family="Helvetica, Arial, sans-serif" font-size="${address.size.toFixed(2)}" opacity="0.6">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${footnote.lines
    .map(
      (line, index) =>
        `<text x="${CARD.width / 2}" y="${(symbolEnd + 12 + address.lines.length * address.size * 1.25 + index * footnote.size * 1.3).toFixed(2)}" text-anchor="middle" fill="${escapeXml(options.ink)}" font-family="Helvetica, Arial, sans-serif" font-size="${footnote.size.toFixed(2)}" opacity="0.45">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
</svg>`;

  return { svg, modules: qr.size, moduleMm };
}
