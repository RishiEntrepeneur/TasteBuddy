import { TasteBuddyApp } from "@/components/app/TasteBuddyApp";

/**
 * The whole app.
 *
 * One route, because it is one thing: point the camera at a menu you cannot
 * read. There is nothing to sign into, no restaurant to have joined, and
 * nothing to install.
 */

export default function Page() {
  return <TasteBuddyApp />;
}
