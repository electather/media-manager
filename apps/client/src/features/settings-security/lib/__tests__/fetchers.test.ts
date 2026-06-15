import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const authMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
}));
vi.mock("@/shared/lib/auth", () => ({ authClient: authMock }));

import { fetchSessions } from "../fetchers";
import { SettingsSecurityApiError } from "../types";

const validRow = {
  id: "sess-1",
  token: "tok-1",
  userId: "user-1",
  ipAddress: "203.0.113.10",
  userAgent: "Mozilla/5.0",
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: new Date(),
};

beforeEach(() => authMock.listSessions.mockReset());
afterEach(() => vi.clearAllMocks());

describe("fetchSessions", () => {
  it("returns the validated session list on a well-formed response", async () => {
    authMock.listSessions.mockResolvedValue({ data: [validRow], error: null });
    const sessions = await fetchSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.token).toBe("tok-1");
  });

  it("throws a typed error when a required field is missing", async () => {
    const { token: _omitted, ...withoutToken } = validRow;
    authMock.listSessions.mockResolvedValue({ data: [withoutToken], error: null });
    await expect(fetchSessions()).rejects.toBeInstanceOf(SettingsSecurityApiError);
  });

  it("maps an upstream auth error to the typed error", async () => {
    authMock.listSessions.mockResolvedValue({
      data: null,
      error: { status: 500, message: "boom" },
    });
    await expect(fetchSessions()).rejects.toBeInstanceOf(SettingsSecurityApiError);
  });
});
