"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import * as THREE from "three";

import { DishModel } from "@/components/ar/DishModel";

/**
 * The card's photograph, except that it is not one.
 *
 * Nothing in this app has a picture of the real plate. The geometry is built
 * from the dish's own name every time: `lib/ar/dish-geometry` picks an
 * archetype from the words and seeds it from a hash of them, so the same dish
 * looks the same on every phone without anything ever being uploaded.
 *
 * The line underneath is not a disclaimer bolted on. It is the difference
 * between showing somebody the kind of thing that arrives, which is useful,
 * and letting them believe they are looking at what the kitchen will actually
 * plate, which is not.
 */

interface DishPreview3DProps {
  /** The dish's name. Picks the shape. */
  name: string;
  /** What is in it. Only consulted when the name says nothing. */
  description?: string;
  /** How it turns up: "one long roll". Names the form when the name does not. */
  servedAs?: string;
  /** False when the dish is not known: the plate comes out empty. */
  recognised?: boolean;
}

export function DishPreview3D({
  name,
  description,
  servedAs,
  recognised = true,
}: DishPreview3DProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.19, 0.34], fov: 38 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
      }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[0.4, 0.9, 0.5]} intensity={1.7} />
      <directionalLight position={[-0.5, 0.4, -0.3]} intensity={0.35} />

      <Suspense fallback={null}>
        <DishModel
          url={null}
          name={name}
          description={description}
          servedAs={servedAs}
          recognised={recognised}
          targetDiameter={0.25}
          portion={1}
        />
      </Suspense>

      {/*
        A table, not a disc. Sized past the frame on purpose: a ground
        plane whose edge is visible reads as an object floating in a void,
        which is the opposite of what this is for.
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <circleGeometry args={[2, 64]} />
        <meshStandardMaterial color="#eceae5" roughness={0.95} />
      </mesh>

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        // Looking at the food rather than at the tablecloth under it.
        target={[0, 0.045, 0]}
        minPolarAngle={0.35}
        maxPolarAngle={1.25}
        autoRotate
        autoRotateSpeed={0.65}
      />
    </Canvas>
  );
}
