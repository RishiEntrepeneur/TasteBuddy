"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { MenuItemConflict } from "@/lib/types";

/**
 * The allergen warning, rendered *in the scene* directly over the dish.
 *
 * Two parts, both anchored to the model rather than to the screen:
 *
 *   1. A translucent red shell enclosing the food. It is unmissable at a
 *      glance and, critically, it moves with the dish — a diner who tilts
 *      their phone can never see an un-warned plate.
 *   2. A camera-facing banner sprite above it naming the allergen.
 *
 * The banner is drawn into a 2D canvas and uploaded as a texture rather than
 * built from `troika` text or a DOM overlay: no font fetch, no layout pass,
 * and it stays crisp and legible over a live camera feed.
 */

interface AllergenWarningOverlayProps {
  /** World radius of the dish being warned about, in metres. */
  radius: number;
  /**
   * Widest the banner may be drawn, in world metres — the visible frustum width
   * at the dish's depth, less a margin. Sizing the banner from the dish alone
   * clips it off-screen for a large dish and leaves it tiny for a small one.
   */
  maxWidth: number;
  /** Allergen conflicts to name. Nutrition conflicts are not shown in AR. */
  conflicts: readonly MenuItemConflict[];
  /** Honours the diner's reduced-motion preference. */
  reducedMotion: boolean;
}

/*
 * Alert colours for the AR scene, fixed rather than read from the theme.
 *
 * These composite over a live camera feed, so there is no app ground behind
 * them to adapt to. Holding them constant also keeps white-on-fill at 6.82:1
 * in both themes; the lifted dark-mode terracotta would drop it to 2.79:1.
 * On dark scenes it is the white outline, not the fill, that carries the
 * warning — white reads at 11:1 or better against dark wood.
 */
const ALERT_FILL = "#9c3b2e";
const ALERT_FILL_RGB = "156, 59, 46";
const ALERT_OUTLINE = "#eab3a3";

const BANNER_WIDTH = 512;
const BANNER_HEIGHT = 128;

function drawBanner(
  context: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);

  // Rounded plate behind the text, so it reads against any background.
  const radius = 26;
  context.fillStyle = `rgba(${ALERT_FILL_RGB}, 0.94)`;
  context.beginPath();
  context.moveTo(radius, 0);
  context.lineTo(width - radius, 0);
  context.quadraticCurveTo(width, 0, width, radius);
  context.lineTo(width, height - radius);
  context.quadraticCurveTo(width, height, width - radius, height);
  context.lineTo(radius, height);
  context.quadraticCurveTo(0, height, 0, height - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 4;
  context.stroke();

  context.textAlign = "center";
  context.textBaseline = "middle";

  context.fillStyle = "#ffffff";
  context.font =
    'bold 46px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
  context.fillText(`⚠  ${title}`, width / 2, height / 2 - 18, width - 40);

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.font =
    '28px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
  context.fillText(subtitle, width / 2, height / 2 + 30, width - 40);
}

export function AllergenWarningOverlay({
  radius,
  maxWidth,
  conflicts,
  reducedMotion,
}: AllergenWarningOverlayProps) {
  const shell = useRef<THREE.Mesh>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const { invalidate } = useThree();

  const allergenConflicts = conflicts.filter(
    (conflict) => conflict.type === "allergen",
  );

  const { title, subtitle } = useMemo(() => {
    const names = allergenConflicts.map((conflict) =>
      String(conflict.key).replace(/_/g, " "),
    );
    const unique = [...new Set(names)];
    return {
      title:
        unique.length === 1
          ? `Contains ${unique[0]}`
          : `Contains ${unique.length} of your allergens`,
      subtitle: unique.join(" · ").toUpperCase(),
    };
  }, [allergenConflicts]);

  // The banner texture is rebuilt only when the wording changes.
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;

    const canvas = document.createElement("canvas");
    canvas.width = BANNER_WIDTH;
    canvas.height = BANNER_HEIGHT;

    const context = canvas.getContext("2d");
    if (!context) return null;

    drawBanner(context, title, subtitle);

    const created = new THREE.CanvasTexture(canvas);
    created.colorSpace = THREE.SRGBColorSpace;
    created.needsUpdate = true;
    return created;
  }, [title, subtitle]);

  useEffect(() => {
    invalidate();
    return () => texture?.dispose();
  }, [texture, invalidate]);

  useFrame(({ clock }) => {
    if (reducedMotion) return;

    // A slow pulse draws the eye without strobing — this sits over a live
    // camera feed and must not become a photosensitivity hazard.
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3.4);

    const material = shell.current?.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      // Terracotta carries less chroma than the red it replaced, so it tints
      // the model less at the same alpha. The range is lifted to keep the
      // wash as legible over a camera feed as it was before, while staying
      // translucent enough to read the dish underneath.
      material.opacity = 0.26 + pulse * 0.24;
    }

    if (sprite.current) {
      sprite.current.position.y = radius * 2.05 + pulse * radius * 0.06;
    }
  });

  if (allergenConflicts.length === 0) return null;

  // Track the dish, but never past the edge of the frame: a 24cm plate would
  // otherwise push the banner wider than the viewport and clip both ends.
  const bannerWidth = Math.min(radius * 2.4, maxWidth);
  const bannerHeight = bannerWidth * (BANNER_HEIGHT / BANNER_WIDTH);

  return (
    <group renderOrder={10}>
      {/* Translucent shell over the food itself. */}
      <mesh ref={shell} position={[0, radius * 0.5, 0]}>
        <sphereGeometry args={[radius * 1.12, 24, 16]} />
        <meshBasicMaterial
          color={ALERT_FILL}
          transparent
          opacity={0.36}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Hard outline so the warning survives a bright, blown-out camera feed. */}
      <mesh position={[0, radius * 0.5, 0]}>
        <sphereGeometry args={[radius * 1.14, 24, 16]} />
        <meshBasicMaterial
          color={ALERT_OUTLINE}
          wireframe
          transparent
          opacity={0.62}
          depthWrite={false}
        />
      </mesh>

      {texture ? (
        <sprite
          ref={sprite}
          position={[0, radius * 2.05, 0]}
          scale={[bannerWidth, bannerHeight, 1]}
          renderOrder={11}
        >
          <spriteMaterial
            map={texture}
            transparent
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      ) : null}
    </group>
  );
}
