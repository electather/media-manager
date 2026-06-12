import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Mocks must be declared before the imports that pull in service.ts, since
// vitest hoists vi.mock() calls to the top of the module.
vi.mock("../internal/config", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("../repo", () => ({
  findUserRole: vi.fn(),
  checkRolePermission: vi.fn(),
  listUsersWithPermission: vi.fn(),
  filterUsersWithPermission: vi.fn(),
}));

vi.mock("../../diagnostics/request-context", () => ({
  currentRequestContext: vi.fn(() => null),
}));

vi.mock("../internal/oauth-handler", () => ({ authRouteHandler: vi.fn() }));
vi.mock("../internal/oauth-metadata", () => ({
  oauthAuthorizationServerHandler: vi.fn(),
  oauthProtectedResourceHandler: vi.fn(),
}));

import { auth } from "../internal/config";
import {
  checkRolePermission,
  filterUsersWithPermission,
  findUserRole,
  listUsersWithPermission,
} from "../repo";
import { AuthService, resetAuthServiceForTest } from "../service";
import type { Permission } from "../types";

const mockGetSession = vi.mocked(auth.api.getSession);
const mockFindUserRole = vi.mocked(findUserRole);
const mockCheckRolePermission = vi.mocked(checkRolePermission);
const mockListUsers = vi.mocked(listUsersWithPermission);
const mockFilterUsers = vi.mocked(filterUsersWithPermission);

function makeContext(session?: { user: { id: string } }) {
  const store = new Map<string, unknown>();
  if (session) store.set("session", session);
  return {
    req: { raw: { headers: new Headers() } },
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

const mockNext = vi.fn(() => Promise.resolve());
const PERM = "manage.users" as Permission;

let service: AuthService;

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthServiceForTest();
  service = new AuthService();
});

describe("AuthService.loadUserRole", () => {
  it("returns null when repo finds no row", async () => {
    mockFindUserRole.mockResolvedValue(null);
    expect(await service.loadUserRole("u1")).toBeNull();
  });

  it("maps row to UserRoleInfo with isSystemAdmin=true for the admin system slug", async () => {
    mockFindUserRole.mockResolvedValue({ roleId: "r1", systemSlug: "admin" });
    const result = await service.loadUserRole("u1");
    expect(result).toEqual({ roleId: "r1", isSystemAdmin: true });
  });

  it("maps isSystemAdmin=false for a missing or non-admin system slug", async () => {
    mockFindUserRole.mockResolvedValue({ roleId: "r1", systemSlug: null });
    expect((await service.loadUserRole("u1"))?.isSystemAdmin).toBe(false);

    mockFindUserRole.mockResolvedValue({ roleId: "r1", systemSlug: "member" });
    expect((await service.loadUserRole("u1"))?.isSystemAdmin).toBe(false);
  });
});

describe("AuthService.roleHasPermission", () => {
  it("returns true for system admin without calling the DB", async () => {
    const role = { roleId: "r1", isSystemAdmin: true };
    expect(await service.roleHasPermission(role, PERM)).toBe(true);
    expect(mockCheckRolePermission).not.toHaveBeenCalled();
  });

  it("delegates to repo for non-admin role", async () => {
    const role = { roleId: "r1", isSystemAdmin: false };
    mockCheckRolePermission.mockResolvedValue(true);
    expect(await service.roleHasPermission(role, PERM)).toBe(true);
    expect(mockCheckRolePermission).toHaveBeenCalledWith("r1", PERM);
  });
});

describe("AuthService.userHasPermission", () => {
  it("returns false when user has no role", async () => {
    mockFindUserRole.mockResolvedValue(null);
    expect(await service.userHasPermission("u1", PERM)).toBe(false);
    expect(mockCheckRolePermission).not.toHaveBeenCalled();
  });
});

describe("AuthService.sessionUserId", () => {
  it("throws unauthorized when no session is set on the context", () => {
    const c = makeContext();
    expect(() => service.sessionUserId(c as never)).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("throws unauthorized when session has no user", () => {
    const c = makeContext({} as never);
    expect(() => service.sessionUserId(c as never)).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("throws unauthorized when session.user has no id", () => {
    const c = makeContext({ user: {} } as never);
    expect(() => service.sessionUserId(c as never)).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
  });

  it("returns the user id when the session is well-formed", () => {
    const c = makeContext({ user: { id: "u1" } });
    expect(service.sessionUserId(c as never)).toBe("u1");
  });
});

describe("AuthService.requireSession", () => {
  it("throws unauthorized when better-auth returns no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const c = makeContext();
    await expect(service.requireSession(c as never, mockNext)).rejects.toMatchObject({
      status: 401,
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("throws unauthorized when better-auth returns a session without user", async () => {
    mockGetSession.mockResolvedValue({} as never);
    const c = makeContext();
    await expect(service.requireSession(c as never, mockNext)).rejects.toMatchObject({
      status: 401,
    });
    expect(mockNext).not.toHaveBeenCalled();
    expect(c.set).not.toHaveBeenCalled();
  });

  it("throws unauthorized when better-auth returns a session.user without id", async () => {
    mockGetSession.mockResolvedValue({ user: {} } as never);
    const c = makeContext();
    await expect(service.requireSession(c as never, mockNext)).rejects.toMatchObject({
      status: 401,
    });
    expect(mockNext).not.toHaveBeenCalled();
    expect(c.set).not.toHaveBeenCalled();
  });

  it("sets session on context and calls next when session exists", async () => {
    const session = { user: { id: "u1" } };
    mockGetSession.mockResolvedValue(session as never);
    const c = makeContext();
    await service.requireSession(c as never, mockNext);
    expect(c.set).toHaveBeenCalledWith("session", session);
    expect(mockNext).toHaveBeenCalledOnce();
  });
});

describe("AuthService.requirePermission", () => {
  it("throws unauthorized when no session on context", async () => {
    const middleware = service.requirePermission(PERM);
    const c = makeContext();
    await expect(middleware(c as never, mockNext)).rejects.toMatchObject({ status: 401 });
  });

  it("throws unauthorized when session has no user", async () => {
    const middleware = service.requirePermission(PERM);
    const c = makeContext({} as never);
    await expect(middleware(c as never, mockNext)).rejects.toMatchObject({ status: 401 });
    expect(mockFindUserRole).not.toHaveBeenCalled();
  });

  it("throws unauthorized when session.user has no id", async () => {
    const middleware = service.requirePermission(PERM);
    const c = makeContext({ user: {} } as never);
    await expect(middleware(c as never, mockNext)).rejects.toMatchObject({ status: 401 });
    expect(mockFindUserRole).not.toHaveBeenCalled();
  });

  it("throws forbidden when user has no role", async () => {
    mockFindUserRole.mockResolvedValue(null);
    const middleware = service.requirePermission(PERM);
    const c = makeContext({ user: { id: "u1" } });
    await expect(middleware(c as never, mockNext)).rejects.toMatchObject({ status: 403 });
  });

  it("throws forbidden when role lacks the permission", async () => {
    mockFindUserRole.mockResolvedValue({ roleId: "r1", systemSlug: null });
    mockCheckRolePermission.mockResolvedValue(false);
    const middleware = service.requirePermission(PERM);
    const c = makeContext({ user: { id: "u1" } });
    await expect(middleware(c as never, mockNext)).rejects.toMatchObject({ status: 403 });
  });

  it("calls next when role has the permission", async () => {
    mockFindUserRole.mockResolvedValue({ roleId: "r1", systemSlug: null });
    mockCheckRolePermission.mockResolvedValue(true);
    const middleware = service.requirePermission(PERM);
    const c = makeContext({ user: { id: "u1" } });
    await middleware(c as never, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });
});

describe("AuthService.listUsersHavingPermission / usersHavingPermission", () => {
  it("delegates listUsersHavingPermission to repo", async () => {
    mockListUsers.mockResolvedValue(["u1", "u2"]);
    expect(await service.listUsersHavingPermission(PERM)).toEqual(["u1", "u2"]);
    expect(mockListUsers).toHaveBeenCalledWith(PERM);
  });

  it("delegates usersHavingPermission to repo", async () => {
    mockFilterUsers.mockResolvedValue(new Set(["u1"]));
    const result = await service.usersHavingPermission(["u1", "u2"], PERM);
    expect(result).toEqual(new Set(["u1"]));
    expect(mockFilterUsers).toHaveBeenCalledWith(["u1", "u2"], PERM);
  });
});
