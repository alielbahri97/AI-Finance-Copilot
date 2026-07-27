#!/usr/bin/env node
/**
 * Feature smoke test — hits public pages and API routes.
 * Protected routes should return 200 (redirect to login) or 401/307, not 500.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const PAGES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
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

const APIS = [
  "/api/health",
  "/api/transactions",
  "/api/categories",
  "/api/forecast",
  "/api/copilot",
  "/api/notifications",
  "/api/import/batches",
  "/api/conversations",
  "/api/invoices",
  "/api/profile",
  "/api/assumptions",
  "/api/rules",
];

async function check(label, url, opts = {}) {
  try {
    const res = await fetch(`${BASE}${url}`, { redirect: "manual", ...opts });
    const ok =
      res.status < 500 &&
      (opts.expectStatus ? res.status === opts.expectStatus : true);
    return { label, url, status: res.status, ok, error: null };
  } catch (error) {
    return { label, url, status: 0, ok: false, error: String(error) };
  }
}

async function main() {
  console.log(`Smoke testing ${BASE}\n`);
  const results = [];

  for (const path of PAGES) {
    results.push(await check(`page ${path}`, path));
  }

  for (const path of APIS) {
    const expect401 = path !== "/api/health";
    const r = await check(`api ${path}`, path);
    if (expect401 && r.status === 401) r.ok = true;
    if (expect401 && r.status === 307) r.ok = true;
    if (path === "/api/health" && r.status === 200) r.ok = true;
    results.push(r);
  }

  // POST endpoints should reject unauthenticated with 401, not 500
  const postApis = [
    ["/api/import/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
    ["/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
  ];
  for (const [path, opts] of postApis) {
    const r = await check(`api POST ${path}`, path, opts);
    if (r.status === 401 || r.status === 400) r.ok = true;
    results.push(r);
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(`${mark} ${r.label.padEnd(28)} ${r.status}${r.error ? ` (${r.error})` : ""}`);
  }

  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main();
