#!/usr/bin/env bun
/**
 * Finds comments longer than MIN_LINES (5) in git-tracked .ts files.
 * Merges consecutive line comments; blocks stand alone; trailing comments don't merge.
 * String-aware (ignores `//` and `/*` in quotes), but comments in `${...}` treated as code.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A comment region is "long" when it spans strictly more than this many lines. */
export const MIN_LINES = 5;

export interface CommentSpan {
  startLine: number;
  endLine: number;
}

export interface LongComment {
  start_line: number;
  end_line: number;
  file_address: string;
}

// `trailing` marks a `//` region that had code before it on its opening line
// (e.g. `foo(); // note`). Such regions must not merge with adjacent standalone
// line comments — the code line between two runs is not a comment line.
type RawRegion = CommentSpan & { type: "line" | "block"; trailing?: boolean };

type ScanState = "code" | "line" | "block" | "single" | "double" | "template";

/**
 * Scans TypeScript source and returns the line ranges of every comment region
 * that spans more than `minLines` lines. Adjacent line comments are merged into
 * a single region; block comments stand on their own.
 */
export function findLongComments(source: string, minLines = MIN_LINES): CommentSpan[] {
  const len = source.length;
  const regions: RawRegion[] = [];
  let state: ScanState = "code";
  let line = 1;
  let regionStart = 0;
  let regionTrailing = false;
  let lineHasCode = false; // any non-whitespace code seen before a comment on the current line
  let i = 0;

  while (i < len) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "\n") {
      if (state === "line") {
        regions.push({
          startLine: regionStart,
          endLine: line,
          type: "line",
          trailing: regionTrailing,
        });
        state = "code";
      }
      line++;
      i++;
      lineHasCode = false;
      continue;
    }

    switch (state) {
      case "code":
        if (c === "/" && next === "/") {
          state = "line";
          regionStart = line;
          regionTrailing = lineHasCode;
          i += 2;
        } else if (c === "/" && next === "*") {
          state = "block";
          regionStart = line;
          i += 2;
        } else if (c === "'") {
          lineHasCode = true;
          state = "single";
          i++;
        } else if (c === '"') {
          lineHasCode = true;
          state = "double";
          i++;
        } else if (c === "`") {
          lineHasCode = true;
          state = "template";
          i++;
        } else {
          if (c !== " " && c !== "\t" && c !== "\r") lineHasCode = true;
          i++;
        }
        break;
      case "line":
        i++; // consumed up to the newline, handled above
        break;
      case "block":
        if (c === "*" && next === "/") {
          regions.push({ startLine: regionStart, endLine: line, type: "block" });
          state = "code";
          i += 2;
        } else {
          i++;
        }
        break;
      case "single":
      case "double":
      case "template": {
        const quote = state === "single" ? "'" : state === "double" ? '"' : "`";
        if (c === "\\") {
          if (source[i + 1] === "\n") line++; // line-continuation inside a string
          i += 2;
        } else {
          if (c === quote) state = "code";
          i++;
        }
        break;
      }
    }
  }

  // Flush an unterminated comment at EOF.
  if (state === "line")
    regions.push({ startLine: regionStart, endLine: line, type: "line", trailing: regionTrailing });
  if (state === "block") regions.push({ startLine: regionStart, endLine: line, type: "block" });

  const merged: RawRegion[] = [];
  for (const region of regions) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.type === "line" &&
      !last.trailing &&
      region.type === "line" &&
      !region.trailing &&
      region.startLine === last.endLine + 1
    ) {
      last.endLine = region.endLine;
    } else {
      merged.push({ ...region });
    }
  }

  return merged
    .filter((r) => r.endLine - r.startLine + 1 > minLines)
    .map(({ startLine, endLine }) => ({ startLine, endLine }));
}

/** Returns repo-relative paths of all git-tracked `.ts` files. */
export function trackedTsFiles(root = ROOT): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "*.ts"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter((p) => p.length > 0 && p.endsWith(".ts"));
}

/** Parses an optional `--limit`/`-n` argument; returns undefined when absent. */
export function parseLimit(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = arg.match(/^(?:--limit|-n|-l)=(.+)$/);
    const raw = inline
      ? inline[1]
      : arg === "--limit" || arg === "-n" || arg === "-l"
        ? argv[++i]
        : undefined;
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid limit: ${raw}`);
    }
    return n;
  }
  return undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: bun tools/find-long-comments.ts [--limit <n>]");
    return;
  }

  const limit = parseLimit(argv);
  const results: LongComment[] = [];

  for (const file of trackedTsFiles()) {
    let source: string;
    try {
      source = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue; // tracked but missing on disk (e.g. staged deletion)
    }
    for (const span of findLongComments(source)) {
      results.push({ start_line: span.startLine, end_line: span.endLine, file_address: file });
      if (limit !== undefined && results.length >= limit) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

if (import.meta.main) {
  main();
}
