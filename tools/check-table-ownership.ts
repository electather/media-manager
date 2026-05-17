#!/usr/bin/env bun
/**
 * Enforces drizzle-table ownership: each module may only import schema symbols
 * that are owned by itself or by `server-infra`. Run from repo root:
 *   `bun tools/check-table-ownership.ts`.
 *
 * Plan ref: TASK-012 in plan/architecture-backend-boundaries-1.md.
 *
 * Schema files declare ownership via a top-of-file directive:
 *   // @owner: <module>
 * A file may override ownership for an individual table with:
 *   // @owner(<tableName>): <module>
 * placed on the line immediately above the `export const <tableName> =` line.
 *
 * Phase 1: only condition (a) (ownership match) is enforced. Condition (b)
 * (importer must be <module>/repo.ts or <module>/repo/**) requires per-module
 * repo.ts which is built in Phase 2/3 — once repo.ts lands for a module, this
 * script should also assert the importer path.
 *
 * Import specifier resolution covers two shapes:
 *   - relative (`./x`, `../x`) — resolved against the importer's directory.
 *   - tsconfig path alias (`@/x`) — resolved against `apps/server/src/`,
 *     matching the `paths` entry in `apps/server/tsconfig.json`.
 * Other specifiers (workspace packages, externals) are skipped.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SRC = join(ROOT, "apps/server/src");
const SCHEMA_DIR = join(SERVER_SRC, "db/schema");
const MODULES = [
  "artwork",
  "auth",
  "catalog",
  "home",
  "media",
  "notifications",
  "preferences",
  "plugin-runtime",
];

// Pre-existing cross-module schema imports. Each entry: "<rel-file>:<symbol>" → plan-task reference.
// Phase 2/3 retrofit routes the reads through the owning module's barrel + repo.
// Adding to this list is a one-way ratchet — paired plan task required.
//
// Phase 2 (TASK-019) resolved 7 entries: all notifications reads now route
// through `auth.{listUsersHavingPermission, usersHavingPermission}` and
// `pluginRuntime.{getConnectionById, listEnabledConnectionsForUsers,
// ensureInboxConnection}`. The plugin-runtime/user-pool entry dropped because
// `serviceConnections` ownership moved from `preferences` to `plugin-runtime`
// (Phase 1 mis-classified it; the table is owned by plugin-runtime).
const ALLOWLIST: Record<string, string> = {
  "apps/server/src/catalog/jobs/user-mirror-sync.ts:serviceConnections":
    "TASK-045: catalog reads via plugin-runtime/preferences barrel",
  "apps/server/src/home/jobs/layout-warm.ts:feedback":
    "TASK-046: home reads via preferences barrel",
  "apps/server/src/home/jobs/layout-warm.ts:userHistoryMirror":
    "TASK-046: home reads via catalog barrel",
  "apps/server/src/media/connection-lifecycle.ts:serviceConnections":
    "TASK-047: media reads via plugin-runtime barrel",
  "apps/server/src/media/connection-targeted.ts:serviceConnections":
    "TASK-047: media reads via plugin-runtime barrel",
  "apps/server/src/media/id-resolver.ts:idMap": "TASK-047: media reads via catalog barrel",
  "apps/server/src/media/primary-preference.ts:primaryConnections":
    "TASK-047: media reads via preferences barrel",
  "apps/server/src/media/primary-preference.ts:serviceConnections":
    "TASK-047: media reads via plugin-runtime barrel",
};

type OwnerInfo = { owner: string; sourceFile: string };
const ownerMap = new Map<string, OwnerInfo>();
const violations: string[] = [];
const warnings: string[] = [];
let schemaFileCount = 0;
let moduleFileCount = 0;

function listSchemaFiles(): string[] {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .map((f) => join(SCHEMA_DIR, f));
}

function parseSchemaFile(file: string): void {
  schemaFileCount += 1;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  // Find the file-level `// @owner: <module>` directive. It must appear in the
  // leading comment block (before any non-comment, non-blank line).
  let fileOwner: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (!line.startsWith("//")) break;
    const m = line.match(/^\/\/\s*@owner\s*:\s*([A-Za-z0-9_-]+)\s*$/);
    if (m) {
      fileOwner = m[1]!;
      break;
    }
  }

  // Track per-table overrides via `// @owner(<table>): <module>`.
  const perTable = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const m = line.match(/^\/\/\s*@owner\(([A-Za-z0-9_]+)\)\s*:\s*([A-Za-z0-9_-]+)\s*$/);
    if (!m) continue;
    perTable.set(m[1]!, m[2]!);
  }

  // Collect every `export const <name>` symbol.
  const exportNames: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*export\s+const\s+([A-Za-z0-9_]+)\s*=/);
    if (m) exportNames.push(m[1]!);
  }

  if (!fileOwner && perTable.size === 0) {
    violations.push(`${rel}: missing @owner directive`);
    return;
  }

  for (const name of exportNames) {
    const owner = perTable.get(name) ?? fileOwner;
    if (!owner) {
      violations.push(
        `${rel}: export '${name}' has no owner (no file-level or per-table directive)`,
      );
      continue;
    }
    ownerMap.set(name, { owner, sourceFile: rel });
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules" || entry === "dist") continue;
      walk(full, acc);
    } else if (stat.isFile() && extname(full) === ".ts" && !full.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

const IMPORT_BLOCK_RE =
  /import\s+(?:type\s+)?(?:\*\s+as\s+[A-Za-z0-9_]+|[A-Za-z0-9_]+|\{[^}]*\}|[A-Za-z0-9_]+\s*,\s*\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

function resolveImportPath(importerDir: string, spec: string): string | null {
  if (spec.startsWith(".")) return resolve(importerDir, spec);
  // Mirror the `@/*` path alias declared in `apps/server/tsconfig.json` so
  // imports like `@/db/schema/catalog` are checked the same as the relative
  // `../../db/schema/catalog` form.
  if (spec.startsWith("@/")) return resolve(SERVER_SRC, spec.slice(2));
  return null;
}

function isSchemaImport(resolvedPath: string): boolean {
  const norm = resolvedPath.replace(/\\/g, "/");
  return /\/apps\/server\/src\/db\/schema(?:\/[^/]+)?$/.test(norm);
}

function parseImportedNames(clause: string): string[] {
  // Strip leading `import` and trailing source clause if accidentally included.
  const braceMatch = clause.match(/\{([\s\S]*?)\}/);
  if (!braceMatch) return [];
  return braceMatch[1]!
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      // Handle `name as alias` — keep the original name.
      const tokens = part.split(/\s+as\s+/);
      const head = tokens[0]!.trim();
      // Strip leading `type` modifier on individual specifiers.
      return head.replace(/^type\s+/, "").trim();
    })
    .filter((name) => /^[A-Za-z0-9_]+$/.test(name));
}

function checkModuleFile(modulePath: string, modName: string): void {
  moduleFileCount += 1;
  const rel = relative(ROOT, modulePath);
  const text = readFileSync(modulePath, "utf8");
  const importerDir = dirname(modulePath);

  // Walk every import block. Compute the line number per match so violations
  // pinpoint the import.
  const lineOffsets: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineOffsets.push(i + 1);
  }
  function lineOf(charIdx: number): number {
    let lo = 0;
    let hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lineOffsets[mid]! <= charIdx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  IMPORT_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_BLOCK_RE.exec(text)) !== null) {
    const spec = m[1]!;
    const resolved = resolveImportPath(importerDir, spec);
    if (!resolved) continue;
    if (!isSchemaImport(resolved)) continue;
    const line = lineOf(m.index);
    const names = parseImportedNames(m[0]!);
    for (const name of names) {
      const info = ownerMap.get(name);
      if (!info) {
        // Symbols like `userRelations`, zod schemas, etc. that aren't drizzle
        // tables won't appear in the ownership map. Treat as soft skip.
        continue;
      }
      if (info.owner === modName) continue;
      if (info.owner === "server-infra") continue;
      const allowKey = `${rel}:${name}`;
      if (ALLOWLIST[allowKey]) {
        warnings.push(
          `${rel}:${line}: imports '${name}' owned by ${info.owner} [allowlisted: ${ALLOWLIST[allowKey]}]`,
        );
        continue;
      }
      violations.push(`${rel}:${line}: imports '${name}' owned by ${info.owner}`);
    }
  }
}

// Build owner map.
for (const file of listSchemaFiles()) {
  parseSchemaFile(file);
}

// Walk module files.
for (const mod of MODULES) {
  const base = join(ROOT, "apps/server/src", mod);
  let files: string[];
  try {
    files = walk(base);
  } catch {
    continue;
  }
  for (const file of files) {
    checkModuleFile(file, mod);
  }
}

// Group violations by file for clearer output.
const grouped = new Map<string, string[]>();
for (const v of violations) {
  const idx = v.indexOf(":");
  const file = idx >= 0 ? v.slice(0, idx) : v;
  const arr = grouped.get(file) ?? [];
  arr.push(v);
  grouped.set(file, arr);
}

for (const w of warnings) console.warn(`warn ${w}`);
for (const [, items] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
  for (const item of items) console.error(`fail ${item}`);
}

console.log("");
console.log("tools/check-table-ownership:");
console.log(`  schema files scanned: ${schemaFileCount}`);
console.log(`  owners declared: ${ownerMap.size}`);
console.log(`  module files scanned: ${moduleFileCount}`);
console.log(`  violations: ${violations.length}`);

if (violations.length > 0) {
  process.exit(1);
}
console.log(`tools/check-table-ownership: 0 violations.`);
