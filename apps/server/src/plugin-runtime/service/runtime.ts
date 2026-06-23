import { consola } from "consola";
import { attempt } from "es-toolkit/util";
import type { PersonalKeyFallbackPolicy } from "@nama/shared/plugins";
import { env } from "../../env";
import * as repo from "../repo";
import { resolveAllowedHostsFromSchema, unionHostSets } from "../internal/allowed-hosts";
import { loadPluginPolicy, type PluginAdminPolicy } from "../internal/admin-policy";
import { buildContext } from "../internal/context";
import { getCapability } from "@nama/plugin-sdk";
import { getBuiltin, listBuiltins, validatePluginModule } from "../internal/loader";
import { capabilityRegistry } from "../internal/registry";
import type { CapabilityScope } from "@nama/shared/plugins";
import { isPluginError, PluginError } from "@nama/plugin-sdk";
import type {
  AuthResult,
  CapabilitySpec,
  PluginContext,
  PluginModule,
  PoolSignalingApi,
} from "@nama/plugin-sdk";
import { captureError, capturePerf } from "../../diagnostics/capture";
import { pluginCode, type HostErrorCode } from "@nama/shared/diagnostics";
import {
  requirePluginRow,
  sharedCredentialsService,
  type PluginRow,
} from "../internal/shared-credentials";
import { listReadyUserConnections, markUserConnectionExhausted } from "../internal/user-pool";

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

/**
 * Parses a stored `globalConfig` JSON column defensively. A corrupt value must
 * degrade into a typed `PluginError` via the plugin-error boundary instead of
 * escaping as a raw `SyntaxError` and surfacing as a generic 500.
 */
function parseGlobalConfig(pluginId: string, raw: string | null): unknown {
  // Only an absent column (`null`/`undefined`) is "no config". An empty string
  // must fall through to `JSON.parse` — `JSON.parse("")` throws, so a stray
  // empty value (manual DB edit, migration bug) surfaces as the typed
  // `plugin.input_invalid` rather than being silently swallowed as `null`.
  if (raw == null) return null;
  // `raw` here is non-null and was produced by `setGlobalConfig` via
  // `JSON.stringify`, so it is valid JSON. The ambiguous `JSON.parse("null")
  // → null` case cannot arise: `setGlobalConfig(id, null)` clears the column to
  // SQL NULL (handled above), never persists the literal string `"null"`.
  const [err, parsed] = attempt(() => JSON.parse(raw) as unknown);
  if (err) {
    throw new PluginError(
      "plugin.input_invalid",
      `[${pluginId}] stored globalConfig is not valid JSON`,
    );
  }
  return parsed;
}

/**
 * Central entry point for all plugin lifecycle and invocation.
 * Kept as a single class so the registry, DB, and crypto concerns stay in one place.
 */
export class PluginRuntime {
  // fallow-ignore-next-line complexity
  async bootstrapBuiltins(): Promise<void> {
    const now = Date.now();
    for (const builtin of listBuiltins()) {
      const loaded = await validatePluginModule(builtin.module, builtin.bytes);
      const existing = await repo.findInstalledPlugin(builtin.id);
      const version = builtin.module.manifest.version;
      if (!existing) {
        await repo.insertBuiltin({
          id: builtin.id,
          version,
          checksum: loaded.checksum,
          manifest: loaded.manifestJson,
          now,
        });
      } else if (existing.checksum !== loaded.checksum || existing.version !== version) {
        await repo.updateBuiltin({
          id: builtin.id,
          version,
          checksum: loaded.checksum,
          manifest: loaded.manifestJson,
          now,
        });
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
    await repo.setEnabled(pluginId, enabled);
    capabilityRegistry.setEnabled(pluginId, enabled);
    if (!enabled) {
      mcpLifecycleHooks?.onPluginDisabled(pluginId);
      return;
    }
    const entry = capabilityRegistry.get(pluginId);
    if (entry) mcpLifecycleHooks?.onPluginEnabled(pluginId, entry.module);
  }

  async uninstall(pluginId: string): Promise<void> {
    if (getBuiltin(pluginId)) {
      throw new PluginError("plugin.builtin_uninstall", "built-in plugins cannot be uninstalled");
    }
    await repo.deletePlugin(pluginId);
    capabilityRegistry.unregister(pluginId);
    mcpLifecycleHooks?.onPluginDisabled(pluginId);
  }

  async setGlobalConfig(pluginId: string, config: unknown): Promise<void> {
    const configJson = config !== null && config !== undefined ? JSON.stringify(config) : null;
    await repo.setGlobalConfig(pluginId, configJson);
  }

  async getGlobalConfig(pluginId: string): Promise<unknown> {
    const raw = await repo.getGlobalConfigJson(pluginId);
    return parseGlobalConfig(pluginId, raw);
  }

  async setPersonalKeyFallback(pluginId: string, policy: PersonalKeyFallbackPolicy): Promise<void> {
    await repo.setPersonalKeyFallback(pluginId, policy);
  }

  async getModule(pluginId: string): Promise<PluginModule> {
    const entry = capabilityRegistry.get(pluginId);
    if (!entry) throw new PluginError("plugin.not_found", `plugin ${pluginId} not installed`);
    if (!entry.enabled) throw new PluginError("plugin.disabled", `plugin ${pluginId} is disabled`);
    return entry.module;
  }

  private async getPluginRow(pluginId: string): Promise<PluginRow> {
    return requirePluginRow(pluginId);
  }

  /**
   * Scope-aware entry point with credential rotation. Picks from the relevant
   * pool, retries on `ctx.pool.markExhausted` until success or pool exhaustion.
   * Callers with decrypted credentials already in hand should use `invokeWithCredentials`.
   */
  // fallow-ignore-next-line complexity
  async invoke<T = unknown>(args: InvokeArgs): Promise<T> {
    const { methodSpec, module, fn, row, globalConfig } = await this.loadInvocationSetup(
      args.pluginId,
      args.capability,
      args.version,
      args.method,
    );
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
      let exhaustedReport: { retryAfterSec?: number } | null = null;
      const pool: PoolSignalingApi = {
        markExhausted: (opts) => {
          exhaustedReport = { retryAfterSec: opts?.retryAfterSec };
        },
      };
      const ctx = this.buildPickContext(pick, {
        args,
        plan,
        exhaustedAdminIds,
        adminFallback,
        globalConfig,
        module,
        adminPolicy,
        pool,
      });

      const t0 = Date.now();
      try {
        const result = await fn(ctx, inputParsed.data);
        void capturePerf({
          kind: "plugin",
          pluginId: args.pluginId,
          route: args.method,
          durationMs: Date.now() - t0,
          userId: args.userId,
        });
        return await this.validateOutput<T>(result, methodSpec, args.pluginId, args.userId, {
          capability: args.capability,
          method: args.method,
          version: args.version,
        });
      } catch (err) {
        void capturePerf({
          kind: "plugin",
          pluginId: args.pluginId,
          route: args.method,
          durationMs: Date.now() - t0,
          userId: args.userId,
        });
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
        await this.throwUpstreamError(err, args.pluginId, args.method, args.userId, {
          capability: args.capability,
          method: args.method,
          version: args.version,
        });
      }
    }

    throw new PluginError(
      "plugin.pool_exhausted",
      `all credentials exhausted for ${args.pluginId}:${args.capability}@${args.version}` +
        (nextRetryAfterSec ? ` (retry after ${nextRetryAfterSec}s)` : ""),
    );
  }

  /**
   * Invocation with externally-provided credentials (connection-targeted dispatch,
   * auth/refresh flows). Does not rotate — `ctx.pool.markExhausted` is a no-op.
   * Rotation-aware path is `invoke()`.
   */
  async invokeWithCredentials<T = unknown>(args: InvokeWithCredentialsArgs): Promise<T> {
    const { methodSpec, module, fn, globalConfig } = await this.loadInvocationSetup(
      args.pluginId,
      args.capability,
      args.version,
      args.method,
    );

    const inputParsed = methodSpec.input.safeParse(args.input);
    if (!inputParsed.success) {
      throw new PluginError("plugin.input_invalid", inputParsed.error.message);
    }

    // Union hosts from all three schemas: userConfigSchema (user credentials),
    // sharedCredentialsSchema (admin credential via peekAdminCredential), and
    // globalConfigSchema (e.g. Seerr's admin-set baseUrl) — mirrors buildAuxContext.
    const sharedCredentials = await this.peekAdminCredential(args.pluginId);
    const dynamicAllowedHosts = unionHostSets(
      resolveAllowedHostsFromSchema(
        args.pluginId,
        module.manifest.userConfigSchema,
        args.userConfig,
      ),
      resolveAllowedHostsFromSchema(
        args.pluginId,
        module.manifest.sharedCredentialsSchema,
        sharedCredentials,
      ),
      resolveAllowedHostsFromSchema(
        args.pluginId,
        module.manifest.globalConfigSchema,
        globalConfig,
      ),
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
      sharedCredentials,
      userConfig: args.userConfig,
      globalConfig,
    });

    let result: unknown;
    const t0 = Date.now();
    try {
      result = await fn(ctx, inputParsed.data);
      void capturePerf({
        kind: "plugin",
        pluginId: args.pluginId,
        route: args.method,
        durationMs: Date.now() - t0,
        userId: args.userId,
      });
    } catch (err) {
      void capturePerf({
        kind: "plugin",
        pluginId: args.pluginId,
        route: args.method,
        durationMs: Date.now() - t0,
        userId: args.userId,
      });
      return this.throwUpstreamError(err, args.pluginId, args.method, args.userId, {
        capability: args.capability,
        method: args.method,
        version: args.version,
      });
    }

    return await this.validateOutput<T>(result, methodSpec, args.pluginId, args.userId, {
      capability: args.capability,
      method: args.method,
      version: args.version,
    });
  }

  /** Runs a plugin-declared auth function. No Zod validation — AuthResult is the contract. */
  // fallow-ignore-next-line complexity
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
    // Prior credentials allow re-auth to rehydrate encrypted secrets the plugin keeps
    // out of userConfig (e.g. Jellyfin's password) so the user need not re-enter them.
    // For startAuth, `input` is the submitted userConfig — pass it so `buildAuxContext`
    // can resolve `x-allowed-host` fields (e.g. Jellyfin's externalServerUrl).
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
      // Severity is derived from the code via the registry in
      // @nama/shared/diagnostics (PluginError.code for plugin throws,
      // plugin-namespaced code otherwise).
      // Genuine `plugin.upstream_error` → error; user-input `plugin.input_invalid`
      // → info. No per-callsite gate required.
      await captureError(err, {
        source: "plugin",
        code: isPluginError(err) ? err.code : pluginCode(pluginId, "auth_failed"),
        pluginId,
        userId,
        context: { fnName },
      });
      // Preserve the original code and `params` from a PluginError so callers
      // distinguish e.g. `plugin.bad_credentials` from `plugin.input_invalid`.
      // The cast is safe: PluginError uses HostErrorCode; PluginErrorShape.code
      // is looser only so the duck-type guard works across bundle boundaries.
      const pluginErr = isPluginError(err) ? err : null;
      return {
        status: "error",
        code: (pluginErr?.code as HostErrorCode | undefined) ?? "plugin.upstream_error",
        devMessage: message,
        ...(pluginErr?.params ? { params: pluginErr.params } : {}),
      };
    }
  }

  /**
   * Probe for the "test" button and health cron. Tries `testConnection`, then
   * `notificationDelivery.testDelivery` (notification channels use `auth.kind: "none"` and
   * lack `testConnection`; without this fallback Telegram/Discord/ntfy/inbox falsely pass),
   * then returns `{ ok: true, message: "plugin has no testConnection" }`.
   */
  // fallow-ignore-next-line complexity
  async testConnection(
    pluginId: string,
    userId: string | null,
    credentials: unknown,
    userConfig: unknown,
  ): Promise<{ ok: boolean; message?: string }> {
    const module = await this.getModule(pluginId);
    const notificationProbe = module.capabilities?.notificationDelivery?.testDelivery;
    if (typeof module.testConnection !== "function" && typeof notificationProbe !== "function") {
      return { ok: true, message: "plugin has no testConnection" };
    }
    try {
      // buildAuxContext sits inside the try so a malformed x-allowed-host
      // field (user-input error) returns a friendly `{ ok: false, message }`
      // instead of escaping as an uncaught throw.
      const ctx = await this.buildAuxContext(pluginId, userId, credentials, userConfig);
      if (typeof module.testConnection === "function") {
        return await module.testConnection(ctx);
      }
      // Notification probe contract: the plugin reads `args.channelConfig`,
      // which mirrors the persisted `userConfig`. See
      // `packages/plugin-sdk/src/capabilities/notification-delivery.ts`.
      return (await notificationProbe!(ctx, { channelConfig: userConfig })) as {
        ok: boolean;
        message?: string;
      };
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

  // fallow-ignore-next-line complexity
  private async runSharedCredentialProbe(
    module: PluginModule,
    pluginId: string,
    sharedValue: unknown,
  ): Promise<{ ok: boolean; message?: string }> {
    // Wrap buildAuxContext inside the try: it throws PluginError("plugin.invalid_base_url")
    // for malformed x-allowed-host URLs and the route has no outer try/catch.
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
   * Invokes a handler from `module.mcpTools`. Input/output schema validation
   * is the MCP dispatcher's responsibility; this method only runs the handler.
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
      return this.throwUpstreamError(err, args.pluginId, args.handlerKey, args.userId, {
        mcpTool: args.handlerKey,
      });
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

  private async loadInvocationSetup(
    pluginId: string,
    capability: string,
    version: string,
    method: string,
  ): Promise<{
    methodSpec: { input: CapabilitySpec["input"]; output: CapabilitySpec["output"] };
    module: PluginModule;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    fn: Function;
    row: PluginRow;
    globalConfig: unknown;
  }> {
    const methodSpec = this.requireMethodSpec({ capability, version, method });
    const module = await this.getModule(pluginId);
    const impl = module.capabilities[capability];
    const fn = impl?.[method];
    if (typeof fn !== "function") {
      throw new PluginError(
        "plugin.missing_method",
        `plugin ${pluginId} does not implement ${method}`,
      );
    }
    const row = await this.getPluginRow(pluginId);
    const globalConfig = parseGlobalConfig(pluginId, row.globalConfig);
    return { methodSpec, module, fn, row, globalConfig };
  }

  private async throwUpstreamError(
    err: unknown,
    pluginId: string,
    logLabel: string,
    userId: string | null,
    context: Record<string, string>,
  ): Promise<never> {
    if (isPluginError(err)) throw err;
    const message = err instanceof Error ? err.message : String(err);
    consola.error(`[plugin:${pluginId}] ${logLabel} threw:`, err);
    await captureError(err, {
      severity: "error",
      source: "plugin",
      code: pluginCode(pluginId, "upstream_error"),
      pluginId,
      userId,
      context,
    });
    throw new PluginError("plugin.upstream_error", message);
  }

  private async validateOutput<T>(
    result: unknown,
    methodSpec: { output: CapabilitySpec["output"] },
    pluginId: string,
    userId: string | null,
    context: { capability: string; method: string; version: string },
  ): Promise<T> {
    const outputParsed = methodSpec.output.safeParse(result);
    if (!outputParsed.success) {
      await captureError(outputParsed.error, {
        severity: "warning",
        source: "plugin",
        code: "plugin.output_invalid",
        pluginId,
        userId,
        context,
      });
      throw new PluginError(
        "plugin.output_invalid",
        `plugin ${pluginId} returned invalid output: ${outputParsed.error.message}`,
      );
    }
    return outputParsed.data as T;
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
    const globalConfig = parseGlobalConfig(pluginId, row.globalConfig);
    const sharedCredentials =
      sharedCredentialsOverride !== undefined
        ? sharedCredentialsOverride
        : await this.peekAdminCredential(pluginId);
    // Union all three schemas: auth/job/test paths don't know which values are in play;
    // missing values contribute nothing. globalConfigSchema included so plugins like
    // Seerr (admin-set baseUrl) still have their host in ctx.fetch's allowlist.
    const dynamicAllowedHosts = unionHostSets(
      resolveAllowedHostsFromSchema(pluginId, module.manifest.userConfigSchema, userConfig),
      resolveAllowedHostsFromSchema(
        pluginId,
        module.manifest.sharedCredentialsSchema,
        sharedCredentials,
      ),
      resolveAllowedHostsFromSchema(pluginId, module.manifest.globalConfigSchema, globalConfig),
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
  // fallow-ignore-next-line complexity
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

  /**
   * Builds a PluginContext for one credential pick in the rotation loop. Resolves
   * the co-admin pick for user-scoped calls (e.g. Trakt's admin OAuth client id
   * alongside the user access token) and derives `x-allowed-host` hostnames.
   */
  // fallow-ignore-next-line complexity
  private buildPickContext(
    pick: PickedCredential,
    opts: {
      args: InvokeArgs;
      plan: PickedCredential[];
      exhaustedAdminIds: Set<string>;
      adminFallback: unknown;
      globalConfig: unknown;
      module: PluginModule;
      adminPolicy: PluginAdminPolicy;
      pool: PoolSignalingApi;
    },
  ): ReturnType<typeof buildContext> {
    const {
      args,
      plan,
      exhaustedAdminIds,
      adminFallback,
      globalConfig,
      module,
      adminPolicy,
      pool,
    } = opts;
    // For user picks, inject an admin credential as sharedCredentials (e.g. Trakt's OAuth client id).
    // Prefer a non-exhausted admin pick; fall back to any admin pick when all are exhausted because
    // the admin credential (OAuth client id) is not rate-limited — only the user access token was.
    const adminPick =
      pick.side === "admin"
        ? pick
        : (plan.find((p) => p.side === "admin" && !exhaustedAdminIds.has(p.entryId)) ??
          plan.find((p) => p.side === "admin"));
    // Resolve x-allowed-host hosts for the current pick: user picks → userConfigSchema,
    // admin picks → sharedCredentialsSchema; always union globalConfigSchema (e.g.
    // Seerr's admin-set baseUrl) so it reaches ctx.fetch regardless of pick side.
    const dynamicAllowedHosts = unionHostSets(
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
          ),
      resolveAllowedHostsFromSchema(
        args.pluginId,
        module.manifest.globalConfigSchema,
        globalConfig,
      ),
    );
    return buildContext({
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
      pool,
    });
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
