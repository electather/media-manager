// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/shared/hooks/use-permission", () => ({
  usePermission: vi.fn(),
}));

import { usePermission } from "@/shared/hooks/use-permission";
import { Can } from "../can";

const mockUsePermission = vi.mocked(usePermission);

afterEach(cleanup);

describe("Can", () => {
  it("renders children when usePermission returns true", () => {
    mockUsePermission.mockReturnValue(true);
    render(
      <Can permission="admin:users">
        <span>allowed</span>
      </Can>,
    );
    expect(screen.getByText("allowed")).toBeTruthy();
  });

  it("renders null when usePermission returns false and no fallback", () => {
    mockUsePermission.mockReturnValue(false);
    const { container } = render(
      <Can permission="admin:users">
        <span>allowed</span>
      </Can>,
    );
    expect(container.textContent).toBe("");
  });

  it("renders fallback when usePermission returns false and fallback is provided", () => {
    mockUsePermission.mockReturnValue(false);
    render(
      <Can permission="admin:users" fallback={<span>denied</span>}>
        <span>allowed</span>
      </Can>,
    );
    expect(screen.getByText("denied")).toBeTruthy();
    expect(screen.queryByText("allowed")).toBeNull();
  });
});
