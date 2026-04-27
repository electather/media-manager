// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import { HomeFeedSkeleton } from "../home-feed-skeleton";

afterEach(() => cleanup());

describe("HomeFeedSkeleton", () => {
  it("flags itself as busy and renders four row strips", () => {
    const { container } = render(<HomeFeedSkeleton />);
    const root = container.firstChild as HTMLElement | null;
    expect(root?.getAttribute("aria-busy")).not.toBeNull();
    // Four row groups + one top-zone group.
    const groups = container.querySelectorAll("[class*='flex flex-col gap-2']").length;
    expect(groups).toBeGreaterThanOrEqual(4);
  });
});
