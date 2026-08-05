"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AssetKind } from "@/lib/personal/net-worth";
import { formatCurrency } from "@/lib/utils";

import { AssetDialog } from "./asset-dialog";
import { HoldingsTable } from "./holdings-table";
import { ValuationDialog } from "./valuation-dialog";
import type { HoldingRow } from "./types";

interface HoldingsManagerProps {
  assets: HoldingRow[];
  liabilities: HoldingRow[];
  assetTotal: number;
  liabilityTotal: number;
  currency: string;
  canEdit: boolean;
}

/**
 * The two tables and the three dialogs that write to them. The server owns the
 * figures — every write ends in `router.refresh()` rather than local state, so
 * the tables, the chart and the summary can never drift apart.
 */
export function HoldingsManager({
  assets,
  liabilities,
  assetTotal,
  liabilityTotal,
  currency,
  canEdit,
}: HoldingsManagerProps) {
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HoldingRow | null>(null);
  const [defaultKind, setDefaultKind] = useState<AssetKind>("PROPERTY");
  const [valuing, setValuing] = useState<HoldingRow | null>(null);

  function openCreate(kind: AssetKind) {
    setEditing(null);
    setDefaultKind(kind);
    setAssetDialogOpen(true);
  }

  function openEdit(holding: HoldingRow) {
    setEditing(holding);
    setDefaultKind(holding.kind);
    setAssetDialogOpen(true);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>What you own</CardTitle>
          <CardDescription>
            {assets.length === 0
              ? "Anything your banks do not already report: property, a car, investments."
              : `${formatCurrency(assetTotal, currency)} across ${assets.length} holding${assets.length === 1 ? "" : "s"}, on top of your cash.`}
          </CardDescription>
          {canEdit ? (
            <CardAction>
              <Button size="sm" variant="outline" onClick={() => openCreate("PROPERTY")}>
                <PlusIcon />
                Add asset
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <HoldingsTable
            rows={assets}
            currency={currency}
            canEdit={canEdit}
            onEdit={openEdit}
            onUpdateValue={setValuing}
            emptyMessage="Nothing recorded yet. Your bank balances are already counted."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you owe</CardTitle>
          <CardDescription>
            {liabilities.length === 0
              ? "A mortgage, a car loan, a credit card balance — entered as a positive amount."
              : `${formatCurrency(liabilityTotal, currency)} across ${liabilities.length} debt${liabilities.length === 1 ? "" : "s"}.`}
          </CardDescription>
          {canEdit ? (
            <CardAction>
              <Button size="sm" variant="outline" onClick={() => openCreate("MORTGAGE")}>
                <PlusIcon />
                Add debt
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <HoldingsTable
            rows={liabilities}
            currency={currency}
            canEdit={canEdit}
            onEdit={openEdit}
            onUpdateValue={setValuing}
            emptyMessage="Nothing recorded yet."
          />
        </CardContent>
      </Card>

      <AssetDialog
        key={editing?.id ?? `new-${defaultKind}`}
        open={assetDialogOpen}
        onOpenChange={setAssetDialogOpen}
        holding={editing}
        defaultKind={defaultKind}
        currency={currency}
      />

      {valuing ? (
        <ValuationDialog
          key={valuing.id}
          open
          onOpenChange={(open) => {
            if (!open) setValuing(null);
          }}
          holding={valuing}
          currency={currency}
        />
      ) : null}
    </div>
  );
}
