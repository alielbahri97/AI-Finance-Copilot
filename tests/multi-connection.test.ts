import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  anchorBalanceHistory,
  computeCashPosition,
  resolveReportCash,
  type CashAccountInput,
} from "@/lib/finance/cash";
import { bankTransactionFingerprint } from "@/lib/integrations/fingerprint";
import { mapBookedTransactions, type GcTransaction } from "@/lib/integrations/gocardless-core";
import {
  canAddConnection,
  multiInstanceRefusal,
  resolveConnectionTarget,
} from "@/lib/integrations/identity";
import { getProviders } from "@/lib/integrations/registry";

function account(overrides: Partial<CashAccountInput> = {}): CashAccountInput {
  return {
    id: "acc-1",
    connectionId: "conn-ing",
    connectionLabel: "ING",
    label: "…1234",
    currency: "EUR",
    balance: 1000,
    balanceAt: "2026-08-04T06:00:00.000Z",
    includeInTotals: true,
    ...overrides,
  };
}

describe("bank transaction fingerprints across connections", () => {
  it("is stable for the same provider transaction", () => {
    expect(bankTransactionFingerprint("gocardless", "acc-a:tx-1")).toBe(
      bankTransactionFingerprint("gocardless", "acc-a:tx-1")
    );
  });

  it("does not collide when two banks reuse a transaction id", () => {
    // Both requisitions can legitimately contain "tx-1"; the account prefix is
    // what keeps the two apart, so the fingerprint basis stays connection-free.
    const tx: GcTransaction[] = [
      {
        transactionId: "tx-1",
        bookingDate: "2026-08-01",
        transactionAmount: { amount: "-25.00", currency: "EUR" },
        remittanceInformationUnstructured: "Coffee",
      },
    ];
    const ing = mapBookedTransactions("ing-account-1", tx)[0];
    const rabo = mapBookedTransactions("rabo-account-9", tx)[0];

    expect(ing.externalId).not.toBe(rabo.externalId);
    expect(bankTransactionFingerprint("gocardless", ing.externalId)).not.toBe(
      bankTransactionFingerprint("gocardless", rabo.externalId)
    );
  });

  it("re-syncing the same account yields the same hashes, so nothing re-imports", () => {
    const tx: GcTransaction[] = [
      {
        transactionId: "tx-7",
        bookingDate: "2026-08-02",
        transactionAmount: { amount: "120.00", currency: "EUR" },
        remittanceInformationUnstructured: "Invoice 4",
      },
    ];
    const first = mapBookedTransactions("acc-a", tx).map((entry) =>
      bankTransactionFingerprint("gocardless", entry.externalId)
    );
    const second = mapBookedTransactions("acc-a", tx).map((entry) =>
      bankTransactionFingerprint("gocardless", entry.externalId)
    );
    expect(first).toEqual(second);
  });

  it("separates providers holding the same account id", () => {
    expect(bankTransactionFingerprint("plaid", "acc-a:tx-1")).not.toBe(
      bankTransactionFingerprint("gocardless", "acc-a:tx-1")
    );
  });
});

describe("aggregated cash position", () => {
  it("sums included accounts across banks", () => {
    const position = computeCashPosition({
      accounts: [
        account({ id: "a", balance: 1200 }),
        account({ id: "b", balance: 300.55 }),
        account({ id: "c", connectionId: "conn-rabo", connectionLabel: "Rabobank", balance: 500 }),
      ],
      transactionBalance: 42,
      currency: "EUR",
    });

    expect(position.source).toBe("bank");
    expect(position.total).toBe(2000.55);
    expect(position.countedAccounts).toBe(3);
    expect(position.banks).toHaveLength(2);
    expect(position.banks.map((bank) => bank.label)).toEqual(["ING", "Rabobank"]);
    expect(position.banks[0].total).toBe(1500.55);
    expect(position.transactionBalance).toBe(42);
  });

  it("reports but never sums excluded accounts", () => {
    const position = computeCashPosition({
      accounts: [
        account({ id: "a", balance: 1000 }),
        account({ id: "b", balance: 9000, includeInTotals: false }),
      ],
      transactionBalance: 0,
      currency: "EUR",
    });

    expect(position.total).toBe(1000);
    expect(position.excludedAccounts).toBe(1);
    expect(position.accounts.find((entry) => entry.id === "b")).toMatchObject({
      counted: false,
      reason: "excluded",
    });
  });

  it("leaves foreign-currency accounts out of the total and flags them", () => {
    const position = computeCashPosition({
      accounts: [
        account({ id: "a", balance: 1000 }),
        account({ id: "b", balance: 500, currency: "USD" }),
      ],
      transactionBalance: 0,
      currency: "EUR",
    });

    expect(position.total).toBe(1000);
    expect(position.hasOtherCurrency).toBe(true);
    expect(position.accounts[1].reason).toBe("other-currency");
  });

  it("falls back to the transaction balance for CSV-only workspaces", () => {
    const position = computeCashPosition({
      accounts: [],
      transactionBalance: 1234.567,
      currency: "EUR",
    });

    expect(position.source).toBe("transactions");
    expect(position.total).toBe(1234.57);
    expect(position.banks).toHaveLength(0);
    expect(position.asOf).toBeNull();
  });

  it("falls back when connected accounts have no balance yet", () => {
    const position = computeCashPosition({
      accounts: [account({ balance: null, balanceAt: null })],
      transactionBalance: 800,
      currency: "EUR",
    });

    expect(position.source).toBe("transactions");
    expect(position.total).toBe(800);
    expect(position.accounts[0].reason).toBe("no-balance");
  });

  it("dates the total by its stalest counted balance", () => {
    const position = computeCashPosition({
      accounts: [
        account({ id: "a", balanceAt: "2026-08-04T06:00:00.000Z" }),
        account({ id: "b", balanceAt: "2026-08-01T06:00:00.000Z" }),
        // Excluded accounts must not drag the freshness back.
        account({ id: "c", balanceAt: "2020-01-01T00:00:00.000Z", includeInTotals: false }),
      ],
      transactionBalance: 0,
      currency: "EUR",
    });

    expect(position.asOf).toBe("2026-08-01T06:00:00.000Z");
  });

  it("matches currency case-insensitively", () => {
    const position = computeCashPosition({
      accounts: [account({ currency: "eur", balance: 10 })],
      transactionBalance: 0,
      currency: "EUR",
    });
    expect(position.total).toBe(10);
  });
});

describe("balance history anchoring", () => {
  const history = [
    { date: "2026-08-01", balance: 100 },
    { date: "2026-08-02", balance: 150 },
    { date: "2026-08-03", balance: 120 },
  ];

  it("shifts the series so it ends at the aggregated bank total", () => {
    const anchored = anchorBalanceHistory(history, 500);
    expect(anchored.map((point) => point.balance)).toEqual([480, 530, 500]);
  });

  it("leaves the series alone without a bank total", () => {
    expect(anchorBalanceHistory(history, null)).toEqual(history);
  });

  it("leaves an empty series alone", () => {
    expect(anchorBalanceHistory([], 500)).toEqual([]);
  });
});

describe("report cash source", () => {
  const now = new Date("2026-08-04T10:00:00.000Z");

  it("uses the bank total for a period running up to now", () => {
    expect(
      resolveReportCash({
        transactionCash: 900,
        bankCash: 1500,
        periodEnd: new Date("2026-08-31T00:00:00.000Z"),
        now,
      })
    ).toEqual({ cash: 1500, source: "bank" });
  });

  it("keeps the transaction close for a historical period", () => {
    expect(
      resolveReportCash({
        transactionCash: 900,
        bankCash: 1500,
        periodEnd: new Date("2026-06-30T00:00:00.000Z"),
        now,
      })
    ).toEqual({ cash: 900, source: "transactions" });
  });

  it("keeps the transaction close when there is no bank total", () => {
    expect(
      resolveReportCash({
        transactionCash: 900,
        bankCash: null,
        periodEnd: new Date("2026-08-31T00:00:00.000Z"),
        now,
      })
    ).toEqual({ cash: 900, source: "transactions" });
  });
});

describe("connection identity and the multi-instance capability", () => {
  it("adds a second bank when the externalId is new", () => {
    expect(
      resolveConnectionTarget({
        providerName: "GoCardless",
        multiInstance: true,
        externalId: "RABOBANK_RABONL2U",
        existing: [{ id: "conn-1", externalId: "ING_INGBNL2A" }],
      })
    ).toEqual({ mode: "create" });
  });

  it("updates the matching connection when the same bank is connected again", () => {
    expect(
      resolveConnectionTarget({
        providerName: "GoCardless",
        multiInstance: true,
        externalId: "ING_INGBNL2A",
        existing: [
          { id: "conn-1", externalId: "ING_INGBNL2A" },
          { id: "conn-2", externalId: "RABOBANK_RABONL2U" },
        ],
      })
    ).toEqual({ mode: "update", connectionId: "conn-1" });
  });

  it("treats a null externalId as the single anonymous row, like the partial index does", () => {
    expect(
      resolveConnectionTarget({
        providerName: "Slack",
        multiInstance: false,
        externalId: null,
        existing: [{ id: "conn-1", externalId: null }],
      })
    ).toEqual({ mode: "update", connectionId: "conn-1" });
  });

  it("re-authorizes rather than duplicates a single-instance provider", () => {
    expect(
      resolveConnectionTarget({
        providerName: "Xero",
        multiInstance: false,
        externalId: "tenant-b",
        existing: [{ id: "conn-1", externalId: "tenant-a" }],
      })
    ).toEqual({ mode: "update", connectionId: "conn-1" });
  });

  it("refuses an explicit second connection for a single-instance provider", () => {
    const target = resolveConnectionTarget({
      providerName: "Slack",
      multiInstance: false,
      externalId: "T999",
      existing: [{ id: "conn-1", externalId: "T123" }],
      intent: "add",
    });
    expect(target).toEqual({ mode: "rejected", reason: multiInstanceRefusal("Slack") });
    expect(multiInstanceRefusal("Slack")).toContain("one connection per workspace");
  });

  it("allows the first connection to any provider", () => {
    expect(canAddConnection(false, 0)).toBe(true);
    expect(canAddConnection(false, 1)).toBe(false);
    expect(canAddConnection(true, 3)).toBe(true);
  });

  it("marks exactly the per-bank providers as multi-instance", () => {
    const multi = getProviders()
      .filter((provider) => provider.multiInstance)
      .map((provider) => provider.id)
      .sort();
    expect(multi).toEqual(["gocardless", "plaid"]);
  });
});

describe("unique-constraint semantics in the schema", () => {
  const root = join(__dirname, "..");
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  const migration = readFileSync(
    join(root, "prisma", "migrations", "0016_multi_bank_connections", "migration.sql"),
    "utf8"
  );

  it("keys connections by workspace + provider + externalId", () => {
    expect(schema).toContain("@@unique([workspaceId, provider, externalId])");
    expect(schema).not.toContain("@@unique([workspaceId, provider])");
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?"integration_connections"\("workspace_id",\s*"provider",\s*"external_id"\)/i
    );
  });

  it("keeps a partial index so NULL externalIds cannot duplicate", () => {
    // Postgres treats NULLs as distinct, so the compound unique alone would let
    // a provider without a derivable id (Slack, legacy rows) be inserted twice.
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?\("workspace_id",\s*"provider"\)\s*WHERE\s+"external_id"\s+IS NULL/i
    );
  });

  it("drops the old provider-wide unique index", () => {
    expect(migration).toMatch(/DROP (CONSTRAINT|INDEX)[\s\S]*?workspace_id_provider_key/i);
  });

  it("keys bank accounts per connection so two banks can share an account id", () => {
    expect(schema).toContain("@@unique([connectionId, externalAccountId])");
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?"bank_accounts"\("connection_id",\s*"external_account_id"\)/i
    );
  });

  it("leaves transaction fingerprints keyed per workspace", () => {
    // Widening the fingerprint basis would orphan every imported row.
    expect(schema).toContain("@@unique([workspaceId, hash])");
  });
});
