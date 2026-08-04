import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/env-url";

const appUrl = getAppUrl();

/** Only the public marketing/auth pages; the app itself is behind login. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: appUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${appUrl}/login`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${appUrl}/signup`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
