import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { consola, type ConsolaInstance } from "consola";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { MediaType } from "@ent-mcp/shared/media";
import { keyToId } from "@ent-mcp/shared/watchlist";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import fixture from "./fixtures/section-parity.json";
import {
  buildParityContinueWatchingItems,
  buildParityMetadata,
  buildParityStatusMap,
  installIncrementingClock,
  parityServersFor,
  PARITY_ITEMS_LIMIT,
  PARITY_MOOD,
  PARITY_MOOD_LIMIT,
  PARITY_RECENTLY_LIMIT,
  PARITY_USER_ID,
  seedParityRows,
} from "./fixtures/section-parity-scenario";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../db/client", async () => {
  const actual = await vi.importActual<typeof import("../../db/client")>("../../db/client");
  return {
    ...actual,
    getDb: () => testDb,
  };
});

vi.mock("../../jobs/events", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

const { emit } = await import("../../jobs/events");
const { addItem, listItems, listMoodItems, getTonightSection, getRecentlyAdded } =
  await import("../service");
const mediaRepo = await import("../../media/repo");
const { __resetAvailabilityCache } = await import("../../media");
const { __resetTonightCache } = await import("../tonight/section");

let testDb: Db;
let ctx: ReturnType<typeof makeParityCtx>;
let restoreClock: () => void;

const log: ConsolaInstance = consola.withTag("parity");

/**
 * Builds a per-request context whose media + catalog mocks resolve the
 * deterministic scenario data (status, metadata, servers, continue-watching).
 */
function makeParityCtx() {
  const metadata = buildParityMetadata();
  const statusMap = buildParityStatusMap();
  const cwItems = buildParityContinueWatchingItems();
  const mediaService = {
    getWatchlistFeed: vi.fn().mockResolvedValue({ items: [], partial: false }),
    getStatusBatch: vi.fn(async (ids: string[]) => {
      const out: Record<string, string> = {};
      for (const id of ids) if (statusMap[id] != null) out[id] = statusMap[id]!;
      return out;
    }),
    getMatchingServers: vi.fn(async (tmdbId: string) => parityServersFor(tmdbId)),
    getMetadata: vi.fn().mockResolvedValue(null),
    getContinueWatchingFeed: vi.fn().mockResolvedValue({ items: cwItems, partial: false }),
  };
  const catalog = {
    getMetadataBatch: vi.fn(async (keys: { tmdbId: string; type: MediaType }[]) => {
      const out: Record<string, CanonicalMetadata> = {};
      for (const k of keys) {
        const id = keyToId({ tmdbId: k.tmdbId, mediaType: k.type });
        if (metadata[id]) out[id] = metadata[id]!;
      }
      return out;
    }),
    getMetadata: vi.fn().mockResolvedValue(null),
    writeMetadata: vi.fn().mockResolvedValue(undefined),
  };
  return {
    userId: PARITY_USER_ID,
    mediaService: mediaService as unknown as Parameters<typeof listItems>[0]["mediaService"],
    catalog: catalog as unknown as Parameters<typeof listItems>[0]["catalog"],
    log,
  };
}

beforeAll(async () => {
  testDb = await createInMemoryDb();
  await testDb.insert(user).values([
    {
      id: PARITY_USER_ID,
      name: PARITY_USER_ID,
      email: `${PARITY_USER_ID}@test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await mediaRepo.__resetActiveRowsForTests(testDb);
  __resetAvailabilityCache();
  await __resetTonightCache();
  (emit as ReturnType<typeof vi.fn>).mockClear();
  restoreClock = installIncrementingClock();
  ctx = makeParityCtx();
  await seedParityRows(addItem, ctx);
});

afterEach(() => {
  restoreClock();
});

// RISK-103 / design §T: these fixtures lock the current section output (item
// ids + order) so the US-014..US-017 `MediaSource` reimplementations can be
// proven behavior-neutral. The WHY (Rule 9): a subtle sort, classify, or
// ranking change during the migration must fail here, not ship silently.
describe("watchlist section parity fixtures", () => {
  it("items section produces the captured ids in order", async () => {
    const res = await listItems(ctx, { limit: PARITY_ITEMS_LIMIT });
    expect(res.items.map((i) => i.id)).toEqual(fixture.items.ids);
    expect(res.cursor).toEqual(fixture.items.cursor);
  });

  it("mood-items section produces the captured ids in order", async () => {
    const res = await listMoodItems(ctx, PARITY_MOOD, { limit: PARITY_MOOD_LIMIT });
    expect(res.items.map((i) => i.id)).toEqual(fixture.moodItems.ids);
    expect(res.cursor).toEqual(fixture.moodItems.cursor);
  });

  it("tonight section produces the captured hero + alternates in order", async () => {
    const res = await getTonightSection(ctx);
    expect(res.items.map((i) => i.id)).toEqual(fixture.tonight.ids);
  });

  it("recently section produces the captured ids in order", async () => {
    const res = await getRecentlyAdded(ctx, PARITY_RECENTLY_LIMIT);
    expect(res.items.map((i) => i.id)).toEqual(fixture.recently.ids);
  });
});
