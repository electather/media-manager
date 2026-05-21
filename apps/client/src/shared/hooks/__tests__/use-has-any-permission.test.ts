// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { useHasAnyPermission } from "../use-has-any-permission";

vi.mock("@/shared/lib/auth", () => ({
  authClient: {
    useSession: vi.fn(),
  },
}));

import { authClient } from "@/shared/lib/auth";

const mockUseSession = vi.mocked(authClient.useSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useHasAnyPermission", () => {
  it("returns true when at least one permission matches", () => {
    mockUseSession.mockReturnValue({
      data: { permissions: ["admin:roles"] },
    } as ReturnType<typeof authClient.useSession>);
    const { result } = renderHook(() => useHasAnyPermission(["admin:users", "admin:roles"]));
    expect(result.current).toBe(true);
  });

  it("returns false when no permissions match", () => {
    mockUseSession.mockReturnValue({
      data: { permissions: ["media:discover"] },
    } as ReturnType<typeof authClient.useSession>);
    const { result } = renderHook(() => useHasAnyPermission(["admin:users", "admin:roles"]));
    expect(result.current).toBe(false);
  });

  it("returns false on empty/null session", () => {
    mockUseSession.mockReturnValue({
      data: null,
    } as ReturnType<typeof authClient.useSession>);
    const { result } = renderHook(() => useHasAnyPermission(["admin:users", "admin:roles"]));
    expect(result.current).toBe(false);
  });
});
