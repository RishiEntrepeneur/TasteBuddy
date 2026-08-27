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
  /** Dish name plus its description; both feed the archetype choice. */
  text: string;
}

export function DishPreview3D({ text }: DishPreview3DProps) {
  return (
    <figure className="m-0">
      <div className="relative aspect-[5/4] w-full overflow-hidden bg-sunk">
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
            <DishModel url={null} text={text} targetDiameter={0.25} portion={1} />
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

        {/* Sits on the image so it cannot come between the dish and its name. */}
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-4 pb-2.5 pt-8 text-[11.5px] leading-snug text-white/90">
          Drag to turn it. Not a photo of the real plate.
        </figcaption>
      </div>
    </figure>
  );
}
