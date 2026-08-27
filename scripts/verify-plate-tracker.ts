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
  DEFAULT_FLATNESS,
  PlateTracker,
  SAMPLE_HEIGHT,
  SAMPLE_PIXELS,
  SAMPLE_WIDTH,
  detectPlate,
  projectAnchor,
  sampleSizeFor,
  tiltFor,
  toViewport,
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

function pixels_set(buffer: Uint8ClampedArray, index: number, colour: Rgb): void {
  buffer[index] = colour[0];
  buffer[index + 1] = colour[1];
  buffer[index + 2] = colour[2];
  buffer[index + 3] = 255;
}

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
    { x: 0, y: 0, radius: 0.5, flatness: 0.6, confidence: 1 },
    { fovDegrees: 55, aspect: 390 / 844, distance: 0.55 },
  );
  check('centred anchor projects to the view axis', Math.abs(pose.position[0]) < 1e-9 && Math.abs(pose.position[1]) < 1e-9);
  check('depth matches the requested distance', pose.position[2] === -0.55);
  // halfHeight = tan(27.5deg) * 0.55 = 0.2864 m; radius 0.5 of that = 0.1432 m.
  check('plate radius converts to metres', Math.abs(pose.radius - 0.1432) < 0.002, `${pose.radius.toFixed(4)} m`);

  const right = projectAnchor(
    { x: 1, y: 0, radius: 0.4, flatness: 0.6, confidence: 1 },
    { fovDegrees: 55, aspect: 390 / 844, distance: 0.55 },
  );
  check('right edge maps to the right of the frustum', right.position[0] > 0.12, `${right.position[0].toFixed(4)} m`);
}

console.log('\nsampleSizeFor — the camera\'s shape survives the downsample');

/** Paints a round plate into a buffer of the given shape, the way `drawImage`
 *  would if it were handed a buffer that matches the camera. */
function shaped(
  width: number,
  height: number,
  plateRadiusFraction: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height * 0.58;
  // A round plate, seen square on: the same radius in both axes, measured
  // against the shorter side so it fits whatever shape the frame is.
  const r = Math.min(width, height) * plateRadiusFraction;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const colour: Rgb = inside ? WHITE_CERAMIC : DARK_WOOD;
      pixels[index] = colour[0];
      pixels[index + 1] = colour[1];
      pixels[index + 2] = colour[2];
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

/** Every camera shape TasteBuddy will actually be handed. */
const CAMERAS: Array<[string, number, number]> = [
  ['landscape 1280x720', 1280, 720],
  ['landscape 640x480', 640, 480],
  ['portrait 720x1280', 720, 1280],
  ['portrait 1080x1920', 1080, 1920],
  ['portrait 480x640', 480, 640],
  ['square 720x720', 720, 720],
];

for (const [label, w, h] of CAMERAS) {
  const size = sampleSizeFor(w, h);
  const budget = size.width * size.height;
  check(
    `${label}: stays inside the pixel budget`,
    budget > SAMPLE_PIXELS * 0.8 && budget < SAMPLE_PIXELS * 1.25,
    `${size.width}x${size.height} = ${budget}px`,
  );
  check(
    `${label}: keeps the camera's aspect`,
    Math.abs(size.width / size.height - w / h) < 0.05,
    `${(size.width / size.height).toFixed(3)} vs ${(w / h).toFixed(3)}`,
  );
  // The regression this exists for: a round plate has to be found on every
  // one of these, portrait included.
  const seen = detectPlate(shaped(size.width, size.height, 0.3), size.width, size.height);
  check(`${label}: a round plate is found`, seen !== null, seen ? `radius ${seen.radius.toFixed(2)}` : 'NOT FOUND');
}

{
  // Same plate, every camera: the radius the tracker reports should not swing
  // with the shape of the sensor.
  const radii = CAMERAS.map(([, w, h]) => {
    const size = sampleSizeFor(w, h);
    // Radius as a fraction of half the frame *height*, which is what the
    // tracker reports, so express the plate that way for the comparison.
    const seen = detectPlate(shaped(size.width, size.height, 0.3), size.width, size.height);
    const expected = (Math.min(size.width, size.height) * 0.3) / (size.height / 2);
    return seen ? Math.abs(seen.radius - expected) / expected : Number.NaN;
  });
  check(
    'the reported radius matches the plate on every camera',
    radii.every((error) => error < 0.12),
    radii.map((e) => (Number.isNaN(e) ? 'n/a' : `${(e * 100).toFixed(0)}%`)).join(', '),
  );
}

{
  // The regression this all exists for. One scene — a phone held upright,
  // looking straight down at a round plate — read two ways.
  const r = 720 * 0.3;
  const draw = (w: number, h: number): Uint8ClampedArray => {
    const pixels = new Uint8ClampedArray(w * h * 4);
    const sx = w / 720;
    const sy = h / 1280;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const inside =
          ((x - (720 / 2) * sx) / (r * sx)) ** 2 + ((y - 1280 * 0.5 * sy) / (r * sy)) ** 2 <= 1;
        pixels_set(pixels, (y * w + x) * 4, inside ? WHITE_CERAMIC : DARK_WOOD);
      }
    }
    return pixels;
  };

  const correct = sampleSizeFor(720, 1280);
  const honest = detectPlate(draw(correct.width, correct.height), correct.width, correct.height);
  const squashed = detectPlate(draw(SAMPLE_WIDTH, SAMPLE_HEIGHT), SAMPLE_WIDTH, SAMPLE_HEIGHT);

  check(
    'read at the camera\'s own shape, a plate seen from above is round',
    honest !== null && honest.flatness > 0.9,
    honest ? `flatness ${honest.flatness.toFixed(2)}, ${((tiltFor(honest.flatness) * 180) / Math.PI).toFixed(0)} deg` : 'NOT FOUND',
  );
  check(
    'forced into the 4:3 buffer, the same plate reads as steeply tilted',
    squashed !== null && squashed.flatness < 0.6,
    squashed ? `flatness ${squashed.flatness.toFixed(2)}, ${((tiltFor(squashed.flatness) * 180) / Math.PI).toFixed(0)} deg` : 'NOT FOUND',
  );
  check(
    'which is the ~50 degrees of error the aspect-correct sample removes',
    honest !== null &&
      squashed !== null &&
      ((tiltFor(honest.flatness) - tiltFor(squashed.flatness)) * 180) / Math.PI > 40,
  );
}

console.log('\ntoViewport — the stream is cropped before the diner sees it');

{
  const seen = { x: 0.5, y: -0.4, radius: 0.3, flatness: 0.6, confidence: 0.8 };

  const same = toViewport(seen, 390 / 844, 390 / 844);
  check(
    'a frame shaped like the screen is left alone',
    Math.abs(same.x - seen.x) < 1e-9 && Math.abs(same.radius - seen.radius) < 1e-9,
  );

  // 4:3 stream in a tall phone: the sides are cropped, so the same plate is
  // further from the centre of the screen than it was of the frame.
  const wide = toViewport(seen, 4 / 3, 390 / 844);
  check('a wide frame in a tall view pushes x outward', wide.x > seen.x, `${wide.x.toFixed(3)}`);
  check('…and leaves the height alone', Math.abs(wide.radius - seen.radius) < 1e-9);

  // 9:16 stream in a landscape view: the top and bottom go instead.
  const tall = toViewport(seen, 9 / 16, 16 / 9);
  check('a tall frame in a wide view grows the radius', tall.radius > seen.radius, `${tall.radius.toFixed(3)}`);
  check('…and leaves x alone', Math.abs(tall.x - seen.x) < 1e-9);

  const centred = toViewport({ x: 0, y: 0, radius: 0.3, flatness: 0.6, confidence: 1 }, 4 / 3, 390 / 844);
  check('a centred plate stays centred', centred.x === 0 && centred.y === 0);

  check(
    'a frame of no size is passed straight through',
    toViewport(seen, 0, 390 / 844).x === seen.x,
  );
}

console.log('\nflatness — the angle the plate is being looked at from');

/** Paints a circle of radius `r` squashed vertically by `flatten`, which is
 *  what a round plate does when it is not being looked at from above. */
function tilted(width: number, height: number, r: number, flatten: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = ((x - cx) / r) ** 2 + ((y - cy) / (r * flatten)) ** 2 <= 1;
      pixels_set(pixels, (y * width + x) * 4, inside ? WHITE_CERAMIC : DARK_WOOD);
    }
  }
  return pixels;
}

{
  const round = detectPlate(tilted(64, 64, 20, 1), 64, 64);
  check(
    'a plate seen from straight above reads as round',
    round !== null && round.flatness > 0.9,
    round ? round.flatness.toFixed(2) : 'NOT FOUND',
  );

  const low = detectPlate(tilted(64, 48, 26, 0.45), 64, 48);
  check(
    'a plate seen from a low angle reads as squashed',
    low !== null && low.flatness > 0.3 && low.flatness < 0.62,
    low ? low.flatness.toFixed(2) : 'NOT FOUND',
  );

  check(
    'a squashed plate is a smaller angle than a round one',
    low !== null && round !== null && tiltFor(low.flatness) < tiltFor(round.flatness),
  );
}

{
  check('straight down is a right angle', Math.abs(tiltFor(1) - Math.PI / 2) < 1e-9);
  check(
    'the default angle is about 21 degrees',
    Math.abs((tiltFor(DEFAULT_FLATNESS) * 180) / Math.PI - 20.6) < 0.5,
    `${((tiltFor(DEFAULT_FLATNESS) * 180) / Math.PI).toFixed(1)} deg`,
  );
  check(
    'an almost edge-on read is clamped, not drawn edge-on',
    tiltFor(0.001) > 0.2,
    `${((tiltFor(0.001) * 180) / Math.PI).toFixed(1)} deg`,
  );
  check('nonsense falls back to the default', tiltFor(Number.NaN) === tiltFor(DEFAULT_FLATNESS));

  const tracker = new PlateTracker();
  const manual = tracker.placeManually(0, 0);
  check(
    'a hand placement carries the default angle',
    manual.anchor?.flatness === DEFAULT_FLATNESS,
  );
}

console.log(
  failures === 0
    ? '\nAll plate-tracker checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);

process.exit(failures === 0 ? 0 : 1);
