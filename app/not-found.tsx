import { QrCode } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <QrCode className="size-8 text-ink-muted" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">
        This table code is not live
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        The QR code may have been reprinted, or the venue is no longer on
        TasteBuddy. Ask a member of staff for the current code.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:border-ink"
      >
        Back to TasteBuddy
      </Link>
    </main>
  );
}
