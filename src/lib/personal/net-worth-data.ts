import "server-only";
import { cache } from "react";

import type { Asset, AssetValuation } from "@/generated/prisma/client";
import { isSchemaOutOfDate } from "@/lib/db-errors";
import { loadCashPosition } from "@/lib/finance/cash-data";
import type { CashPosition } from "@/lib/finance/cash";
import { logger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import {
  buildNetWorthHistory,
  computeNetWorth,
  HISTORY_MONTHS,
  monthAxis,
  monthEndCashSeries,
  monthKey,
  selectLargestAssets,
  SNAPSHOT_TREND_MONTHS,
  summarizeTrend,
  type AssetInput,
  type AssetKind,
  type MonthNet,
  type NetWorthPoint,
  type NetWorthPosition,
  type NetWorthTrend,
} from "./net-worth";

/**
 * The database boundary for net worth. Everything above this file works in
 * plain numbers and Dates: Prisma `Decimal` is converted here and never handed
 * to a component, and every query is scoped by `workspaceId`.
 *
 * Two things this module is careful about:
 *
 *  - **It survives a missing table.** Code reaches production before migration
 *    0020 is applied by hand (HANDOFF.md §6), and until then `/net-worth`
 *    reports net worth from synced bank balances alone rather than 500ing —
 *    the same degradation `loadBankAccounts` does for 0016.
 *  - **It only ever asks for cash once.** `loadCashPosition` is request-
 *    memoized, so the page, the dashboard card and the copilot's snapshot
 *    share one round trip.
 */

/** Valuations listed per asset in the UI. The maths still uses every one. */
const RECENT_VALUATIONS = 6;

export interface ValuationRow {
  id: string;
  value: number;
  asOf: Date;
}

/** The API shape of an asset row, with money as numbers. */
export interface AssetRecord {
  id: string;
  name: string;
  kind: Asset["kind"];
  currency: string | null;
  note: string | null;
  createdAt: Date;
}

export interface NetWorthOverview {
  position: NetWorthPosition;
  history: NetWorthPoint[];
  trend: NetWorthTrend;
  /** Aggregated bank cash, so the page can explain where its cash came from. */
  cash: CashPosition;
  /** The most recent valuations per asset id, for the detail rows. */
  valuations: Record<string, ValuationRow[]>;
  /**
   * False when migration 0020 has not been applied yet: the page shows the
   * cash-only figure and says so rather than pretending there are no holdings.
   */
  assetsAvailable: boolean;
}

export function toAssetRecord(row: Asset): AssetRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    currency: row.currency,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export function toValuationRow(row: AssetValuation): ValuationRow {
  return { id: row.id, value: row.value.toNumber(), asOf: row.asOf };
}

type AssetWithValuations = Asset & { valuations: AssetValuation[] };

function toAssetInput(row: AssetWithValuations): AssetInput {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    currency: row.currency,
    note: row.note,
    createdAt: row.createdAt,
    valuations: row.valuations.map((valuation) => ({
      value: valuation.value.toNumber(),
      asOf: valuation.asOf,
    })),
  };
}

/**
 * Every asset with its whole valuation history. Unbounded on purpose: the
 * history series carries the last known figure forward month by month, so a
 * truncated list would draw the wrong line.
 *
 * Valuations come back newest first, and `createdAt` breaks ties on `asOf`:
 * two figures for the same day means the second one was a correction, so the
 * one entered last has to be the one every "latest valuation" rule above this
 * file picks up.
 */
const loadAssets = cache(async (workspaceId: string): Promise<AssetWithValuations[] | null> => {
  try {
    return await prisma.asset.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { valuations: { orderBy: [{ asOf: "desc" }, { createdAt: "desc" }] } },
    });
  } catch (error) {
    if (isSchemaOutOfDate(error)) {
      logger.warn("[net-worth] assets not available yet; reporting cash only", {
        error: serializeError(error),
      });
      return null;
    }
    throw error;
  }
});

/** Monthly transaction flow over the axis, plus everything recorded before it. */
async function loadMonthlyFlow(
  workspaceId: string,
  axis: readonly string[]
): Promise<{ months: MonthNet[]; openingBalance: number }> {
  const [year, index] = axis[0].split("-").map(Number);
  const windowStart = new Date(Date.UTC(year, index - 1, 1));

  const [rows, priorRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { workspaceId, date: { gte: windowStart } },
      select: { type: true, amount: true, date: true },
    }),
    prisma.transaction.findMany({
      where: { workspaceId, date: { lt: windowStart } },
      select: { type: true, amount: true },
    }),
  ]);

  const nets = new Map<string, number>(axis.map((month) => [month, 0]));
  for (const row of rows) {
    const key = monthKey(row.date);
    if (!nets.has(key)) continue;
    const signed = row.type === "INCOME" ? row.amount.toNumber() : -row.amount.toNumber();
    nets.set(key, (nets.get(key) ?? 0) + signed);
  }

  return {
    months: axis.map((month) => ({ month, net: nets.get(month) ?? 0 })),
    openingBalance: priorRows.reduce(
      (sum, row) =>
        sum + (row.type === "INCOME" ? row.amount.toNumber() : -row.amount.toNumber()),
      0
    ),
  };
}

/**
 * The whole net-worth picture for a workspace: the current position, the
 * monthly line behind it, and the cash breakdown that explains the cash part.
 * Request-memoized — the page and the dashboard card ask for the same figures
 * on the same render.
 */
export const getNetWorthOverview = cache(
  async (workspaceId: string, currency: string): Promise<NetWorthOverview> => {
    const axis = monthAxis(new Date(), HISTORY_MONTHS);

    const [rows, flow] = await Promise.all([
      loadAssets(workspaceId),
      loadMonthlyFlow(workspaceId, axis),
    ]);

    const transactionBalance =
      flow.openingBalance + flow.months.reduce((sum, month) => sum + month.net, 0);
    const cash = await loadCashPosition(workspaceId, currency, transactionBalance);

    const assets = (rows ?? []).map(toAssetInput);
    const position = computeNetWorth({ assets, cash: cash.total, currency });

    const history = buildNetWorthHistory({
      assets,
      cash: monthEndCashSeries(
        flow.months,
        flow.openingBalance,
        cash.source === "bank" ? cash.total : null
      ),
      currency,
    });

    return {
      position,
      history,
      trend: summarizeTrend(history),
      cash,
      valuations: Object.fromEntries(
        (rows ?? []).map((row) => [
          row.id,
          row.valuations.slice(0, RECENT_VALUATIONS).map(toValuationRow),
        ])
      ),
      assetsAvailable: rows !== null,
    };
  }
);

/* ------------------------------------------------------------------ */
/* Copilot snapshot                                                    */
/* ------------------------------------------------------------------ */

/**
 * The compact net-worth block the copilot is grounded in. Deliberately small:
 * a total, the three largest holdings, what is owed, and six monthly points.
 * Anything more would spend tokens on a table the model does not need to
 * answer "how is my net worth developing?".
 */
export interface NetWorthSnapshot {
  total: number;
  assetTotal: number;
  liabilityTotal: number;
  cash: number;
  largestAssets: { name: string; kind: AssetKind; value: number }[];
  trend: { label: string; netWorth: number }[];
  /** Holdings in another currency, which are excluded from every figure here. */
  otherCurrencyCount: number;
}

export interface NetWorthSnapshotInput {
  workspaceId: string;
  currency: string;
  /** Monthly flow over the snapshot's own window, oldest first. */
  months: readonly MonthNet[];
  /** Cumulative net of everything recorded before that window. */
  openingBalance: number;
  /** The bank total when the banks are the authority on cash, else null. */
  cashAnchor: number | null;
  /** Today's cash figure, whichever source it came from. */
  cash: number;
}

/**
 * Null when there is nothing to say — no holdings entered, or the table does
 * not exist yet — so `renderSnapshot` leaves the section out entirely rather
 * than spending tokens saying "net worth: your bank balance". A Business
 * workspace has no way to create an asset, so it always lands here.
 */
export async function loadNetWorthSnapshot(
  input: NetWorthSnapshotInput
): Promise<NetWorthSnapshot | null> {
  const rows = await loadAssets(input.workspaceId);
  if (rows === null || rows.length === 0) return null;

  const assets = rows.map(toAssetInput);
  const position = computeNetWorth({
    assets,
    cash: input.cash,
    currency: input.currency,
  });

  const history = buildNetWorthHistory({
    assets,
    cash: monthEndCashSeries(input.months, input.openingBalance, input.cashAnchor),
    currency: input.currency,
  }).slice(-SNAPSHOT_TREND_MONTHS);

  return {
    total: position.netWorth,
    assetTotal: position.assetTotal,
    liabilityTotal: position.liabilityTotal,
    cash: position.cash,
    largestAssets: selectLargestAssets(position.assets).map((asset) => ({
      name: asset.name,
      kind: asset.kind,
      value: asset.value,
    })),
    trend: history.map((point) => ({ label: point.label, netWorth: point.netWorth })),
    otherCurrencyCount: position.otherCurrencyCount,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

/** An asset row's own fields, verified to be in this workspace. */
export async function findAssetInWorkspace(
  workspaceId: string,
  assetId: string
): Promise<Asset | null> {
  return prisma.asset.findFirst({ where: { id: assetId, workspaceId } });
}

/** Whether another holding in the workspace already answers to this name. */
export async function assetNameTaken(
  workspaceId: string,
  name: string,
  exceptId?: string
): Promise<boolean> {
  const existing = await prisma.asset.findFirst({
    where: {
      workspaceId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return existing !== null;
}
