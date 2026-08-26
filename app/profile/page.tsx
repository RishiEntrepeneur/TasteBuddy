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
 */
export default function ProfilePage() {
  return (
    <div className="min-h-dvh bg-slate-950">
      <div className="mx-auto w-full max-w-md px-4 pb-16 safe-top">
        <header className="flex items-center justify-between py-5">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[13px] text-slate-400 transition-colors hover:text-slate-200"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </Link>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
            <QrCode className="size-3" aria-hidden />
            TasteBuddy
          </span>
        </header>

        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-50">
          What do you avoid?
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-400">
          Set this once. Every menu you scan re-checks itself, and the AR view
          overlays a warning on any dish that matches.
        </p>

        <div className="mt-6">
          <AllergySelector />
        </div>

        <p className="mt-6 text-[12px] leading-relaxed text-slate-600">
          Stored in this browser and nowhere else. If you have a severe allergy,
          always confirm with your server.
        </p>
      </div>
    </div>
  );
}
