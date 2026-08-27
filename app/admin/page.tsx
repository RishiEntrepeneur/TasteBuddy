import type { Metadata } from "next";

import { MenuEditor } from "@/components/admin/MenuEditor";

export const metadata: Metadata = {
  title: "Menu editor",
  description:
    "Edit your venue’s dishes, ingredients and allergen declarations.",
  // Staff tooling: never index it, and never leak the venue via a referrer.
  robots: { index: false, follow: false },
};

/**
 * The restaurant-side menu editor.
 *
 * Client-rendered because the whole page depends on a session cookie the
 * server would otherwise have to branch on twice — once to decide whether to
 * render the sign-in form, once for the data. The API enforces the session on
 * every call regardless of what this renders.
 */
export default function AdminPage() {
  return <MenuEditor />;
}
