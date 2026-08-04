"use client";

import { useState } from "react";
import { LockIcon } from "lucide-react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { IntegrationDetail } from "./integration-detail";
import { ProviderIcon } from "./provider-icons";
import type { IntegrationCardData } from "./types";

/** Display groups for the tile grid (finer-grained than the registry categories). */
const GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: "Banks", ids: ["gocardless", "plaid", "tink"] },
  { label: "Accounting", ids: ["quickbooks", "xero", "exact"] },
  { label: "Email & Calendar", ids: ["gmail", "outlook", "google-calendar"] },
  { label: "Messaging", ids: ["slack", "teams"] },
];

interface TileStatus {
  label: string;
  dotClass: string;
}

/**
 * The tile summarises every connection to the provider: the worst status wins
 * (a broken bank must not hide behind a healthy one) and the count is shown
 * once a workspace has more than one.
 */
function tileStatus(data: IntegrationCardData, locked: boolean): TileStatus {
  if (locked) return { label: "Business plan", dotClass: "bg-muted-foreground/40" };
  if (!data.configured) return { label: "Needs setup", dotClass: "bg-muted-foreground/40" };

  const connections = data.connections;
  if (connections.length === 0) return { label: "Available", dotClass: "bg-sky-500" };

  const count = connections.length;
  const suffix = count > 1 ? ` · ${count} connected` : "";
  if (connections.some((connection) => connection.status === "ERROR")) {
    return { label: `Error${suffix}`, dotClass: "bg-destructive" };
  }
  if (connections.some((connection) => connection.status === "EXPIRED")) {
    return { label: `Reconnect${suffix}`, dotClass: "bg-amber-500" };
  }
  return {
    label: count > 1 ? `${count} connected` : "Connected",
    dotClass: "bg-emerald-500",
  };
}

function IntegrationTile({
  data,
  locked,
  onOpen,
}: {
  data: IntegrationCardData;
  locked: boolean;
  onOpen: () => void;
}) {
  const status = tileStatus(data, locked);
  const connected =
    !locked && data.connections.some((connection) => connection.status === "CONNECTED");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "bg-card hover:border-primary/40 hover:shadow-sm focus-visible:ring-ring/50 group flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all focus-visible:ring-2 focus-visible:outline-none",
        connected && "border-emerald-500/40"
      )}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <ProviderIcon providerId={data.id} className={cn(locked && "opacity-60 grayscale-[35%]")} />
        {locked ? <LockIcon className="text-muted-foreground size-4" /> : null}
      </div>
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{data.name}</p>
        <p className="text-muted-foreground line-clamp-2 text-xs">{data.description}</p>
      </div>
      <p className="text-muted-foreground mt-auto flex items-center gap-1.5 text-xs">
        <span className={cn("size-1.5 rounded-full", status.dotClass)} aria-hidden />
        {status.label}
      </p>
    </button>
  );
}

export function IntegrationsGrid({
  cards,
  locked,
}: {
  cards: IntegrationCardData[];
  locked: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const grouped = new Set(GROUPS.flatMap((group) => group.ids));
  const leftovers = cards.filter((card) => !grouped.has(card.id));
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  const renderTiles = (list: IntegrationCardData[]) => {
    // Connected tiles first, keeping the curated order otherwise.
    const sorted = [...list].sort(
      (a, b) => Number(b.connections.length > 0) - Number(a.connections.length > 0)
    );
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {sorted.map((card) => (
          <IntegrationTile
            key={card.id}
            data={card}
            locked={locked}
            onOpen={() => setSelectedId(card.id)}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="space-y-8">
        {GROUPS.map((group) => {
          const list = group.ids
            .map((id) => byId.get(id))
            .filter((card): card is IntegrationCardData => Boolean(card));
          if (list.length === 0) return null;
          return (
            <section key={group.label} className="space-y-3">
              <h2 className="text-lg font-medium">{group.label}</h2>
              {renderTiles(list)}
            </section>
          );
        })}
        {leftovers.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Other</h2>
            {renderTiles(leftovers)}
          </section>
        ) : null}
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          {selected ? <IntegrationDetail data={selected} locked={locked} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
