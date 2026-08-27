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
  /** The dish's name. Picks the recipe. */
  name: string;
  /** What is in it, consulted only when the name says nothing. */
  description?: string;
  /** How it turns up: "one long roll". Names the form when the name does not. */
  servedAs?: string;
  /** False when the dish is not known. Draws an empty plate. */
  recognised?: boolean;
  /** World diameter to fit the dish into, in metres. */
  targetDiameter: number;
  /** Portion multiplier. Volume is linear in this, so length goes as its cube root. */
  portion: number;
}

/**
 * The object's own size, in its own units, along its longest axis.
 *
 * Measured with the object's scale reset first, and that is the whole point:
 * `setFromObject` walks world matrices, so measuring a mesh that is already
 * scaled to fit returns the fitted size. Divide by that and the scale comes
 * back as 1 — the mesh springs to its native size the moment the target
 * changes, which on a tracked plate is every frame.
 */
function intrinsicSize(object: THREE.Object3D): number {
  const scale = object.scale.clone();
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);

  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());

  object.scale.copy(scale);
  object.updateMatrixWorld(true);

  const longest = Math.max(size.x, size.y, size.z);
  return Number.isFinite(longest) && longest > 0 ? longest : 1;
}

/** The bottom of the object, in its own units, so it can sit on the plate. */
function intrinsicFloor(object: THREE.Object3D): number {
  const scale = object.scale.clone();
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);

  const { min } = new THREE.Box3().setFromObject(object);

  object.scale.copy(scale);
  object.updateMatrixWorld(true);

  return Number.isFinite(min.y) ? min.y : 0;
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

  // Measured once per model, never per target: see `intrinsicSize`.
  const own = useMemo(
    () => ({ longest: intrinsicSize(model), floor: intrinsicFloor(model) }),
    [model],
  );
  const baseScale = targetDiameter / own.longest;

  // Volume scales with the portion, so each linear dimension scales with its
  // cube root — a "double portion" is not a dish twice as wide.
  const scale = baseScale * Math.cbrt(portion);

  // Sit the mesh on the plate rather than through it.
  const yOffset = -own.floor * baseScale;

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
function ProceduralDish({
  name,
  description,
  servedAs,
  recognised,
  targetDiameter,
  portion,
}: DishModelProps) {
  const built = useMemo(
    () => buildDish({ name, description, servedAs, recognised }),
    [name, description, servedAs, recognised],
  );

  // Built imperatively, so nothing else will release it.
  useEffect(() => built.dispose, [built]);

  const longest = useMemo(() => intrinsicSize(built.group), [built]);
  const baseScale = targetDiameter / longest;

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
