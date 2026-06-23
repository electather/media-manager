/** Plugin testing kit — extracted from duplicated `makeCtx` patterns across plugin tests. Authors import from `@nama/plugin-sdk/testing` to avoid re-implementing host-side mocks. */

import type { PluginContext } from "../types";
import type { NotificationEvent } from "@nama/shared/notifications";

export interface FakeCall {
  url: string;
  init?: RequestInit;
}

export type FakeResponse = Response | Error;

export interface MakeTestContextOptions {
  /**
   * Pre-staged fetch responses, returned in order on each `ctx.fetch` call.
   * Throws when more calls are made than responses are queued — surface
   * "unexpected fetch" rather than silent fallthrough.
   */
  responses?: FakeResponse[];
  /** Per-call overrides applied last (e.g. swap `credentials` to a typed bag). */
  overrides?: Partial<PluginContext>;
}

export interface TestContext extends PluginContext {
  /** Each fetch invocation is recorded so tests can assert request URLs and bodies. */
  calls: FakeCall[];
}

export interface TestNotificationContext extends TestContext {
  /** Track emitted notifications for assertion in tests. */
  emittedNotifications: Omit<NotificationEvent, "id" | "occurredAt">[];
}

/** Builds a fully-typed `PluginContext` with in-memory store and queued-response fetch. Defaults: global call, no credentials. Override `credentials` / `sharedCredentials` / `config` per-test. */
export function makeTestContext(opts: MakeTestContextOptions = {}): TestContext {
  const { responses = [], overrides = {} } = opts;
  const calls: FakeCall[] = [];
  const queue = [...responses];
  const storeState = new Map<string, unknown>();

  const ctx: TestContext = {
    calls,
    async fetch(url: string, init?: RequestInit) {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected fetch: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    userId: null,
    credentials: null,
    sharedCredentials: null,
    config: { global: null, user: null },
    // Known limitation: this in-memory store ignores the `scope` option entirely
    // (`{ scope: "user" }` and `{ scope: "global" }` share the same key space).
    // Tests that exercise multi-scope store routing must pass a richer
    // `overrides.store` or build a scoped fake — `makeTestContext` keeps the
    // happy-path simple and lets richer scenarios opt in.
    store: {
      async get(key: string) {
        return storeState.get(key);
      },
      async set(key: string, value: unknown) {
        storeState.set(key, value);
      },
      async delete(key: string) {
        storeState.delete(key);
      },
    },
    pool: { markExhausted() {} },
    appBaseUrl: "https://app.example.com",
    notify: async () => {},
    ...overrides,
  } as TestContext;

  return ctx;
}

/** Builds a JSON `Response` with sensible defaults. Matches the body fetch helpers expect. */
export function jsonRes(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Builds a `Response` with status code and optional body. Enforces HTTP spec: 204/205/304 always send null body even if caller passes one. For testing non-2xx error paths. */
export function statusRes(status: number, body: string = "", init?: ResponseInit): Response {
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : body, { status, ...init });
}

/**
 * Builds a paginated JSON response with the standard Trakt-style pagination
 * headers (`x-pagination-page`, `x-pagination-page-count`, `x-pagination-item-count`).
 * Used by plugins whose APIs return paged collections.
 */
export function paginatedPage(
  body: unknown,
  page: number,
  pageCount: number,
  itemCount?: number,
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-pagination-page": String(page),
      "x-pagination-page-count": String(pageCount),
      "x-pagination-item-count": String(itemCount ?? 0),
    },
  });
}

/**
 * Builds a `PluginContext` with notification tracking for tests. Captures
 * all emitted notifications in `emittedNotifications` for assertion.
 * Inherits all other testing helpers from `makeTestContext`.
 */
export function createTestNotificationContext(
  opts: MakeTestContextOptions = {},
): TestNotificationContext {
  const emittedNotifications: Omit<NotificationEvent, "id" | "occurredAt">[] = [];

  const base = makeTestContext({
    ...opts,
    overrides: {
      ...opts.overrides,
      notify:
        opts.overrides?.notify ||
        (async (event) => {
          emittedNotifications.push(event);
        }),
    },
  });

  const ctx: TestNotificationContext = {
    ...base,
    emittedNotifications,
  };
  return ctx;
}
