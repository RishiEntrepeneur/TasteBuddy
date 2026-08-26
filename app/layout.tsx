import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TasteBuddy",
    template: "%s · TasteBuddy",
  },
  description:
    "Scan the QR code on your table to see every dish in AR, sized to your portion and checked against your allergies.",
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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
