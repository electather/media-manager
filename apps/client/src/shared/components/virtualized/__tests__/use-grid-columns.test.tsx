// @vitest-environment happy-dom
import { useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { setupVirtualizerEnv } from "./virtualizer-test-env";
import { useGridColumns } from "../use-grid-columns";

function Probe({ minColumnWidthPx, gapPx }: { minColumnWidthPx: number; gapPx: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { cols } = useGridColumns(ref, { minColumnWidthPx, gapPx });
  return (
    <div ref={ref}>
      <span data-testid="cols">{cols}</span>
    </div>
  );
}

interface Case {
  width: number;
  expected: number;
}

// Pivot points for the `floor((w + gap) / (minCol + gap))` formula
// at gap=16, minCol=180: 1→2 at 376, 2→3 at 572, 3→4 at 768.
const CASES: Case[] = [
  { width: 200, expected: 1 },
  { width: 375, expected: 1 },
  { width: 376, expected: 2 },
  { width: 768, expected: 4 },
  { width: 1024, expected: 5 },
];

describe("useGridColumns", () => {
  let env: ReturnType<typeof setupVirtualizerEnv> | undefined;
  afterEach(() => {
    cleanup();
    env?.cleanup();
    env = undefined;
  });

  for (const { width, expected } of CASES) {
    it(`returns ${expected} cols at width ${width} with gap=16, minCol=180`, () => {
      env = setupVirtualizerEnv({ width, elementWidth: width });
      render(<Probe minColumnWidthPx={180} gapPx={16} />);
      expect(screen.getByTestId("cols").textContent).toBe(String(expected));
    });
  }
});
