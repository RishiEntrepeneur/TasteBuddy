"use client";

import { useGLTF } from "@react-three/drei";
import { Component, useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";

import { buildDish } from "@/lib/ar/dish-geometry";

/**
 * The dish mesh.
 *
 * A generated `.glb` when the pipeline has produced one, and a procedural
 * stand-in when it has not — a dish whose asset is still being generated, or
 * whose CDN object 404s, still has to show the diner *something* on the plate
 * rather than an empty reticle.
 */

interface DishModelProps {
  url: string | null;
  /** Dish name, plus its description when there is one — picks the recipe. */
  text: string;
  /** World diameter to fit the dish into, in metres. */
  targetDiameter: number;
  /** Portion multiplier. Volume is linear in this, so length goes as its cube root. */
  portion: number;
}

/** Fits an object's bounding box into `targetDiameter` on its longest axis. */
function fitScale(object: THREE.Object3D, targetDiameter: number): number {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) return 1;
  return targetDiameter / longest;
}

function GltfDish({
  url,
  targetDiameter,
  portion,
}: DishModelProps & { url: string }) {
  const { scene } = useGLTF(url);

  // Clone so the same cached GLTF can appear in two viewers without them
  // fighting over one transform.
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        // Meshes come out of the generator with unpredictable frustum bounds.
        child.frustumCulled = false;
      }
    });
    return clone;
  }, [scene]);

  const baseScale = useMemo(
    () => fitScale(model, targetDiameter),
    [model, targetDiameter],
  );

  // Volume scales with the portion, so each linear dimension scales with its
  // cube root — a "double portion" is not a dish twice as wide.
  const scale = baseScale * Math.cbrt(portion);

  // Sit the mesh on the plate rather than through it.
  const yOffset = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    return -box.min.y * baseScale;
  }, [model, baseScale]);

  return (
    <primitive
      object={model}
      scale={scale}
      position={[0, yOffset * Math.cbrt(portion), 0]}
    />
  );
}

/**
 * Procedural stand-in, built from `lib/ar/dish-geometry`.
 *
 * Composed per dish rather than shown as one generic shape: a diner looking at
 * an anonymous dome learns nothing about what is coming, and the portion slider
 * has nothing meaningful to scale. The recipe is deterministic, so a dish plates
 * identically every time it is opened.
 */
function ProceduralDish({ text, targetDiameter, portion }: DishModelProps) {
  const built = useMemo(() => buildDish({ text }), [text]);

  // Built imperatively, so nothing else will release it.
  useEffect(() => built.dispose, [built]);

  const baseScale = useMemo(
    () => fitScale(built.group, targetDiameter),
    [built, targetDiameter],
  );

  // Volume scales with the portion, so each linear dimension takes its cube
  // root — the same rule the generated meshes follow.
  return (
    <primitive object={built.group} scale={baseScale * Math.cbrt(portion)} />
  );
}

/* -------------------------------------------------------------------------- */
/*  Error boundary                                                             */
/* -------------------------------------------------------------------------- */

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
  /** Remounts the boundary when the asset URL changes. */
  resetKey: string;
}

interface BoundaryState {
  failed: boolean;
}

/**
 * Catches a failed `.glb` fetch or parse.
 *
 * `useGLTF` throws inside Suspense, and an uncaught throw in the R3F tree takes
 * the whole canvas down — which would leave the diner staring at a black
 * rectangle instead of their table.
 */
class ModelErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previous: BoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  componentDidCatch(error: unknown): void {
    console.warn("[TasteBuddy AR] falling back to procedural dish", error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function DishModel(props: DishModelProps) {
  const fallback = <ProceduralDish {...props} />;

  if (!props.url) return fallback;

  return (
    <ModelErrorBoundary fallback={fallback} resetKey={props.url}>
      <GltfDish {...props} url={props.url} />
    </ModelErrorBoundary>
  );
}

export { ProceduralDish };
