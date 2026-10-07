import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen is per-user and permission-aware, so pages render dynamically
  // per request; Cache Components / Partial Prerendering are left off.
  poweredByHeader: false,
  serverExternalPackages: ["pdf-lib", "qrcode"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
