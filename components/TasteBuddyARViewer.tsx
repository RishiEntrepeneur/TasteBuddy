"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Camera,
  CameraOff,
  Crosshair,
  Hand,
  Loader2,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as THREE from "three";

import { AllergenWarningOverlay } from "@/components/ar/AllergenWarningOverlay";
import { ALLERGEN_CATALOG } from "@/lib/allergens";
import { DishModel } from "@/components/ar/DishModel";
import {
  PlateTracker,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
  DEFAULT_FLATNESS,
  sampleSizeFor,
  tiltFor,
  toViewport,
  projectAnchor,
  type AnchorPose,
  type PlateObservation,
  type TrackingState,
} from "@/lib/ar/plate-tracker";
import type { DishExplanation, LikelyAllergen } from "@/lib/dish/types";
import { useCameraStream } from "@/lib/hooks/useCameraStream";

/**
 * What the viewer needs to know about a dish.
 *
 * Note what is missing: a model file. Nothing in this app has a photograph of
 * the real plate, so the geometry is built from the dish's own name every
 * time. That is honest about what this is — the shape and size of the thing
 * that arrives, not a picture of it.
 */
export interface ARDish {
  name: string;
  /** Fed to the geometry builder along with the name. */
  description: string;
  /** Longest real-world edge of the plated dish, in metres. */
  realWorldScaleM: number;
  /** How it turns up: "one long roll". Names the form when the name does not. */
  servedAs: string;
  /** False when the dish is not known: the plate is left empty. */
  recognised: boolean;
  /** Only the ones that clash with this diner's profile. */
  clashes: LikelyAllergen[];
}

/** Builds the viewer's input from an explained dish and what the diner avoids. */
export function arDishFrom(
  dish: DishExplanation,
  clashes: LikelyAllergen[],
): ARDish {
  return {
    name: dish.printedName,
    description: `${dish.englishName} ${dish.whatItIs}`,
    realWorldScaleM: 0.22,
    servedAs: dish.servedAs,
    recognised: dish.recognised,
    clashes,
  };
}

/**
 * TasteBuddyARViewer — the AR canvas.
 *
 * Architecture
 * ------------
 * The camera feed is a plain `<video>` painted behind a transparent WebGL
 * canvas, rather than a WebGL video texture. That is deliberate: the browser
 * composites the video on its own, which keeps the feed at full frame rate even
 * while the renderer is throttled, and it avoids a second full-resolution
 * texture upload per frame on devices that can least afford it.
 *
 * Surface tracking runs off a 64x48 downsample of that same video, so the
 * tracker costs a few hundred microseconds a frame — see `lib/ar/plate-tracker`.
 *
 * Safety
 * ------
 * If the dish conflicts with the diner's allergen profile, the warning is
 * anchored to the model in 3D (`AllergenWarningOverlay`), not merely printed in
 * the surrounding DOM, so there is no camera angle from which the dish appears
 * without its warning.
 */

/** Where the plate plane sits when tracking has not measured it, in metres. */
const FALLBACK_DISTANCE_M = 0.75;
const CAMERA_FOV_DEGREES = 55;

/**
 * The tilt to draw the dish at before anything has been measured, in radians.
 *
 * A plate is a flat disc: drawn square-on to the camera axis it collapses to a
 * sliver of rim and a wall of whatever is in it. There is no device pose to
 * take a real angle from — no WebXR, no orientation events — so the angle
 * comes from the plate's own foreshortening once the tracker has one, and from
 * this until then.
 */
// Positive rotates the plate's top surface toward the camera (Y toward +Z);
// negative tips it away and shows the underside of the bowl.
const PREVIEW_TILT = tiltFor(DEFAULT_FLATNESS);

interface TasteBuddyARViewerProps {
  item: ARDish;
  onClose: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Scene                                                                      */
/* -------------------------------------------------------------------------- */

interface SceneProps {
  item: ARDish;
  anchor: PlateObservation | null;
  trackingState: TrackingState;
  reducedMotion: boolean;
}

/**
 * Places the dish at the tracked anchor and eases it there.
 *
 * The tracker is already smoothed, but the projection changes discontinuously
 * when the plate radius jumps, so the group is damped once more here.
 */
function AnchoredDish({
  item,
  anchor,
  trackingState,
  reducedMotion,
}: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const { size } = useThree();

  const pose: AnchorPose = useMemo(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;

    if (!anchor) {
      // Nothing tracked yet. Distance is set by what fits: a portrait frame
      // spans only ~0.48x the depth in metres, so a 28cm plate needs about
      // 0.75m of it. The drop stays modest and `PREVIEW_TILT` supplies the
      // downward angle instead — with no tracking there is no device pose to
      // take it from, and dropping the dish far enough to see into it would
      // push it off the bottom of the frame.
      return {
        position: [0, -0.16, -FALLBACK_DISTANCE_M],
        radius: item.realWorldScaleM / 2,
      };
    }

    return projectAnchor(anchor, {
      fovDegrees: CAMERA_FOV_DEGREES,
      aspect,
      distance: FALLBACK_DISTANCE_M,
    });
  }, [anchor, size.width, size.height, item.realWorldScaleM]);

  const target = useMemo(
    () => new THREE.Vector3(...pose.position),
    [pose.position],
  );

  useFrame((_, delta) => {
    if (!group.current) return;
    // Critically-damped-ish follow; snaps when the diner places by hand.
    const alpha = reducedMotion ? 1 : Math.min(1, delta * 6);
    group.current.position.lerp(target, alpha);
  });

  // Only a *tracked* plate is a real-world ruler worth scaling to. A hand
  // placement is a position, not a measurement — its radius is a fixed guess —
  // so in that case the dish's own recorded dimension is the better number.
  const targetDiameter =
    trackingState === "locked"
      ? pose.radius * 2 * 0.78
      : item.realWorldScaleM;

  const dishRadius = targetDiameter / 2;

  // Visible frustum width where the dish sits, so the warning banner can be
  // clamped to the frame rather than to the dish.
  const visibleWidth = useMemo(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const halfHeight =
      Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360) * FALLBACK_DISTANCE_M;
    return 2 * halfHeight * aspect;
  }, [size.width, size.height]);

  // How squashed the plate arrived is the angle it is being seen from, and it
  // is the only angle available. Zero would draw the dish edge-on.
  const tilt = anchor ? tiltFor(anchor.flatness) : PREVIEW_TILT;

  return (
    <group ref={group} position={pose.position} rotation={[tilt, 0, 0]}>
      <Suspense fallback={null}>
        <DishModel
          url={null}
          name={item.name}
          description={item.description}
          servedAs={item.servedAs}
          recognised={item.recognised}
          targetDiameter={targetDiameter}
          portion={1}
        />
      </Suspense>

      {/* Contact shadow — the single strongest cue that the dish is *on* the
          plate rather than floating in front of it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[dishRadius * 1.05, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} />
      </mesh>

      {item.clashes.length > 0 ? (
        // Undoes the dish's tilt. The banner sits above the food, so tipping
        // the dish toward the camera swings the banner forward with it and it
        // is drawn wider than the frame — the one thing a warning must not be.
        <group rotation={[-tilt, 0, 0]}>
          <AllergenWarningOverlay
            radius={dishRadius}
            maxWidth={visibleWidth * 0.88}
            clashes={item.clashes}
            reducedMotion={reducedMotion}
          />
        </group>
      ) : null}
    </group>
  );
}

/** Lighting tuned to read against a live camera feed rather than a dark page. */
function SceneLighting() {
  return (
    <>
      <ambientLight intensity={1.5} />
      <directionalLight position={[1.5, 3, 2]} intensity={2.1} />
      <directionalLight position={[-2, 1, -1]} intensity={0.6} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Reduced motion                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `prefers-reduced-motion` read as an external store.
 *
 * The AR warning pulses and the dish eases into place; a diner who has asked
 * the OS for reduced motion gets neither. Reading the media query through
 * `useSyncExternalStore` keeps the server snapshot honest (no motion assumed)
 * and avoids a second render on mount.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function getReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerReducedMotion(): boolean {
  return false;
}

/* -------------------------------------------------------------------------- */
/*  Viewer                                                                     */
/* -------------------------------------------------------------------------- */

export function TasteBuddyARViewer({
  item,
  onClose,
}: TasteBuddyARViewerProps) {
  const camera = useCameraStream();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef<PlateTracker>(new PlateTracker());
  const rafRef = useRef<number | null>(null);

  const [anchor, setAnchor] = useState<PlateObservation | null>(null);
  const [trackingState, setTrackingState] =
    useState<TrackingState>("searching");

  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion,
  );

  // Device capability is fixed for the life of the session, so it is read once
  // during the initial render rather than patched in from an effect.



  // The procedural dish renders straight away; the generated mesh replaces it
  // only once the CDN object is confirmed to exist.

  /* ---- Camera ------------------------------------------------------------- */

  const requestCamera = camera.request;

  useEffect(() => {
    void requestCamera();
  }, [requestCamera]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !camera.stream) return;

    video.srcObject = camera.stream;
    // iOS refuses to autoplay without both of these, even muted.
    video.setAttribute("playsinline", "true");
    video.muted = true;
    void video.play().catch(() => {
      /* A rejected play() resolves once the diner taps; nothing to do here. */
    });

    return () => {
      video.srcObject = null;
    };
  }, [camera.stream]);

  /* ---- Tracking loop ------------------------------------------------------ */

  useEffect(() => {
    if (camera.status !== "granted") return;

    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement("canvas");
      sampleCanvasRef.current.width = SAMPLE_WIDTH;
      sampleCanvasRef.current.height = SAMPLE_HEIGHT;
    }

    const canvas = sampleCanvasRef.current;
    // `willReadFrequently` keeps the surface on the CPU, which is what makes
    // a per-frame getImageData affordable.
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    let disposed = false;
    // The tracker runs at ~15 Hz; the renderer stays at display rate.
    const intervalMs = 1000 / 15;
    let lastRun = 0;

    const step = (timestamp: number) => {
      if (disposed) return;
      rafRef.current = requestAnimationFrame(step);

      if (timestamp - lastRun < intervalMs) return;
      lastRun = timestamp;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      // The camera's shape, not the buffer's: a phone held upright sends a
      // portrait stream, and squashing that into a fixed landscape buffer
      // turns every plate into an ellipse too wide for the tracker to accept.
      const { width, height } = sampleSizeFor(video.videoWidth, video.videoHeight);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      try {
        context.drawImage(video, 0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        const snapshot = trackerRef.current.update(frame.data, width, height);

        // What the tracker measured is in the stream's coordinates; the feed
        // is on screen under `object-fit: cover`, which crops it. A hand
        // placement already came from the screen, so it is left alone.
        const viewWidth = video.clientWidth;
        const viewHeight = video.clientHeight;
        const anchored =
          snapshot.anchor && snapshot.state !== "manual" && viewHeight > 0
            ? toViewport(
                snapshot.anchor,
                video.videoWidth / video.videoHeight,
                viewWidth / viewHeight,
              )
            : snapshot.anchor;

        setAnchor(anchored);
        setTrackingState(snapshot.state);
      } catch {
        // A tainted canvas or a torn-down stream must not kill the loop.
      }
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      disposed = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [camera.status]);

  /* ---- Manual placement --------------------------------------------------- */

  const handleTapToPlace = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;

      const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);

      const snapshot = trackerRef.current.placeManually(x, y);
      setAnchor(snapshot.anchor);
      setTrackingState(snapshot.state);
    },
    [],
  );

  const handleRetrack = useCallback(() => {
    const snapshot = trackerRef.current.reset();
    setAnchor(snapshot.anchor);
    setTrackingState(snapshot.state);
  }, []);

  const handleClose = useCallback(() => {
    camera.stop();
    onClose();
  }, [camera, onClose]);

  // Escape closes the viewer, and the camera is released on unmount by the hook.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  const cameraReady = camera.status === "granted";

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={`AR view of ${item.name}`}
    >
      {/* Camera feed, composited by the browser behind the canvas. */}
      <video
        ref={videoRef}
        className="absolute inset-0 size-full object-cover"
        playsInline
        muted
        autoPlay
        aria-hidden
      />

      {/* WebGL canvas. Transparent so the feed shows through. */}
      {cameraReady ? (
        <div className="absolute inset-0" onPointerDown={handleTapToPlace}>
          <Canvas
            gl={{
              alpha: true,
              antialias: true,
              powerPreference: "high-performance",
            }}
            // Cap the pixel ratio: a 3x phone screen triples the fragment cost
            // for no visible gain over a camera feed.
            dpr={[1, 2]}
            camera={{
              fov: CAMERA_FOV_DEGREES,
              near: 0.01,
              far: 20,
              position: [0, 0, 0],
            }}
            style={{ background: "transparent" }}
          >
            <SceneLighting />
            <AnchoredDish
              item={item}
              anchor={anchor}
              trackingState={trackingState}
              reducedMotion={reducedMotion}
            />
          </Canvas>
        </div>
      ) : null}

      <ARChrome
        item={item}
        cameraStatus={camera.status}
        cameraError={camera.errorMessage}
        trackingState={trackingState}
        onRetry={() => void camera.request()}
        onRetrack={handleRetrack}
        onClose={handleClose}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  DOM chrome                                                                 */
/* -------------------------------------------------------------------------- */

interface ARChromeProps {
  item: ARDish;
  cameraStatus: ReturnType<typeof useCameraStream>["status"];
  cameraError: string | null;
  trackingState: TrackingState;
  onRetry: () => void;
  onRetrack: () => void;
  onClose: () => void;
}

const TRACKING_COPY: Readonly<Record<TrackingState, string>> = {
  searching: "Point at an empty plate",
  acquiring: "Hold still, finding the plate",
  locked: "Plate locked",
  manual: "Placed by hand",
};

function ARChrome({
  item,
  cameraStatus,
  cameraError,
  trackingState,
  onRetry,
  onRetrack,
  onClose,
}: ARChromeProps) {


  return (
    <>
      {/* Top bar */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-10">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-white">
            {item.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/75">
            {trackingState === "acquiring" ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <Crosshair className="size-3" aria-hidden />
            )}
            {TRACKING_COPY[trackingState]}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-control bg-black/55 text-white backdrop-blur"
          aria-label="Close AR view"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {/* Allergen banner. The authoritative warning is the 3D overlay on the
          model; this repeats it for screen readers and for a diner glancing at
          the edge of the screen. */}
      {item.clashes.length > 0 ? (
        <div
          role="alert"
          className="safe-top pointer-events-none absolute inset-x-0 top-16 z-20 mx-4 rounded-control border-2 border-white/85 bg-[var(--color-ar-alert)] px-4 py-3 text-white shadow-lg tb-alert-pulse"
        >
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            Allergen warning
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {item.clashes.map((clash) => (
              <li key={clash.key}>
                {clash.likelihood === "usually" ? "Usually" : "Sometimes"} has{" "}
                {ALLERGEN_CATALOG[clash.key].label.toLowerCase()}
                {clash.from ? `, from ${clash.from}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Reticle, shown only while hunting for the plate. */}
      {cameraStatus === "granted" &&
      (trackingState === "searching" || trackingState === "acquiring") ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            className={[
              "size-48 rounded-control border-2 border-dashed border-white/70",
              trackingState === "acquiring" ? "tb-pulse" : "",
            ].join(" ")}
          />
        </div>
      ) : null}

      {/* Camera permission / error states */}
      {cameraStatus !== "granted" ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/90 px-6">
          <div className="max-w-sm text-center text-white">
            {cameraStatus === "requesting" ? (
              <>
                <Camera className="mx-auto size-8 animate-pulse" aria-hidden />
                <p className="mt-4 text-base font-medium">
                  Opening the camera…
                </p>
                <p className="mt-1 text-sm text-white/70">
                  Allow camera access to place {item.name} on your table.
                </p>
              </>
            ) : (
              <>
                <CameraOff
                  className="mx-auto size-8 text-[var(--color-ar-alert-ink)]"
                  aria-hidden
                />
                <p className="mt-4 text-base font-medium">
                  {cameraStatus === "denied"
                    ? "Camera access blocked"
                    : "Camera unavailable"}
                </p>
                <p className="mt-1 text-sm text-white/70">
                  {cameraError ?? "The camera could not be started."}
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-control bg-white px-4 py-2 text-sm font-medium text-black"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-control border border-white/40 px-4 py-2 text-sm font-medium text-white"
                  >
                    Back to menu
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Bottom controls */}
      {cameraStatus === "granted" ? (
        <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-4 pt-12">
          <p className="pointer-events-none flex items-center gap-1.5 rounded-control bg-black/55 px-3 py-2 text-xs text-white/85 backdrop-blur">
            <Hand className="size-3.5" aria-hidden />
            Tap anywhere to place it yourself
          </p>

          {trackingState === "manual" ? (
            <button
              type="button"
              onClick={onRetrack}
              className="pointer-events-auto flex items-center gap-1.5 rounded-control bg-white/95 px-3 py-2 text-xs font-medium text-black"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Re-track
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export default TasteBuddyARViewer;
