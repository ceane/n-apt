/**
 * Pure-logic unit tests for the Onscreen capture mode resolution
 * and visibleOnscreenRange clamping used in SpectrumSidebar.
 *
 * These tests exercise the exact same algorithms inline (no React rendering)
 * so regressions in the core math are caught instantly.
 */

// ---------- helpers that mirror SpectrumSidebar logic ----------

interface FrequencyRange {
  min: number;
  max: number;
}

interface Frame {
  label: string;
  min_mhz: number;
  max_mhz: number;
}

/**
 * Mirrors SpectrumSidebar.visibleOnscreenRange (safeZoom <= 1 branch)
 */
function computeVisibleOnscreenRange(
  frequencyRange: FrequencyRange,
  activeFrame: Frame | undefined,
  sampleRateMHz: number | null,
  vizZoom: number,
  vizPanOffset: number,
): FrequencyRange {
  const fallbackSpan = frequencyRange.max - frequencyRange.min;
  const hardwareMin = activeFrame?.min_mhz ?? frequencyRange.min;
  const hardwareMax = activeFrame?.max_mhz ?? frequencyRange.max;
  const hardwareSpan =
    typeof sampleRateMHz === "number" && Number.isFinite(sampleRateMHz)
      ? Math.min(sampleRateMHz, Math.max(0, hardwareMax - hardwareMin || fallbackSpan))
      : Math.max(0, hardwareMax - hardwareMin || fallbackSpan);

  const safeZoom = Number.isFinite(vizZoom) && vizZoom > 0 ? vizZoom : 1;
  if (safeZoom <= 1 || hardwareSpan <= 0) {
    const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
    const halfHardware = hardwareSpan / 2;
    return {
      min: Math.max(hardwareMin, hardwareCenter - halfHardware),
      max: Math.min(hardwareMax, hardwareCenter + halfHardware),
    };
  }

  const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
  const visualSpan = Math.min(hardwareSpan, hardwareSpan / safeZoom);
  const halfVisualSpan = visualSpan / 2;
  const boundedCenter = Math.max(
    hardwareMin + halfVisualSpan,
    Math.min(hardwareMax - halfVisualSpan, hardwareCenter + vizPanOffset),
  );

  return {
    min: Math.max(hardwareMin, boundedCenter - halfVisualSpan),
    max: Math.min(hardwareMax, boundedCenter + halfVisualSpan),
  };
}

/**
 * Mirrors SpectrumSidebar.handleCapture effectiveAcquisitionMode logic (FIXED version)
 */
function resolveEffectiveAcquisitionMode(
  activeCaptureAreas: string[],
  visibleOnscreenRange: FrequencyRange | null,
  maxSampleRate: number,
  acquisitionMode: "stepwise" | "interleaved" | "whole_sample",
): string {
  const onscreenIsActive = activeCaptureAreas.includes("Onscreen");
  const onscreenSpan = visibleOnscreenRange
    ? visibleOnscreenRange.max - visibleOnscreenRange.min
    : 0;
  const hardwareSampleRateMHz = maxSampleRate / 1_000_000;
  if (
    onscreenIsActive &&
    hardwareSampleRateMHz > 0 &&
    Math.abs(onscreenSpan - hardwareSampleRateMHz) < 0.01
  ) {
    return "whole_sample";
  }
  return acquisitionMode;
}

// ---------- Tests ----------

describe("visibleOnscreenRange clamping", () => {
  const frameA: Frame = { label: "A", min_mhz: 0.018, max_mhz: 4.37 };

  it("clamps to hardware sample rate when zoom=1", () => {
    const range = computeVisibleOnscreenRange(
      { min: 0.018, max: 3.218 }, // 3.2 MHz span
      frameA,
      3.2, // sampleRateMHz
      1,   // vizZoom
      0,   // vizPanOffset
    );
    const span = range.max - range.min;
    expect(span).toBeCloseTo(3.2, 2);
  });

  it("clamps even when frequencyRange is wider than hardware (bug scenario)", () => {
    // This was the original bug: frequencyRange was 4.0 MHz wide
    const range = computeVisibleOnscreenRange(
      { min: 0.018, max: 4.018 }, // 4.0 MHz span — wider than 3.2
      frameA,
      3.2,
      1,
      0,
    );
    const span = range.max - range.min;
    expect(span).toBeCloseTo(3.2, 2);
  });

  it("clamps when frequencyRange spans the full channel", () => {
    const range = computeVisibleOnscreenRange(
      { min: 0.018, max: 4.37 }, // full channel span 4.352
      frameA,
      3.2,
      1,
      0,
    );
    const span = range.max - range.min;
    expect(span).toBeCloseTo(3.2, 2);
  });

  it("returns narrower span when zoomed in", () => {
    const range = computeVisibleOnscreenRange(
      { min: 0.018, max: 3.218 },
      frameA,
      3.2,
      2, // zoomed in 2x
      0,
    );
    const span = range.max - range.min;
    expect(span).toBeCloseTo(1.6, 2);
  });

  it("falls back to frequencyRange span when sampleRateMHz is null", () => {
    const range = computeVisibleOnscreenRange(
      { min: 1.0, max: 3.0 }, // 2.0 MHz
      frameA,
      null,
      1,
      0,
    );
    const span = range.max - range.min;
    // Without sampleRateMHz, hardwareSpan = hardwareMax - hardwareMin = 4.352
    // but clamped by Math.max(0, ...) so it's 4.352, center=2.0, halfHardware=2.176
    // min = max(0.018, 2.0 - 2.176) = 0.018, max = min(4.37, 2.0 + 2.176) = 4.176
    // Actually hardwareSpan = 4.352, so span = 4.352 from center of frequencyRange
    expect(span).toBeGreaterThan(3.2);
  });

  it("pans within hardware bounds when zoomed in", () => {
    const range = computeVisibleOnscreenRange(
      { min: 0.018, max: 3.218 },
      frameA,
      3.2,
      4, // zoomed 4x
      0.5, // panned right
    );
    const span = range.max - range.min;
    expect(span).toBeCloseTo(0.8, 2);
    expect(range.min).toBeGreaterThanOrEqual(frameA.min_mhz);
    expect(range.max).toBeLessThanOrEqual(frameA.max_mhz);
  });
});

describe("effectiveAcquisitionMode resolution", () => {
  it("returns whole_sample when Onscreen is active and span matches hardware rate", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["Onscreen"],
      { min: 0.018, max: 3.218 }, // 3.2 MHz
      3_200_000,
      "stepwise",
    );
    expect(mode).toBe("whole_sample");
  });

  it("returns whole_sample even when user set interleaved (span matches)", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["Onscreen"],
      { min: 1.0, max: 4.2 }, // 3.2 MHz
      3_200_000,
      "interleaved",
    );
    expect(mode).toBe("whole_sample");
  });

  it("preserves user mode when Onscreen is NOT active", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["A"], // only area A, not Onscreen
      { min: 0.018, max: 3.218 },
      3_200_000,
      "stepwise",
    );
    expect(mode).toBe("stepwise");
  });

  it("preserves user mode when onscreen span does NOT match hardware rate", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["Onscreen"],
      { min: 0.018, max: 2.018 }, // 2.0 MHz — narrower than 3.2
      3_200_000,
      "interleaved",
    );
    expect(mode).toBe("interleaved");
  });

  it("preserves user mode when maxSampleRate is 0 (not yet known)", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["Onscreen"],
      { min: 0.018, max: 3.218 },
      0, // unknown
      "stepwise",
    );
    expect(mode).toBe("stepwise");
  });

  it("returns whole_sample with small floating-point difference", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["Onscreen"],
      { min: 0.018, max: 3.2179999 }, // 3.1999999 — within 0.01 tolerance
      3_200_000,
      "stepwise",
    );
    expect(mode).toBe("whole_sample");
  });

  it("does NOT return whole_sample when span exceeds tolerance", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["Onscreen"],
      { min: 0.0, max: 4.0 }, // 4.0 MHz — far from 3.2
      3_200_000,
      "stepwise",
    );
    expect(mode).toBe("stepwise");
  });

  it("handles null visibleOnscreenRange gracefully", () => {
    const mode = resolveEffectiveAcquisitionMode(
      ["Onscreen"],
      null,
      3_200_000,
      "stepwise",
    );
    expect(mode).toBe("stepwise");
  });
});

describe("captureRange isolation (Bug 2 regression)", () => {
  // Bug 2: captureRange was always mixing in visibleOnscreenRange min/max
  // even when only a channel was selected, causing -382kHz to 4.770MHz.

  it("channel-only capture uses channel bounds, not onscreen bounds", () => {
    const visibleOnscreenRange = { min: 0.594, max: 3.794 }; // hardware-width window
    const availableCaptureAreas = [
      { label: "Onscreen", min: visibleOnscreenRange.min, max: visibleOnscreenRange.max },
      { label: "A", min: 0.018, max: 4.37 },
    ];
    const activeCaptureAreas = ["A"]; // only channel A selected, NOT onscreen

    // Mirrors SpectrumSidebar.captureRange logic (FIXED)
    const segments = availableCaptureAreas.filter((a) =>
      activeCaptureAreas.includes(a.label)
    );
    const mins = segments.map((s) => s.min);
    const maxs = segments.map((s) => s.max);
    const captureRange = {
      min: Math.min(...mins),
      max: Math.max(...maxs),
    };

    // Should be channel A bounds exactly
    expect(captureRange.min).toBeCloseTo(0.018, 3);
    expect(captureRange.max).toBeCloseTo(4.37, 3);
  });

  it("onscreen-only capture uses onscreen bounds", () => {
    const visibleOnscreenRange = { min: 0.594, max: 3.794 };
    const availableCaptureAreas = [
      { label: "Onscreen", min: visibleOnscreenRange.min, max: visibleOnscreenRange.max },
      { label: "A", min: 0.018, max: 4.37 },
    ];
    const activeCaptureAreas = ["Onscreen"];

    const segments = availableCaptureAreas.filter((a) =>
      activeCaptureAreas.includes(a.label)
    );
    const mins = segments.map((s) => s.min);
    const maxs = segments.map((s) => s.max);
    const captureRange = {
      min: Math.min(...mins),
      max: Math.max(...maxs),
    };

    expect(captureRange.min).toBeCloseTo(0.594, 3);
    expect(captureRange.max).toBeCloseTo(3.794, 3);
  });

  it("both selected uses the union of onscreen and channel", () => {
    const visibleOnscreenRange = { min: 0.594, max: 3.794 };
    const availableCaptureAreas = [
      { label: "Onscreen", min: visibleOnscreenRange.min, max: visibleOnscreenRange.max },
      { label: "A", min: 0.018, max: 4.37 },
    ];
    const activeCaptureAreas = ["Onscreen", "A"];

    const segments = availableCaptureAreas.filter((a) =>
      activeCaptureAreas.includes(a.label)
    );
    const mins = segments.map((s) => s.min);
    const maxs = segments.map((s) => s.max);
    const captureRange = {
      min: Math.min(...mins),
      max: Math.max(...maxs),
    };

    expect(captureRange.min).toBeCloseTo(0.018, 3);
    expect(captureRange.max).toBeCloseTo(4.37, 3);
  });
});

describe("UI mode restriction logic (Bug 1)", () => {
  // Bug 1: Onscreen-only should only allow whole_sample.
  // Channel wider than hardware should only allow stepwise/interleaved.

  function resolveAvailableModes(
    activeCaptureAreas: string[],
    captureRangeSpan: number,
    hardwareSampleRateMHz: number,
  ): { isOnscreenExactMatch: boolean; isWiderThanHardware: boolean } {
    const hasOnscreenSelected = activeCaptureAreas.includes("Onscreen");
    const hasChannelSelected = activeCaptureAreas.some((a) => a !== "Onscreen");
    const onscreenOnly = hasOnscreenSelected && !hasChannelSelected;
    const isOnscreenExactMatch = onscreenOnly && hardwareSampleRateMHz > 0 && Math.abs(captureRangeSpan - hardwareSampleRateMHz) < 0.01;
    const isWiderThanHardware = captureRangeSpan > hardwareSampleRateMHz + 0.01;
    return { isOnscreenExactMatch, isWiderThanHardware };
  }

  it("onscreen-only exact match: only whole_sample available", () => {
    const { isOnscreenExactMatch, isWiderThanHardware } = resolveAvailableModes(
      ["Onscreen"], 3.2, 3.2,
    );
    expect(isOnscreenExactMatch).toBe(true);
    expect(isWiderThanHardware).toBe(false);
  });

  it("channel wider than hardware: no whole_sample available", () => {
    const { isOnscreenExactMatch, isWiderThanHardware } = resolveAvailableModes(
      ["A"], 4.352, 3.2,
    );
    expect(isOnscreenExactMatch).toBe(false);
    expect(isWiderThanHardware).toBe(true);
  });

  it("channel+onscreen wider than hardware: no whole_sample, not exact match", () => {
    const { isOnscreenExactMatch, isWiderThanHardware } = resolveAvailableModes(
      ["Onscreen", "A"], 4.352, 3.2,
    );
    expect(isOnscreenExactMatch).toBe(false);
    expect(isWiderThanHardware).toBe(true);
  });

  it("narrow channel: all modes available", () => {
    const { isOnscreenExactMatch, isWiderThanHardware } = resolveAvailableModes(
      ["A"], 2.0, 3.2,
    );
    expect(isOnscreenExactMatch).toBe(false);
    expect(isWiderThanHardware).toBe(false);
  });

  it("forces stepwise when wider than hardware and user had whole_sample", () => {
    const { isWiderThanHardware } = resolveAvailableModes(
      ["A"], 4.352, 3.2,
    );
    expect(isWiderThanHardware).toBe(true);
    // The UI guard would force whole_sample → stepwise
    const acquisitionMode = "whole_sample";
    const effective = isWiderThanHardware && acquisitionMode === "whole_sample"
      ? "stepwise"
      : acquisitionMode;
    expect(effective).toBe("stepwise");
  });

  it("preserves interleaved when wider than hardware", () => {
    const { isWiderThanHardware } = resolveAvailableModes(
      ["A"], 4.352, 3.2,
    );
    expect(isWiderThanHardware).toBe(true);
    const acquisitionMode: string = "interleaved";
    const effective = isWiderThanHardware && acquisitionMode === "whole_sample"
      ? "stepwise"
      : acquisitionMode;
    expect(effective).toBe("interleaved");
  });
});

describe("frequency_range metadata override (Bug: -382kHz to 4.77MHz)", () => {
  // The backend expands each hop to full hardware bandwidth for tuning.
  // Channel A (0.018 to 4.37 MHz) with 3.2 MHz hardware and 0.75 usable fraction
  // produces hops that span -0.382 to 4.77 MHz.
  // The frequency_range metadata field stores the REQUESTED bounds.

  it("hop expansion produces wider range than requested", () => {
    // Mirrors websocket_server.rs hop computation
    const hwBwMhz = 3.2;
    const usableBwFraction = 0.75;
    const usableBwMhz = hwBwMhz * usableBwFraction; // 2.4
    const minFreq = 0.018;
    const maxFreq = 4.37;
    const span = maxFreq - minFreq; // 4.352

    const numHops = Math.ceil(span / usableBwMhz); // ceil(1.813) = 2
    const firstCenter = minFreq + usableBwMhz / 2; // 1.218
    const lastCenter = maxFreq - usableBwMhz / 2;  // 3.17

    const hop0Start = firstCenter - hwBwMhz / 2; // -0.382
    const hop1End = lastCenter + hwBwMhz / 2;     // 4.77

    expect(numHops).toBe(2);
    expect(hop0Start).toBeCloseTo(-0.382, 3);
    expect(hop1End).toBeCloseTo(4.77, 3);

    // This proves hops extend beyond requested range
    expect(hop0Start).toBeLessThan(minFreq);
    expect(hop1End).toBeGreaterThan(maxFreq);
  });

  it("frequency_range metadata restores correct bounds after stitching", () => {
    // Simulates fileWorker.ts metadata override logic
    const metadata: any = {
      center_frequency_hz: 2194000, // from overall requested
      capture_sample_rate_hz: 4352000,
      frequency_range: [0.018, 4.37], // [min_mhz, max_mhz]
    };

    // Stitched channel has expanded hop bounds
    const stitchedChannel = {
      center_freq_hz: 2194000, // from hops
      sample_rate_hz: 5152000, // hop0 start to hop1 end = -382kHz to 4.77MHz = 5.152 MHz
    };

    // WITHOUT frequency_range, metadata would use hop bounds (the bug).
    // WITH frequency_range, metadata uses requested bounds (the fix).
    const freqRange = metadata.frequency_range;
    if (freqRange && freqRange.length === 2) {
      const rangeMinHz = freqRange[0] * 1_000_000;
      const rangeMaxHz = freqRange[1] * 1_000_000;
      const spanHz = rangeMaxHz - rangeMinHz;
      metadata.center_frequency_hz = rangeMinHz + spanHz / 2;
      metadata.capture_sample_rate_hz = spanHz;
      metadata.sample_rate_hz = spanHz;
    }

    // Fixed values should match requested range
    expect(metadata.center_frequency_hz).toBeCloseTo(2194000, -2);
    expect(metadata.capture_sample_rate_hz).toBeCloseTo(4352000, -2);
    expect(metadata.sample_rate_hz).toBeCloseTo(4352000, -2);
  });

  it("falls back to stitched bounds when frequency_range is absent (legacy files)", () => {
    const metadata: any = {
      center_frequency_hz: 2194000,
      capture_sample_rate_hz: 4352000,
      // no frequency_range — legacy file
    };

    const stitchedChannel = {
      center_freq_hz: 2194000,
      sample_rate_hz: 5152000,
    };

    const freqRange = metadata.frequency_range;
    if (freqRange && freqRange.length === 2) {
      // would override
    } else {
      metadata.center_frequency_hz = stitchedChannel.center_freq_hz;
      metadata.capture_sample_rate_hz = stitchedChannel.sample_rate_hz;
      metadata.sample_rate_hz = stitchedChannel.sample_rate_hz;
    }

    // Fallback: uses stitched bounds (wider)
    expect(metadata.sample_rate_hz).toBe(5152000);
  });

  it("Channel B: verifies requested vs hop bounds", () => {
    // Channel B: 24.72 to 29.88 MHz, span = 5.16 MHz
    const hwBwMhz = 3.2;
    const usableBwMhz = hwBwMhz * 0.75; // 2.4
    const minFreq = 24.72;
    const maxFreq = 29.88;
    const span = maxFreq - minFreq; // 5.16

    const numHops = Math.ceil(span / usableBwMhz); // ceil(2.15) = 3
    const firstCenter = minFreq + usableBwMhz / 2; // 25.92
    const lastCenter = maxFreq - usableBwMhz / 2;  // 28.68
    const hop0Start = firstCenter - hwBwMhz / 2; // 24.32
    const hopLastEnd = lastCenter + hwBwMhz / 2;  // 30.28

    expect(hop0Start).toBeCloseTo(24.32, 2);
    expect(hopLastEnd).toBeCloseTo(30.28, 2);

    // Proves hops extend beyond requested
    expect(hop0Start).toBeLessThan(minFreq);
    expect(hopLastEnd).toBeGreaterThan(maxFreq);

    // frequency_range would restore [24.72, 29.88]
    const freqRange = [minFreq, maxFreq];
    const rangeMinHz = freqRange[0] * 1_000_000;
    const rangeMaxHz = freqRange[1] * 1_000_000;
    const fixedSpanHz = rangeMaxHz - rangeMinHz;
    expect(fixedSpanHz).toBeCloseTo(5_160_000, -2);
  });

  it("playback initialization should prefer metadata frequency_range over channel hop bounds", () => {
    const firstFileMeta = {
      frequency_range: [0.018, 4.37] as [number, number],
    };
    const channels = [
      {
        center_freq_hz: 2.194e6,
        sample_rate_hz: 5.152e6,
      },
    ];

    let range: { min: number; max: number } | null = null;
    const requestedRange = firstFileMeta.frequency_range;
    if (
      Array.isArray(requestedRange) &&
      requestedRange.length === 2 &&
      Number.isFinite(requestedRange[0]) &&
      Number.isFinite(requestedRange[1])
    ) {
      range = { min: requestedRange[0], max: requestedRange[1] };
    } else if (channels.length > 0) {
      const ch = channels[0];
      const span = (ch.sample_rate_hz || 3200000) / 1_000_000;
      const center = (ch.center_freq_hz || 0) / 1_000_000;
      range = { min: center - span / 2, max: center + span / 2 };
    }

    expect(range).toEqual({ min: 0.018, max: 4.37 });
  });

  it("multi-channel playback initialization should prefer first channel frequency_range over file-wide frequency_range", () => {
    const firstFileMeta = {
      frequency_range: [0.018, 29.88] as [number, number],
    };
    const channels = [
      {
        center_freq_hz: 2.194e6,
        sample_rate_hz: 5.152e6,
        frequency_range: [0.018, 4.37] as [number, number],
      },
      {
        center_freq_hz: 27.3e6,
        sample_rate_hz: 5.96e6,
        frequency_range: [24.72, 29.88] as [number, number],
      },
    ];

    let range: { min: number; max: number } | null = null;
    const firstChannel = channels.length > 0 ? channels[0] : null;
    const firstChannelRange =
      Array.isArray(firstChannel?.frequency_range) &&
      firstChannel.frequency_range.length === 2 &&
      Number.isFinite(firstChannel.frequency_range[0]) &&
      Number.isFinite(firstChannel.frequency_range[1])
        ? firstChannel.frequency_range
        : null;
    const requestedRange = firstFileMeta.frequency_range;

    if (firstChannelRange) {
      range = { min: firstChannelRange[0], max: firstChannelRange[1] };
    } else if (
      Array.isArray(requestedRange) &&
      requestedRange.length === 2 &&
      Number.isFinite(requestedRange[0]) &&
      Number.isFinite(requestedRange[1])
    ) {
      range = { min: requestedRange[0], max: requestedRange[1] };
    }

    expect(range).toEqual({ min: 0.018, max: 4.37 });
  });

  it("channel switch should prefer channel frequency_range over channel hop bounds", () => {
    const ch = {
      center_freq_hz: 2.194e6,
      sample_rate_hz: 5.152e6,
      frequency_range: [24.72, 29.88],
    };

    let range: { min: number; max: number } | null = null;
    if (
      Array.isArray(ch.frequency_range) &&
      ch.frequency_range.length === 2 &&
      Number.isFinite(ch.frequency_range[0]) &&
      Number.isFinite(ch.frequency_range[1])
    ) {
      range = {
        min: ch.frequency_range[0],
        max: ch.frequency_range[1],
      };
    } else {
      const span = (ch.sample_rate_hz || 3200000) / 1_000_000;
      const center = (ch.center_freq_hz || 0) / 1_000_000;
      range = { min: center - span / 2, max: center + span / 2 };
    }

    expect(range).toEqual({ min: 24.72, max: 29.88 });
  });

  it("channel switch metadata should use channel frequency_range for center and capture rate", () => {
    const ch = {
      center_freq_hz: 27.3e6,
      sample_rate_hz: 5.96e6,
      frame_rate: 12,
      hardware_sample_rate_hz: 3.2e6,
      frequency_range: [24.72, 29.88] as [number, number],
    };

    const freqRange =
      Array.isArray(ch.frequency_range) &&
      ch.frequency_range.length === 2 &&
      Number.isFinite(ch.frequency_range[0]) &&
      Number.isFinite(ch.frequency_range[1])
        ? ch.frequency_range
        : undefined;
    const derivedCenterHz = freqRange
      ? ((freqRange[0] + freqRange[1]) / 2) * 1_000_000
      : ch.center_freq_hz;
    const derivedCaptureRateHz = freqRange
      ? (freqRange[1] - freqRange[0]) * 1_000_000
      : ch.sample_rate_hz;

    expect(derivedCenterHz).toBeCloseTo(27_300_000, -2);
    expect(derivedCaptureRateHz).toBeCloseTo(5_160_000, -2);
    expect(ch.frame_rate).toBe(12);
  });

  it("initial active playback metadata should use first channel frequency_range for center and capture rate", () => {
    const ch = {
      center_freq_hz: 2.194e6,
      sample_rate_hz: 5.152e6,
      frame_rate: 8,
      hardware_sample_rate_hz: 3.2e6,
      frequency_range: [0.018, 4.37] as [number, number],
    };

    const activeRange =
      Array.isArray(ch.frequency_range) &&
      ch.frequency_range.length === 2 &&
      Number.isFinite(ch.frequency_range[0]) &&
      Number.isFinite(ch.frequency_range[1])
        ? ch.frequency_range
        : undefined;

    const metadata = {
      center_frequency_hz: activeRange
        ? ((activeRange[0] + activeRange[1]) / 2) * 1_000_000
        : ch.center_freq_hz,
      capture_sample_rate_hz: activeRange
        ? (activeRange[1] - activeRange[0]) * 1_000_000
        : ch.sample_rate_hz,
      frame_rate: ch.frame_rate,
    };

    expect(metadata.center_frequency_hz).toBeCloseTo(2_194_000, -2);
    expect(metadata.capture_sample_rate_hz).toBeCloseTo(4_352_000, -2);
    expect(metadata.frame_rate).toBe(8);
  });
});

describe("activeFragments label stripping regression", () => {
  // This tests the exact bug that was found: activeFragments.map strips label,
  // so any downstream check on fragment.label would fail.
  it("mapped fragments lose label property", () => {
    const areas = [
      { label: "Onscreen", min: 0.018, max: 3.218 },
      { label: "A", min: 0.018, max: 4.37 },
    ];
    const activeCaptureAreas = ["Onscreen"];

    // This is the exact code from SpectrumSidebar
    const activeFragments = areas
      .filter((a) => activeCaptureAreas.includes(a.label))
      .map((a) => ({ minFreq: a.min, maxFreq: a.max }));

    // The OLD buggy code would do:
    const buggyCheck = activeFragments.find(
      (fragment: any) => fragment.label === "Onscreen",
    );
    expect(buggyCheck).toBeUndefined(); // proves the bug existed

    // The FIXED code uses activeCaptureAreas.includes directly
    const fixedCheck = activeCaptureAreas.includes("Onscreen");
    expect(fixedCheck).toBe(true);
  });
});
