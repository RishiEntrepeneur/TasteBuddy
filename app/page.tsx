import type { Metadata } from "next";

import { DishFinder } from "@/components/dish/DishFinder";

/**
 * The app.
 *
 * There is nothing to sign into and no restaurant to have joined: somebody is
 * standing in front of a menu they cannot read, and this is the page that
 * answers that. Everything else in the repository serves it or serves the
 * venues that opt in to a richer version at `/restaurant/<slug>`.
 */

export const metadata: Metadata = {
  title: "What is that on the menu?",
  description:
    "Photograph a menu you cannot read and it will tell you what every dish is, and flag anything that clashes with your allergies.",
};

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 pb-24 pt-12 safe-top">
      <DishFinder />
    </main>
  );
}
