/**
 * Turns the printed menu into something that looks like it was photographed
 * across a table by a phone: shot from an angle, lit from one side by a
 * window, slightly out of focus at the far edge, with sensor noise and JPEG
 * loss on top.
 *
 * A flat, perfect render would test almost nothing — the hard part of reading
 * a real menu is the skew, the glare and the softness, not the text.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const SCRATCH = process.env.SCRATCH;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// 1. The flat printed page.
const flat = await browser.newContext({ viewport: { width: 720, height: 1020 }, deviceScaleFactor: 2 });
const page = await flat.newPage();
await page.goto("file://" + SCRATCH + "/fixtures/menu.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
const printed = (await page.locator(".sheet").screenshot()).toString("base64");
await flat.close();

// 2. Photographed.
const shotCtx = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.6 });
const shot = await shotCtx.newPage();
await shot.setContent(`
<style>
  body { margin:0; width:900px; height:1200px; overflow:hidden;
         background: radial-gradient(ellipse at 60% 30%, #6d6355 0%, #3b352d 70%, #241f1a 100%); }
  .stage { width:900px; height:1200px; display:grid; place-items:center;
           perspective: 1500px; perspective-origin: 52% 42%; }
  .paper { position:relative; width:640px;
           transform: rotateX(9deg) rotateY(-7.5deg) rotateZ(-1.4deg) translateZ(-30px);
           box-shadow: 26px 34px 60px rgba(0,0,0,.55); }
  .paper img { display:block; width:100%; height:auto; }
  /* Warm indoor light falling from the upper left. */
  .paper::after {
    content:""; position:absolute; inset:0;
    background:
      linear-gradient(118deg, rgba(255,246,222,.42) 0%, rgba(255,246,222,0) 34%),
      linear-gradient(200deg, rgba(20,14,6,0) 52%, rgba(20,14,6,.34) 100%);
    mix-blend-mode: soft-light;
  }
  /* A window reflecting off the paper, which is what actually eats text. */
  .glare {
    position:absolute; width:340px; height:520px; right:-40px; top:120px;
    background: linear-gradient(140deg, rgba(255,255,255,.60), rgba(255,255,255,0) 62%);
    filter: blur(18px); transform: rotate(-16deg); pointer-events:none;
  }
  /* The far edge falls out of focus, the way a close phone shot does. */
  .blur { position:absolute; inset:0;
          -webkit-mask-image: linear-gradient(112deg, rgba(0,0,0,0) 46%, #000 100%);
          mask-image: linear-gradient(112deg, rgba(0,0,0,0) 46%, #000 100%);
          backdrop-filter: blur(1.7px); }
</style>
<div class="stage">
  <div class="paper">
    <img src="data:image/png;base64,${printed}">
    <div class="glare"></div>
    <div class="blur"></div>
  </div>
</div>`);
await shot.waitForTimeout(900);
const clean = await shot.screenshot();
await shotCtx.close();

// 3. Sensor noise and JPEG loss, the way a phone actually hands it over.
const grainCtx = await browser.newContext({ viewport: { width: 1440, height: 1920 } });
const grain = await grainCtx.newPage();
const jpeg = await grain.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const n = (Math.random() - 0.5) * 15;
    p[i] = Math.max(0, Math.min(255, p[i] + n));
    p[i + 1] = Math.max(0, Math.min(255, p[i + 1] + n));
    p[i + 2] = Math.max(0, Math.min(255, p[i + 2] + n));
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL("image/jpeg", 0.78);
}, `data:image/png;base64,${clean.toString("base64")}`);
await grainCtx.close();

fs.writeFileSync(`${SCRATCH}/fixtures/menu-photo.jpg`, Buffer.from(jpeg.split(",")[1], "base64"));
console.log("menu-photo.jpg", (fs.statSync(`${SCRATCH}/fixtures/menu-photo.jpg`).size / 1024).toFixed(0), "KB");
await browser.close();
