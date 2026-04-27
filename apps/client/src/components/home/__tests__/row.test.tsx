// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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

function renderRow(stubOverride: Partial<HomeRowStub> = {}) {
  return render(<Row row={{ ...stub, ...stubOverride }} onRowUnavailable={vi.fn()} />);
}

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
