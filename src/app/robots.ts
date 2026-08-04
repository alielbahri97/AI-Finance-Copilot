import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/env-url";

const appUrl = getAppUrl();

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
