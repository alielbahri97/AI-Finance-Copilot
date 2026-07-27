import type { MetadataRoute } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // App surface is per-user and noindexed via metadata too; disallowing
        // here keeps crawlers from wasting budget on redirects to /login.
        disallow: ["/api/", "/dashboard", "/transactions", "/invoices", "/forecast",
          "/reports", "/copilot", "/integrations", "/billing", "/admin", "/settings",
          "/notifications", "/import", "/profile", "/onboarding"],
      },
    ],
    sitemap: `${appUrl}/sitemap.xml`,
  };
}
