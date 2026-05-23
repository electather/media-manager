// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { PackageOpenIcon } from "lucide-react";

import { EmptyState } from "../empty-state";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders the icon, title and description", () => {
    render(
      <EmptyState
        icon={<PackageOpenIcon data-testid="empty-icon" className="size-5" />}
        title="Nothing to acquire"
        description="Items wishlisted that aren't on a media server."
      />,
    );
    expect(screen.getByTestId("empty-icon")).toBeDefined();
    expect(screen.getByText("Nothing to acquire")).toBeDefined();
    expect(screen.getByText("Items wishlisted that aren't on a media server.")).toBeDefined();
  });

  it("renders the optional action slot below the description", () => {
    render(
      <EmptyState
        icon={<PackageOpenIcon className="size-5" />}
        title="Empty"
        description="No items."
        action={
          <button type="button" data-testid="empty-action">
            Add one
          </button>
        }
      />,
    );
    const action = screen.getByTestId("empty-action");
    expect(action).toBeDefined();
    // Action sits as a sibling after the description block.
    expect(action.tagName).toBe("BUTTON");
  });
});
