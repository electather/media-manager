#!/usr/bin/env bun
/**
 * Enforces LOC caps and junk-drawer filename bans (GUD-003) for server modules.
 * Hard caps: service.ts/index.ts 500, repo.ts 300, events.ts 200, jobs/* 200.
 * Soft warn at 80% (TASK-011). Run: bun tools/check-file-sizes.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
const BANNED_NAMES = new Set(["utils.ts", "helpers.ts", "misc.ts"]);

// Pre-existing oversized files scheduled for future splits (one-way ratchet).
// New files cannot be allowlisted without a paired plan task that schedules the split.
const ALLOWLIST: Record<string, string> = {};

type Cap = { warn: number; fail: number };
const CAPS: Record<string, Cap> = {
  "service.ts": { warn: 400, fail: 500 },
  // service/ directory index carries the same budget as the flat service.ts it replaced.
  "service/index.ts": { warn: 400, fail: 500 },
  "repo.ts": { warn: 240, fail: 300 },
  "events.ts": { warn: 160, fail: 200 },
};
const JOBS_CAP: Cap = { warn: 160, fail: 200 };

export function walk(dir: string, acc: string[] = []): string[] {
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

function loc(file: string): number {
  return readFileSync(file, "utf8").split("\n").length;
}

function capFor(rel: string): Cap | null {
  for (const [name, cap] of Object.entries(CAPS)) {
    if (rel.endsWith("/" + name)) return cap;
  }
  if (rel.match(/\/jobs\/[^/]+\.ts$/) && !rel.endsWith("/jobs/index.ts")) return JOBS_CAP;
  return null;
}

function main(): void {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const mod of MODULES) {
    const base = join(ROOT, "apps/server/src", mod);
    const files = walk(base);
    for (const file of files) {
      const rel = relative(ROOT, file);
      const fileName = rel.split("/").pop()!;
      if (BANNED_NAMES.has(fileName)) {
        failures.push(`${rel}: junk-drawer filename '${fileName}' is banned (GUD-003)`);
        continue;
      }
      const cap = capFor(rel);
      if (!cap) continue;
      const lines = loc(file);
      if (lines > cap.fail) {
        if (ALLOWLIST[rel]) {
          warnings.push(
            `${rel}: ${lines} LOC > ${cap.fail} hard cap [allowlisted: ${ALLOWLIST[rel]}]`,
          );
        } else {
          failures.push(`${rel}: ${lines} LOC > ${cap.fail} hard cap`);
        }
      } else if (lines > cap.warn) {
        warnings.push(`${rel}: ${lines} LOC > ${cap.warn} soft cap (hard cap ${cap.fail})`);
      }
    }
  }

  for (const w of warnings) console.warn(`warn ${w}`);
  for (const f of failures) console.error(`fail ${f}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} file-size or naming violation(s).`);
    process.exit(1);
  }
  console.log(`tools/check-file-sizes: 0 hard failures, ${warnings.length} soft warning(s).`);
}

if (import.meta.main) {
  main();
}
