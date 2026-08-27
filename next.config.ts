import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` ships optional native bindings that must not be traced into the
  // serverless bundle; keeping it external also avoids re-bundling it per route.
  serverExternalPackages: ["pg"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // AR needs the rear camera on this origin and nowhere else.
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(), geolocation=(), xr-spatial-tracking=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
