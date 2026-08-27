import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-lg place-items-center px-6">
      <div className="text-center">
        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink">
          Nothing here
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-ink-2">
          TasteBuddy is one screen: point it at a menu.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full bg-ink px-6 py-3 text-[15px] font-semibold text-card"
        >
          Take me back
        </Link>
      </div>
    </main>
  );
}
