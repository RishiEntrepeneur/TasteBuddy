import { Boxes, QrCode, ScanLine, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { listRestaurants } from "@/lib/db/repository";

/**
 * Landing page.
 *
 * Diners never see this — they arrive at `/restaurant/<slug>` straight from the
 * QR code on their table. It exists for restaurant staff testing their own
 * link, and as the entry point for the venue directory.
 */

/**
 * The venue directory changes rarely, so the page is prerendered and refreshed
 * in the background rather than queried on every request.
 */
export const revalidate = 300;

const FEATURES = [
  {
    icon: ScanLine,
    title: "No app to install",
    body: "Scan the code on the table and the menu opens in the browser you already have.",
  },
  {
    icon: Boxes,
    title: "Every dish in 3D",
    body: "Photos become lightweight .glb meshes, so you can put the real portion on your own plate before you order.",
  },
  {
    icon: ShieldCheck,
    title: "Allergies checked first",
    body: "Set your allergens once. Anything that clashes is flagged in the menu and again over the dish in AR.",
  },
] as const;

export default async function HomePage() {
  const restaurants = await listRestaurants();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-16">
      <header>
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-ink-muted">
          <QrCode className="size-3" aria-hidden />
          TasteBuddy
        </p>
        <h1 className="mt-4 font-display text-[2.6rem] leading-[1.05] tracking-tight">
          See the dish before you order it.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-muted">
          A web-native AR menu. One QR code on the table, no download, and every
          plate rendered at the portion you actually want.
        </p>
      </header>

      <ul className="mt-10 space-y-5">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
                {body}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <section className="mt-12">
        <h2 className="text-xs font-medium uppercase tracking-widest text-ink-muted">
          Live venues
        </h2>
        <ul className="mt-3 space-y-2">
          {restaurants.map((restaurant) => (
            <li key={restaurant.id}>
              <Link
                href={`/restaurant/${restaurant.slug}`}
                className="flex items-center justify-between rounded-card border border-border px-4 py-3 transition hover:border-ink"
              >
                <span>
                  <span className="block text-sm font-medium">
                    {restaurant.name}
                  </span>
                  <span className="block text-sm text-ink-muted">
                    {restaurant.tagline}
                  </span>
                </span>
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: restaurant.branding.accentColor }}
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-auto pt-12 text-xs text-ink-muted">
        Allergen data is supplied by each venue. If you have a severe allergy,
        always confirm with your server.
      </footer>
    </div>
  );
}
