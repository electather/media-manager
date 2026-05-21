// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { usePermission } from "../use-permission";

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

describe("usePermission", () => {
  it("returns true when permission is present in session", () => {
    mockUseSession.mockReturnValue({
      data: { permissions: ["admin:users", "admin:roles"] },
    } as ReturnType<typeof authClient.useSession>);
    const { result } = renderHook(() => usePermission("admin:users"));
    expect(result.current).toBe(true);
  });

  it("returns false when permission is absent from session", () => {
    mockUseSession.mockReturnValue({
      data: { permissions: ["admin:roles"] },
    } as ReturnType<typeof authClient.useSession>);
    const { result } = renderHook(() => usePermission("admin:users"));
    expect(result.current).toBe(false);
  });

  it("returns false when session.data is null", () => {
    mockUseSession.mockReturnValue({
      data: null,
    } as ReturnType<typeof authClient.useSession>);
    const { result } = renderHook(() => usePermission("admin:users"));
    expect(result.current).toBe(false);
  });

  it("returns false when session.isPending is true", () => {
    mockUseSession.mockReturnValue({
      data: null,
      isPending: true,
    } as ReturnType<typeof authClient.useSession>);
    const { result } = renderHook(() => usePermission("admin:users"));
    expect(result.current).toBe(false);
  });
});
