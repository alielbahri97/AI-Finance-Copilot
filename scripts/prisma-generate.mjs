/**
 * Runs `prisma generate`, with a fallback for networks that block
 * binaries.prisma.sh.
 *
 * Prisma's CLI insists on having a schema-engine binary on disk before it will
 * run *any* command, including `generate` — even though this project never
 * executes it: the `prisma-client` generator emits plain TypeScript and the
 * runtime talks to Postgres through the `@prisma/adapter-pg` driver adapter.
 * The CLI only checks that the file exists, so pointing
 * PRISMA_SCHEMA_ENGINE_BINARY at an empty placeholder satisfies the check and
 * produces a byte-for-byte identical client.
 *
 * Behaviour:
 *   1. Run `prisma generate` normally. On an unrestricted network this is the
 *      only thing that happens — engines download and nothing below applies.
 *   2. If it fails *because the engine download failed*, print a warning, point
 *      PRISMA_SCHEMA_ENGINE_BINARY at a placeholder and retry.
 *   3. Any other failure (schema errors, etc.) is re-raised untouched.
 *
 * The fallback regenerates the client from the current schema — it never reuses
 * an existing one — and the freshness check below fails the build if the output
 * directory was somehow not rewritten, so a stale client cannot slip through.
 *
 * Only migrate/introspect commands (`db:push`, `db:migrate`) genuinely need a
 * working schema engine; use `npm run db:apply` for those on a blocked network.
 *
 * Set PRISMA_ENGINE_STUB_FALLBACK to change the behaviour:
 *   auto (default) - try the real download first, fall back if it fails
 *   always         - skip the doomed download attempt (saves ~70s per build on
 *                    a network that is known to block binaries.prisma.sh)
 *   off            - never fall back; fail loudly instead
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const schemaPath = path.join(root, "prisma", "schema.prisma");
const passthroughArgs = process.argv.slice(2);

const mode = (process.env.PRISMA_ENGINE_STUB_FALLBACK ?? "auto").toLowerCase();
if (!["auto", "always", "off"].includes(mode)) {
  console.error(
    `prisma-generate: PRISMA_ENGINE_STUB_FALLBACK must be auto, always or off (got "${mode}").`,
  );
  process.exit(1);
}

/** Markers that mean "the engine binary could not be downloaded". */
const DOWNLOAD_FAILURE = [
  "binaries.prisma.sh",
  "Failed to fetch the engine file",
  "failed to fetch sha256 checksum",
  "Downloading Prisma engines",
];

/** Resolves the generator's `output` path so we can verify it was rewritten. */
function generatorOutputDir() {
  try {
    const schema = readFileSync(schemaPath, "utf8");
    const match = schema.match(/generator\s+\w+\s*\{[^}]*?output\s*=\s*"([^"]+)"/s);
    if (match) return path.resolve(path.dirname(schemaPath), match[1]);
  } catch {
    // Fall through to the default location.
  }
  return path.join(root, "src", "generated", "prisma");
}

function newestMtimeMs(dir) {
  let newest = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

/** Empty placeholder that satisfies the CLI's existence check. */
function ensureStubEngine() {
  // Honour the placeholder committed at the repo root if it is still there.
  const committed = path.join(root, ".prisma-stub-engine.exe");
  if (existsSync(committed)) return committed;

  const stub = path.join(
    root,
    "node_modules",
    ".cache",
    "prisma-engine-stub",
    process.platform === "win32" ? "schema-engine.exe" : "schema-engine",
  );
  mkdirSync(path.dirname(stub), { recursive: true });
  if (!existsSync(stub)) writeFileSync(stub, "");
  return stub;
}

function runGenerate(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [prismaCli, "generate", ...passthroughArgs], {
      cwd: root,
      env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let combined = "";
    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.on("data", (chunk) => {
        combined += chunk.toString();
        sink.write(chunk);
      });
    }

    child.on("error", (err) => resolve({ code: 1, output: `${combined}\n${err.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, output: combined }));
  });
}

function banner(lines) {
  const width = Math.max(...lines.map((line) => line.length));
  console.error(`\n${"!".repeat(width + 4)}`);
  for (const line of lines) console.error(`! ${line.padEnd(width)} !`);
  console.error(`${"!".repeat(width + 4)}\n`);
}

const outputDir = generatorOutputDir();
const startedAt = Date.now();

if (mode !== "always") {
  const first = await runGenerate(process.env);
  if (first.code === 0) process.exit(0);

  const isDownloadFailure = DOWNLOAD_FAILURE.some((marker) =>
    first.output.toLowerCase().includes(marker.toLowerCase()),
  );

  if (!isDownloadFailure) {
    console.error(
      "\nprisma-generate: `prisma generate` failed for a reason unrelated to the\n" +
        "engine download, so the placeholder-engine fallback was not applied.\n",
    );
    process.exit(first.code);
  }

  if (mode === "off") {
    banner([
      "Prisma engine download failed and the fallback is disabled",
      "(PRISMA_ENGINE_STUB_FALLBACK=off).",
    ]);
    process.exit(first.code);
  }

  banner([
    "Could not download the Prisma schema engine from binaries.prisma.sh.",
    "Retrying with a placeholder engine binary.",
    "",
    "The generated client is still built fresh from prisma/schema.prisma and",
    "is fully correct: this project never runs the schema engine (the",
    "prisma-client generator emits TypeScript and the runtime uses the pg",
    "driver adapter).",
    "",
    "Commands that DO need a real engine (db:push, db:migrate) will still",
    "fail on this network -- use `npm run db:apply` instead.",
  ]);
}

const stub = ensureStubEngine();
const retry = await runGenerate({ ...process.env, PRISMA_SCHEMA_ENGINE_BINARY: stub });

if (retry.code !== 0) {
  banner([
    "`prisma generate` failed even with the placeholder engine.",
    "This is a real error -- see the output above.",
  ]);
  process.exit(retry.code);
}

// A fallback that quietly left an old client in place would hand the build a
// stale schema, which typechecks against fields that no longer exist. Refuse.
if (newestMtimeMs(outputDir) < startedAt) {
  banner([
    "`prisma generate` reported success but did not rewrite",
    outputDir,
    "Refusing to build against a possibly stale Prisma client.",
  ]);
  process.exit(1);
}

console.error(
  `prisma-generate: client regenerated using a placeholder schema engine (${path.relative(root, stub)}).`,
);
