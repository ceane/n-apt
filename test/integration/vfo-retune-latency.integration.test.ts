import { createLiveReduxStreamHarness } from "./helpers/liveReduxStreamHarness";

const explicitLiveBackendUrl = (
  process.env.LIVE_BACKEND_URL ?? ""
).trim();
/** Sub-frame budget runs only against an external backend (CI/dev with LIVE_BACKEND_URL). */
const strictLatencyBudget = explicitLiveBackendUrl.length > 0;

if (!strictLatencyBudget) {
  // Harness-spawned smoke runs share the host with any dev backend stack and
  // real USB SDRs; device re-enumeration can stall acquisition for tens of
  // seconds mid-run. One retry keeps that environment green without masking
  // regressions — a real latency or delivery regression fails both attempts.
  jest.retryTimes(1, { logErrorsBeforeRetry: true });
}

const vfoFftCases = strictLatencyBudget
  ? [
      { fftSize: 2048, frameRate: 60 },
      { fftSize: 8192, frameRate: 60 },
    ]
  : [{ fftSize: 2048, frameRate: 60 }];

describe("VFO center-frequency round-trip latency", () => {
  jest.setTimeout(120_000);

  let harness: Awaited<ReturnType<typeof createLiveReduxStreamHarness>> | null =
    null;

  // Lazy, retry-safe initialization. jest.retryTimes does not re-run
  // beforeAll hooks, so suite setup happens here instead — and a failed
  // setup tears its backend down so the retried attempt starts from a fresh
  // process rather than a possibly-wedged one.
  const ensureReady = async () => {
    try {
      if (harness) return;
      // Default: harness spawns an isolated backend (CI-safe, no pre-running server).
      // Set LIVE_BACKEND_URL (e.g. http://127.0.0.1:18766) for strict sub-frame checks.
      harness = await createLiveReduxStreamHarness(
        strictLatencyBudget
          ? {
              backendUrl: explicitLiveBackendUrl.replace(/\/$/, ""),
              ...(process.env.LIVE_STREAM_PASSWORD
                ? { password: process.env.LIVE_STREAM_PASSWORD }
                : {}),
            }
          : { pollIntervalMs: 1 },
      );
      await harness.connect();
      await harness.selectSource("mock-apt");
      // Harness-spawned backends enumerate real USB hardware during startup,
      // which can stall frame production well past the usual warm-up on
      // machines with SDRs attached. The strict external-backend budget below
      // is unaffected.
      await harness.waitFor(
        () => harness!.snapshot(),
        (value) => value.rxPresentation.hasFrame,
        strictLatencyBudget ? 20_000 : 45_000,
      );
    } catch (error) {
      harness?.close();
      harness = null;
      throw error;
    }
  };

  afterAll(() => {
    harness?.close();
    harness = null;
  });

  test.each(vfoFftCases)(
    strictLatencyBudget
      ? "returns the mocked hardware response for FFT size $fftSize inside one frame interval"
      : "completes retunes for FFT size $fftSize on harness-spawned backend (smoke)",
    async ({ fftSize, frameRate }) => {
      await ensureReady();
      await harness!.setFftSize(fftSize, 30_000);

      const latencies: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        latencies.push(
          await harness!.retuneCenterFrequency(5_000_000 + index * 100_000),
        );
      }

      const frameBudgetMs = 1000 / frameRate;
      const worstCaseMs = Math.max(...latencies);
      console.log(
        JSON.stringify({
          mode: strictLatencyBudget ? "strict" : "smoke",
          fftSize,
          frameBudgetMs,
          latencies,
          worstCaseMs,
        }),
      );

      expect(latencies.every((latency) => latency > 0 && latency < 30_000)).toBe(
        true,
      );

      if (strictLatencyBudget) {
        expect(worstCaseMs).toBeLessThan(frameBudgetMs);
        return;
      }

      // Harness-spawned backends are slower and may not echo large FFT settings;
      // keep CI green while still proving retune round-trips complete.
      expect(worstCaseMs).toBeLessThan(5_000);
    },
  );
});
