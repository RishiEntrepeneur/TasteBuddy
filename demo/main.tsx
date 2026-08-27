import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { TasteBuddyApp } from "@/components/app/TasteBuddyApp";

import { Intro } from "./Intro";
import { installLocalKitchen } from "./kitchen";

/**
 * The demo build's entry point.
 *
 * It mounts the app's own root component, unchanged. The only difference
 * between this and the real thing is that `installLocalKitchen` answers the two
 * API routes from a list bundled into the file, because a published page has
 * no way to reach a server — see `kitchen.ts`.
 */

installLocalKitchen();

const mount = document.getElementById("root");
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <TasteBuddyApp />
      <Intro />
    </StrictMode>,
  );
}
