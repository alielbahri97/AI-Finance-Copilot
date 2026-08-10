/**
 * Mechanical checks on apply-0027.sql. Touches no database.
 *   node ops/migrations-bundle/verify-0027.mjs
 *
 * Run it from the repository root. It needs `feat/play-billing` to be fetched,
 * because it reads the migration file out of git rather than out of a checkout.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BUNDLE = "ops/migrations-bundle/apply-0027.sql";
const MIGRATION_REF = "feat/play-billing:prisma/migrations/0027_play_billing/migration.sql";
const RECORDED_CHECKSUM = "d213f127397d5db6cde8488923b60f96bba8294970db00b1f828d1f60bf440bd";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const raw = readFileSync(BUNDLE);
const text = raw.toString("utf8");

// 1. clean UTF-8, no BOM, no stray CR, nothing non-ASCII that a SQL console
//    might mangle on the way to Postgres.
check("no UTF-8 BOM", !(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf));
check(
  "round-trips as UTF-8 unchanged",
  Buffer.compare(Buffer.from(text, "utf8"), raw) === 0
);
// The em dash in comments is the established house style (every other bundle
// here uses it). What matters is that nothing outside a comment depends on the
// encoding, so no identifier or string literal can be mangled on the way to
// Postgres.
const nonAscii = [...new Set([...text].filter((ch) => ch.codePointAt(0) > 0x7f))];
check("the only non-ASCII character is the em dash", nonAscii.join("") === "\u2014", JSON.stringify(nonAscii));
const nonAsciiOutsideComments = text
  .split("\n")
  .filter((line) => [...line].some((ch) => ch.codePointAt(0) > 0x7f) && !line.trimStart().startsWith("--"));
check("no non-ASCII outside comments", nonAsciiOutsideComments.length === 0,
  nonAsciiOutsideComments.join(" | "));
check("no NUL bytes", !raw.includes(0));

// 2. exactly one transaction.
const begins = (text.match(/^BEGIN;$/gm) || []).length;
const commits = (text.match(/^COMMIT;$/gm) || []).length;
check("exactly one BEGIN", begins === 1, `${begins}`);
check("exactly one COMMIT", commits === 1, `${commits}`);
check("no ROLLBACK", !/^ROLLBACK/m.test(text));
check(
  "COMMIT comes after BEGIN",
  text.indexOf("\nBEGIN;") < text.indexOf("\nCOMMIT;")
);
check(
  "nothing after COMMIT writes",
  !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(
    text.slice(text.indexOf("\nCOMMIT;")).replace(/^--.*$/gm, "")
  )
);

// 3. dollar-quoted blocks are balanced and each tag is used exactly twice.
const tags = text.match(/\$[a-z_0-9]+\$/g) || [];
const counts = new Map();
for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
const unbalanced = [...counts].filter(([, n]) => n % 2 !== 0);
check(
  `all ${counts.size} dollar-quoted blocks are balanced`,
  unbalanced.length === 0,
  unbalanced.map(([t, n]) => `${t}x${n}`).join(", ")
);
const notPaired = [...counts].filter(([, n]) => n !== 2);
check("each dollar tag is used exactly twice", notPaired.length === 0,
  notPaired.map(([t, n]) => `${t}x${n}`).join(", "));

// 4. the recorded checksum really is the LF sha256 of the migration file.
const blob = execFileSync("git", ["show", MIGRATION_REF], {
  encoding: "buffer",
  maxBuffer: 1e7,
});
const lf = Buffer.from(blob.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
const sha = createHash("sha256").update(lf).digest("hex");
check("migration file is LF in git", !blob.toString("latin1").includes("\r\n"));
check(`recorded checksum is the LF sha256`, sha === RECORDED_CHECKSUM, sha);
// Four places: the header summary, the migration section header, the INSERT
// that records it, and verification check 2 that reads it back.
check(
  "the checksum appears in all four places",
  (text.match(new RegExp(RECORDED_CHECKSUM, "g")) || []).length === 4,
  `${(text.match(new RegExp(RECORDED_CHECKSUM, "g")) || []).length}`
);

// 5. every quoted identifier in the migration appears in the bundle.
const migration = lf.toString("utf8");
const identifiers = [...new Set(migration.match(/"[A-Za-z_][A-Za-z_0-9]*"/g) || [])];
const missing = identifiers.filter((id) => !text.includes(id));
check(
  `all ${identifiers.length} quoted identifiers from the migration appear in the bundle`,
  missing.length === 0,
  missing.join(", ")
);

// 6. the column count asserted by verification row 15 is the real one.
const createTable = migration.slice(
  migration.indexOf('CREATE TABLE "play_purchases"')
);
const body = createTable.slice(createTable.indexOf("(") + 1, createTable.indexOf("CONSTRAINT"));
const columnCount = (body.match(/^\s{4}"[a-z_]+"/gm) || []).length;
check("play_purchases really has 25 columns", columnCount === 25, `${columnCount}`);
check("the bundle asserts that same count", text.includes("'25',"));

// 7. every statement in the migration has a counterpart in the bundle.
for (const needle of [
  `CREATE TYPE "PlanSource" AS ENUM ('FREE', 'TRIAL', 'COMPLIMENTARY', 'STRIPE', 'GOOGLE_PLAY')`,
  `"plan_source" "PlanSource" NOT NULL DEFAULT 'FREE'`,
  `"stripe_plan" "PlanId"`,
  `"stripe_status" "SubscriptionStatus"`,
  `ON DELETE SET NULL ON UPDATE CASCADE`,
  `CONSTRAINT "play_purchases_pkey" PRIMARY KEY ("id")`,
]) {
  check(`bundle contains: ${needle.slice(0, 58)}`, text.includes(needle));
}

// 8. sanity: the bundle guards everything it creates.
check("table creation is guarded", text.includes('CREATE TABLE IF NOT EXISTS "play_purchases"'));
check(
  "all five indexes are guarded",
  (text.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS "play_purchases_/g) || []).length === 5
);
check(
  "all three ADD COLUMNs are guarded",
  (text.match(/ADD COLUMN IF NOT EXISTS/g) || []).length === 3
);
check("enum creation is guarded by to_regtype", /to_regtype\('"PlanSource"'\) IS NULL/.test(text));
const fkBlock = text.slice(text.indexOf("DO $fks_0027$"), text.lastIndexOf("$fks_0027$;"));
check(
  "both foreign keys are added inside a pg_constraint guard",
  (fkBlock.match(/IF NOT EXISTS \(\s*[\r\n]/g) || []).length === 2 &&
    (fkBlock.match(/ADD CONSTRAINT/g) || []).length === 2 &&
    (fkBlock.match(/FROM pg_constraint/g) || []).length === 2
);

// 9. verification table is well formed: contiguous numbering, ends in OK/LOOK.
const rows = [...text.matchAll(/^\s{8}\((\d+), '/gm)].map((m) => Number(m[1]));
const contiguous = rows.every((n, i) => n === i + 1);
check(`verification rows are numbered 1..${rows.length} with no gaps`, contiguous, rows.join(","));
check("summary renders OK / LOOK AT THIS", text.includes("THEN 'OK' ELSE '*** LOOK AT THIS ***'"));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
