"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Component, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

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
  /** World diameter to fit the dish into, in metres. */
  targetDiameter: number;
  /** Portion multiplier. Volume is linear in this, so length goes as its cube root. */
  portion: number;
  /** Tint used by the procedural fallback. */
  accentColor: string;
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
 * Procedural stand-in: a shallow bowl of food on the plate.
 *
 * Intentionally abstract. It reads as "a serving of this size" without
 * pretending to be a photoreal render of a dish we have not generated yet.
 */
function ProceduralDish({
  targetDiameter,
  portion,
  accentColor,
}: DishModelProps) {
  const group = useRef<THREE.Group>(null);
  const radius = (targetDiameter / 2) * Math.cbrt(portion);

  useFrame((_, delta) => {
    // A slow turn makes the volume readable from a static camera.
    if (group.current) group.current.rotation.y += delta * 0.35;
  });

  const color = useMemo(() => new THREE.Color(accentColor), [accentColor]);

  return (
    <group ref={group}>
      <mesh position={[0, radius * 0.42, 0]}>
        <sphereGeometry
          args={[radius * 0.78, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2]}
        />
        <meshStandardMaterial color={color} roughness={0.72} metalness={0.05} />
      </mesh>
      <mesh position={[0, radius * 0.06, 0]}>
        <cylinderGeometry
          args={[radius * 0.92, radius * 0.84, radius * 0.12, 48]}
        />
        <meshStandardMaterial
          color="#f5f5f4"
          roughness={0.35}
          metalness={0.02}
        />
      </mesh>
    </group>
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
