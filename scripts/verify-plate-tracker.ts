/**
 * Verification harness for the plate tracker.
 *
 * The browser test drives the AR viewer against Chromium's fake camera, which
 * emits a flat synthetic pattern with no plate in it — so the tracker's actual
 * detection maths has to be exercised here instead, against frames we control.
 *
 *   npx tsx scripts/verify-plate-tracker.ts
 */

import {
  PlateTracker,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  detectPlate,
  projectAnchor,
} from '../lib/ar/plate-tracker';

type Rgb = [number, number, number];

/** Paints a frame: a coloured table, optionally with a bright neutral disc. */
function frame(options: {
  table: Rgb;
  plate?: { cx: number; cy: number; rx: number; ry: number; color: Rgb };
  noise?: number;
}): Uint8ClampedArray {
  const { table, plate, noise = 0 } = options;
  const pixels = new Uint8ClampedArray(SAMPLE_WIDTH * SAMPLE_HEIGHT * 4);

  for (let y = 0; y < SAMPLE_HEIGHT; y += 1) {
    for (let x = 0; x < SAMPLE_WIDTH; x += 1) {
      const index = (y * SAMPLE_WIDTH + x) * 4;
      let colour: Rgb = table;

      if (plate) {
        const dx = (x - plate.cx) / plate.rx;
        const dy = (y - plate.cy) / plate.ry;
        if (dx * dx + dy * dy <= 1) colour = plate.color;
      }

      const jitter = noise ? (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1) * noise : 0;
      pixels[index] = colour[0] + jitter;
      pixels[index + 1] = colour[1] + jitter;
      pixels[index + 2] = colour[2] + jitter;
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

const DARK_WOOD: Rgb = [92, 58, 30];
const WHITE_CERAMIC: Rgb = [238, 236, 232];

let failures = 0;

function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

console.log('\ndetectPlate — single frame');

{
  const centred = detectPlate(
    frame({
      table: DARK_WOOD,
      plate: { cx: 32, cy: 24, rx: 16, ry: 12, color: WHITE_CERAMIC },
    }),
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT,
  );
  check('centred plate is found', centred !== null);
  if (centred) {
    check(
      'centre is at the origin',
      Math.abs(centred.x) < 0.06 && Math.abs(centred.y) < 0.06,
      `x=${centred.x.toFixed(3)} y=${centred.y.toFixed(3)}`,
    );
    check('radius is plausible', centred.radius > 0.3 && centred.radius < 0.85, `r=${centred.radius.toFixed(3)}`);
    check('confidence is high', centred.confidence > 0.5, `c=${centred.confidence.toFixed(3)}`);
  }
}

{
  // Plate pushed to the lower-right, where a plate in front of a diner sits.
  const offset = detectPlate(
    frame({
      table: DARK_WOOD,
      plate: { cx: 46, cy: 33, rx: 13, ry: 10, color: WHITE_CERAMIC },
    }),
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT,
  );
  check('off-centre plate is found', offset !== null);
  if (offset) {
    check('x is right of centre', offset.x > 0.3, `x=${offset.x.toFixed(3)}`);
    check('y is below centre', offset.y < -0.2, `y=${offset.y.toFixed(3)}`);
  }
}

{
  const bare = detectPlate(frame({ table: DARK_WOOD }), SAMPLE_WIDTH, SAMPLE_HEIGHT);
  check('bare table yields nothing', bare === null);

  const saturated = detectPlate(
    frame({ table: DARK_WOOD, plate: { cx: 32, cy: 24, rx: 16, ry: 12, color: [230, 40, 40] } }),
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT,
  );
  check('a bright *red* disc is rejected (too saturated)', saturated === null);

  const blownOut = detectPlate(
    frame({ table: [245, 244, 242] }),
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT,
  );
  check('a fully white frame is rejected (too large)', blownOut === null);

  const speck = detectPlate(
    frame({ table: DARK_WOOD, plate: { cx: 32, cy: 24, rx: 3, ry: 3, color: WHITE_CERAMIC } }),
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT,
  );
  check('a small bright speck is rejected (too small)', speck === null);

  const streak = detectPlate(
    frame({ table: DARK_WOOD, plate: { cx: 32, cy: 24, rx: 31, ry: 4, color: WHITE_CERAMIC } }),
    SAMPLE_WIDTH,
    SAMPLE_HEIGHT,
  );
  check('a long bright streak is rejected (too eccentric)', streak === null);
}

console.log('\nPlateTracker — hysteresis and smoothing');

{
  const tracker = new PlateTracker();
  const good = frame({
    table: DARK_WOOD,
    plate: { cx: 32, cy: 24, rx: 16, ry: 12, color: WHITE_CERAMIC },
  });

  let snapshot = tracker.update(good);
  check('first good frame does not lock immediately', snapshot.state === 'acquiring', snapshot.state);

  for (let i = 0; i < 5; i += 1) snapshot = tracker.update(good);
  check('locks after six consecutive good frames', snapshot.state === 'locked', snapshot.state);

  const empty = frame({ table: DARK_WOOD });
  snapshot = tracker.update(empty);
  check('one dropped frame does not release the lock', snapshot.state === 'locked', snapshot.state);

  for (let i = 0; i < 25; i += 1) snapshot = tracker.update(empty);
  check('sustained loss releases the lock', snapshot.state === 'searching', snapshot.state);
  check('anchor is cleared on release', snapshot.anchor === null);
}

{
  const tracker = new PlateTracker();
  const left = frame({ table: DARK_WOOD, plate: { cx: 20, cy: 24, rx: 14, ry: 11, color: WHITE_CERAMIC } });
  const right = frame({ table: DARK_WOOD, plate: { cx: 44, cy: 24, rx: 14, ry: 11, color: WHITE_CERAMIC } });

  for (let i = 0; i < 10; i += 1) tracker.update(left);
  const before = tracker.update(left).anchor?.x ?? 0;
  const afterJump = tracker.update(right).anchor?.x ?? 0;
  const jumped = detectPlate(right, SAMPLE_WIDTH, SAMPLE_HEIGHT)?.x ?? 0;

  check(
    'a sudden jump is smoothed, not snapped',
    Math.abs(afterJump - before) < Math.abs(jumped - before) * 0.5,
    `before=${before.toFixed(3)} smoothed=${afterJump.toFixed(3)} raw=${jumped.toFixed(3)}`,
  );
}

{
  const tracker = new PlateTracker();
  const good = frame({ table: DARK_WOOD, plate: { cx: 32, cy: 24, rx: 16, ry: 12, color: WHITE_CERAMIC } });
  for (let i = 0; i < 10; i += 1) tracker.update(good);

  const manual = tracker.placeManually(-0.5, 0.25);
  check('manual placement takes effect', manual.state === 'manual' && manual.anchor?.x === -0.5);

  const afterUpdate = tracker.update(good);
  check('tracker cannot override a hand placement', afterUpdate.state === 'manual' && afterUpdate.anchor?.x === -0.5);

  const reset = tracker.reset();
  check('reset hands control back to the tracker', reset.state === 'searching' && reset.anchor === null);
}

console.log('\nprojectAnchor — screen space to metres');

{
  const pose = projectAnchor(
    { x: 0, y: 0, radius: 0.5, confidence: 1 },
    { fovDegrees: 55, aspect: 390 / 844, distance: 0.55 },
  );
  check('centred anchor projects to the view axis', Math.abs(pose.position[0]) < 1e-9 && Math.abs(pose.position[1]) < 1e-9);
  check('depth matches the requested distance', pose.position[2] === -0.55);
  // halfHeight = tan(27.5deg) * 0.55 = 0.2864 m; radius 0.5 of that = 0.1432 m.
  check('plate radius converts to metres', Math.abs(pose.radius - 0.1432) < 0.002, `${pose.radius.toFixed(4)} m`);

  const right = projectAnchor(
    { x: 1, y: 0, radius: 0.4, confidence: 1 },
    { fovDegrees: 55, aspect: 390 / 844, distance: 0.55 },
  );
  check('right edge maps to the right of the frustum', right.position[0] > 0.12, `${right.position[0].toFixed(4)} m`);
}

console.log(
  failures === 0
    ? '\nAll plate-tracker checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);

process.exit(failures === 0 ? 0 : 1);
