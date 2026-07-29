import type { Metadata, Viewport } from "next";

import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "FinPilot — AI Finance Copilot",
    template: "%s | FinPilot",
  },
  description:
    "AI finance copilot for small and medium-sized businesses. Track income and expenses, visualize spending, and get grounded insights.",
  applicationName: "FinPilot",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FinPilot",
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
    siteName: "FinPilot",
    title: "FinPilot — AI Finance Copilot",
    description:
      "AI finance copilot for small and medium-sized businesses. Track income and expenses, visualize spending, and get grounded insights.",
    url: appUrl,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4F46E5" },
    { media: "(prefers-color-scheme: dark)", color: "#312E81" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <a
          href="#main-content"
          className="bg-primary text-primary-foreground focus:ring-ring sr-only rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
        >
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <PwaRegister />
          <PwaInstallPrompt />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
