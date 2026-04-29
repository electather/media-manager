import { AsyncLocalStorage } from "node:async_hooks";
import { consola, type ConsolaInstance, type LogType } from "consola";
import { scrub } from "../errors/scrubber";
import type { LogLevel } from "@ent-mcp/shared/jobs";
import { isPrimitive } from "es-toolkit/predicate";

const BUFFER_MAX_BYTES = 500 * 1024;

/**
 * Maps a consola log type name to its numeric verbosity (lower = more
 * severe, per `consola`'s `LogLevels` table). Mirrored locally rather than
 * imported so this module stays cheap and avoids pulling consola's runtime
 * for a value lookup.
 */
const CONSOLA_TYPE_VERBOSITY: Record<string, number> = {
  silent: Number.NEGATIVE_INFINITY,
  fatal: 0,
  error: 0,
  warn: 1,
  log: 2,
  info: 3,
  success: 3,
  fail: 3,
  ready: 3,
  start: 3,
  box: 3,
  debug: 4,
  trace: 5,
  verbose: Number.POSITIVE_INFINITY,
};

/**
 * Reads `JOB_CONSOLE_LOG_LEVEL` straight from `process.env` so this
 * low-level utility stays decoupled from `env.ts`'s validation chain
 * (importing the typed env up-front would crash test files that do not
 * inject the rest of the schema). Anything strictly more verbose than the
 * configured threshold is dropped on stdout. Default `warn` so per-run
 * completion banners don't clutter logs; buffer capture is unaffected so
 * the dashboard still sees every entry the per-job buffer level allows.
 */
function loadStdoutLevelThreshold(): number {
  const raw = (process.env.JOB_CONSOLE_LOG_LEVEL ?? "warn").trim().toLowerCase();
  const resolved = CONSOLA_TYPE_VERBOSITY[raw];
  return resolved ?? CONSOLA_TYPE_VERBOSITY.warn!;
}

// Frozen at module load — `JOB_CONSOLE_LOG_LEVEL` set after the first import
// of this file (e.g. inside a test that mutates `process.env`) is ignored for
// the rest of the worker. Tests that need a non-default threshold must set
// the env var before importing `run-logger`.
const STDOUT_LEVEL_THRESHOLD = loadStdoutLevelThreshold();

const LOG_LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  meta?: Record<string, unknown>;
  row?: string;
}

interface RunLogContext {
  buffer: LogEntry[];
  currentBytes: number;
  truncatedCount: number;
  minLevel: number;
  currentRow?: string;
}

const storage = new AsyncLocalStorage<RunLogContext>();

/** Returns the active run's log context, or null when called outside a run. */
export function currentRunLogContext(): RunLogContext | null {
  return storage.getStore() ?? null;
}

/** Tags subsequent log entries within this call with a row identifier. */
export function setCurrentRow(row: string | undefined): void {
  const ctx = storage.getStore();
  if (ctx) ctx.currentRow = row;
}

/** Runs `fn` inside a log-capture ALS context. */
export async function runWithLogCapture<T>(logLevel: LogLevel, fn: () => Promise<T>): Promise<T> {
  const ctx: RunLogContext = {
    buffer: [],
    currentBytes: 0,
    truncatedCount: 0,
    minLevel: LOG_LEVEL_ORDER[logLevel] ?? 1,
  };
  return storage.run(ctx, fn);
}

/** Appends a log entry to the active run's buffer (if any). */
// fallow-ignore-next-line complexity
function appendToBuffer(entry: LogEntry): void {
  const ctx = storage.getStore();
  if (!ctx) return;

  const levelNum = LOG_LEVEL_ORDER[entry.level] ?? 1;
  if (levelNum < ctx.minLevel) return;

  const size = estimateEntryBytes(entry);

  while (ctx.currentBytes + size > BUFFER_MAX_BYTES && ctx.buffer.length > 0) {
    const evicted = ctx.buffer.shift()!;
    ctx.currentBytes -= estimateEntryBytes(evicted);
    ctx.truncatedCount += 1;
  }

  ctx.buffer.push(entry);
  ctx.currentBytes += size;
}

/** Serializes and scrubs the captured logs, returning the JSON string and truncation count. */
// fallow-ignore-next-line complexity
export function serializeRunLogs(): {
  logs: string | null;
  logsTruncated: number;
} {
  const ctx = storage.getStore();
  if (!ctx || ctx.buffer.length === 0) {
    return { logs: null, logsTruncated: ctx?.truncatedCount ?? 0 };
  }

  const scrubbed = ctx.buffer.map((entry) => ({
    ...entry,
    msg: scrubString(entry.msg),
    meta: entry.meta ? (scrub(entry.meta) as Record<string, unknown>) : undefined,
  }));

  try {
    return {
      logs: JSON.stringify(scrubbed),
      logsTruncated: ctx.truncatedCount,
    };
  } catch {
    return { logs: null, logsTruncated: ctx.truncatedCount };
  }
}

/**
 * Creates a logger that tees output to both stdout (via consola) and the
 * run's in-memory ring buffer. Errors passed as the second argument are
 * flattened into `meta.error` with message, stack, and cause chain.
 */
export function createRunLogger(jobId: string, runId: string, requestId: string): ConsolaInstance {
  const tag = `job:${jobId}:${runId.slice(0, 8)}:${requestId.slice(0, 8)}`;
  const base = consola.withTag(tag);

  const handler: ProxyHandler<ConsolaInstance> = {
    get(target, prop, receiver) {
      if (isLogMethod(prop)) {
        // fallow-ignore-next-line complexity
        return (...args: unknown[]) => {
          const level = consolaTypeToLevel(prop);
          const { msg, meta } = extractMessageAndMeta(args);
          const ctx = storage.getStore();
          const entry: LogEntry = {
            ts: Date.now(),
            level,
            msg,
            meta: Object.keys(meta).length > 0 ? meta : undefined,
            row: ctx?.currentRow,
          };
          appendToBuffer(entry);
          const verbosity = CONSOLA_TYPE_VERBOSITY[prop] ?? CONSOLA_TYPE_VERBOSITY.info!;
          if (verbosity > STDOUT_LEVEL_THRESHOLD) return;
          return Reflect.get(target, prop, receiver).apply(
            target,
            args as [message: any, ...args: any[]],
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  };

  return new Proxy(base, handler);
}

function isLogMethod(prop: string | symbol): prop is LogType {
  return (
    typeof prop === "string" &&
    ["debug", "info", "warn", "error", "log", "success", "fail", "ready", "start", "box"].includes(
      prop,
    )
  );
}

const LEVEL_FOR_TYPE: Record<string, LogEntry["level"]> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  log: "info",
  success: "info",
  fail: "error",
  ready: "info",
  start: "info",
  box: "info",
};

function consolaTypeToLevel(type: string): LogEntry["level"] {
  return LEVEL_FOR_TYPE[type] ?? "info";
}

// fallow-ignore-next-line complexity
function extractMessageAndMeta(args: unknown[]): {
  msg: string;
  meta: Record<string, unknown>;
} {
  const meta: Record<string, unknown> = {};
  const parts: string[] = [];

  for (const arg of args) {
    if (arg instanceof Error) {
      parts.push(arg.message);
      meta.error = flattenError(arg);
    } else if (typeof arg === "object" && arg !== null && !Array.isArray(arg)) {
      Object.assign(meta, arg);
    } else {
      parts.push(String(arg));
    }
  }

  return { msg: parts.join(" "), meta };
}

function formatCause(cause: unknown): unknown {
  if (cause instanceof Error) return flattenError(cause);
  if (isPrimitive(cause)) return String(cause);
  return JSON.stringify(cause);
}

function flattenError(err: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {
    message: err.message,
    stack: err.stack ?? null,
  };
  if (err.cause) result.cause = formatCause(err.cause);
  return result;
}

function estimateEntryBytes(entry: LogEntry): number {
  let size = entry.msg.length + 40;
  if (entry.meta) {
    try {
      size += JSON.stringify(entry.meta).length;
    } catch {
      size += 100;
    }
  }
  if (entry.row) size += entry.row.length + 8;
  return size;
}

/** Applies pattern-based scrubbing to a string (credential-shaped tokens). */
function scrubString(input: string): string {
  return input
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "[REDACTED]");
}
