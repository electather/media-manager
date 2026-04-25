import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import JSZip from "jszip";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../../__tests__/helpers/in-memory-db";
import { buildUserExport, EXPORT_SCHEMA_VERSION } from "../export";
import { user } from "../../../../db/schema/auth";
import { feedback } from "../../../../db/schema/feedback";
import { roles, userRoles } from "../../../../db/schema/roles";

const USER = "u-export";

let db: Db;

beforeEach(async () => {
  db = await createInMemoryDb();
  await db.insert(user).values({ id: USER, name: "Exportee", email: "exp@example.com" });
});

afterAll(() => cleanupInMemoryDbs());

describe("buildUserExport", () => {
  it("packs the expected files including a versioned README", async () => {
    const { zipBytes, filename } = await buildUserExport(db, USER);
    const zip = await JSZip.loadAsync(zipBytes);

    expect(filename).toMatch(/^ent-mcp-export-u-export-\d{8}\.zip$/);

    const expected = [
      "identity.json",
      "role.json",
      "sessions.json",
      "oauth-apps.json",
      "connections.json",
      "primary-connections.json",
      "taste/preference-profiles.json",
      "taste/feedback.json",
      "jobs.json",
      "README.txt",
    ];
    for (const path of expected) {
      expect(zip.file(path), `missing ${path}`).toBeTruthy();
    }

    const readme = await zip.file("README.txt")!.async("string");
    expect(readme).toContain(`schema-version: ${EXPORT_SCHEMA_VERSION}`);
  });

  it("contains the user's identity row but never any credential field", async () => {
    await seedRoleAssignment(db, USER, "viewer", "Read-only access");
    await db.insert(feedback).values({
      id: "fb-1",
      userId: USER,
      tmdbId: "movie-1",
      mediaType: "movie",
      action: "like",
      createdAt: 1,
    });

    const { zipBytes } = await buildUserExport(db, USER);
    const zip = await JSZip.loadAsync(zipBytes);

    const identity = JSON.parse(await zip.file("identity.json")!.async("string"));
    expect(identity.id).toBe(USER);
    expect(identity.email).toBe("exp@example.com");

    const role = JSON.parse(await zip.file("role.json")!.async("string"));
    expect(role).toEqual({ name: "viewer", description: "Read-only access" });

    const feedbackOut = JSON.parse(await zip.file("taste/feedback.json")!.async("string"));
    expect(feedbackOut).toHaveLength(1);
    expect(feedbackOut[0].userId).toBe(USER);

    // Cross-cut assertion: scan every JSON file for credential-shaped keys.
    const jsonPaths = expected().filter((p) => p.endsWith(".json"));
    for (const path of jsonPaths) {
      const text = await zip.file(path)!.async("string");
      expect(text, `${path} contains a credential field`).not.toMatch(
        /encryptedCredentials|credentialsIv|password|access_?token|refresh_?token|client_?secret/i,
      );
    }
  });

  it("returns role: null when the user has no role assignment", async () => {
    const { zipBytes } = await buildUserExport(db, USER);
    const zip = await JSZip.loadAsync(zipBytes);

    const role = JSON.parse(await zip.file("role.json")!.async("string"));
    expect(role).toBeNull();
  });
});

function expected(): string[] {
  return [
    "identity.json",
    "role.json",
    "sessions.json",
    "oauth-apps.json",
    "connections.json",
    "primary-connections.json",
    "taste/preference-profiles.json",
    "taste/feedback.json",
    "jobs.json",
  ];
}

async function seedRoleAssignment(
  db: Db,
  userId: string,
  roleName: string,
  description: string,
): Promise<void> {
  await db.insert(roles).values({
    id: `role-${roleName}`,
    name: roleName,
    description,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(userRoles).values({ userId, roleId: `role-${roleName}`, assignedAt: 0 });
}
