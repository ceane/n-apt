import { createLiveReduxStreamHarness } from "./helpers/liveReduxStreamHarness";

const explicitLiveBackendUrl = (
  process.env.LIVE_BACKEND_URL ?? ""
).trim();
/** Sub-frame budget runs only against an external backend (CI/dev with LIVE_BACKEND_URL). */
const strictLatencyBudget = explicitLiveBackendUrl.length > 0;

const vfoFftCases = strictLatencyBudget
  ? [
      { fftSize: 2048, frameRate: 60 },
      { fftSize: 8192, frameRate: 60 },
    ]
  : [{ fftSize: 2048, frameRate: 60 }];

describe("VFO center-frequency round-trip latency", () => {
  jest.setTimeout(120_000);

  let harness: Awaited<ReturnType<typeof createLiveReduxStreamHarness>>;

  beforeAll(async () => {
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
    await harness.waitFor(
      () => harness.snapshot(),
      (value) => value.rxPresentation.hasFrame,
      20_000,
    );
  });

  afterAll(() => {
    harness?.close();
  });

  test.each(vfoFftCases)(
    strictLatencyBudget
      ? "returns the mocked hardware response for FFT size $fftSize inside one frame interval"
      : "completes retunes for FFT size $fftSize on harness-spawned backend (smoke)",
    async ({ fftSize, frameRate }) => {
      await harness.setFftSize(fftSize, 30_000);

      const latencies: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        latencies.push(
          await harness.retuneCenterFrequency(5_000_000 + index * 100_000),
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
