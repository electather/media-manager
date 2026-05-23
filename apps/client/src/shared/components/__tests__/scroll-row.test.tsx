// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { setupVirtualizerEnv } from "../virtualized/__tests__/virtualizer-test-env";
import { ScrollRow, ScrollRowTrack, ScrollRowViewport } from "../scroll-row";

describe("ScrollRowTrack", () => {
  let env: ReturnType<typeof setupVirtualizerEnv> | undefined;
  afterEach(() => {
    cleanup();
    env?.cleanup();
    env = undefined;
  });

  it("non-virtualize branch renders children verbatim", () => {
    render(
      <ScrollRow>
        <ScrollRowViewport>
          <ScrollRowTrack>
            <li data-testid="child-a">A</li>
            <li data-testid="child-b">B</li>
            <li data-testid="child-c">C</li>
          </ScrollRowTrack>
        </ScrollRowViewport>
      </ScrollRow>,
    );
    expect(screen.getByTestId("child-a")).toBeTruthy();
    expect(screen.getByTestId("child-b")).toBeTruthy();
    expect(screen.getByTestId("child-c")).toBeTruthy();
  });

  it("virtualize branch caps DOM nodes and fires onRangeChange", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    const items = Array.from({ length: 100 }, (_, i) => ({ id: `it-${i}` }));
    const onRangeChange = vi.fn();
    render(
      <ScrollRow>
        <ScrollRowViewport>
          <ScrollRowTrack
            virtualize
            items={items}
            getKey={(it) => it.id}
            estimateItemWidth={200}
            renderItem={(it) => <span data-testid="virt-cell">{it.id}</span>}
            onRangeChange={onRangeChange}
          />
        </ScrollRowViewport>
      </ScrollRow>,
    );
    const cells = screen.queryAllByTestId("virt-cell");
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(items.length);
    expect(onRangeChange).toHaveBeenCalled();
    const lastCall = onRangeChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      startIndex: expect.any(Number),
      endIndex: expect.any(Number),
    });
  });

  it("virtualize branch positions items with gapPx between them", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `it-${i}` }));
    render(
      <ScrollRow>
        <ScrollRowViewport>
          <ScrollRowTrack
            virtualize
            items={items}
            getKey={(it) => it.id}
            estimateItemWidth={200}
            gapPx={16}
            renderItem={(it) => <span data-testid="virt-cell">{it.id}</span>}
          />
        </ScrollRowViewport>
      </ScrollRow>,
    );
    // Items are absolutely positioned by the virtualizer; each `vi.start` must
    // advance by `estimateItemWidth + gapPx` so the rendered cards keep a 16px
    // visual gap. A prior regression measured the DOM (cardWidth only) and
    // packed items tight with no gap.
    const positioned = Array.from(
      document.querySelectorAll<HTMLLIElement>('[data-slot="scroll-row-item"]'),
    );
    expect(positioned.length).toBeGreaterThan(1);
    const first = Number.parseFloat(positioned[0]!.style.insetInlineStart);
    const second = Number.parseFloat(positioned[1]!.style.insetInlineStart);
    expect(second - first).toBe(216);
  });
});
