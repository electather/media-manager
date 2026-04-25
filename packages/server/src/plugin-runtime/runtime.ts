import { eq } from "drizzle-orm";
import { consola } from "consola";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";
import { getDb } from "../db/client";
import { env } from "../env";
import { plugins } from "../db/schema/plugins";
import { resolveAllowedHostsFromSchema, unionHostSets } from "./allowed-hosts";
import { loadPluginPolicy } from "./admin-policy";
import { buildContext } from "./context";
import { getCapability } from "./capabilities";
import { getBuiltin, listBuiltins, validatePluginModule } from "./loader";
import { capabilityRegistry } from "./registry";
import type { CapabilityScope } from "@ent-mcp/shared/plugins";
import { isPluginError, PluginError } from "./types";
import type {
  AuthResult,
  CapabilitySpec,
  PluginContext,
  PluginModule,
  PoolSignalingApi,
} from "./types";
import { captureError } from "../errors/capture";
import { pluginCode, type HostErrorCode } from "../errors/codes";
import { sharedCredentialsService } from "./shared-credentials";
import { listReadyUserConnections, markUserConnectionExhausted } from "./user-pool";

/**
 * Injected at bootstrap time so `plugin-runtime` does not import the MCP
 * package directly (the MCP bootstrap calls `callExtension` which imports
 * `pluginRuntime`, creating an import cycle).
 */
interface McpLifecycleHooks {
  onPluginEnabled(pluginId: string, module: PluginModule): void;
  onPluginDisabled(pluginId: string): void;
}

let mcpLifecycleHooks: McpLifecycleHooks | null = null;

export function setMcpLifecycleHooks(hooks: McpLifecycleHooks): void {
  mcpLifecycleHooks = hooks;
}

export interface InvokeArgs {
  pluginId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  scope: CapabilityScope;
  userId: string | null;
}

export interface InvokeWithCredentialsArgs {
  pluginId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  userId: string | null;
  credentials?: unknown;
  userConfig?: unknown;
}

type CredentialSide = "admin" | "user";

interface PickedCredential {
  side: CredentialSide;
  /** Pool-entry id for admin picks, service_connections.id for user picks. */
  entryId: string;
  value: unknown;
  userConfig: unknown;
}

interface PluginRow {
  id: string;
  version: string;
  enabled: number;
  globalConfig: string | null;
  personalKeyFallback: PersonalKeyFallbackPolicy;
  manifest: string;
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
      const enabled = (existing?.enabled ?? 1) === 1;
      capabilityRegistry.register({
        pluginId: builtin.id,
        module: builtin.module,
        enabled,
      });
      if (enabled) mcpLifecycleHooks?.onPluginEnabled(builtin.id, builtin.module);
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
    if (!enabled) {
      mcpLifecycleHooks?.onPluginDisabled(pluginId);
      return;
    }
    const entry = capabilityRegistry.get(pluginId);
    if (entry) mcpLifecycleHooks?.onPluginEnabled(pluginId, entry.module);
  }

  async uninstall(pluginId: string): Promise<void> {
    const db = getDb();
    if (getBuiltin(pluginId)) {
      throw new PluginError("plugin.builtin_uninstall", "built-in plugins cannot be uninstalled");
    }
    await db.delete(plugins).where(eq(plugins.id, pluginId));
    capabilityRegistry.unregister(pluginId);
    mcpLifecycleHooks?.onPluginDisabled(pluginId);
  }

  async setGlobalConfig(pluginId: string, config: unknown): Promise<void> {
    const db = getDb();
    await db
      .update(plugins)
      .set({
        globalConfig: config !== null && config !== undefined ? JSON.stringify(config) : null,
        updatedAt: Date.now(),
      })
      .where(eq(plugins.id, pluginId));
  }

  async getGlobalConfig(pluginId: string): Promise<unknown> {
    const db = getDb();
    const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
    if (!row || !row.globalConfig) return null;
    return JSON.parse(row.globalConfig);
  }

  async setPersonalKeyFallback(pluginId: string, policy: PersonalKeyFallbackPolicy): Promise<void> {
    const db = getDb();
    await db
      .update(plugins)
      .set({ personalKeyFallback: policy, updatedAt: Date.now() })
      .where(eq(plugins.id, pluginId));
  }

  async getModule(pluginId: string): Promise<PluginModule> {
    const entry = capabilityRegistry.get(pluginId);
    if (!entry) throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
    if (!entry.enabled) throw new PluginError("plugin.disabled", `plugin ${pluginId} is disabled`);
    return entry.module;
  }

  private async getPluginRow(pluginId: string): Promise<PluginRow> {
    const db = getDb();
    const row = await db.select().from(plugins).where(eq(plugins.id, pluginId)).get();
    if (!row) throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
    return row as PluginRow;
  }

  /**
   * Scope-aware entry point. The runtime owns credential resolution: it picks
   * an entry from the relevant pool, injects it into a fresh `PluginContext`,
   * and rotates on `ctx.pool.markExhausted` until the method succeeds or every
   * pool is exhausted.
   *
   * Callers that already hold decrypted credentials (e.g. connection-targeted
   * dispatch) should use `invokeWithCredentials` instead.
   */
  async invoke<T = unknown>(args: InvokeArgs): Promise<T> {
    const methodSpec = this.requireMethodSpec(args);
    const module = await this.getModule(args.pluginId);
    const impl = module.capabilities[args.capability];
    const fn = impl?.[args.method];
    if (typeof fn !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `plugin ${args.pluginId} does not implement ${args.method}`,
      );
    }

    const row = await this.getPluginRow(args.pluginId);
    const globalConfig = row.globalConfig ? JSON.parse(row.globalConfig) : null;
    const adminPolicy = await loadPluginPolicy(args.pluginId);
    const plan = await this.buildCredentialPlan(args, row);
    if (plan.length === 0) {
      throw new PluginError(
        "plugin.capability_unavailable",
        `no usable credentials for ${args.pluginId}:${args.capability}@${args.version} (scope=${args.scope})`,
      );
    }

    // Plugins like Trakt need the admin's OAuth client id alongside the user's
    // access token on every user-scoped call. `ctx.sharedCredentials` must be
    // populated whenever any admin entry exists, independent of rotation or
    // `personalKeyFallback`.
    const adminFallback = plan.some((p) => p.side === "admin")
      ? null
      : await this.peekAdminCredential(args.pluginId);

    const inputParsed = methodSpec.input.safeParse(args.input);
    if (!inputParsed.success) {
      throw new PluginError("plugin.input_invalid", inputParsed.error.message);
    }

    const exhaustedAdminIds = new Set<string>();
    let nextRetryAfterSec: number | undefined;
    for (const pick of plan) {
      // For user picks we need to inject an admin credential as sharedCredentials
      // (e.g. Trakt's OAuth client id). Skip any admin pick already marked
      // exhausted earlier in this loop so we don't hand a rate-limited secret
      // to a subsequent user call.
      const adminPick =
        pick.side === "admin"
          ? pick
          : plan.find((p) => p.side === "admin" && !exhaustedAdminIds.has(p.entryId));
      let exhaustedReport: { retryAfterSec?: number } | null = null;
      const poolApi: PoolSignalingApi = {
        markExhausted: (opts) => {
          exhaustedReport = { retryAfterSec: opts?.retryAfterSec };
        },
      };
      // Resolve per-invocation `x-allowed-host` hostnames from whichever
      // config matches the current pick: user-scoped picks read
      // `userConfigSchema` against the stored `userConfig`; admin-scoped picks
      // read `sharedCredentialsSchema` against the chosen pool entry.
      const dynamicAllowedHosts =
        pick.side === "user"
          ? resolveAllowedHostsFromSchema(
              args.pluginId,
              module.manifest.userConfigSchema,
              pick.userConfig,
            )
          : resolveAllowedHostsFromSchema(
              args.pluginId,
              module.manifest.sharedCredentialsSchema,
              pick.value,
            );
      const ctx = buildContext({
        pluginId: args.pluginId,
        allowedHosts: module.manifest.allowedHosts,
        dynamicAllowedHosts,
        adminAllowlist: adminPolicy.adminAllowlist,
        adminHeaders: adminPolicy.adminHeaders,
        userId: args.userId,
        appBaseUrl: env.APP_EXTERNAL_URL,
        credentials: pick.side === "user" ? pick.value : null,
        sharedCredentials: pick.side === "admin" ? pick.value : (adminPick?.value ?? adminFallback),
        userConfig: pick.userConfig,
        globalConfig,
        pool: poolApi,
      });

      try {
        const result = await fn(ctx, inputParsed.data);
        const outputParsed = methodSpec.output.safeParse(result);
        if (!outputParsed.success) {
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
      } catch (err) {
        const shouldRotate =
          !!exhaustedReport || (isPluginError(err) && err.code === "plugin.rate_limited");
        if (shouldRotate) {
          const retryAfterSec = (exhaustedReport as { retryAfterSec?: number } | null)
            ?.retryAfterSec;
          await this.markPickExhausted(args.pluginId, pick, retryAfterSec);
          if (pick.side === "admin") exhaustedAdminIds.add(pick.entryId);
          nextRetryAfterSec = retryAfterSec;
          continue;
        }
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
    }

    throw new PluginError(
      "plugin.pool_exhausted",
      `all credentials exhausted for ${args.pluginId}:${args.capability}@${args.version}` +
        (nextRetryAfterSec ? ` (retry after ${nextRetryAfterSec}s)` : ""),
    );
  }

  /**
   * Invocation with externally-provided credentials. Used by the dispatcher's
   * connection-targeted path (writes against a specific connection) and by
   * auth/refresh flows where credentials are in flight.
   *
   * This path intentionally does not rotate and installs the inert pool API —
   * the caller has chosen a specific credential, so `ctx.pool.markExhausted`
   * is a no-op here. Plugins still participate in pool bookkeeping through
   * `invoke()`, which is the rotation-aware entry point.
   */
  async invokeWithCredentials<T = unknown>(args: InvokeWithCredentialsArgs): Promise<T> {
    const methodSpec = this.requireMethodSpec(args);
    const module = await this.getModule(args.pluginId);
    const impl = module.capabilities[args.capability];
    const fn = impl?.[args.method];
    if (typeof fn !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `plugin ${args.pluginId} does not implement ${args.method}`,
      );
    }
    const row = await this.getPluginRow(args.pluginId);
    const globalConfig = row.globalConfig ? JSON.parse(row.globalConfig) : null;

    const inputParsed = methodSpec.input.safeParse(args.input);
    if (!inputParsed.success) {
      throw new PluginError("plugin.input_invalid", inputParsed.error.message);
    }

    // Connection-targeted dispatch: credentials are user-scoped, so resolve
    // `x-allowed-host` hosts from the `userConfigSchema`.
    const dynamicAllowedHosts = resolveAllowedHostsFromSchema(
      args.pluginId,
      module.manifest.userConfigSchema,
      args.userConfig,
    );
    const adminPolicy = await loadPluginPolicy(args.pluginId);
    const ctx = buildContext({
      pluginId: args.pluginId,
      allowedHosts: module.manifest.allowedHosts,
      dynamicAllowedHosts,
      adminAllowlist: adminPolicy.adminAllowlist,
      adminHeaders: adminPolicy.adminHeaders,
      userId: args.userId,
      appBaseUrl: env.APP_EXTERNAL_URL,
      credentials: args.credentials,
      sharedCredentials: await this.peekAdminCredential(args.pluginId),
      userConfig: args.userConfig,
      globalConfig,
    });

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
    priorCredentials?: unknown,
  ): Promise<AuthResult> {
    const module = await this.getModule(pluginId);
    const fn = module[fnName];
    if (typeof fn !== "function") {
      throw new PluginError(
        "plugin.missing_auth_fn",
        `plugin ${pluginId} does not export ${fnName}`,
      );
    }
    // Prior credentials are passed through when the caller is re-running
    // startAuth on an existing connection (form re-auth). Plugins that keep
    // user-entered secrets out of userConfig by storing them in the encrypted
    // credentials blob (e.g. Jellyfin's password) need ctx.credentials to
    // rehydrate those secrets without the user re-entering them.
    //
    // For startAuth specifically, `input` is the submitted userConfig. Pass
    // it through so `buildAuxContext` can resolve `x-allowed-host` fields
    // against it and ctx.fetch can reach the user-supplied upstream (e.g.
    // Jellyfin's externalServerUrl) during the initial auth round-trip.
    const authUserConfig = fnName === "startAuth" ? input : undefined;
    try {
      // `buildAuxContext` itself throws a PluginError when `x-allowed-host`
      // resolution fails on user-supplied values (e.g. "asd" is not a valid
      // URL). Running it inside the same try as the plugin function keeps the
      // error funneled through the AuthResult boundary so `params.field`
      // reaches the frontend instead of escaping as a generic 500.
      const ctx = await this.buildAuxContext(pluginId, userId, priorCredentials, authUserConfig);
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
      // Severity is derived from the code via the registry in ./errors/codes
      // (PluginError.code for plugin throws, plugin-namespaced code otherwise).
      // Genuine `plugin.upstream_error` → error; user-input `plugin.input_invalid`
      // → info. No per-callsite gate required.
      await captureError(err, {
        source: "plugin",
        code: isPluginError(err) ? err.code : pluginCode(pluginId, "auth_failed"),
        pluginId,
        userId,
        context: { fnName },
      });
      // Preserve both the original code and any `params` carried by a
      // PluginError so downstream callers (including the frontend) can
      // distinguish e.g. `plugin.bad_credentials` from `plugin.input_invalid`
      // without grubbing through params.field. Non-PluginError throws surface
      // as the generic `plugin.upstream_error` with no params. The cast is
      // safe because `PluginError` is constructed with a `HostErrorCode` —
      // `PluginErrorShape.code: string` is intentionally looser only so the
      // duck-type guard works for plugins loaded from a separate bundle.
      const pluginErr = isPluginError(err) ? err : null;
      return {
        status: "error",
        code: (pluginErr?.code as HostErrorCode | undefined) ?? "plugin.upstream_error",
        devMessage: message,
        ...(pluginErr?.params ? { params: pluginErr.params } : {}),
      };
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
    try {
      // buildAuxContext sits inside the try so a malformed x-allowed-host
      // field (user-input error) returns a friendly `{ ok: false, message }`
      // instead of escaping as an uncaught throw.
      const ctx = await this.buildAuxContext(pluginId, userId, credentials, userConfig);
      return await module.testConnection(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await captureError(err, {
        source: "plugin",
        code: isPluginError(err) ? err.code : pluginCode(pluginId, "test_failed"),
        pluginId,
        userId,
      });
      return { ok: false, message };
    }
  }

  /**
   * Verifies a specific shared-credentials pool entry. Uses `verifyShared` for
   * pure-global plugins (auth.kind === "none"); otherwise falls back to
   * `testConnection` with the picked entry injected as the sole credential.
   */
  async testSharedCredential(
    pluginId: string,
    credentialId: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const module = await this.getModule(pluginId);
    const pick = await sharedCredentialsService.getDecrypted({ pluginId, credentialId });
    return this.runSharedCredentialProbe(module, pluginId, pick.value);
  }

  /**
   * Verifies an unsaved candidate shared credential. Mirrors `testSharedCredential`
   * but takes the raw value directly instead of fetching by id, so the admin
   * dialog's `Test & save` can run before the row is persisted.
   */
  async testSharedCredentialEphemeral(
    pluginId: string,
    value: unknown,
  ): Promise<{ ok: boolean; message?: string }> {
    const module = await this.getModule(pluginId);
    return this.runSharedCredentialProbe(module, pluginId, value);
  }

  private async runSharedCredentialProbe(
    module: PluginModule,
    pluginId: string,
    sharedValue: unknown,
  ): Promise<{ ok: boolean; message?: string }> {
    // `buildAuxContext` resolves `x-allowed-host` fields on the shared
    // credential and throws `PluginError("plugin.invalid_base_url")` for
    // malformed URLs. Wrap it inside the try so that escapes as a friendly
    // `{ ok: false, message }` instead of bubbling to Hono as a 500 — same
    // pattern as `testConnection`. The `/shared-credentials/:credId/test`
    // route has no outer try/catch, so this is the only safety net.
    try {
      const ctx = await this.buildAuxContext(pluginId, null, null, null, sharedValue);
      const probe = module.verifyShared ?? module.testConnection;
      if (typeof probe !== "function") {
        return { ok: true, message: "plugin has no testConnection/verifyShared" };
      }
      return await probe(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  /**
   * Invokes a plugin-declared MCP tool. Looks up the handler on
   * `module.mcpTools`, builds a PluginContext with the caller's credentials,
   * and surfaces errors via `PluginError`. Input/output schema validation is
   * the MCP dispatcher's responsibility; this method only runs the handler.
   */
  async invokeMcpTool<T = unknown>(args: {
    pluginId: string;
    handlerKey: string;
    input: unknown;
    userId: string | null;
    credentials?: unknown;
    userConfig?: unknown;
  }): Promise<T> {
    const module = await this.getModule(args.pluginId);
    const fn = module.mcpTools?.[args.handlerKey];
    if (typeof fn !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `plugin ${args.pluginId} does not export mcp tool ${args.handlerKey}`,
      );
    }
    const ctx = await this.buildAuxContext(
      args.pluginId,
      args.userId,
      args.credentials,
      args.userConfig,
    );
    try {
      return (await fn(ctx, args.input)) as T;
    } catch (err) {
      if (isPluginError(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      await captureError(err, {
        severity: "error",
        source: "plugin",
        code: pluginCode(args.pluginId, "upstream_error"),
        pluginId: args.pluginId,
        userId: args.userId,
        context: { mcpTool: args.handlerKey },
      });
      throw new PluginError("plugin.upstream_error", message);
    }
  }

  /**
   * Builds a PluginContext for a job handler. Jobs run on the host's schedule,
   * not inside a capability invocation, so there is no pool signalling — the
   * returned context uses the inert pool stub.
   */
  async buildJobContext(
    pluginId: string,
    userId: string | null,
    credentials: unknown = null,
    userConfig: unknown = null,
  ): Promise<PluginContext> {
    return this.buildAuxContext(pluginId, userId, credentials, userConfig);
  }

  /** Runs refreshAuth for a plugin, returning new credentials. */
  async refreshAuth(pluginId: string, userId: string, credentials: unknown): Promise<unknown> {
    const module = await this.getModule(pluginId);
    if (typeof module.refreshAuth !== "function") {
      throw new PluginError("plugin.missing_refresh", `plugin ${pluginId} cannot refresh`);
    }
    const ctx = await this.buildAuxContext(pluginId, userId, credentials);
    return module.refreshAuth(ctx, credentials);
  }

  private async buildAuxContext(
    pluginId: string,
    userId: string | null,
    credentials?: unknown,
    userConfig?: unknown,
    sharedCredentialsOverride?: unknown,
  ): Promise<PluginContext> {
    const module = await this.getModule(pluginId);
    const row = await this.getPluginRow(pluginId);
    const globalConfig = row.globalConfig ? JSON.parse(row.globalConfig) : null;
    const sharedCredentials =
      sharedCredentialsOverride !== undefined
        ? sharedCredentialsOverride
        : await this.peekAdminCredential(pluginId);
    // Aux contexts (auth, job handlers, testConnection, refresh) don't know
    // ahead of time whether the user config or shared credentials are in
    // play, so union hosts from both schemas against whichever values are
    // present. Missing values simply contribute nothing.
    const dynamicAllowedHosts = unionHostSets(
      resolveAllowedHostsFromSchema(pluginId, module.manifest.userConfigSchema, userConfig),
      resolveAllowedHostsFromSchema(
        pluginId,
        module.manifest.sharedCredentialsSchema,
        sharedCredentials,
      ),
    );
    const adminPolicy = await loadPluginPolicy(pluginId);
    return buildContext({
      pluginId,
      allowedHosts: module.manifest.allowedHosts,
      dynamicAllowedHosts,
      adminAllowlist: adminPolicy.adminAllowlist,
      adminHeaders: adminPolicy.adminHeaders,
      userId,
      appBaseUrl: env.APP_EXTERNAL_URL,
      credentials,
      sharedCredentials,
      userConfig,
      globalConfig,
    });
  }

  private async peekAdminCredential(pluginId: string): Promise<unknown> {
    const picks = await sharedCredentialsService.listDecryptedActive(pluginId);
    return picks[0]?.value ?? null;
  }

  private requireMethodSpec(args: { capability: string; version: string; method: string }): {
    input: CapabilitySpec["input"];
    output: CapabilitySpec["output"];
  } {
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
    return methodSpec;
  }

  /**
   * Produces an ordered list of credential candidates for the call, implementing
   * the scope + `personalKeyFallback` policy described in the design doc. Each
   * entry is tried in order until one succeeds or every entry is exhausted.
   */
  private async buildCredentialPlan(args: InvokeArgs, row: PluginRow): Promise<PickedCredential[]> {
    const adminPicks = await sharedCredentialsService.listDecryptedActive(args.pluginId);
    const userPicks = args.userId ? await listReadyUserConnections(args.userId, args.pluginId) : [];

    const adminOrdered: PickedCredential[] = adminPicks.map((p) => ({
      side: "admin",
      entryId: p.id,
      value: p.value,
      userConfig: null,
    }));
    const userOrdered: PickedCredential[] = userPicks.map((p) => ({
      side: "user",
      entryId: p.connectionId,
      value: p.credentials,
      userConfig: p.userConfig,
    }));

    if (args.scope === "global") return adminOrdered;

    switch (row.personalKeyFallback) {
      case "admin-first":
        return [...adminOrdered, ...userOrdered];
      case "personal-first":
        return [...userOrdered, ...adminOrdered];
      default:
        return userOrdered;
    }
  }

  private async markPickExhausted(
    pluginId: string,
    pick: PickedCredential,
    retryAfterSec: number | undefined,
  ): Promise<void> {
    if (pick.side === "admin") {
      await sharedCredentialsService.markExhausted({
        pluginId,
        credentialId: pick.entryId,
        retryAfterSec,
      });
      return;
    }
    await markUserConnectionExhausted(pick.entryId, retryAfterSec ?? 60);
  }
}

export const pluginRuntime = new PluginRuntime();
