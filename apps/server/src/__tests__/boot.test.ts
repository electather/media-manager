import { describe, expect, it } from "vite-plus/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const SERVER_SRC = resolve(ROOT, "apps/server/src");

/**
 * Alphabetical module order for the Node entry point (`index.ts`).
 * `plugin-runtime` sorts before `preferences` because directory names are
 * compared char-by-char: 'p','l' < 'p','r'.
 */
const INDEX_EXPECTED_ORDER = [
  "artwork",
  "auth",
  "catalog",
  "home",
  "library",
  "media",
  "notifications",
  "plugin-runtime",
  "preferences",
  "watchlist",
];

// Maps namespace identifier to canonical module name. `plugin-runtime` → `pluginRuntime`
// (hyphens invalid in JS identifiers); others use directory name directly.
const NAMESPACE_TO_MODULE: Record<string, string> = {
  artwork: "artwork",
  auth: "auth",
  catalog: "catalog",
  home: "home",
  library: "library",
  media: "media",
  notifications: "notifications",
  pluginRuntime: "plugin-runtime",
  preferences: "preferences",
  watchlist: "watchlist",
};

// Strip JS line + block comments before scanning so prose mentions of
// `<ns>.registerJobs()` in JSDoc cannot pollute the extracted order.
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

function extractRegisterJobsOrder(file: string): string[] {
  const text = stripComments(readFileSync(file, "utf8"));
  // Match `<namespace>.registerJobs(...)` with any (possibly nested-brace)
  // argument list. The index path calls with no arg.
  const re = /(\w+)\.registerJobs\([^)]*\)/g;
  const order: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ns = m[1]!;
    const mod = NAMESPACE_TO_MODULE[ns];
    if (!mod) continue;
    if (order[order.length - 1] === mod) continue;
    order.push(mod);
  }
  return order;
}

describe("boot order", () => {
  it("apps/server/src/index.ts invokes every module's registerJobs() in alphabetical order", () => {
    const order = extractRegisterJobsOrder(resolve(SERVER_SRC, "index.ts"));
    expect(order).toEqual(INDEX_EXPECTED_ORDER);
  });
});

// Static check: every event in `<module>/events.ts` and `runtime-events.ts`
// must have an `on(...)` handler in some `on-*.ts`. Fresh-process variant too heavy;
// static check catches spec regression: "module added events.ts but never wired handler".
describe("event handler coverage", () => {
  const eventFiles = [
    resolve(SERVER_SRC, "jobs/runtime-events.ts"),
    resolve(SERVER_SRC, "media/events.ts"),
    resolve(SERVER_SRC, "plugin-runtime/events.ts"),
    resolve(SERVER_SRC, "notifications/events.ts"),
  ];

  function declaredEventRefs(text: string): string[] {
    // Match `<NAME>: "..." as EventName` inside `<CONST>_EVENTS = { ... } as const`.
    // We don't fully parse — just collect both `<CONST>` and `<NAME>` so the
    // search target becomes `<CONST>.<NAME>` substrings in handler files.
    const refs: string[] = [];
    const constMatch = text.match(/export const (\w+_EVENTS)\s*=\s*\{([\s\S]*?)\}\s*as const/);
    if (!constMatch) return refs;
    const constName = constMatch[1]!;
    const body = constMatch[2]!;
    const keyRe = /(\w+):\s*["'][^"']+["']\s*as EventName/g;
    let km: RegExpExecArray | null;
    while ((km = keyRe.exec(body)) !== null) {
      refs.push(`${constName}.${km[1]!}`);
    }
    return refs;
  }

  function findHandlerCalls(): string {
    // Concatenate every `on-*.ts` handler file; the substring search runs
    // across the joined corpus. This keeps the test cheap without a full AST
    // pass and avoids a per-file matrix.
    const moduleDirs = [
      "notifications/jobs",
      "catalog/jobs",
      "home/jobs",
      "preferences/jobs",
      "plugin-runtime/jobs",
    ];
    const chunks: string[] = [];
    for (const dir of moduleDirs) {
      const full = resolve(SERVER_SRC, dir);
      if (!existsSync(full)) continue;
      for (const entry of readdirSync(full)) {
        if (!entry.startsWith("on-") || !entry.endsWith(".ts")) continue;
        chunks.push(readFileSync(resolve(full, entry), "utf8"));
      }
    }
    return chunks.join("\n");
  }

  it("every declared event has at least one on() handler somewhere", () => {
    const declared: string[] = [];
    for (const file of eventFiles) {
      const text = readFileSync(file, "utf8");
      declared.push(...declaredEventRefs(text));
    }
    const handlerCorpus = findHandlerCalls();
    const missing = declared.filter((ref) => !handlerCorpus.includes(ref));
    expect(missing, "declared events without a matching on(...) call").toEqual([]);
  });
});

// Prevents cascade: `runner.emitJobOutcome` skips outcome emission for runtime-event
// dispatchers (else fault in `jobs.run.failed` re-emits the same event). Invariant:
// every `JOB_EVENTS` value must be in `EVENT_DISPATCHER_JOB_IDS` (checked in CI).
describe("runner skip-list ↔ JOB_EVENTS invariant", () => {
  it("every JOB_EVENTS value appears in EVENT_DISPATCHER_JOB_IDS", async () => {
    const { JOB_EVENTS, EVENT_DISPATCHER_JOB_IDS } = await import("../jobs/runtime-events");
    const missing = Object.values(JOB_EVENTS).filter((name) => !EVENT_DISPATCHER_JOB_IDS.has(name));
    expect(missing, "events declared without a dispatcher-skip entry").toEqual([]);
  });
});
