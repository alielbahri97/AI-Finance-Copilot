import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Simplified, hand-drawn brand glyphs for the integration tiles. Local SVGs
 * only — nothing is hotlinked. These are deliberately reduced marks (brand
 * color + simple shape/lettermark), not reproductions of the official logos.
 */

type SvgProps = ComponentProps<"svg">;

function Tile({ className, children, ...props }: SvgProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      className={cn("size-10 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

const mark = {
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontWeight: 700,
} as const;

function PlaidIcon(props: SvgProps) {
  // Interlocking-weave suggestion: four rotated squares.
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#111111" />
      <g fill="#ffffff" transform="rotate(45 24 24)">
        <rect x="13" y="13" width="9.5" height="9.5" rx="2" />
        <rect x="25.5" y="13" width="9.5" height="9.5" rx="2" />
        <rect x="13" y="25.5" width="9.5" height="9.5" rx="2" />
        <rect x="25.5" y="25.5" width="9.5" height="9.5" rx="2" opacity="0.55" />
      </g>
    </Tile>
  );
}

function TinkIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#0f0f0f" />
      <text x="24" y="33" textAnchor="middle" fontSize="26" fill="#e9fb5a" style={mark}>
        t
      </text>
    </Tile>
  );
}

function GoCardlessIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#0b2540" />
      <text x="24" y="32" textAnchor="middle" fontSize="22" fill="#ffffff" style={mark}>
        G
      </text>
    </Tile>
  );
}

function QuickBooksIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="24" fill="#2ca01c" />
      <text x="24" y="31" textAnchor="middle" fontSize="17" fill="#ffffff" style={mark}>
        qb
      </text>
    </Tile>
  );
}

function XeroIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="24" fill="#13b5ea" />
      <text x="24" y="30" textAnchor="middle" fontSize="14" fill="#ffffff" style={mark}>
        xero
      </text>
    </Tile>
  );
}

function ExactIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#d81e05" />
      <text x="24" y="32" textAnchor="middle" fontSize="22" fill="#ffffff" style={mark}>
        E
      </text>
    </Tile>
  );
}

function GmailIcon(props: SvgProps) {
  // Envelope "M" silhouette.
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <path
        d="M10 35V15.5l14 10 14-10V35h-5.5V22.5L24 28.7l-8.5-6.2V35Z"
        fill="#ea4335"
      />
    </Tile>
  );
}

function OutlookIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#0f6cbd" />
      <circle cx="24" cy="24" r="10.5" fill="none" stroke="#ffffff" strokeWidth="5" />
    </Tile>
  );
}

function SlackIcon(props: SvgProps) {
  // Four-color pinwheel suggestion.
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#f8fafc" stroke="#e2e8f0" />
      <rect x="21" y="8" width="7" height="15" rx="3.5" fill="#36c5f0" />
      <rect x="25" y="21" width="15" height="7" rx="3.5" fill="#2eb67d" />
      <rect x="20" y="25" width="7" height="15" rx="3.5" fill="#e01e5a" />
      <rect x="8" y="20" width="15" height="7" rx="3.5" fill="#ecb22e" />
    </Tile>
  );
}

function TeamsIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#464eb8" />
      <text x="24" y="32" textAnchor="middle" fontSize="22" fill="#ffffff" style={mark}>
        T
      </text>
    </Tile>
  );
}

function GoogleCalendarIcon(props: SvgProps) {
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" fill="#1a73e8" />
      <rect x="10" y="10" width="28" height="28" rx="4" fill="#ffffff" />
      <text x="24" y="31" textAnchor="middle" fontSize="15" fill="#1a73e8" style={mark}>
        31
      </text>
    </Tile>
  );
}

const ICONS: Record<string, (props: SvgProps) => React.JSX.Element> = {
  plaid: PlaidIcon,
  tink: TinkIcon,
  gocardless: GoCardlessIcon,
  quickbooks: QuickBooksIcon,
  xero: XeroIcon,
  exact: ExactIcon,
  gmail: GmailIcon,
  outlook: OutlookIcon,
  slack: SlackIcon,
  teams: TeamsIcon,
  "google-calendar": GoogleCalendarIcon,
};

export function ProviderIcon({
  providerId,
  ...props
}: SvgProps & { providerId: string }) {
  const Icon = ICONS[providerId];
  if (Icon) return <Icon {...props} />;
  return (
    <Tile {...props}>
      <rect width="48" height="48" rx="10" className="fill-muted" />
    </Tile>
  );
}
