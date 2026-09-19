/**
 * Sequential Rust backend handoff helpers.
 *
 * A USB SDR is an exclusive resource: only one process can own the interface at
 * a time. The hot-reload swap therefore has to stop the current backend and wait
 * for it to release the device *before* starting the replacement, otherwise the
 * replacement's open attempts collide with the outgoing owner and libusb reports
 * `usb_claim_interface error -3` (device busy) / `-99`.
 */

/** Wait after the previous backend exits before the replacement probes USB. */
export const HOT_RELOAD_USB_RELEASE_SETTLE_MS = 250;
/** How long to wait for the outgoing backend process to exit. */
export const HOT_RELOAD_PROCESS_EXIT_TIMEOUT_MS = 5000;
/** How long to wait for the replacement backend to claim a supported radio. */
export const HOT_RELOAD_SDR_READY_TIMEOUT_MS = 15000;
/**
 * Minimum time the replacement backend is polled before an empty source
 * inventory is trusted. The backend refreshes its USB inventory on a periodic
 * probe, so an empty list immediately after startup is ambiguous rather than
 * proof that no radio is attached.
 */
export const HOT_RELOAD_SDR_INVENTORY_SETTLE_MS = 3000;

/** Source kinds that represent exclusive physical radios, not simulations. */
export const HARDWARE_SOURCE_KINDS = ["rtl-sdr", "hackrf_one"] as const;

export type HotReloadDeviceState = {
  connected: boolean;
  state: string;
  info: string;
};

export type SdrReadiness =
  | { ready: true; outcome: "connected" | "no-hardware" }
  | { ready: false; outcome: "waiting" };

export type SdrReadyOutcome = "connected" | "no-hardware" | "failed" | "cancelled";

export type SdrReadyResult = {
  ok: boolean;
  outcome: SdrReadyOutcome;
  device?: HotReloadDeviceState;
  hardwareSourceKinds: string[];
};

export type Sleep = (ms: number) => Promise<void>;

export type FetchResponseLike = {
  ok: boolean;
  json: () => Promise<unknown>;
};

export type FetchLike = (url: string) => Promise<FetchResponseLike>;

export function isHardwareSourceKind(kind: string): boolean {
  return (HARDWARE_SOURCE_KINDS as readonly string[]).includes(kind);
}

/**
 * Read the source kinds from the backend `/status` snapshot
 * (`{ status: { sources: [{ kind }] } }`).
 */
export function extractSourceKinds(snapshot: unknown): string[] {
  const sources = (snapshot as { status?: { sources?: unknown } } | null)?.status
    ?.sources;
  if (!Array.isArray(sources)) return [];

  return sources
    .map((source) => (source as { kind?: unknown } | null)?.kind)
    .filter((kind): kind is string => typeof kind === "string" && kind.length > 0);
}

/**
 * Read the device block from the backend `/api/agent/status` payload
 * (`{ device: { connected, state, info } }`). The flat `/status` route does not
 * expose device state.
 */
export function extractDeviceState(payload: unknown): HotReloadDeviceState | null {
  const device = (payload as { device?: unknown } | null)?.device;
  if (!device || typeof device !== "object") return null;

  const { connected, state, info } = device as Record<string, unknown>;
  if (typeof connected !== "boolean") return null;

  return {
    connected,
    state: typeof state === "string" ? state : "",
    info: typeof info === "string" ? info : "",
  };
}

/**
 * A reported connection wins outright. When no hardware source has ever been
 * enumerated the reload is allowed to proceed, because the operator is running
 * without a radio; the caller applies the inventory settle window before
 * trusting that.
 */
export function evaluateSdrReadiness(
  device: HotReloadDeviceState | null,
  hardwareSourceKinds: readonly string[],
): SdrReadiness {
  if (device?.connected) {
    return { ready: true, outcome: "connected" };
  }

  if (!hardwareSourceKinds.some(isHardwareSourceKind)) {
    return { ready: true, outcome: "no-hardware" };
  }

  return { ready: false, outcome: "waiting" };
}

export function formatSdrReadyFailure(result: SdrReadyResult): string {
  const kinds = result.hardwareSourceKinds.filter(isHardwareSourceKind);
  const detected = kinds.length > 0 ? kinds.join(", ") : "unknown radio";
  const state = result.device?.state ? `state=${result.device.state}` : "state unknown";
  const info = result.device?.info ? `, ${result.device.info}` : "";
  return `${detected} detected but never connected (${state}${info})`;
}

const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultFetch: FetchLike = (url) => fetch(url, { cache: "no-store" });

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Poll a freshly started backend until it has claimed a supported radio, or
 * until the source inventory proves that none is attached.
 *
 * Observed hardware kinds are accumulated across polls: a radio that is
 * enumerated once must not be forgotten while the inventory churns.
 */
export async function waitForSdrReady(options: {
  baseUrl: string;
  timeoutMs?: number;
  pollMs?: number;
  settleMs?: number;
  fetchImpl?: FetchLike;
  sleep?: Sleep;
  now?: () => number;
  isCancelled?: () => boolean;
}): Promise<SdrReadyResult> {
  const {
    baseUrl,
    timeoutMs = HOT_RELOAD_SDR_READY_TIMEOUT_MS,
    pollMs = 250,
    settleMs = HOT_RELOAD_SDR_INVENTORY_SETTLE_MS,
    fetchImpl = defaultFetch,
    sleep = defaultSleep,
    now = Date.now,
    isCancelled,
  } = options;

  const startedAt = now();
  const observedKinds = new Set<string>();
  let lastDevice: HotReloadDeviceState | null = null;
  let sawDevicePayload = false;

  for (;;) {
    if (isCancelled?.()) {
      return {
        ok: false,
        outcome: "cancelled",
        device: lastDevice ?? undefined,
        hardwareSourceKinds: Array.from(observedKinds),
      };
    }

    const [devicePayload, sourceSnapshot] = await Promise.all([
      fetchJson(fetchImpl, `${baseUrl}/api/agent/status`),
      fetchJson(fetchImpl, `${baseUrl}/status`),
    ]);

    const device = extractDeviceState(devicePayload);
    if (device) {
      lastDevice = device;
      sawDevicePayload = true;
    }
    for (const kind of extractSourceKinds(sourceSnapshot)) {
      observedKinds.add(kind);
    }

    const hardwareSourceKinds = Array.from(observedKinds);
    const readiness = evaluateSdrReadiness(lastDevice, hardwareSourceKinds);

    if (readiness.ready) {
      // A reported connection is authoritative and returns immediately. An
      // absent-radio pass additionally requires the backend to have answered
      // with device state and the inventory to have settled; otherwise a
      // backend that is still starting (or unreachable) would masquerade as a
      // machine with no radio attached.
      const settled = sawDevicePayload && now() - startedAt >= settleMs;
      if (readiness.outcome === "connected" || settled) {
        return {
          ok: true,
          outcome: readiness.outcome,
          device: lastDevice ?? undefined,
          hardwareSourceKinds,
        };
      }
    }

    if (now() - startedAt >= timeoutMs) {
      return {
        ok: false,
        outcome: "failed",
        device: lastDevice ?? undefined,
        hardwareSourceKinds,
      };
    }

    await sleep(pollMs);
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH means the process is gone. EPERM means it exists but belongs to
    // another user, which still counts as alive for handoff purposes.
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

/** Wait until a pid is gone, returning false if it outlives the timeout. */
export async function waitForProcessExit(options: {
  pid: number;
  timeoutMs?: number;
  pollMs?: number;
  isAlive?: (pid: number) => boolean;
  sleep?: Sleep;
  now?: () => number;
}): Promise<boolean> {
  const {
    pid,
    timeoutMs = HOT_RELOAD_PROCESS_EXIT_TIMEOUT_MS,
    pollMs = 100,
    isAlive = defaultIsProcessAlive,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(pollMs);
  }

  return !isAlive(pid);
}

/**
 * Signal a detached child's whole process group, falling back to the pid alone
 * when the group is already gone.
 */
export function signalProcessTree(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already exited; nothing left to signal.
    }
  }
}
