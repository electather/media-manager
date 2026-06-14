import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { UserRoleInfo } from "../../../auth";

vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

// Hoisted so the `db/client` mock factory (which Vitest hoists above the module
// body) can read the current DB without hitting the temporal dead zone. The
// transitive import of the auth config calls `getDb()` at module-init time —
// before any test runs — so the holder must already be readable then.
const holder = vi.hoisted(() => ({ db: undefined as Db | undefined }));

vi.mock("../../../db/client", () => ({
  getDb: () => holder.db,
}));

// `buildOnboardingContext` reads the TMDB count from the shared-credentials
// service; we control it so the completion gate can be exercised both ways
// without a real plugin install. Everything else from the barrel is preserved.
let tmdbEnabledCount = 0;
vi.mock("../../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../../plugin-runtime")>("../../../plugin-runtime");
  return {
    ...actual,
    sharedCredentialsService: {
      ...actual.sharedCredentialsService,
      countEnabled: async () => tmdbEnabledCount,
    },
  };
});

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";
import { roles, userRoles } from "../../../db/schema/auth/roles";
import { isUserOnboarded } from "../../../auth";
import {
  buildOnboardingContext,
  requiredStepsSatisfied,
  resolveOnboardingSteps,
} from "../onboarding";

const ADMIN_ROLE: UserRoleInfo = { roleId: "role_admin", isSystemAdmin: true };
const MEMBER_ROLE: UserRoleInfo = { roleId: "role_member", isSystemAdmin: false };

// A plain local handle for the test bodies. It is assigned from the hoisted
// holder in `beforeEach`; only the mock closure reads the holder directly to
// avoid the import-time temporal-dead-zone problem above.
let db: Db;

beforeEach(async () => {
  holder.db = await createInMemoryDb();
  db = holder.db;
  tmdbEnabledCount = 0;
});

afterAll(() => cleanupInMemoryDbs());

describe("resolveOnboardingSteps", () => {
  // For an admin both steps apply. `welcome` is informational (not required,
  // always complete); `connect-services` is required and its completion tracks
  // whether TMDB is configured — the "app is functional" guarantee.
  it("resolves both admin steps with TMDB-driven completion when admin and TMDB unconfigured", () => {
    const steps = resolveOnboardingSteps({ role: ADMIN_ROLE, tmdbConfigured: false });

    const welcome = steps.find((s) => s.id === "welcome");
    expect(welcome).toMatchObject({ applies: true, required: false, complete: true });

    const connect = steps.find((s) => s.id === "connect-services");
    expect(connect).toMatchObject({ applies: true, required: true, complete: false });
  });

  // Completion of the required step must follow `tmdbConfigured` exactly — this
  // is the server-side source of truth the client renders.
  it("marks connect-services complete only when TMDB is configured", () => {
    const steps = resolveOnboardingSteps({ role: ADMIN_ROLE, tmdbConfigured: true });
    const connect = steps.find((s) => s.id === "connect-services");
    expect(connect?.complete).toBe(true);
  });

  // The role-aware reuse contract: a non-admin role sees neither step as
  // applicable. This locks in the framework's role filtering before any
  // member-facing onboarding step exists, so adding one later is purely
  // additive and never accidentally exposes the admin steps.
  it("omits both steps (applies:false) for a member-role context", () => {
    const steps = resolveOnboardingSteps({ role: MEMBER_ROLE, tmdbConfigured: true });
    expect(steps.every((s) => s.applies === false)).toBe(true);
  });

  // A user with no role at all must also see no applicable steps.
  it("omits both steps for a null role", () => {
    const steps = resolveOnboardingSteps({ role: null, tmdbConfigured: true });
    expect(steps.every((s) => s.applies === false)).toBe(true);
  });
});

describe("requiredStepsSatisfied", () => {
  // The gate must be satisfied only when every applicable, required step is
  // complete. With TMDB unconfigured the required connect-services step is
  // incomplete, so the gate is closed.
  it("is false while an applies && required step is incomplete", () => {
    const steps = resolveOnboardingSteps({ role: ADMIN_ROLE, tmdbConfigured: false });
    expect(requiredStepsSatisfied(steps)).toBe(false);
  });

  it("is true once every applies && required step is complete", () => {
    const steps = resolveOnboardingSteps({ role: ADMIN_ROLE, tmdbConfigured: true });
    expect(requiredStepsSatisfied(steps)).toBe(true);
  });

  // Steps that do not apply (e.g. for a member) must never hold the gate open
  // or shut — the gate only considers applicable required steps.
  it("ignores steps that do not apply", () => {
    const steps = resolveOnboardingSteps({ role: MEMBER_ROLE, tmdbConfigured: false });
    expect(requiredStepsSatisfied(steps)).toBe(true);
  });
});

describe("buildOnboardingContext", () => {
  // The context builder must read the role from the DB and the TMDB state from
  // the shared-credentials count, so the resolved steps reflect reality.
  it("builds an admin context whose required step is incomplete when TMDB has zero enabled credentials", async () => {
    await db.insert(user).values({ id: "u_admin", name: "Admin", email: "admin@example.com" });
    await db.insert(roles).values({
      id: "role_admin",
      name: "Admin",
      isSystem: 1,
      systemSlug: "admin",
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(userRoles).values({ userId: "u_admin", roleId: "role_admin", assignedAt: 0 });
    tmdbEnabledCount = 0;

    const ctx = await buildOnboardingContext("u_admin");
    expect(ctx.role?.isSystemAdmin).toBe(true);
    expect(ctx.tmdbConfigured).toBe(false);
    expect(requiredStepsSatisfied(resolveOnboardingSteps(ctx))).toBe(false);
  });

  it("reports tmdbConfigured true once at least one TMDB credential is enabled", async () => {
    await db.insert(user).values({ id: "u_admin", name: "Admin", email: "admin@example.com" });
    await db.insert(roles).values({
      id: "role_admin",
      name: "Admin",
      isSystem: 1,
      systemSlug: "admin",
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(userRoles).values({ userId: "u_admin", roleId: "role_admin", assignedAt: 0 });
    tmdbEnabledCount = 1;

    const ctx = await buildOnboardingContext("u_admin");
    expect(ctx.tmdbConfigured).toBe(true);
    expect(requiredStepsSatisfied(resolveOnboardingSteps(ctx))).toBe(true);
  });
});

// The flip is server-authoritative: hasOnboarded must only become true when the
// required steps are satisfied. This mirrors what `POST /complete` enforces —
// re-derive the context, gate, then flip — so the "app is functional" guarantee
// is enforced on the server, never trusted from the client.
describe("markUserOnboarded flip path", () => {
  async function seedAdmin(): Promise<void> {
    await db.insert(user).values({ id: "u_admin", name: "Admin", email: "admin@example.com" });
    await db.insert(roles).values({
      id: "role_admin",
      name: "Admin",
      isSystem: 1,
      systemSlug: "admin",
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(userRoles).values({ userId: "u_admin", roleId: "role_admin", assignedAt: 0 });
  }

  it("does not flip hasOnboarded when TMDB is unconfigured (requirements_unmet)", async () => {
    await seedAdmin();
    tmdbEnabledCount = 0;

    const ctx = await buildOnboardingContext("u_admin");
    const satisfied = requiredStepsSatisfied(resolveOnboardingSteps(ctx));
    expect(satisfied).toBe(false);

    // The handler throws before flipping when requirements are unmet; the flag
    // stays false.
    expect(await isUserOnboarded("u_admin")).toBe(false);
  });

  it("flips hasOnboarded once TMDB is configured", async () => {
    const { markUserOnboarded } = await import("../../../auth");
    await seedAdmin();
    tmdbEnabledCount = 1;

    const ctx = await buildOnboardingContext("u_admin");
    expect(requiredStepsSatisfied(resolveOnboardingSteps(ctx))).toBe(true);

    expect(await isUserOnboarded("u_admin")).toBe(false);
    await markUserOnboarded("u_admin");
    expect(await isUserOnboarded("u_admin")).toBe(true);
  });
});
