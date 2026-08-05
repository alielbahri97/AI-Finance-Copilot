/**
 * The tables and columns the running code needs. Vercel deploys on push while
 * migrations are applied by hand, so the code can go live ahead of its schema —
 * this list lets /api/health name exactly what is missing instead of leaving
 * the operator to read P2021/P2022 stack traces.
 *
 * Add an entry whenever a migration introduces something the app queries on a
 * hot path. Older, long-settled tables are deliberately left out: the point is
 * to catch the gap between the newest migrations and production.
 */
export interface SchemaCheck {
  /** Table in the `public` schema. */
  table: string;
  /** Columns that must exist on it. Empty means the table alone is enough. */
  columns: string[];
  /** Migration that introduces them, quoted back in the health response. */
  migration: string;
}

export const SCHEMA_CHECKS: SchemaCheck[] = [
  { table: "help_messages", columns: [], migration: "0013_help_messages" },
  { table: "workspaces", columns: [], migration: "0014_workspaces" },
  { table: "workspace_members", columns: [], migration: "0014_workspaces" },
  { table: "workspace_invitations", columns: [], migration: "0014_workspaces" },
  { table: "audit_logs", columns: [], migration: "0014_workspaces" },
  { table: "transactions", columns: ["workspace_id"], migration: "0014_workspaces" },
  { table: "categories", columns: ["workspace_id"], migration: "0014_workspaces" },
  { table: "conversations", columns: ["workspace_id"], migration: "0014_workspaces" },
  { table: "subscriptions", columns: ["workspace_id"], migration: "0014_workspaces" },
  { table: "invoices", columns: ["workspace_id"], migration: "0014_workspaces" },
  { table: "invoices", columns: ["extraction_provider"], migration: "0015_extraction_telemetry" },
  { table: "bank_accounts", columns: [], migration: "0016_multi_bank_connections" },
  {
    table: "integration_connections",
    columns: ["external_id", "display_name"],
    migration: "0016_multi_bank_connections",
  },
  { table: "savings_goals", columns: [], migration: "0017_workspace_editions" },
  { table: "savings_contributions", columns: [], migration: "0017_workspace_editions" },
  { table: "workspaces", columns: ["type"], migration: "0017_workspace_editions" },
  { table: "budgets", columns: ["category_id", "rollover"], migration: "0017_workspace_editions" },
  {
    table: "workspaces",
    columns: ["ai_categorization_enabled"],
    migration: "0018_ai_categorization",
  },
  {
    table: "usage_records",
    columns: ["ai_categorizations"],
    migration: "0018_ai_categorization",
  },
  { table: "invoices", columns: ["customer_email"], migration: "0019_customer_dunning" },
  {
    table: "workspaces",
    columns: ["auto_dunning_enabled"],
    migration: "0019_customer_dunning",
  },
  { table: "reminder_logs", columns: [], migration: "0019_customer_dunning" },
  { table: "assets", columns: [], migration: "0020_net_worth" },
  { table: "asset_valuations", columns: [], migration: "0020_net_worth" },
  // The forecast page reads both on every load, and the copilot's snapshot
  // reads the column.
  { table: "scenarios", columns: [], migration: "0021_forecast_scenarios" },
  { table: "assumptions", columns: ["scenario_id"], migration: "0021_forecast_scenarios" },
];

export interface SchemaDrift {
  /** Expected tables absent from the database. */
  missingTables: string[];
  /** Expected columns absent from a table that does exist, as `table.column`. */
  missingColumns: string[];
  /** Migrations that would supply them, in file order. */
  pendingMigrations: string[];
}

/** Every table named in SCHEMA_CHECKS, deduplicated. */
export function expectedTables(checks: SchemaCheck[] = SCHEMA_CHECKS): string[] {
  return [...new Set(checks.map((check) => check.table))];
}

/** Every column named in SCHEMA_CHECKS, deduplicated (names only). */
export function expectedColumns(checks: SchemaCheck[] = SCHEMA_CHECKS): string[] {
  return [...new Set(checks.flatMap((check) => check.columns))];
}

/**
 * Compares what the database has against what the code needs. Pure, so the
 * catalog query stays in the health route and this stays unit-testable.
 *
 * @param presentTables table names found in the `public` schema
 * @param presentColumns found columns as `table.column`
 */
export function findSchemaDrift(
  presentTables: Iterable<string>,
  presentColumns: Iterable<string>,
  checks: SchemaCheck[] = SCHEMA_CHECKS
): SchemaDrift {
  const tables = new Set(presentTables);
  const columns = new Set(presentColumns);

  const missingTables = new Set<string>();
  const missingColumns = new Set<string>();
  const pendingMigrations = new Set<string>();

  for (const check of checks) {
    if (!tables.has(check.table)) {
      missingTables.add(check.table);
      pendingMigrations.add(check.migration);
      // No point reporting its columns too — the whole table is absent.
      continue;
    }
    for (const column of check.columns) {
      if (!columns.has(`${check.table}.${column}`)) {
        missingColumns.add(`${check.table}.${column}`);
        pendingMigrations.add(check.migration);
      }
    }
  }

  return {
    missingTables: [...missingTables],
    missingColumns: [...missingColumns],
    pendingMigrations: [...pendingMigrations].sort(),
  };
}

export function isSchemaUpToDate(drift: SchemaDrift): boolean {
  return drift.missingTables.length === 0 && drift.missingColumns.length === 0;
}
