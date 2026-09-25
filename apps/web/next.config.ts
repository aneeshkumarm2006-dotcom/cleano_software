import path from "node:path";
import type { NextConfig } from "next";

// The monorepo root. npm hoists dependencies there, so the Prisma query engine
// lives in <root>/node_modules/.prisma — outside this app's folder. Both roots
// below must reach it or Vercel ships server bundles without the engine. Next
// would infer the same from the lockfile; saying it keeps a stray lockfile in
// apps/web from silently changing the answer.
//
// __dirname exists because Next loads this file as CommonJS, which it does
// while package.json has no "type": "module". Adding that would make this
// undefined and quietly drop the engine from the bundles.
const WORKSPACE_ROOT = path.join(__dirname, "..", "..");

// Routes that moved under /admin/* (admin-only + shared admin/cleaner pages).
const ADMIN_ROUTES = [
  "dashboard","analytics","kpi","calendar","contacts","jobs","requests","waitlist",
  "documents","clients","web-bookings","leads","chat","employees","job-applications",
  "training-docs","announcements","inventory","sales","reports","quotes","gift-cards",
  "payouts","finances","invoices","bulk-charge","properties","logs","settings",
  "training","recurring","promo-codes","wash-payouts",
];
// Routes that moved under /cleaners/*.
const CLEANER_ROUTES = ["my-jobs","my-pay","my-inventory","available-jobs","availability"];

const nextConfig: NextConfig = {
  // Type errors fail the build. Turned on for the multi-tenant migration: the
  // compiler is the guardrail that catches a query missing its organization
  // scope across ~1,400 call sites. Do not re-enable ignoreBuildErrors.
  typescript: {
    ignoreBuildErrors: false,
  },
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  turbopack: { root: WORKSPACE_ROOT },
  outputFileTracingRoot: WORKSPACE_ROOT,
  experimental: {
    // Careers résumé uploads stream through a server action; the default 1 MB
    // body limit 400s before our 8 MB size check runs. Keep these in sync.
    serverActions: { bodySizeLimit: "10mb" },
  },
  // Backward-compatible redirects from the old flat routes to the new
  // /admin/*, /cleaners/*, and customer-root (/) structure. Temporary (307/308
  // off) so they can be removed once external links/emails have aged out.
  // Shared admin/cleaner pages redirect to the /admin/* variant; the area
  // layout then bounces non-admins to their own home.
  async redirects() {
    const mk = (route: string, prefix: string) => [
      { source: `/${route}`, destination: `${prefix}/${route}`, permanent: false },
      { source: `/${route}/:path*`, destination: `${prefix}/${route}/:path*`, permanent: false },
    ];
    return [
      ...ADMIN_ROUTES.flatMap((r) => mk(r, "/admin")),
      ...CLEANER_ROUTES.flatMap((r) => mk(r, "/cleaners")),
      { source: "/portal", destination: "/", permanent: false },
      { source: "/portal/:path*", destination: "/:path*", permanent: false },
    ];
  },
  // Baseline security headers applied to every response. Intentionally NOT a
  // full CSP (would need per-source allowlisting for Stripe/Cloudinary/Leaflet/
  // inline styles); `frame-ancestors`/X-Frame-Options stop clickjacking without
  // risking breakage.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
