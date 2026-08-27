import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";

import "./globals.css";

/*
 * Two faces, doing different jobs.
 *
 * Fraunces carries the restaurant's name and the dish names: it is an
 * old-style serif with an optical-size axis, so it stays warm at menu sizes
 * instead of turning into a wall of neutral sans. Instrument Sans handles
 * everything a person has to act on, where character is a liability.
 *
 * Both are variable and subset to Latin, which is one file each.
 */
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display-variable",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans-variable",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TasteBuddy",
    template: "%s · TasteBuddy",
  },
  description:
    "Photograph a menu you cannot read and it tells you what every dish is, and flags anything that clashes with your allergies.",
  applicationName: "TasteBuddy",
  appleWebApp: {
    capable: true,
    title: "TasteBuddy",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // The AR canvas must own the viewport: no zoom, no browser chrome shifting
  // under the camera feed.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1011" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-bg text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
