"use client";

import { Box, Image as ImageIcon } from "lucide-react";
import { useState } from "react";

import { DishPreview3D } from "@/components/dish/DishPreview3D";

/**
 * The picture at the top of a dish.
 *
 * Two things can fill it, and they arrive in that order on purpose.
 *
 * The 3D model is built on the device out of the dish's own words, so it is
 * there instantly and it is there offline. It can tell a long roll from a
 * flatbread from a bowl of soup, and it will never look like food.
 *
 * The drawing is fetched from `/api/dish-image` and fades in over the top when
 * it arrives. If it never arrives — the service is down, the phone is on a
 * train, the operator switched it off — the model is already there and nothing
 * happens. That is why the model renders first rather than behind a spinner.
 *
 * Neither is a photograph, and the line underneath says so both times. A dish
 * nobody recognised gets neither: an empty plate, and a caption explaining it.
 */

interface DishFigureProps {
  /** The name to draw, and to pick the 3D shape from. */
  name: string;
  /** The English name, when there is one — it draws better than a transliteration. */
  drawAs?: string;
  /** What is in it. Only consulted when the name says nothing. */
  description?: string;
  /** How it turns up: "one long roll". Names the form when the name does not. */
  servedAs?: string;
  /** False when the dish is not known: nothing is drawn at all. */
  recognised?: boolean;
}

type Drawing = "waiting" | "ready" | "gone";

export function DishFigure({
  name,
  drawAs,
  description,
  servedAs,
  recognised = true,
}: DishFigureProps) {
  const subject = (drawAs || name).trim();
  const [drawing, setDrawing] = useState<Drawing>("waiting");
  const [showing, setShowing] = useState<"drawing" | "model">("drawing");

  // Open a different dish and the drawing starts again. Adjusted during the
  // render rather than in an effect: an effect would paint the previous dish's
  // drawing over the new one for a frame first.
  const [drawnSubject, setDrawnSubject] = useState(subject);
  if (drawnSubject !== subject) {
    setDrawnSubject(subject);
    setDrawing("waiting");
    setShowing("drawing");
  }

  // Nothing is known about it, so nothing is drawn — not by either of them.
  const canDraw = recognised && subject.length >= 2;
  const drawn = canDraw && drawing === "ready" && showing === "drawing";

  return (
    <figure className="m-0">
      <div className="relative aspect-[5/4] w-full overflow-hidden bg-sunk">
        <DishPreview3D
          name={name}
          description={description}
          servedAs={servedAs}
          recognised={recognised}
        />

        {canDraw ? (
          // Not `next/image`: this is already a fixed-size, immutable,
          // CDN-cached asset off this app's own route, so putting the image
          // optimiser in front of it adds a hop and optimises nothing.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/dish-image?dish=${encodeURIComponent(subject)}`}
            alt={`A drawing of ${subject}. Not a photograph, and not this restaurant's plate.`}
            onLoad={() => setDrawing("ready")}
            onError={() => setDrawing("gone")}
            className={[
              "absolute inset-0 size-full object-cover transition-opacity duration-500",
              drawn ? "opacity-100" : "pointer-events-none opacity-0",
            ].join(" ")}
          />
        ) : null}

        {/* Only offered once there is something to switch between. */}
        {canDraw && drawing === "ready" ? (
          <button
            type="button"
            onClick={() => setShowing(drawn ? "model" : "drawing")}
            aria-label={drawn ? "Show the 3D model" : "Show the drawing"}
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[11.5px] font-medium text-white backdrop-blur transition active:scale-95"
          >
            {drawn ? (
              <Box className="size-3.5" aria-hidden />
            ) : (
              <ImageIcon className="size-3.5" aria-hidden />
            )}
            {drawn ? "3D" : "Drawing"}
          </button>
        ) : null}

        {/* Sits on the picture so it cannot come between the dish and its name. */}
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-4 pb-2.5 pt-8 text-[11.5px] leading-snug text-white/90">
          {!recognised
            ? "Nothing is drawn here, because this dish is not known."
            : drawn
              ? "A drawing, not a photo. Not this restaurant's plate."
              : "Drag to turn it. Not a photo of the real plate."}
        </figcaption>
      </div>
    </figure>
  );
}
