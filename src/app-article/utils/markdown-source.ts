import { assetPageUrl } from "@n-apt/app-article/utils/asset-helpers";

export const DEFAULT_MARKDOWN_SOURCE = "/pages/how-do-they-do-it.md";

type CachedRequest = {
  fetcher: typeof fetch;
  promise: Promise<string>;
};

const requests = new Map<string, CachedRequest>();

const requestMarkdown = (path: string, bustCache: boolean): Promise<string> => {
  const normalizedPath = path.trim() || DEFAULT_MARKDOWN_SOURCE;
  const url = assetPageUrl(normalizedPath);
  const fetcher = globalThis.fetch;

  if (!bustCache) {
    const cached = requests.get(url);
    if (cached?.fetcher === fetcher) {
      return cached.promise;
    }
  }

  const requestUrl = bustCache ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
  const promise = fetcher(requestUrl, {
    headers: { "Cache-Control": "no-cache" },
    cache: "no-store",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch markdown: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error("Received HTML fallback instead of markdown");
    }

    return response.text();
  });

  if (!bustCache) {
    requests.set(url, { fetcher, promise });
    void promise.catch(() => {
      const cached = requests.get(url);
      if (cached?.promise === promise) {
        requests.delete(url);
      }
    });
  }

  return promise;
};

export const loadMarkdown = (
  path = DEFAULT_MARKDOWN_SOURCE,
  bustCache = false,
): Promise<string> => requestMarkdown(path, bustCache);

export const preloadMarkdown = (path = DEFAULT_MARKDOWN_SOURCE): Promise<string> => loadMarkdown(path);

/** Resets the in-flight request cache between isolated test runs. */
export const resetMarkdownRequestCache = (): void => {
  requests.clear();
};
