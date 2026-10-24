import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  shouldAdvanceSpectrumSpikeHistory,
  shouldAcceptSpectrumSpikeAnalysisResult,
  shouldResetSpectrumSpikeHistory,
  shouldRunSpectrumSpikeAnalysis,
} from "@n-apt/spectrum/fft/frameProcessing";

describe("spectrum spike analysis scheduling", () => {
  test("does not rerun classifier analysis for viewport-only paints", () => {
    expect(
      shouldRunSpectrumSpikeAnalysis({
        enabled: true,
        hasNewData: false,
        shouldReprocessCurrentFrame: false,
      }),
    ).toBe(false);
  });

  test("does not classify the resident waveform as a new frame while its replacement FFT is pending", () => {
    expect(
      shouldRunSpectrumSpikeAnalysis({
        enabled: true,
        hasNewData: true,
        shouldReprocessCurrentFrame: true,
        workerPending: true,
      }),
    ).toBe(false);
    expect(
      shouldAdvanceSpectrumSpikeHistory({
        hasNewData: true,
        isFresh: true,
        workerPending: true,
      }),
    ).toBe(false);
  });

  test("reanalyzes a changed spectrum without advancing temporal history", () => {
    expect(
      shouldRunSpectrumSpikeAnalysis({
        enabled: true,
        hasNewData: false,
        shouldReprocessCurrentFrame: true,
      }),
    ).toBe(true);
    expect(
      shouldAdvanceSpectrumSpikeHistory({
        hasNewData: false,
        isFresh: true,
      }),
    ).toBe(false);
  });

  test("advances temporal history only for fresh new frames", () => {
    expect(
      shouldAdvanceSpectrumSpikeHistory({
        hasNewData: true,
        isFresh: true,
      }),
    ).toBe(true);
    expect(
      shouldAdvanceSpectrumSpikeHistory({
        hasNewData: true,
        isFresh: false,
      }),
    ).toBe(false);
  });

  test("keeps temporal history across viewport pans but resets on source scope or acquisition axis changes", () => {
    const sourceRange = { min: 0, max: 3_200_000 };
    expect(
      shouldResetSpectrumSpikeHistory({
        previousScope: "mock-apt:1:4:4096:hann",
        nextScope: "mock-apt:1:4:4096:hann",
        previousRange: sourceRange,
        nextRange: sourceRange,
      }),
    ).toBe(false);
    expect(
      shouldResetSpectrumSpikeHistory({
        previousScope: "mock-apt:1:4:4096:hann",
        nextScope: "rtl-sdr:2:4:4096:hann",
        previousRange: sourceRange,
        nextRange: sourceRange,
      }),
    ).toBe(true);
    expect(
      shouldResetSpectrumSpikeHistory({
        previousScope: "mock-apt:1:4:4096:hann",
        nextScope: "mock-apt:1:4:4096:hann",
        previousRange: sourceRange,
        nextRange: { min: 0, max: 6_400_000 },
      }),
    ).toBe(true);
  });

  test("rejects classifier readbacks that complete after a source switch", () => {
    expect(
      shouldAcceptSpectrumSpikeAnalysisResult("mock-apt:1", "rtl-sdr:2"),
    ).toBe(false);
    expect(
      shouldAcceptSpectrumSpikeAnalysisResult("mock-apt:1", "mock-apt:1"),
    ).toBe(true);
  });

  test("projects retained spike markers from the acquisition axis into the active viewport", () => {
    const shader = readFileSync(
      join(process.cwd(), "src/ts/shaders/spike_render.wgsl"),
      "utf8",
    );
    expect(shader).toContain("let source_frequency = mix(uniforms[4].x, uniforms[4].y, t);");
    expect(shader).toContain("let display_t = (frequency - view_min) / view_span;");
    expect(shader).toContain("frequency < view_min || frequency > view_max");
    expect(shader).toContain("let mirror_side = instance_index % 2u;");
  });
});
