import { createLiveReduxStreamHarness } from "./helpers/liveReduxStreamHarness";

describe("VFO center-frequency round-trip latency", () => {
  jest.setTimeout(120_000);

  let harness: Awaited<ReturnType<typeof createLiveReduxStreamHarness>>;

  beforeAll(async () => {
    // Prefer the harness-started backend on the default port. Set
    // `LIVE_BACKEND_URL` / `backendUrl` to use an external backend (e.g.
    // http://127.0.0.1:18766) when debugging against a long-lived dev server.
    harness = await createLiveReduxStreamHarness();
    await harness.connect();
    await harness.selectSource("mock-apt");
  });

  afterAll(() => {
    harness?.close();
  });

  test.each([
    { fftSize: 2048, frameRate: 60 },
    { fftSize: 8192, frameRate: 60 },
  ])(
    "returns the mocked hardware response for FFT size $fftSize inside one frame interval",
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
        JSON.stringify({ fftSize, frameBudgetMs, latencies, worstCaseMs }),
      );
      expect(worstCaseMs).toBeLessThan(frameBudgetMs);
    },
  );
});
