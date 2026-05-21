// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { setupVirtualizerEnv } from "./virtualizer-test-env";
import { VirtualWindowList } from "../virtual-window-list";

describe("VirtualWindowList", () => {
  let env: ReturnType<typeof setupVirtualizerEnv> | undefined;
  afterEach(() => {
    cleanup();
    env?.cleanup();
    env = undefined;
  });

  it("caps mounted items to roughly visible + overscan window", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementHeight: 120 });
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `i-${i}` }));
    render(
      <VirtualWindowList
        items={items}
        getKey={(it) => it.id}
        estimateSize={() => 120}
        renderItem={(it) => <div data-testid="vw-item">{it.id}</div>}
      />,
    );
    const mounted = screen.queryAllByTestId("vw-item");
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(20);
  });

  it("renders header and footer slots verbatim", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementHeight: 120 });
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `i-${i}` }));
    render(
      <VirtualWindowList
        items={items}
        getKey={(it) => it.id}
        estimateSize={() => 120}
        renderItem={(it) => <div data-testid="vw-item">{it.id}</div>}
        header={<div data-testid="vw-header">H</div>}
        footer={<div data-testid="vw-footer">F</div>}
      />,
    );
    expect(screen.getByTestId("vw-header")).toBeTruthy();
    expect(screen.getByTestId("vw-footer")).toBeTruthy();
  });
});
