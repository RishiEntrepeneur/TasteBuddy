/**
 * Builds the offline demo: the real app, in one HTML file.
 *
 *   npm run build        # first — this reuses the stylesheet Next compiles
 *   npm run demo:build
 *
 * It bundles `components/` and `lib/` exactly as they are, takes the Tailwind
 * CSS the app itself compiles to, inlines the two typefaces, and writes a
 * single file that reaches for nothing. The only substitution is `kitchen.ts`,
 * which answers the two API routes from a bundled list of dishes — a published
 * page cannot reach a server, so a build that could ask the model is not on
 * the table.
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "demo", "dist");
const NEXT_STATIC = path.join(ROOT, ".next", "static");

fs.mkdirSync(OUT, { recursive: true });

/* -- 1. the app ----------------------------------------------------------- */

const bundled = await esbuild.build({
  entryPoints: [path.join(ROOT, "demo", "main.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  jsx: "automatic",
  minify: true,
  tsconfig: path.join(ROOT, "tsconfig.json"),
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env": "{}",
  },
  loader: { ".png": "dataurl", ".svg": "dataurl" },
  logLevel: "warning",
});

const script = bundled.outputFiles[0].text;

/* -- 2. the stylesheet, with the fonts folded in -------------------------- */

const cssFile = fs
  .readdirSync(path.join(NEXT_STATIC, "chunks"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => path.join(NEXT_STATIC, "chunks", name))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

if (!cssFile) {
  throw new Error("No compiled stylesheet under .next/static/chunks. Run `npm run build` first.");
}

let css = fs.readFileSync(cssFile, "utf8");

let fontBytes = 0;
css = css.replace(/url\(\.\.\/media\/([^)]+\.woff2)\)/g, (_match, name) => {
  const file = path.join(NEXT_STATIC, "media", name);
  const data = fs.readFileSync(file);
  fontBytes += data.length;
  return `url(data:font/woff2;base64,${data.toString("base64")})`;
});

// next/font puts these on a generated class on <html>, which this build has no
// way to reproduce; the names themselves are already declared above.
css += `
:root{--font-display-variable:"Fraunces","Fraunces Fallback",Georgia,serif;--font-sans-variable:"Instrument Sans","Instrument Sans Fallback",ui-sans-serif,system-ui,sans-serif}
body{min-height:100dvh;-webkit-font-smoothing:antialiased;margin:0}

/* The intro sheet. Built on the app's custom properties rather than its
   utility classes, because the stylesheet above is only whatever Tailwind
   emitted for the app and a class it never used is not in there. */
.demo-scrim{position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;padding:16px;background:color-mix(in srgb,var(--color-ink) 42%,transparent);backdrop-filter:blur(3px)}
.demo-sheet{width:100%;max-width:32rem;background:var(--color-card);border-radius:var(--radius-card);padding:26px 24px 22px;box-shadow:0 -2px 4px rgba(0,0,0,.04),0 32px 64px -24px rgba(0,0,0,.45);animation:demo-rise .34s cubic-bezier(.22,1,.36,1)}
@keyframes demo-rise{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
@media(prefers-reduced-motion:reduce){.demo-sheet{animation:none}}
.demo-eyebrow{margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-ink-3)}
.demo-title{margin:0 0 12px;font-family:var(--font-display);font-size:26px;line-height:1.12;letter-spacing:-.01em;color:var(--color-ink)}
.demo-body{margin:0 0 12px;font-size:15px;line-height:1.6;color:var(--color-ink-2)}
.demo-label{margin:18px 0 8px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-ink-3)}
.demo-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 22px;padding:0;list-style:none}
.demo-chips li{padding:6px 11px;border-radius:999px;background:var(--color-sunk);color:var(--color-ink-2);font-size:13.5px}
.demo-go{width:100%;padding:15px;border:0;border-radius:var(--radius-control);background:var(--color-ink);color:var(--color-card);font:600 16px/1 var(--font-sans);cursor:pointer}
.demo-go:active{transform:scale(.99)}
.demo-go:focus-visible{outline:2px solid var(--color-safe);outline-offset:3px}
`;

/* -- 3. one file ---------------------------------------------------------- */

const html = `<title>TasteBuddy Offline</title>
<meta name="color-scheme" content="light dark">
<style>${css}</style>
<div id="root"></div>
<script>${script}</script>
`;

const outFile = path.join(OUT, "tastebuddy-demo.html");
fs.writeFileSync(outFile, html);

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`app      ${mb(script.length)} MB`);
console.log(`css      ${mb(css.length)} MB  (${mb(fontBytes)} MB of it type)`);
console.log(`written  ${outFile}  ${mb(fs.statSync(outFile).size)} MB`);
