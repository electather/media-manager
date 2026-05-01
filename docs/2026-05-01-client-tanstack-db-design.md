# Client TanStack DB Infra — Design (2026-05-01)

> Caveman ultra. Pseudo-code only. Real impl in plan.

## §G Goal

Reactive client store. Collections wrap Hono RPC. SWR offline. Optimistic mutations. Cross-component cache. Pilot: admin jobs.

## §M Motivation

A. Cache coherence — same row, many readers, one mutation, all update.
B. Optimistic + rollback — drop manual cache patching.
C. Live queries — filter/sort/join client-side, no refetch.
D. Realtime — deferred, slot-in later (custom collection / SSE).
E. Offline lists — IDB persist, SWR.
F. Drop `queryKey` sprawl — collection = source of truth.

## §S Stack

```
+ @tanstack/react-db                       # collections, useLiveQuery
+ @tanstack/query-db-collection            # queryCollectionOptions
+ @tanstack/query-async-storage-persister  # persister
+ @tanstack/react-query-persist-client     # PersistQueryClientProvider
+ idb-keyval                               # IDB backing
  @tanstack/react-query (existing)
```

No `dexieCollectionOptions` v1. Persistence = QueryClient-level, not per-collection. Future: swap individual collections to `dexieCollectionOptions` if local-first need clear.

## §C Constraints

- C1. Sync engine = `queryCollectionOptions` only v1. ⊥ custom collections, ⊥ Electric, ⊥ Dexie collections.
- C2. Realtime ⊥ v1. Polling via `refetchInterval` carries D until SSE/WS lands.
- C3. Granularity = collection-per-endpoint. ⊥ entity-shared collections v1 (cross-component cache trade accepted).
- C4. Schema (Zod) on optimistic input only. ⊥ schema parse on server-sync writes (server already validated).
- C5. Optimistic = toggles only (`enabled`, `scheduleOverride`). ⊥ optimistic on `trigger`/`cancel` (server runId truth).
- C6. Persistence = `QueryClient` IDB persister. Opt-out via `meta.persist=false`. Default = persist.
  - `maxAge` = 30d. `buster` = `${APP_VERSION}-${SHARED_VERSION}`. `gcTime` ≥ maxAge.
- C7. SW out of scope. Design SW-friendly: persister key shape stable, ⊥ Network-only assumptions.
- C8. C12 (feature-first) holds: shared infra in `shared/lib/db/`, collections in `features/<x>/data/`.
- C9. C11 (es-toolkit) holds: ⊥ custom util reimpl in db code.
- C10. C7 (shared isomorphic) holds: ⊥ TanStack DB import from `@ent-mcp/shared`. Client-only dep.
- C11. Pilot scope = `features/jobs` only. ⊥ migrate other `useQuery` call sites this PR.

## §F File Layout

```
apps/client/src/
  shared/lib/db/
    client.ts          # QueryClient instance (hoisted from main.tsx)
    persister.ts       # createIdbPersister(), buster, dehydrate filter
    provider.tsx       # AppDataProvider wrapping PersistQueryClientProvider
    test-utils.ts      # createTestCollection(), seedRows(), no-persist client
    index.ts           # barrel
  features/jobs/
    data/
      jobs-list.collection.ts     # admin.jobs.$get
      job-detail.collection.ts    # admin.jobs/:id (factory by jobId)
      jobs.hooks.ts               # useJobsList, useJobDetail, useJobMutations
      index.ts
    components/...                # existing
    index.ts                      # re-export hooks, dialogs
  main.tsx              # AppDataProvider replaces inline QueryClientProvider
```

## §I Interfaces

### I.client — `shared/lib/db/client.ts`

```ts
queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: 30d, staleTime: 0 } },
});
```

### I.persister — `shared/lib/db/persister.ts`

```ts
buster = `${import.meta.env.VITE_APP_VERSION}-${import.meta.env.VITE_SHARED_VERSION}`;
persister = createAsyncStoragePersister({
  storage: { getItem, setItem, removeItem } from idb-keyval keyed `tsq:cache`,
  key: 'ent-mcp-tsq',
});
dehydrateOptions = {
  shouldDehydrateQuery: q => q.meta?.persist !== false,
};
```

### I.provider — `shared/lib/db/provider.tsx`

```tsx
<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{ persister, maxAge: 30d, buster, dehydrateOptions }}
>
  {children}
</PersistQueryClientProvider>
```

### I.test-utils — `shared/lib/db/test-utils.ts`

```ts
createTestQueryClient()                     // gcTime 0, retries 0, no persist
createTestCollection<T>(opts, seed?: T[])   // wraps queryCollectionOptions w/ stub queryFn
seedRows<T>(collection, rows)               // utils.writeBatch + writeInsert
```

### I.jobs.collections

```ts
// jobs-list.collection.ts
jobsListCollection = createCollection(queryCollectionOptions({
  id: 'admin.jobs.list',
  queryKey: ['admin','jobs','list'],
  queryClient,
  queryFn: () => api.admin.jobs.$get().then(unwrap),  // {jobs: JobHandle[]}
  select: r => r.jobs,
  getKey: j => j.id,
  refetchInterval: 10_000,
  meta: { persist: false },                            // admin = fresh
  onUpdate: async ({ transaction }) => {               // config toggle
    for (m of transaction.mutations) {
      patch = { enabled: m.changes.enabled, scheduleOverride: m.changes.scheduleOverride };
      await api.admin.jobs[':id'].config.$post({ param:{id:m.key}, json: patch });
    }
  },
}));

// job-detail.collection.ts (factory — id-keyed)
jobDetailCollection(jobId) = createCollection(queryCollectionOptions({
  id: `admin.jobs.detail.${jobId}`,
  queryKey: ['admin','jobs','detail', jobId],
  queryClient,
  queryFn: () => api.admin.jobs[':id'].$get({ param:{id:jobId}, query:{limit:'30'} }).then(unwrap),
  select: r => [r.job],                                // single-row collection
  getKey: j => j.id,
  refetchInterval: 5_000,
  meta: { persist: false },
}));
// runs: stay useQuery v1 (low reuse). Migrate later if motivation A bites.
```

### I.jobs.hooks — `features/jobs/data/jobs.hooks.ts`

```ts
useJobsList(filters)   → useLiveQuery(q.from(jobsListCollection).where(filters))
useJobDetail(jobId)    → useLiveQuery(q.from(jobDetailCollection(jobId)).findOne())
useJobMutations()      → {
  toggleEnabled(jobId, enabled)        // optimistic via collection.update
  setScheduleOverride(jobId, expr)     // optimistic via collection.update
  trigger(jobId, payload)              // useMutation, NOT optimistic, invalidate list+detail
  cancel(jobId, scopeKey?)             // useMutation, NOT optimistic, invalidate list+detail
}
```

### I.mutations.policy

| Op                | Path                        | Optimistic | Reason                       |
| ----------------- | --------------------------- | ---------- | ---------------------------- |
| toggle enabled    | `collection.update`         | yes        | Idempotent, instant feedback |
| schedule override | `collection.update`         | yes        | Idempotent                   |
| trigger run       | `useMutation` + invalidate  | no         | Server runId is truth        |
| cancel run        | `useMutation` + invalidate  | no         | Side-effect heavy            |
| config save modal | `collection.update`         | yes        | Same as toggle, batched      |

Rollback: handler throws → TanStack DB auto-rollback + toast via `onError`.

### I.persistence.policy

| Domain            | `meta.persist` | `staleTime` | Reason                      |
| ----------------- | -------------- | ----------- | --------------------------- |
| admin.* (jobs etc)| false          | 0           | Fresh = correctness         |
| connections       | true           | 5m          | User read-heavy             |
| watchlist / home  | true           | 1m          | Offline list                |
| auth/session      | false          | 0           | Sensitive                   |
| notifications     | true           | 30s         | Inbox view offline          |
| settings/prefs    | true           | 5m          | Rarely change               |

## §V Invariants

- V1. `QueryClient` singleton lives in `shared/lib/db/client.ts`. ⊥ second instance, ⊥ inline in `main.tsx`.
- V2. ∀ collection that wrap server data → `queryCollectionOptions` w/ `queryClient` from V1.
- V3. ∀ admin/sensitive query → `meta.persist=false`. ⊥ leak admin row to IDB.
- V4. Buster string change ⇒ IDB cache wiped on next mount. Bump on shape break.
- V5. Optimistic mutation = `collection.update/insert/delete`. Non-optimistic = `useMutation` + `queryClient.invalidateQueries`. ⊥ mix.
- V6. Schema (Zod) attached only when collection accepts user-authored optimistic writes. ⊥ schema for read-only sync collections (cost no value).
- V7. Collection `id` = stable string `${domain}.${endpoint}[.${param}]`. Used for devtools + persistence keys.
- V8. ⊥ TanStack DB symbol imported from `@ent-mcp/shared`. Client dep only.
- V9. Hooks = sole consumer surface. Components ⊥ import collection direct.
- V10. ⊥ live query joins across collections v1 (granularity = endpoint, joins later when entity collections land).

## §T Tasks

| # | Task                                                                      | Deps |
| - | ------------------------------------------------------------------------- | ---- |
| 1 | Add deps via `vp add` (`@tanstack/react-db`, query-db-collection, query-async-storage-persister, react-query-persist-client, idb-keyval) | — |
| 2 | `shared/lib/db/client.ts` — hoist `queryClient`. Update `main.tsx` import. | 1 |
| 3 | `shared/lib/db/persister.ts` — IDB persister + buster + dehydrate filter. | 1, 2 |
| 4 | `shared/lib/db/provider.tsx` — `AppDataProvider` (PersistQueryClientProvider). | 2, 3 |
| 5 | `main.tsx` — swap `QueryClientProvider` → `AppDataProvider`. Smoke test. | 4 |
| 6 | `shared/lib/db/test-utils.ts` — `createTestQueryClient`, `createTestCollection`, `seedRows`. | 2 |
| 7 | `features/jobs/data/jobs-list.collection.ts` — list collection + onUpdate. | 4 |
| 8 | `features/jobs/data/job-detail.collection.ts` — detail factory.            | 4 |
| 9 | `features/jobs/data/jobs.hooks.ts` — `useJobsList`, `useJobDetail`, `useJobMutations`. | 7, 8 |
| 10 | Migrate `routes/_authenticated/_settings/admin/jobs.tsx` — `useQuery` → hooks. Optimistic config toggle. ⊥ rewrite UI. | 9 |
| 11 | Migrate `features/jobs/components/trigger-dialog.tsx` — `useMutation` (no optimistic per V5/I.mutations.policy). | 9 |
| 12 | Tests: `shared/lib/db/__tests__/persister.test.ts` (buster bump wipes, opt-out filter), `features/jobs/__tests__/jobs.hooks.test.ts` (collection seed + hook render + optimistic rollback). | 6, 9 |
| 13 | Manual smoke: list polls, detail polls, toggle optimistic + rollback on 500, trigger/cancel non-optimistic, reload offline shows last list (non-admin route — verify on connections page after V).  | 10, 11 |
| 14 | Changeset `.changeset/<slug>.md` — `@ent-mcp/client: minor`, 1-sentence user-facing.    | 10 |

## §B Backprop slots

(populated as bugs surface during build)

## §R Risks / Open

- R1. `select` w/ `queryCollectionOptions` — confirm shape works for `{jobs: JobHandle[]}` envelope. Fall back to `queryFn` returning array if `select` typing fights.
- R2. `PersistQueryClientProvider` blocks render until hydration. Acceptable for v1 (jobs admin gated behind auth anyway).
- R3. Per-id `jobDetailCollection(id)` factory creates one collection per opened job. Drawer-close should not leak — verify TanStack DB auto-disposes on no-subscriber, else add `useEffect` cleanup.
- R4. `import.meta.env.VITE_APP_VERSION` requires Vite define. Add to `vite.config.ts` (`define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) }`).
- R5. SW future: when shipped, design path = SW handles `/api/` runtime cache via Workbox; persister keeps role for hydrated UI before SW responds. ⊥ duplicate SWR layer.

## §X Out of Scope

- Service worker / PWA install / offline shell.
- Realtime (SSE/WS) push into collections.
- Migration of `connections`, `settings`, `oauth`, `auth`, `admin/plugins`, `admin/logs`, `home`, `notifications` to TanStack DB.
- Entity-level (cross-endpoint) collections.
- ElectricSQL / Dexie persistence.
- Live-query joins.
