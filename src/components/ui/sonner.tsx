"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // The bottom edge belongs to the mobile tab bar, and the bottom-right
      // corner to the help FAB and the install prompt. Top-centre is the only
      // spot free at every width, and the offset clears the sticky h-16 header
      // so a toast never covers the workspace switcher or the notification
      // bell it is often reporting on.
      position="top-center"
      offset={{ top: "5rem" }}
      mobileOffset={{ top: "5rem", left: "0.75rem", right: "0.75rem" }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // richColors otherwise ships its own hardcoded green/red/amber, so a
          // change to --success or --warning would never reach a toast.
          "--success-bg": "var(--popover)",
          "--success-text": "var(--success)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--destructive)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--popover)",
          "--warning-text": "var(--warning)",
          "--warning-border": "var(--border)",
        } as React.CSSProperties
      }
      richColors
      closeButton
      {...props}
    />
  );
};

export { Toaster };
