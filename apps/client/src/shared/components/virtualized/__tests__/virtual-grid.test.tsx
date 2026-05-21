// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { setupVirtualizerEnv } from "./virtualizer-test-env";
import { VirtualGrid } from "../virtual-grid";

describe("VirtualGrid", () => {
  let env: ReturnType<typeof setupVirtualizerEnv> | undefined;
  afterEach(() => {
    cleanup();
    env?.cleanup();
    env = undefined;
  });

  it("caps mounted rows at 1024px viewport with minColumnWidthPx=180", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 1024, elementHeight: 320 });
    const items = Array.from({ length: 500 }, (_, i) => ({ id: `i-${i}` }));
    render(
      <VirtualGrid
        items={items}
        getKey={(it) => it.id}
        minColumnWidthPx={180}
        estimateRowHeight={() => 320}
        renderItem={(it) => <div data-testid="vg-cell">{it.id}</div>}
      />,
    );
    const rows = document.querySelectorAll("[data-index]");
    // 5 cols @ 1024 (auto-fill formula yields 5), 800/320 ≈ 2.5 visible + overscan 2 → ~ <= 6.
    expect(rows.length).toBeLessThanOrEqual(6);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("recomputes columns when the parent shrinks", async () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 1024, elementHeight: 320 });
    const items = Array.from({ length: 500 }, (_, i) => ({ id: `i-${i}` }));
    const { container } = render(
      <VirtualGrid
        items={items}
        getKey={(it) => it.id}
        minColumnWidthPx={180}
        estimateRowHeight={() => 320}
        renderItem={(it) => <div data-testid="vg-cell">{it.id}</div>}
      />,
    );

    const initialRow = container.querySelector('[data-index="0"]') as HTMLElement | null;
    expect(initialRow).toBeTruthy();
    const initialColsAttr = initialRow?.style.gridTemplateColumns ?? "";
    expect(initialColsAttr).toContain("repeat(5,");

    await act(async () => {
      env?.triggerResize(600);
    });

    const resizedRow = container.querySelector('[data-index="0"]') as HTMLElement | null;
    const resizedColsAttr = resizedRow?.style.gridTemplateColumns ?? "";
    expect(resizedColsAttr).toContain("repeat(3,");
  });
});
