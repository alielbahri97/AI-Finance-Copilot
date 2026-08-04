import { WalletIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashAccount, CashPosition } from "@/lib/finance/cash";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * Total cash across every included bank account, with the per-bank → per-account
 * breakdown one click away. Uses a native <details> so it stays a server
 * component — no client bundle for a disclosure.
 */
export function CashCard({ cash }: { cash: CashPosition }) {
  const hasBreakdown = cash.accounts.length > 0;

  return (
    <Card className="gap-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-muted-foreground text-sm font-medium">Total cash</CardTitle>
        <WalletIcon className="text-muted-foreground size-4" />
      </CardHeader>
      <CardContent>
        <span
          className={cn(
            "text-2xl font-bold tracking-tight",
            cash.total >= 0 ? "text-success" : "text-destructive"
          )}
        >
          {formatCurrency(cash.total, cash.currency)}
        </span>
        <p className="text-muted-foreground mt-1 text-xs">{hint(cash)}</p>

        {hasBreakdown ? (
          <details className="group mt-2">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs select-none">
              <span className="group-open:hidden">Show breakdown</span>
              <span className="hidden group-open:inline">Hide breakdown</span>
            </summary>
            <div className="mt-2 space-y-2">
              {cash.banks.map((bank) => (
                <div key={bank.connectionId} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs font-medium">
                    <span className="truncate">{bank.label}</span>
                    <span className="tabular-nums">
                      {formatCurrency(bank.total, cash.currency)}
                    </span>
                  </div>
                  <ul className="space-y-0.5 pl-2">
                    {bank.accounts.map((account) => (
                      <li
                        key={account.id}
                        className="text-muted-foreground flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="truncate">
                          {account.label}
                          {account.counted ? "" : ` · ${accountNote(account)}`}
                        </span>
                        <span className={cn("tabular-nums", !account.counted && "line-through")}>
                          {account.balance === null
                            ? "—"
                            : formatCurrency(account.balance, account.currency ?? cash.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Legend for the balance chart: which accounts the line adds up to. Per-account
 * *series* aren't possible — imported transactions carry no account id, so only
 * the current balance is known per account — so the legend shows each account's
 * standing balance and marks the ones left out of the total.
 */
export function CashLegend({ cash }: { cash: CashPosition }) {
  if (cash.accounts.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {cash.banks.flatMap((bank) =>
        bank.accounts.map((account) => (
          <span
            key={account.id}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
              account.counted ? "text-foreground" : "text-muted-foreground"
            )}
            title={account.counted ? undefined : accountNote(account)}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                account.counted ? "bg-[var(--chart-1)]" : "bg-muted-foreground/40"
              )}
            />
            <span className="truncate">
              {bank.label} {account.label}
            </span>
            <span className="tabular-nums">
              {account.balance === null
                ? "—"
                : formatCurrency(account.balance, account.currency ?? cash.currency)}
            </span>
          </span>
        ))
      )}
    </div>
  );
}

function hint(cash: CashPosition): string {
  if (cash.source === "transactions") {
    return cash.accounts.length > 0
      ? "No bank balances yet — from your recorded transactions"
      : "Across all recorded transactions";
  }
  const accounts = `${cash.countedAccounts} account${cash.countedAccounts === 1 ? "" : "s"}`;
  const banks = `${cash.banks.length} bank${cash.banks.length === 1 ? "" : "s"}`;
  const excluded = cash.excludedAccounts > 0 ? `, ${cash.excludedAccounts} excluded` : "";
  return `${accounts} at ${banks}${excluded}`;
}

function accountNote(account: CashAccount): string {
  switch (account.reason) {
    case "excluded":
      return "not in totals";
    case "no-balance":
      return "no balance yet";
    case "other-currency":
      return `held in ${account.currency ?? "another currency"}`;
    case "counted":
      return "";
  }
}
