import type { Metadata } from "next";
import { ArrowLeft, QrCode } from "lucide-react";
import Link from "next/link";

import { AllergySelector } from "@/components/AllergySelector";

export const metadata: Metadata = {
  title: "Allergy profile",
  description:
    "Set what you avoid once. Every TasteBuddy menu and AR view checks itself against it.",
};

/**
 * The standalone allergy profile screen.
 *
 * Deliberately its own route rather than a panel inside a venue's menu: the
 * profile belongs to the diner, not to the restaurant whose branding wraps the
 * menu page, and it is set once and reused across every venue they scan.
 *
 * Uses the shared surface and ink tokens rather than any colour of its own, so
 * it sits on the same alabaster ground as the menu blocks.
 */
export default function ProfilePage() {
  return (
    <div className="min-h-dvh bg-surface">
      <div className="safe-top mx-auto w-full max-w-md px-5 pb-16">
        <header className="flex items-center justify-between py-5">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </Link>
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            <QrCode className="size-3" aria-hidden />
            TasteBuddy
          </span>
        </header>

        <h1 className="mt-3 font-display text-[2rem] leading-[1.1] tracking-tight text-ink">
          What do you avoid?
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-ink-muted">
          Set this once. Every menu you scan re-checks itself, and the AR view
          overlays a warning on any dish that matches.
        </p>

        <div className="mt-7">
          <AllergySelector />
        </div>

        <p className="mt-6 text-[13px] leading-relaxed text-ink-muted">
          Stored in this browser and nowhere else. If you have a severe allergy,
          always confirm with your server.
        </p>
      </div>
    </div>
  );
}
