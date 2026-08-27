import type { Metadata } from "next";

import { SavedDishesView } from "@/components/SavedDishesView";

export const metadata: Metadata = {
  title: "Saved dishes",
  description: "Dishes you kept, across every venue you have scanned.",
};

/**
 * The saved list.
 *
 * Rendered on the client because the list is keyed by a token only the browser
 * holds — the server has no way to know whose list to fetch until the request
 * carries it.
 */
export default function SavedPage() {
  return <SavedDishesView />;
}
