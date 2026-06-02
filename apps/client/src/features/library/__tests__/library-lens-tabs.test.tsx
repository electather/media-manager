// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import { librarySearchSchema, type LibrarySearch } from "../lib/search";

afterEach(() => cleanup());

// Capture the props each `RouteTab` is rendered with so we can exercise the
// inline `search` reducer directly — that reducer hand-lists the carried axes,
// which the type system can't guard (TanStack types `prev` as the full search).
const captured: { search?: (prev: LibrarySearch) => LibrarySearch }[] = [];
vi.mock("@/shared/components/route-tabs", () => ({
  RouteTabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  RouteTab: (props: { search?: (prev: LibrarySearch) => LibrarySearch }) => {
    captured.push(props);
    return <a href="#" />;
  },
}));

const { LibraryLensTabs } = await import("../components/library-lens-tabs");

describe("LibraryLensTabs", () => {
  it("carries every librarySearchSchema axis across a lens switch", () => {
    render(<LibraryLensTabs />);
    const carry = captured[0]?.search;
    expect(carry).toBeTypeOf("function");

    const full: LibrarySearch = {
      kinds: ["movie"],
      genres: ["Drama"],
      qualities: ["4K"],
      servers: ["Plex"],
      watched: ["partial"],
    };
    const next = carry!(full);

    // The set of carried keys must match the schema's axes exactly — a new axis
    // added to `librarySearchSchema` but not to the reducer would drop here.
    expect(Object.keys(next).sort()).toEqual(Object.keys(librarySearchSchema.shape).sort());
    expect(next).toEqual(full);
  });
});
