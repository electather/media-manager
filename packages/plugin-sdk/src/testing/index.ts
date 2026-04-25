/**
 * Plugin testing kit. Extracted from `makeCtx` and fetch-helper patterns that
 * were duplicated across every plugin's `__tests__/contract.test.ts`. Plugin
 * authors import from `@ent-mcp/plugin-sdk/testing` to write contract tests
 * without re-implementing the host-side mocks.
 */

import type { PluginContext } from "../types";

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

/**
 * Builds a fully-typed `PluginContext` backed by an in-memory store and a
 * queued-response fetch shim. Defaults match the host's "global call, no
 * shared credentials configured" baseline; override `credentials` /
 * `sharedCredentials` / `config` per-test.
 */
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
    credentials: null,
    sharedCredentials: null,
    config: { global: null, user: null },
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

/** Builds a `Response` carrying only a status code (e.g. 204 No Content). */
export function statusRes(status: number, init?: ResponseInit): Response {
  return new Response(null, { status, ...init });
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
