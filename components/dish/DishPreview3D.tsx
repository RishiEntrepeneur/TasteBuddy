"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";

import { DishModel } from "@/components/ar/DishModel";

/**
 * The dish, on a plate, turnable.
 *
 * Built from the dish's own name: `lib/ar/dish-geometry` picks an archetype
 * from the words and seeds it from a hash of them, so the same dish looks the
 * same every time without anything having been uploaded. Nothing in this app
 * has a photograph of the actual food, and the caption says so: this shows the
 * *kind* of thing that arrives, which is the question being asked.
 */

interface DishPreview3DProps {
  /** Dish name plus its description; both feed the archetype choice. */
  text: string;
}

export function DishPreview3D({ text }: DishPreview3DProps) {
  return (
    <figure className="m-0">
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-card border border-border bg-surface-raised">
        <Canvas
          dpr={[1, 1.75]}
          camera={{ position: [0, 0.26, 0.42], fov: 40 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
          }}
        >
          <ambientLight intensity={0.75} />
          <directionalLight position={[0.4, 0.8, 0.5]} intensity={1.6} />
          <directionalLight position={[-0.5, 0.4, -0.3]} intensity={0.4} />

          <Suspense fallback={null}>
            <DishModel url={null} text={text} targetDiameter={0.24} portion={1} />
          </Suspense>

          {/* The plate reads as a plate mostly because of what it sits on. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
            <circleGeometry args={[0.3, 48]} />
            <meshStandardMaterial color="#efe9dd" roughness={0.95} />
          </mesh>

          <OrbitControls
            enablePan={false}
            enableZoom={false}
            minPolarAngle={0.3}
            maxPolarAngle={1.35}
            autoRotate
            autoRotateSpeed={0.7}
          />
        </Canvas>
      </div>
      <figcaption className="mt-1.5 text-xs leading-relaxed text-ink-muted">
        Drag to turn it. This is the kind of thing that arrives, not a photo of
        the real plate.
      </figcaption>
    </figure>
  );
}
