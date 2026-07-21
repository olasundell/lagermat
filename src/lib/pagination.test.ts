import { describe, expect, it, vi } from "vitest";
import { collectPages } from "./pagination";

describe("collectPages", () => {
  it("loads every row when the result exceeds the API maximum", async () => {
    const source = Array.from({ length: 5_000 }, (_, index) => index);
    const loadPage = vi.fn(async (offset: number, pageSize: number) => source.slice(offset, offset + pageSize));

    const result = await collectPages(loadPage, 500);

    expect(result).toEqual(source);
    expect(loadPage).toHaveBeenCalledTimes(11);
    expect(loadPage).toHaveBeenLastCalledWith(5_000, 500);
  });

  it("rejects an invalid page size", async () => {
    await expect(collectPages(async () => [], 0)).rejects.toThrow("positivt heltal");
  });
});
