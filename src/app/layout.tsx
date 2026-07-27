import type { Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { ReportIssueButton } from "@/components/report-issue/report-issue-button";
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
  openGraph: {
    type: "website",
    siteName: "FinPilot",
    title: "FinPilot — AI Finance Copilot",
    description:
      "AI finance copilot for small and medium-sized businesses. Track income and expenses, visualize spending, and get grounded insights.",
    url: appUrl,
  },
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
          <ReportIssueButton />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
