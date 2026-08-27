import type { MetadataRoute } from "next";

/**
 * What "Add to Home Screen" reads.
 *
 * The point of `standalone` is not decoration: launched from the home screen
 * the app gets the whole screen with no browser chrome over it, which is what
 * the camera view needs and what stops the address bar sliding around under a
 * live feed. The icons themselves are `app/icon.png` and `app/apple-icon.png`;
 * Next serves and links both without being told.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TasteBuddy",
    short_name: "TasteBuddy",
    description:
      "Photograph a menu you cannot read and it tells you what every dish is, and flags anything that clashes with your allergies.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // The light ground. A manifest gets one colour; the two the app actually
    // uses are on `themeColor` in the layout, which does honour the scheme.
    background_color: "#f7f7f5",
    theme_color: "#f7f7f5",
    categories: ["food", "travel", "utilities"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
