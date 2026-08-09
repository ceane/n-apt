/** Meaningful cargo/compiler lines worth surfacing during long rebuilds. */
const PROGRESS_PATTERNS: RegExp[] = [
  /\bBuilding\s+\[[^\]]*\]\s+\d+\/\d+\s*:\s*\S+/i,
  /\bCompiling\s+\S+/i,
  /\bChecking\s+\S+/i,
  /\bBuilding\s+\S+/i,
  /\bFinished\b.+/i,
  /\bDownloading\s+\S+/i,
  /\bDownloaded\s+\S+/i,
  /\berror(\[[^\]]+\])?:/i,
  /\bwarning(\[[^\]]+\])?:/i,
];

const CARGO_BUILD_PROGRESS = /\bBuilding\s+\[[^\]]*\]\s+(\d+)\/(\d+)\s*:\s*(.+)$/i;
const N_APT_BACKEND_CRATE = /^Compiling\s+n-apt-backend\b/i;

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
    const buildProgress = line.match(CARGO_BUILD_PROGRESS);
    if (buildProgress) {
      const target = buildProgress[3].trim();
      const binary = /n-apt-backend\(bin\)/i.test(target);
      if (/n-apt-backend/i.test(target)) {
        latest = binary
          ? `Building n-apt-backend binary (${buildProgress[1]}/${buildProgress[2]})`
          : `Compiling n-apt-backend (${buildProgress[1]}/${buildProgress[2]})`;
      } else {
        latest = `Building dependency ${buildProgress[1]}/${buildProgress[2]}: ${target}`;
      }
      continue;
    }
    if (N_APT_BACKEND_CRATE.test(line)) {
      latest = "Compiling n-apt-backend crate";
      continue;
    }
    if (PROGRESS_PATTERNS.some((pattern) => pattern.test(line))) {
      latest = line.length > 120 ? `${line.slice(0, 117)}...` : line;
    }
  }
  return latest;
}

export function formatCargoBuildHeartbeat(lastProgress: string, elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const elapsed = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return `${lastProgress} — rustc is still processing this crate (${elapsed} elapsed)`;
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
