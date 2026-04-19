import { eq } from "drizzle-orm";
import { consola } from "consola";
import { getDb } from "../db/client";
import { plugins } from "../db/schema/plugins";
import { encryptJson, decryptJson } from "../crypto/helpers";
import { buildContext } from "./context";
import { getCapability } from "./capabilities";
import { getBuiltin, listBuiltins, validatePluginModule } from "./loader";
import { capabilityRegistry } from "./registry";
import { isPluginError, PluginError } from "./types";
import type { AuthResult, CapabilitySpec, PluginContext, PluginModule } from "./types";
import { captureError } from "../errors/capture";
import { pluginCode } from "../errors/codes";

export interface InvokeArgs {
  pluginId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  userId: string | null;
  credentials?: unknown;
  userConfig?: unknown;
}

export interface PluginRowLite {
  id: string;
  version: string;
  enabled: number;
  globalConfig: string | null;
  globalConfigIv: string | null;
}

/**
 * Central entry point for all plugin lifecycle and invocation.
 * Kept as a single class so the registry, DB, and crypto concerns stay in one place.
 */
export class PluginRuntime {
  async bootstrapBuiltins(): Promise<void> {
    const db = getDb();
    const now = Date.now();
    for (const builtin of listBuiltins()) {
      const loaded = await validatePluginModule(builtin.module, builtin.bytes);
      const existing = await db.select().from(plugins).where(eq(plugins.id, builtin.id)).get();
      if (!existing) {
        await db.insert(plugins).values({
          id: builtin.id,
          version: builtin.module.manifest.version,
          sourceUrl: `builtin:${builtin.id}`,
          sourceType: "builtin",
          checksum: loaded.checksum,
          manifest: loaded.manifestJson,
          enabled: 1,
          installedAt: now,
          updatedAt: now,
        });
      } else if (
        existing.checksum !== loaded.checksum ||
        existing.version !== builtin.module.manifest.version
      ) {
        await db
          .update(plugins)
          .set({
            version: builtin.module.manifest.version,
            checksum: loaded.checksum,
            manifest: loaded.manifestJson,
            updatedAt: now,
          })
          .where(eq(plugins.id, builtin.id));
      }
      capabilityRegistry.register({
        pluginId: builtin.id,
        module: builtin.module,
        enabled: (existing?.enabled ?? 1) === 1,
      });
    }
    consola.info(`Plugin runtime loaded ${listBuiltins().length} built-in plugins`);
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const db = getDb();
    await db
      .update(plugins)
      .set({ enabled: enabled ? 1 : 0, updatedAt: Date.now() })
      .where(eq(plugins.id, pluginId));
    capabilityRegistry.setEnabled(pluginId, enabled);
  }

  async uninstall(pluginId: string): Promise<void> {
    const db = getDb();
    if (getBuiltin(pluginId)) {
      throw new PluginError("plugin.builtin_uninstall", "built-in plugins cannot be uninstalled");
    }
    await db.delete(plugins).where(eq(plugins.id, pluginId));
    capabilityRegistry.unregister(pluginId);
  }

  async setGlobalConfig(pluginId: string, config: unknown): Promise<void> {
    const db = getDb();
    if (config === null || config === undefined) {
      await db
        .update(plugins)
        .set({ globalConfig: null, globalConfigIv: null, updatedAt: Date.now() })
        .where(eq(plugins.id, pluginId));
      return;
    }
    const { iv, data } = await encryptJson(config);
    await db
      .update(plugins)
      .set({ globalConfig: data, globalConfigIv: iv, updatedAt: Date.now() })
      .where(eq(plugins.id, pluginId));
  }

  async getGlobalConfig(pluginId: string): Promise<unknown> {
    const db = getDb();
    const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
    if (!row) return null;
    return decryptJson(row.globalConfigIv, row.globalConfig);
  }

  async setSharedCredentials(pluginId: string, credentials: unknown): Promise<void> {
    const db = getDb();
    if (credentials === null || credentials === undefined) {
      await db
        .update(plugins)
        .set({ sharedCredentials: null, sharedCredentialsIv: null, updatedAt: Date.now() })
        .where(eq(plugins.id, pluginId));
      return;
    }
    const { iv, data } = await encryptJson(credentials);
    await db
      .update(plugins)
      .set({ sharedCredentials: data, sharedCredentialsIv: iv, updatedAt: Date.now() })
      .where(eq(plugins.id, pluginId));
  }

  async getSharedCredentials(pluginId: string): Promise<unknown> {
    const db = getDb();
    const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
    if (!row) return null;
    return decryptJson(row.sharedCredentialsIv, row.sharedCredentials);
  }

  async getModule(pluginId: string): Promise<PluginModule> {
    const entry = capabilityRegistry.get(pluginId);
    if (!entry) throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
    if (!entry.enabled) throw new PluginError("plugin.disabled", `plugin ${pluginId} is disabled`);
    return entry.module;
  }

  async buildContextForInvocation(
    pluginId: string,
    userId: string | null,
    credentials?: unknown,
    userConfig?: unknown,
  ): Promise<PluginContext> {
    const module = await this.getModule(pluginId);
    const globalConfig = await this.getGlobalConfig(pluginId);
    return buildContext({
      pluginId,
      allowedHosts: module.manifest.allowedHosts,
      userId,
      credentials,
      userConfig,
      globalConfig,
    });
  }

  /**
   * Invokes a capability method on a plugin. Validates input and output against the
   * host-side Zod schemas. Throws PluginError on any failure.
   */
  async invoke<T = unknown>(args: InvokeArgs): Promise<T> {
    const spec = getCapability(args.capability, args.version);
    if (!spec) {
      throw new PluginError(
        "plugin.missing_method",
        `unknown capability ${args.capability}@${args.version}`,
      );
    }
    const methods = spec.methods as unknown as Record<string, CapabilitySpec>;
    const methodSpec = methods[args.method];
    if (!methodSpec) {
      throw new PluginError(
        "plugin.missing_method",
        `${args.capability}@${args.version}.${args.method} does not exist`,
      );
    }

    const module = await this.getModule(args.pluginId);
    const impl = module.capabilities[args.capability];
    const fn = impl?.[args.method];
    if (typeof fn !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `plugin ${args.pluginId} does not implement ${args.method}`,
      );
    }

    const inputParsed = methodSpec.input.safeParse(args.input);
    if (!inputParsed.success) {
      throw new PluginError("plugin.input_invalid", inputParsed.error.message);
    }

    const ctx = await this.buildContextForInvocation(
      args.pluginId,
      args.userId,
      args.credentials,
      args.userConfig,
    );

    let result: unknown;
    try {
      result = await fn(ctx, inputParsed.data);
    } catch (err) {
      if (isPluginError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      consola.error(`[plugin:${args.pluginId}] ${args.method} threw:`, err);
      await captureError(err, {
        severity: "error",
        source: "plugin",
        code: pluginCode(args.pluginId, "upstream_error"),
        pluginId: args.pluginId,
        userId: args.userId,
        context: { capability: args.capability, method: args.method, version: args.version },
      });
      throw new PluginError("plugin.upstream_error", message);
    }

    const outputParsed = methodSpec.output.safeParse(result);
    if (!outputParsed.success) {
      // Plugin returned something that doesn't match its own declared schema. Not fatal
      // to the caller — we still throw — but the mismatch itself is a "warning" because
      // it's a plugin bug surfaced at runtime.
      await captureError(outputParsed.error, {
        severity: "warning",
        source: "plugin",
        code: "plugin.output_invalid",
        pluginId: args.pluginId,
        userId: args.userId,
        context: { capability: args.capability, method: args.method, version: args.version },
      });
      throw new PluginError(
        "plugin.output_invalid",
        `plugin ${args.pluginId} returned invalid output: ${outputParsed.error.message}`,
      );
    }
    return outputParsed.data as T;
  }

  /** Runs a plugin-declared auth function. No Zod validation — AuthResult is the contract. */
  async runAuth(
    pluginId: string,
    fnName: "startAuth" | "pollAuth" | "completeAuth",
    userId: string | null,
    input: unknown,
    state?: unknown,
  ): Promise<AuthResult> {
    const module = await this.getModule(pluginId);
    const fn = module[fnName];
    if (typeof fn !== "function") {
      throw new PluginError(
        "plugin.missing_auth_fn",
        `plugin ${pluginId} does not export ${fnName}`,
      );
    }
    const ctx = await this.buildContextForInvocation(pluginId, userId);
    try {
      if (fnName === "completeAuth") {
        return await (fn as NonNullable<PluginModule["completeAuth"]>)(
          ctx,
          input as Record<string, string>,
          state,
        );
      }
      if (fnName === "pollAuth") {
        return await (fn as NonNullable<PluginModule["pollAuth"]>)(ctx, state);
      }
      return await (fn as NonNullable<PluginModule["startAuth"]>)(ctx, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await captureError(err, {
        severity: "error",
        source: "plugin",
        code: pluginCode(pluginId, "auth_failed"),
        pluginId,
        userId,
        context: { fnName },
      });
      return { status: "error", code: "plugin.upstream_error", devMessage: message };
    }
  }

  /** Runs testConnection for a user's connection; used by the "test" button and health cron. */
  async testConnection(
    pluginId: string,
    userId: string | null,
    credentials: unknown,
    userConfig: unknown,
  ): Promise<{ ok: boolean; message?: string }> {
    const module = await this.getModule(pluginId);
    if (typeof module.testConnection !== "function") {
      return { ok: true, message: "plugin has no testConnection" };
    }
    const ctx = await this.buildContextForInvocation(pluginId, userId, credentials, userConfig);
    try {
      return await module.testConnection(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await captureError(err, {
        severity: "error",
        source: "plugin",
        code: pluginCode(pluginId, "test_failed"),
        pluginId,
        userId,
      });
      return { ok: false, message };
    }
  }

  /** Runs refreshAuth for a plugin, returning new credentials. */
  async refreshAuth(pluginId: string, userId: string, credentials: unknown): Promise<unknown> {
    const module = await this.getModule(pluginId);
    if (typeof module.refreshAuth !== "function") {
      throw new PluginError("plugin.missing_refresh", `plugin ${pluginId} cannot refresh`);
    }
    const ctx = await this.buildContextForInvocation(pluginId, userId, credentials);
    return module.refreshAuth(ctx, credentials);
  }
}

export const pluginRuntime = new PluginRuntime();
