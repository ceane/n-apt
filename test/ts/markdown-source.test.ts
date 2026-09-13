import { loadMarkdown, preloadMarkdown, resetMarkdownRequestCache } from "@n-apt/app-article/utils/markdown-source";

describe("markdown source loading", () => {
  beforeEach(() => {
    resetMarkdownRequestCache();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Article"),
      headers: { get: () => "text/markdown" },
    }) as any;
  });

  it("shares the preloaded request with the first app load", async () => {
    const preload = preloadMarkdown();
    const appLoad = loadMarkdown();

    await expect(appLoad).resolves.toBe("# Article");
    await expect(preload).resolves.toBe("# Article");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bypasses the shared request when hot reload asks for fresh markdown", async () => {
    await loadMarkdown();
    await loadMarkdown(undefined, true);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
