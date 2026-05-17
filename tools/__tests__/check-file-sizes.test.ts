import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { walk } from "../check-file-sizes";

test("walk skips entries that cannot be statted", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-file-sizes-"));
  try {
    const source = join(dir, "service.ts");
    writeFileSync(source, "export const ok = true;\n");
    symlinkSync(join(dir, "missing.ts"), join(dir, "broken.ts"));

    expect(walk(dir)).toEqual([source]);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
