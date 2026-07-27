#!/usr/bin/env node
/**
 * Authenticated feature tests — requires TEST_USER_EMAIL and TEST_USER_PASSWORD in .env
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const email = process.env.TEST_USER_EMAIL?.trim();
const password = process.env.TEST_USER_PASSWORD?.trim();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!email || !password) {
  console.log("Skip authenticated tests — set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env");
  process.exit(0);
}
if (!url || !anonKey) fail("Missing Supabase env vars");

/** Minimal cookie jar for @supabase/ssr in Node. */
const jar = new Map();
const supabase = createServerClient(url, anonKey, {
  cookies: {
    getAll() {
      return [...jar.entries()].map(([name, value]) => ({ name, value }));
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        jar.set(name, value);
      }
    },
  },
});

const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) fail(`Sign-in failed: ${authError.message}`);

const cookieHeader = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
if (!cookieHeader) fail("No session cookies after sign-in");

async function api(method, path, body) {
  const headers = { Cookie: cookieHeader };
  const opts = { method, headers };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

const checks = [];
function expect(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log(`Authenticated feature tests as ${email}\n`);

const getRoutes = [
  "/api/profile",
  "/api/categories",
  "/api/transactions?limit=5",
  "/api/notifications",
  "/api/conversations",
  "/api/import/batches",
  "/api/invoices",
  "/api/assumptions",
  "/api/rules",
  "/api/forecast?months=3",
];

for (const path of getRoutes) {
  const { status } = await api("GET", path);
  expect(`GET ${path}`, status === 200, `status ${status}`);
}

const csvPath = join(root, "sample-data", "dummy-transactions.csv");
const form = new FormData();
form.append(
  "file",
  new Blob([readFileSync(csvPath)], { type: "text/csv" }),
  "dummy-transactions.csv"
);
const parsed = await api("POST", "/api/import/parse", form);
expect(
  "POST /api/import/parse",
  parsed.status === 200 && parsed.json?.rowCount > 0,
  parsed.status === 200 ? `${parsed.json.rowCount} rows detected` : `status ${parsed.status}`
);

const copilot = await api("POST", "/api/copilot", {
  message: "What is my total spending?",
  conversationId: null,
});
expect(
  "POST /api/copilot",
  copilot.status === 200 || copilot.status === 402 || copilot.status === 429,
  `status ${copilot.status}`
);

const pages = [
  "/dashboard",
  "/transactions",
  "/import",
  "/categories",
  "/reports",
  "/forecast",
  "/copilot",
  "/invoices",
  "/integrations",
  "/settings",
  "/profile",
  "/billing",
];

for (const path of pages) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: { Cookie: cookieHeader } });
  expect(`page ${path}`, res.status === 200, `status ${res.status}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} authenticated checks passed`);
if (failed.length) process.exit(1);
