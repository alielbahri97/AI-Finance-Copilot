import type { MetadataRoute } from "next";

import { BRAND, BRAND_TITLE } from "@/lib/branding";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_TITLE,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#E9F3FF",
    theme_color: "#005ADB",
    categories: ["finance", "business", "productivity"],
    lang: "en",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
