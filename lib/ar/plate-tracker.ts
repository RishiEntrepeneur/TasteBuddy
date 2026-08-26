/**
 * Surface tracking for an empty plate.
 *
 * WebXR hit-testing is the right tool for this and is used whenever the browser
 * offers it (`immersive-ar` + `hit-test`, i.e. Chrome on ARCore devices). iOS
 * Safari ships no WebXR at all, which is most of the diners TasteBuddy will
 * ever see, so this module provides the fallback: a lightweight vision pass
 * over the camera feed that finds the plate itself.
 *
 * The heuristic exploits what a plate reliably is — a large, bright, almost
 * colourless disc against a darker, more saturated table:
 *
 *   1. Downsample the frame to 64x48. That is enough to locate a dinner plate
 *      at arm's length and cheap enough to run every frame on a mid-range
 *      phone without stealing the GPU from the renderer.
 *   2. Keep pixels that are bright and low-saturation.
 *   3. Take the weighted centroid and the second moment of that mask; the
 *      centroid is the plate centre and the spread gives its radius.
 *   4. Reject implausible results (too small, too large, too eccentric) and
 *      smooth what survives, so the dish does not jitter while the diner's
 *      hand shakes.
 *
 * Everything here is pure apart from the canvas read, which makes the tuning
 * constants testable in isolation.
 */

/** Analysis resolution. Small on purpose — see the note above. */
export const SAMPLE_WIDTH = 64;
export const SAMPLE_HEIGHT = 48;

/** A pixel must be at least this bright (0–1) to be plate-like. */
const MIN_LUMINANCE = 0.55;
/** …and no more saturated than this (0–1). Ceramic is nearly colourless. */
const MAX_SATURATION = 0.22;

/** Plausible plate area, as a fraction of the frame. */
const MIN_AREA_RATIO = 0.035;
const MAX_AREA_RATIO = 0.72;

/** Above this the blob is a wall or a tablecloth, not a plate. */
const MAX_ECCENTRICITY = 2.1;

/** Consecutive good frames before the anchor locks. */
const FRAMES_TO_LOCK = 6;
/** Consecutive bad frames before a locked anchor is released. */
const FRAMES_TO_RELEASE = 20;

/** Exponential smoothing factor for the anchor pose. */
const SMOOTHING = 0.18;

export interface PlateObservation {
  /** Centre in normalised device coordinates, x and y both in [-1, 1]. */
  x: number;
  y: number;
  /** Radius as a fraction of half the frame height. */
  radius: number;
  /** 0–1. Combines area plausibility and how circular the blob is. */
  confidence: number;
}

export type TrackingState =
  /** Nothing plate-like in frame yet. */
  | "searching"
  /** A candidate is being confirmed across frames. */
  | "acquiring"
  /** Anchor is stable; the dish is placed. */
  | "locked"
  /** The diner placed the dish by hand after tracking failed. */
  | "manual";

export interface TrackerSnapshot {
  state: TrackingState;
  anchor: PlateObservation | null;
}

/** Single-frame analysis with no history. Exported for tests. */
export function detectPlate(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PlateObservation | null {
  let count = 0;
  let sumX = 0;
  let sumY = 0;

  // Pass 1 — centroid of every plate-like pixel.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = pixels[index] / 255;
      const g = pixels[index + 1] / 255;
      const b = pixels[index + 2] / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const saturation = max === 0 ? 0 : (max - min) / max;

      if (luminance < MIN_LUMINANCE || saturation > MAX_SATURATION) continue;

      count += 1;
      sumX += x;
      sumY += y;
    }
  }

  const areaRatio = count / (width * height);
  if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) return null;

  const meanX = sumX / count;
  const meanY = sumY / count;

  // Pass 2 — second moments, which give both the radius and the eccentricity.
  let varianceX = 0;
  let varianceY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = pixels[index] / 255;
      const g = pixels[index + 1] / 255;
      const b = pixels[index + 2] / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const saturation = max === 0 ? 0 : (max - min) / max;

      if (luminance < MIN_LUMINANCE || saturation > MAX_SATURATION) continue;

      varianceX += (x - meanX) ** 2;
      varianceY += (y - meanY) ** 2;
    }
  }

  varianceX /= count;
  varianceY /= count;

  const sigmaX = Math.sqrt(varianceX);
  const sigmaY = Math.sqrt(varianceY);

  if (sigmaX <= 0 || sigmaY <= 0) return null;

  // A plate viewed at an angle is an ellipse, but a very elongated blob is a
  // table edge or a window, so reject it.
  const eccentricity = Math.max(sigmaX / sigmaY, sigmaY / sigmaX);
  if (eccentricity > MAX_ECCENTRICITY) return null;

  // For a filled disc, sigma = radius / 2, hence the factor of two.
  const radiusPx = Math.max(sigmaX, sigmaY) * 2;

  // Circularity: how close the observed area is to the disc the moments imply.
  const impliedArea = Math.PI * radiusPx ** 2;
  const circularity = Math.min(1, count / Math.max(1, impliedArea));

  // Mid-range areas are the most trustworthy; the extremes are penalised.
  const areaScore =
    1 -
    Math.abs(areaRatio - (MIN_AREA_RATIO + MAX_AREA_RATIO) / 2) /
      ((MAX_AREA_RATIO - MIN_AREA_RATIO) / 2);

  const confidence = Math.max(
    0,
    Math.min(1, 0.55 * circularity + 0.45 * Math.max(0, areaScore)),
  );

  return {
    // Canvas y grows downward, NDC y grows upward.
    x: (meanX / width) * 2 - 1,
    y: -((meanY / height) * 2 - 1),
    radius: radiusPx / (height / 2),
    confidence,
  };
}

/**
 * Stateful wrapper over `detectPlate` that adds hysteresis and smoothing.
 *
 * One instance lives for the lifetime of an AR session.
 */
export class PlateTracker {
  private anchor: PlateObservation | null = null;
  private state: TrackingState = "searching";
  private goodFrames = 0;
  private badFrames = 0;

  /** Feeds one downsampled frame in and returns the current anchor. */
  update(
    pixels: Uint8ClampedArray,
    width = SAMPLE_WIDTH,
    height = SAMPLE_HEIGHT,
  ): TrackerSnapshot {
    // A hand-placed anchor is never overridden by the tracker.
    if (this.state === "manual") return this.snapshot();

    const observation = detectPlate(pixels, width, height);

    if (!observation) {
      this.goodFrames = 0;
      this.badFrames += 1;
      if (this.state === "locked" && this.badFrames >= FRAMES_TO_RELEASE) {
        this.state = "searching";
        this.anchor = null;
      } else if (this.state === "acquiring") {
        this.state = "searching";
      }
      return this.snapshot();
    }

    this.badFrames = 0;
    this.goodFrames += 1;

    this.anchor = this.anchor
      ? {
          x: lerp(this.anchor.x, observation.x, SMOOTHING),
          y: lerp(this.anchor.y, observation.y, SMOOTHING),
          radius: lerp(this.anchor.radius, observation.radius, SMOOTHING),
          confidence: lerp(
            this.anchor.confidence,
            observation.confidence,
            SMOOTHING,
          ),
        }
      : observation;

    if (this.state !== "locked") {
      this.state = this.goodFrames >= FRAMES_TO_LOCK ? "locked" : "acquiring";
    }

    return this.snapshot();
  }

  /**
   * Places the dish by hand at a normalised point, used by "tap to place" when
   * the surface is glass, dark wood, or a patterned tablecloth.
   */
  placeManually(x: number, y: number, radius = 0.42): TrackerSnapshot {
    this.anchor = { x, y, radius, confidence: 1 };
    this.state = "manual";
    this.goodFrames = 0;
    this.badFrames = 0;
    return this.snapshot();
  }

  /** Drops a manual placement and hands control back to the tracker. */
  reset(): TrackerSnapshot {
    this.anchor = null;
    this.state = "searching";
    this.goodFrames = 0;
    this.badFrames = 0;
    return this.snapshot();
  }

  private snapshot(): TrackerSnapshot {
    return { state: this.state, anchor: this.anchor };
  }
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/* -------------------------------------------------------------------------- */
/*  Projection                                                                 */
/* -------------------------------------------------------------------------- */

export interface AnchorPose {
  /** World-space position on the plate, in metres. */
  position: [number, number, number];
  /** World radius of the plate, in metres. */
  radius: number;
}

/**
 * Projects a normalised anchor onto a plane a fixed distance in front of the
 * camera, which is where an arm's-length plate actually sits.
 *
 * The camera looks down -Z from the origin, so camera space is world space and
 * no matrix work is needed.
 */
export function projectAnchor(
  anchor: PlateObservation,
  options: { fovDegrees: number; aspect: number; distance: number },
): AnchorPose {
  const { fovDegrees, aspect, distance } = options;
  const halfHeight = Math.tan((fovDegrees * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * aspect;

  return {
    position: [anchor.x * halfWidth, anchor.y * halfHeight, -distance],
    radius: Math.max(0.02, anchor.radius * halfHeight),
  };
}
