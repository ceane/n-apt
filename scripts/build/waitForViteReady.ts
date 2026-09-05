import fs from "node:fs";

export interface WaitForViteReadyOptions {
  url?: string;
  urls?: string[];
  timeoutMs?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  stableSuccesses?: number;
  depsMetadataPath?: string;
  fetchImpl?: typeof fetch;
  isCancelled?: () => boolean;
  onAttempt?: (info: { attempt: number; elapsedMs: number }) => void;
}

export interface WaitForViteReadyResult {
  ok: boolean;
  reason?: string;
  elapsedMs: number;
}

const DEFAULT_URLS = [
  "http://127.0.0.1:5173/",
  "http://127.0.0.1:5173/Main.tsx",
];
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const DEFAULT_STABLE_SUCCESSES = 3;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type ProbeResponse = {
  ok: boolean;
  text: () => Promise<string>;
};

const isUsableViteResponse = async (
  response: ProbeResponse,
): Promise<boolean> => {
  if (!response?.ok) {
    return false;
  }

  try {
    const body = await response.text();
    return typeof body === "string" && body.trim().length > 0;
  } catch {
    return false;
  }
};

const probeUrl = async (
  fetchImpl: typeof fetch,
  url: string,
  requestTimeoutMs: number,
): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = (await fetchImpl(url, {
      signal: controller.signal,
    })) as ProbeResponse;
    return await isUsableViteResponse(response);
  } catch {
    // Vite may accept TCP while Rolldown/Tailwind still block responses.
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const waitForViteReady = async (
  options: WaitForViteReadyOptions = {},
): Promise<WaitForViteReadyResult> => {
  const urls = options.urls ?? (options.url ? [options.url] : DEFAULT_URLS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const requestTimeoutMs =
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const stableSuccesses = Math.max(
    1,
    options.stableSuccesses ?? DEFAULT_STABLE_SUCCESSES,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const startedAt = Date.now();
  let attempt = 0;
  let consecutiveSuccesses = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (options.isCancelled?.()) {
      return {
        ok: false,
        reason: "cancelled",
        elapsedMs: Date.now() - startedAt,
      };
    }

    attempt += 1;
    options.onAttempt?.({ attempt, elapsedMs: Date.now() - startedAt });

    const depsReady =
      !options.depsMetadataPath || fs.existsSync(options.depsMetadataPath);

    let roundOk = depsReady;
    if (roundOk) {
      const probeResults = await Promise.all(
        urls.map((url) => probeUrl(fetchImpl, url, requestTimeoutMs)),
      );
      roundOk = probeResults.every(Boolean);
    }

    if (roundOk) {
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses >= stableSuccesses) {
        return {
          ok: true,
          elapsedMs: Date.now() - startedAt,
        };
      }
    } else {
      consecutiveSuccesses = 0;
    }

    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      break;
    }

    await sleep(Math.min(intervalMs, remaining));
  }

  if (options.isCancelled?.()) {
    return {
      ok: false,
      reason: "cancelled",
      elapsedMs: Date.now() - startedAt,
    };
  }

  return {
    ok: false,
    reason: `timed out after ${timeoutMs}ms waiting for stable Vite responses (${urls.join(", ")})`,
    elapsedMs: Date.now() - startedAt,
  };
};
