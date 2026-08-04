/** Meaningful cargo/compiler lines worth surfacing during long rebuilds. */
const PROGRESS_PATTERNS: RegExp[] = [
  /\bCompiling\s+\S+/i,
  /\bChecking\s+\S+/i,
  /\bBuilding\s+\S+/i,
  /\bFinished\b.+/i,
  /\bDownloading\s+\S+/i,
  /\bDownloaded\s+\S+/i,
  /\berror(\[[^\]]+\])?:/i,
  /\bwarning(\[[^\]]+\])?:/i,
];

export type RebuildStatusPayload = {
  rebuilding: boolean;
  /** Coalesce window only — must not keep the in-app rebuild toast alive. */
  pending?: boolean;
  success?: boolean;
  stage?: string;
  phase?: string;
  progress?: string;
  recentLines?: string[];
  /** Epoch ms when the current wait/build episode started. */
  startedAt?: number;
};

/** Absolute ceiling so a dead interval/watcher cannot leave UI stuck forever. */
export const RUST_HOT_RELOAD_WAIT_STALE_MS = 45_000;
export const RUST_HOT_RELOAD_BUILD_STALE_MS = 12 * 60_000;

export function isRebuildStatusStale(
  status: Pick<RebuildStatusPayload, "rebuilding" | "pending" | "phase" | "startedAt">,
  now = Date.now(),
): boolean {
  if (typeof status.startedAt !== "number" || !Number.isFinite(status.startedAt)) {
    return false;
  }
  const age = now - status.startedAt;
  if (status.phase === "waiting" || status.pending) {
    return age >= RUST_HOT_RELOAD_WAIT_STALE_MS;
  }
  if (
    status.rebuilding
    || status.phase === "building"
    || status.phase === "rebuilding"
    || status.phase === "restarting"
  ) {
    return age >= RUST_HOT_RELOAD_BUILD_STALE_MS;
  }
  return false;
}

/** Pick the newest cargo progress line from a chunk of stdout/stderr text. */
export function summarizeCargoProgressChunk(chunk: string): string | null {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);

  let latest: string | null = null;
  for (const line of lines) {
    if (PROGRESS_PATTERNS.some((pattern) => pattern.test(line))) {
      latest = line.length > 120 ? `${line.slice(0, 117)}...` : line;
    }
  }
  return latest;
}

export function mergeRebuildRecentLines(
  previous: string[] | undefined,
  chunk: string,
  limit = 8,
): string[] {
  const next = chunk
    .split(/\r?\n/)
    .map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim())
    .filter(Boolean);
  return [...(previous ?? []), ...next].slice(-limit);
}
