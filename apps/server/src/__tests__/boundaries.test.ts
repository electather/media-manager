import { describe, expect, it } from "vite-plus/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SERVER_SRC = join(ROOT, "apps/server/src");

/**
 * Modules whose canonical layout the test enforces. Phase 2 enables only the
 * notifications exemplar; Phase 3 retrofits the remaining seven and extends
 * this list as each lands so the rules stay in lock-step with the code.
 */
const ENABLED_MODULES = [
  "notifications",
  "preferences",
  "auth",
  "artwork",
  "catalog",
  "home",
  "media",
  "plugin-runtime",
];
const ALL_MODULES = [
  "artwork",
  "auth",
  "catalog",
  "home",
  "media",
  "notifications",
  "preferences",
  "plugin-runtime",
];

// Barrel may only re-export from these sibling files (or directory barrels):
// service, events, errors, types, jobs. `repo/**`, `internal/**`, and
// individual handler files in `jobs/<x>.ts` are deliberately private.
const APPROVED_RE_EXPORT_SOURCES = [
  /^\.\/service$/,
  /^\.\/events$/,
  /^\.\/errors$/,
  /^\.\/types$/,
  /^\.\/jobs$/,
  /^\.\/progress$/,
];

function readBarrel(module: string): string {
  return readFileSync(join(SERVER_SRC, module, "index.ts"), "utf8");
}

function parseReExportSources(barrelText: string): string[] {
  // Match: `export { ... } from "..."`, `export * from "..."`,
  // `export type { ... } from "..."`, `export type * from "..."`.
  const re = /export\s+(?:\*|type\s+\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
  const sources: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(barrelText)) !== null) {
    sources.push(m[1]!);
  }
  return sources;
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

function forbiddenDeepImportPatterns(module: string): RegExp[] {
  // Match `../<module>/repo`, `../<module>/repo/x`, `../<module>/internal/x`,
  // `../<module>/jobs/<handler>` AND the `@/<module>/...` path-alias variants.
  // The handler-file pattern excludes `../<module>/jobs` (no trailing slash)
  // because that resolves to `jobs/index.ts` which is allowed via the barrel.
  return [
    new RegExp(`["']\\.\\.\/\${module}\/repo(["'/])`),
    new RegExp(`["']\\.\\.\/\${module}\/internal\/`),
    new RegExp(`["']\\.\\.\/\${module}\/jobs\/[a-zA-Z]`),
    new RegExp(`["']@\/\${module}\/repo(["'/])`),
    new RegExp(`["']@\/\${module}\/internal\/`),
    new RegExp(`["']@\/\${module}\/jobs\/[a-zA-Z]`),
  ];
}

describe("backend boundaries: canonical module layout", () => {
  for (const module of ENABLED_MODULES) {
    describe(`${module}/`, () => {
      it("has index.ts as the barrel", () => {
        const path = join(SERVER_SRC, module, "index.ts");
        expect(statSync(path).isFile()).toBe(true);
      });

      it("re-exports only from approved sibling files", () => {
        const barrel = readBarrel(module);
        const sources = parseReExportSources(barrel);
        const offenders: string[] = [];
        for (const src of sources) {
          if (!src.startsWith("./")) continue;
          const ok = APPROVED_RE_EXPORT_SOURCES.some((re) => re.test(src));
          if (!ok) offenders.push(src);
        }
        expect(offenders, `barrel exports from disallowed path(s)`).toEqual([]);
      });

      it("is not deep-imported from any other module, adapter, or entry point", () => {
        const forbidden = forbiddenDeepImportPatterns(module);
        const offenders: string[] = [];
        const moduleRoot = join(SERVER_SRC, module);
        const allFiles = walk(SERVER_SRC);
        for (const file of allFiles) {
          if (file.startsWith(moduleRoot + "/") || file === moduleRoot + ".ts") continue;
          const text = readFileSync(file, "utf8");
          for (const re of forbidden) {
            if (re.test(text)) {
              offenders.push(`${relative(ROOT, file)} matches ${re.source}`);
            }
          }
        }
        expect(offenders, `external deep imports of ${module}/`).toEqual([]);
      });
    });
  }

  // Always asserted, regardless of ENABLED_MODULES: every domain module ships
  // at least an `index.ts`. Phase 3 retrofit will tighten the layout for the
  // rest; the file-presence check is cheap to assert now.
  for (const module of ALL_MODULES) {
    it(`${module}/ ships an index.ts barrel`, () => {
      const path = join(SERVER_SRC, module, "index.ts");
      expect(statSync(path).isFile()).toBe(true);
    });
  }
});
