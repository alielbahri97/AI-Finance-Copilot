import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { BRAND, BRAND_TITLE, BRAND_TITLE_TEMPLATE } from "@/lib/branding";
import { getAppUrl } from "@/lib/env-url";

import "./globals.css";

// getAppUrl() falls back sanely when NEXT_PUBLIC_APP_URL is unset and throws a
// message naming the variable when it is set to something unparseable, so a
// typo here can no longer surface as a bare "TypeError: Invalid URL" while
// Next collects page data.
const appUrl = getAppUrl();

// Fonts are self-hosted rather than pulled via next/font/google: `next build`
// runs on networks where fonts.googleapis.com is unreachable, and the Google
// loader fetches CSS and binaries at build time. The .woff2 files are copied
// into this repo from @fontsource-variable/* so the build never needs the
// network; re-copy from node_modules/@fontsource-variable/<family>/files when
// bumping those packages.
const inter = localFont({
  src: [
    {
      path: "./fonts/inter-latin-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "./fonts/inter-latin-wght-italic.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: [
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
  adjustFontFallback: "Arial",
});

const jetBrainsMono = localFont({
  src: [
    {
      path: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
      weight: "100 800",
      style: "normal",
    },
  ],
  variable: "--font-mono-custom",
  display: "swap",
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Consolas",
    "Liberation Mono",
    "monospace",
  ],
  // Deriving fallback metrics from Arial (the only sans option next/font
  // offers) would mis-size the monospace stack this actually falls back to.
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: BRAND_TITLE,
    template: BRAND_TITLE_TEMPLATE,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: BRAND.name,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: BRAND_TITLE,
    description: BRAND.description,
    url: appUrl,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#005ADB" },
    { media: "(prefers-color-scheme: dark)", color: "#002561" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetBrainsMono.variable}`}
    >
      <body className="font-sans">
        <a
          href="#main-content"
          className="bg-primary text-primary-foreground focus:ring-ring sr-only rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
        >
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <PwaRegister />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
