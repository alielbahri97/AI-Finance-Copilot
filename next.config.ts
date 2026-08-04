import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy, as strict as feasible with Next.js:
 * - script-src needs 'unsafe-inline' for Next's inline bootstrap scripts
 *   (nonce-based CSP requires dynamic rendering everywhere) and
 *   'unsafe-eval' only in development (React Refresh).
 * - cdn.plaid.com hosts the Plaid Link script and iframe.
 * - Supabase (storage signed URLs, auth) must be reachable from the browser;
 *   invoice previews embed storage URLs in img/iframe.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://cdn.plaid.com`,
  "style-src 'self' 'unsafe-inline'",
  // GoCardless institution logos are served from their CDN / GCS buckets.
  "img-src 'self' blob: data: https://*.supabase.co https://cdn-logos.gocardless.com https://storage.googleapis.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://sandbox.plaid.com https://production.plaid.com wss://*.supabase.co",
  "frame-src https://cdn.plaid.com https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // 2 years, ready for preload list submission.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
  headers: async () => [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    {
      source: "/manifest.webmanifest",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
    {
      source: "/icons/(.*)",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
  ],
};

export default nextConfig;
