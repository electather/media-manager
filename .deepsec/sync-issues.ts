#!/usr/bin/env -S npx tsx
/**
 * Syncs deepsec report findings to GitHub issues.
 * Reads data/media-manager/reports/report.json, fetches existing issue titles,
 * and creates issues for any finding not already tracked.
 *
 * Dedup key: title + filePath. Existing issues are matched by title + the
 * "**File:** `path`" line in the body (format written by this script).
 * For issues that predate this script (no structured body), falls back to
 * title-count matching: if #existing-with-title >= #report-with-title, skip.
 *
 * Usage: pnpm sync-issues
 * Requires: gh CLI authenticated, run from .deepsec/ directory.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Finding {
  severity: string;
  vulnSlug: string;
  title: string;
  description: string;
  lineNumbers: number[];
  recommendation: string;
  confidence: string;
  producedByRunId: string;
}

interface ReportFile {
  filePath: string;
  findings: Finding[];
}

interface Report {
  projectId: string;
  generatedAt: string;
  summary: Record<string, number>;
  files: ReportFile[];
}

interface GhIssue {
  title: string;
  body: string;
}

function gh(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf8" });
}

function fetchExistingIssues(): GhIssue[] {
  const raw = gh(
    'issue list --state all --limit 500 --json title,body'
  );
  return JSON.parse(raw);
}

// Extract the **File:** `path` from an issue body written by this script.
function extractFilePath(body: string): string | null {
  const m = body.match(/\*\*File:\*\*\s+`([^`]+)`/);
  return m ? m[1] : null;
}

function buildIssueKey(title: string, filePath: string): string {
  return `${title}\0${filePath}`;
}

function createIssue(filePath: string, finding: Finding): string {
  const lines =
    finding.lineNumbers.length > 0
      ? finding.lineNumbers.slice(0, 10).join(", ")
      : "—";

  const body = [
    `**File:** \`${filePath}\``,
    `**Lines:** ${lines}`,
    `**Severity:** ${finding.severity}`,
    `**Confidence:** ${finding.confidence}`,
    "",
    finding.description,
    "",
    `**Recommendation:** ${finding.recommendation}`,
  ].join("\n");

  return gh(
    `issue create --title ${JSON.stringify(finding.title)} --body ${JSON.stringify(body)}`
  ).trim();
}

// --- main ---

const reportPath = join(
  import.meta.dirname,
  "data/media-manager/reports/report.json"
);
const report: Report = JSON.parse(readFileSync(reportPath, "utf8"));

console.log(
  `Report: ${report.summary.totalFindings} findings from ${report.generatedAt}`
);

const existingIssues = fetchExistingIssues();
console.log(`Existing issues: ${existingIssues.size ?? existingIssues.length}`);

// Build two lookup structures:
// 1. Structured key (title + filePath) for issues created by this script.
// 2. Title count for issues that predate this script (no filePath in body).
const structuredKeys = new Set<string>();
const titleCounts = new Map<string, number>();

for (const issue of existingIssues) {
  const filePath = extractFilePath(issue.body);
  if (filePath) {
    structuredKeys.add(buildIssueKey(issue.title, filePath));
  }
  titleCounts.set(issue.title, (titleCounts.get(issue.title) ?? 0) + 1);
}

// Count how many findings per title appear in the report (for legacy fallback).
const reportTitleCounts = new Map<string, number>();
const allFindings: Array<{ filePath: string; finding: Finding }> = [];

for (const file of report.files) {
  for (const finding of file.findings) {
    allFindings.push({ filePath: file.filePath, finding });
    reportTitleCounts.set(
      finding.title,
      (reportTitleCounts.get(finding.title) ?? 0) + 1
    );
  }
}

// Track how many we've decided to create per title (for legacy fallback counter).
const toCreateCountByTitle = new Map<string, number>();

const newFindings = allFindings.filter(({ filePath, finding }) => {
  // Prefer structured match when available.
  if (structuredKeys.has(buildIssueKey(finding.title, filePath))) return false;

  // Legacy fallback: title count. If existing >= report count, all covered.
  const existingCount = titleCounts.get(finding.title) ?? 0;
  const alreadyScheduled = toCreateCountByTitle.get(finding.title) ?? 0;
  if (existingCount + alreadyScheduled >= (reportTitleCounts.get(finding.title) ?? 0)) {
    return false;
  }

  toCreateCountByTitle.set(finding.title, alreadyScheduled + 1);
  return true;
});

if (newFindings.length === 0) {
  console.log("All findings already tracked. Nothing to create.");
  process.exit(0);
}

console.log(`New findings: ${newFindings.length}`);

let created = 0;
let failed = 0;

for (const { filePath, finding } of newFindings) {
  try {
    const url = createIssue(filePath, finding);
    console.log(`  ✓ [${finding.severity}] ${finding.title}`);
    console.log(`    ${url}`);
    created++;
  } catch (err) {
    console.error(`  ✗ [${finding.severity}] ${finding.title}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(`\nDone: ${created} created, ${failed} failed.`);
if (failed > 0) process.exit(1);
