// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { HomeRowStub } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: () => ({ data: undefined }),
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

const paginationMock = vi.hoisted(() => ({ value: { isPending: false } as unknown }));
vi.mock("@/hooks/use-row-pagination", () => ({
  useRowPagination: () => paginationMock.value,
}));

const cardSpy = vi.hoisted(() => vi.fn());
vi.mock("../card", () => ({
  Card: (props: { priority?: boolean }) => {
    cardSpy(props);
    return <div data-testid="card-stub">{props.priority ? "priority" : "normal"}</div>;
  },
}));

import { Row } from "../row";

function setPagination(value: Record<string, unknown>) {
  paginationMock.value = {
    items: [],
    cursor: null,
    hasMore: false,
    isFetching: false,
    isPending: false,
    isPartial: false,
    fetchNext: vi.fn(),
    ...value,
  };
}

const stub: HomeRowStub = {
  rowId: "upcomingForYou",
  title: "Upcoming for You",
  initialCursor: null,
};

function renderRow(stubOverride: Partial<HomeRowStub> = {}, props: { isFirstRow?: boolean } = {}) {
  return render(<Row row={{ ...stub, ...stubOverride }} onRowUnavailable={vi.fn()} {...props} />);
}

beforeEach(() => cardSpy.mockReset());
afterEach(() => cleanup());

describe("Row partial indicator", () => {
  it("renders the warning tooltip when pagination.isPartial is true", () => {
    setPagination({ items: [], isPartial: true });
    renderRow();
    expect(screen.getByLabelText("Some sources didn't respond")).toBeTruthy();
  });

  it("does not render the warning tooltip when pagination.isPartial is false", () => {
    setPagination({ items: [], isPartial: false });
    renderRow();
    expect(screen.queryByLabelText("Some sources didn't respond")).toBeNull();
  });

  it("renders the 'caught up' copy for upcomingForYou when items empty and not partial", () => {
    setPagination({ items: [], isPartial: false });
    renderRow();
    expect(screen.getByText(/all caught up on upcoming episodes/i)).toBeTruthy();
  });

  it("suppresses the 'caught up' copy when partial is true (calendar outage path)", () => {
    setPagination({ items: [], isPartial: true });
    renderRow();
    expect(screen.queryByText(/all caught up on upcoming episodes/i)).toBeNull();
  });
});

describe("Row priority propagation", () => {
  // The single-backdrop path renders one Card directly; covers the
  // non-carousel branch of Row's render tree.
  const singleItem = {
    id: "movie:1",
    tmdbId: "1",
    mediaType: "movie",
    title: "x",
  };

  it("propagates priority=true to every rendered Card when isFirstRow is true", () => {
    setPagination({ items: [singleItem] });
    renderRow({ rowId: "continueWatching" }, { isFirstRow: true });
    const priorities = cardSpy.mock.calls.map(
      (call) => (call[0] as { priority?: boolean }).priority,
    );
    expect(priorities.length).toBeGreaterThan(0);
    for (const p of priorities) expect(p).toBe(true);
  });

  it("does not mark cards as priority when isFirstRow is false or omitted", () => {
    setPagination({ items: [singleItem] });
    renderRow({ rowId: "continueWatching" });
    const priorities = cardSpy.mock.calls.map(
      (call) => (call[0] as { priority?: boolean }).priority,
    );
    expect(priorities.length).toBeGreaterThan(0);
    for (const p of priorities) expect(p).toBeFalsy();
  });
});
