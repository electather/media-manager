import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const dispatchPrimaryMock = vi.fn();
vi.mock("../strategies/primary-with-enrichment", () => ({
  dispatchPrimary: (...args: unknown[]) => dispatchPrimaryMock(...args),
}));

vi.mock("../dispatcher", () => ({
  dispatchAggregate: vi.fn(),
  dispatchSingle: vi.fn(),
  dispatchPrimary: (...args: unknown[]) => dispatchPrimaryMock(...args),
}));

const mapToMediaDetailMock = vi.fn((raw: unknown, id: string) => ({
  id,
  mediaType: id.split(":")[0],
  title: (raw as { title?: string }).title ?? "",
}));
vi.mock("../mappers", () => ({
  mapToMediaDetail: (...args: [unknown, string]) => mapToMediaDetailMock(...args),
}));

const { MediaService } = await import("../service");

beforeEach(() => {
  dispatchPrimaryMock.mockReset();
  mapToMediaDetailMock.mockClear();
});

describe("MediaService.getDetailsTyped", () => {
  it("dispatches metadata.getDetails with the bare id, not the combined form", async () => {
    dispatchPrimaryMock.mockResolvedValue({
      data: { title: "Man of Steel" },
      errors: [],
      attempted: 1,
    });

    const result = await new MediaService("u1").getDetailsTyped("movie:49521");

    expect(dispatchPrimaryMock).toHaveBeenCalledTimes(1);
    const req = dispatchPrimaryMock.mock.calls[0]![0] as {
      input: { id: string; type: string };
      mediaType: string;
    };
    expect(req.input).toEqual({ id: "49521", type: "movie" });
    expect(req.mediaType).toBe("movie");
    expect(result).toMatchObject({ id: "movie:49521", title: "Man of Steel" });
  });

  it("returns null when the dispatcher yields no data", async () => {
    dispatchPrimaryMock.mockResolvedValue({ data: null, errors: [], attempted: 1 });
    const result = await new MediaService("u1").getDetailsTyped("movie:49521");
    expect(result).toBeNull();
    expect(mapToMediaDetailMock).not.toHaveBeenCalled();
  });

  it("accepts a bare id with explicit type and forwards it unchanged", async () => {
    dispatchPrimaryMock.mockResolvedValue({ data: { title: "X" }, errors: [], attempted: 1 });

    await new MediaService("u1").getDetailsTyped("550", "movie");

    const req = dispatchPrimaryMock.mock.calls[0]![0] as { input: { id: string; type: string } };
    expect(req.input).toEqual({ id: "550", type: "movie" });
  });
});
