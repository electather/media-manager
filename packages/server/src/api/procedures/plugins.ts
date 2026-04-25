import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  pluginSetEnabledSchema as setEnabledSchema,
  pluginGlobalConfigSchema as setGlobalConfigSchema,
  pluginAddSharedCredentialSchema as addSharedCredentialSchema,
  pluginUpdateSharedCredentialSchema as updateSharedCredentialSchema,
  pluginPersonalKeyFallbackSchema as personalKeyFallbackSchema,
  pluginTestEphemeralSharedCredentialSchema as testEphemeralSharedCredentialSchema,
  pluginAdminAllowlistSchema as adminAllowlistSchema,
  pluginAdminHeadersSchema as adminHeadersSchema,
} from "@ent-mcp/shared/plugins";
import { getDb } from "../../db/client";
import { plugins } from "../../db/schema";
import { requireSession, requirePermission } from "../../auth/middleware";
import { PERMISSIONS } from "../../auth/permissions";
import { pluginRuntime } from "../../plugin-runtime/runtime";
import { getBuiltin } from "../../plugin-runtime/loader";
import { sharedCredentialsService } from "../../plugin-runtime/shared-credentials";
import {
  loadPluginPolicy,
  setAdminAllowlist,
  updateAdminHeaders,
} from "../../plugin-runtime/admin-policy";
import type { ValidatedManifest } from "@ent-mcp/shared/plugins";
import { classifyScopes } from "../../plugin-runtime/manifest";
import { zValidator } from "../../errors/validator";
import { badRequest } from "../../errors/http-errors";
import { PluginError } from "../../plugin-runtime/types";

function parseManifest(raw: string): ValidatedManifest {
  return JSON.parse(raw) as ValidatedManifest;
}

export const pluginsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_PLUGINS))
  .get("/", async (c) => {
    const db = getDb();
    const rows = await db.select().from(plugins).all();
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const manifest = parseManifest(r.manifest);
        const scopes = classifyScopes(manifest);
        // Single `list()` round-trip — derive both total and enabled counts
        // from the same row set instead of issuing two parallel queries.
        const sharedEntries = await sharedCredentialsService.list(r.id);
        const sharedTotal = sharedEntries.length;
        const sharedEnabled = sharedEntries.filter((e) => e.enabled).length;
        const policy = await loadPluginPolicy(r.id);
        return {
          id: r.id,
          version: r.version,
          sourceType: r.sourceType,
          enabled: r.enabled === 1,
          hasGlobalConfig: !!r.globalConfig,
          // Total entries (any enabled state). The previous `countEnabled`
          // semantics moved to `sharedCredentialsEnabledCount` below so the
          // admin meta line can render `enabled/total` without a follow-up
          // query.
          sharedCredentialsCount: sharedTotal,
          sharedCredentialsEnabledCount: sharedEnabled,
          personalKeyFallback: r.personalKeyFallback,
          poolable: manifest.poolable ?? false,
          capabilities: Object.entries(manifest.capabilities).map(([id, cap]) => ({
            id,
            version: cap.version,
            scope: cap.scope,
          })),
          manifest,
          isPureGlobal: scopes.isPureGlobal,
          installedAt: r.installedAt,
          updatedAt: r.updatedAt,
          isBuiltin: !!getBuiltin(r.id),
          advanced: {
            adminAllowlist: policy.adminAllowlist,
            adminHeaderNames: policy.adminHeaders ? Object.keys(policy.adminHeaders).sort() : [],
          },
        };
      }),
    );
    return c.json({ plugins: enriched });
  })
  .patch("/:id/enabled", zValidator("json", setEnabledSchema), async (c) => {
    const id = c.req.param("id");
    const { enabled } = c.req.valid("json");
    await pluginRuntime.setEnabled(id, enabled);
    return c.json({ ok: true });
  })
  .get("/:id/global-config", async (c) => {
    const id = c.req.param("id");
    const config = await pluginRuntime.getGlobalConfig(id);
    return c.json({ config });
  })
  .put("/:id/global-config", zValidator("json", setGlobalConfigSchema), async (c) => {
    const id = c.req.param("id");
    const { config } = c.req.valid("json");
    await pluginRuntime.setGlobalConfig(id, config);
    return c.json({ ok: true });
  })
  .get("/:id/shared-credentials", async (c) => {
    const id = c.req.param("id");
    const entries = await sharedCredentialsService.list(id);
    return c.json({ entries });
  })
  .post("/:id/shared-credentials", zValidator("json", addSharedCredentialSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    try {
      const credentialId = await sharedCredentialsService.add({
        pluginId: id,
        label: body.label,
        value: body.value,
      });
      return c.json({ id: credentialId });
    } catch (err) {
      throw toHttpError(err);
    }
  })
  .patch(
    "/:id/shared-credentials/:credId",
    zValidator("json", updateSharedCredentialSchema),
    async (c) => {
      const pluginId = c.req.param("id");
      const credentialId = c.req.param("credId");
      const body = c.req.valid("json");
      try {
        await sharedCredentialsService.update({
          pluginId,
          credentialId,
          label: body.label,
          value: body.value,
          enabled: body.enabled,
        });
        return c.json({ ok: true });
      } catch (err) {
        throw toHttpError(err);
      }
    },
  )
  .delete("/:id/shared-credentials/:credId", async (c) => {
    const pluginId = c.req.param("id");
    const credentialId = c.req.param("credId");
    await sharedCredentialsService.delete({ pluginId, credentialId });
    return c.json({ ok: true });
  })
  .post("/:id/shared-credentials/:credId/test", async (c) => {
    const pluginId = c.req.param("id");
    const credentialId = c.req.param("credId");
    const result = await pluginRuntime.testSharedCredential(pluginId, credentialId);
    return c.json(result);
  })
  .post(
    "/:id/shared-credentials/test-ephemeral",
    zValidator("json", testEphemeralSharedCredentialSchema),
    async (c) => {
      const pluginId = c.req.param("id");
      const { value } = c.req.valid("json");
      try {
        const result = await pluginRuntime.testSharedCredentialEphemeral(pluginId, value);
        return c.json(result);
      } catch (err) {
        throw toHttpError(err);
      }
    },
  )
  .patch("/:id/personal-key-fallback", zValidator("json", personalKeyFallbackSchema), async (c) => {
    const pluginId = c.req.param("id");
    const { policy } = c.req.valid("json");
    const db = getDb();
    const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
    if (!row) throw badRequest("plugin.not_found", `plugin ${pluginId} not installed`);
    const manifest = parseManifest(row.manifest);
    const scopes = classifyScopes(manifest);
    if (scopes.isPureGlobal && policy !== "off") {
      throw badRequest(
        "plugin.scope_invalid",
        "personalKeyFallback only applies to plugins with user-scoped capabilities",
      );
    }
    await pluginRuntime.setPersonalKeyFallback(pluginId, policy);
    return c.json({ ok: true });
  })
  .put("/:id/admin-allowlist", zValidator("json", adminAllowlistSchema), async (c) => {
    const pluginId = c.req.param("id");
    const { allowlist } = c.req.valid("json");
    try {
      await setAdminAllowlist(pluginId, allowlist);
      return c.json({ ok: true });
    } catch (err) {
      throw toHttpError(err);
    }
  })
  .put("/:id/admin-headers", zValidator("json", adminHeadersSchema), async (c) => {
    const pluginId = c.req.param("id");
    const { headers } = c.req.valid("json");
    try {
      await updateAdminHeaders(pluginId, headers);
      return c.json({ ok: true });
    } catch (err) {
      throw toHttpError(err);
    }
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (getBuiltin(id)) {
      throw badRequest("plugin.builtin_uninstall", "built-in plugins cannot be uninstalled");
    }
    await pluginRuntime.uninstall(id);
    return c.json({ ok: true });
  });

function toHttpError(err: unknown) {
  if (err instanceof PluginError) {
    return badRequest(err.code, err.message, err.params);
  }
  throw err;
}
