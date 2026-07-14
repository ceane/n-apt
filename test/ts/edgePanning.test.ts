import {
  computeBandPannedWithinTrack,
  computeBandPannedWithOverflow,
  computeEdgeResizedBand,
  getBandDragMode,
  getPointerOffsetWithinBandHz,
} from "../../src/ts/utils/edgePanning";

describe("getBandDragMode", () => {
  it("treats the middle of a selection as a whole-band drag", () => {
    expect(
      getBandDragMode({
        pointerHz: 150,
        startHz: 120,
        endHz: 180,
        hzPerPixel: 1,
      }),
    ).toBe("move");
  });

  it("returns null outside the selection and its handles", () => {
    expect(
      getBandDragMode({
        pointerHz: 100,
        startHz: 120,
        endHz: 180,
        hzPerPixel: 1,
      }),
    ).toBeNull();
  });

  it("chooses the nearest edge when both handles overlap", () => {
    expect(
      getBandDragMode({
        pointerHz: 124,
        startHz: 120,
        endHz: 125,
        hzPerPixel: 1,
      }),
    ).toBe("resize-right");
  });
});

// ───── Edge resize ─────

describe("computeEdgeResizedBand", () => {
  it("resizes from the left edge without moving the right edge", () => {
    const result = computeEdgeResizedBand({
      visibleMinHz: 100,
      visibleMaxHz: 200,
      startHz: 120,
      endHz: 160,
      pointerHz: 80,
      activeHandle: "left",
    });

    expect(result).toEqual({
      startHz: 100,
      endHz: 160,
      centerHz: 130,
      sampleRateHz: 60,
    });
  });

  it("resizes from the right edge without moving the left edge", () => {
    const result = computeEdgeResizedBand({
      visibleMinHz: 100,
      visibleMaxHz: 200,
      startHz: 120,
      endHz: 160,
      pointerHz: 220,
      activeHandle: "right",
    });

    expect(result).toEqual({
      startHz: 120,
      endHz: 200,
      centerHz: 160,
      sampleRateHz: 80,
    });
  });
});

// ───── Band panning within track (no overflow) ─────

describe("computeBandPannedWithinTrack", () => {
  it("moves the whole band while preserving pointer offset", () => {
    const result = computeBandPannedWithinTrack({
      visibleMinHz: 100,
      visibleMaxHz: 200,
      startHz: 120,
      endHz: 160,
      pointerHz: 175,
      pointerOffsetHz: 20,
    });

    expect(result).toEqual({
      startHz: 155,
      endHz: 195,
      centerHz: 175,
      sampleRateHz: 40,
    });
  });

  it("clamps whole-band movement at the track edge", () => {
    const result = computeBandPannedWithinTrack({
      visibleMinHz: 100,
      visibleMaxHz: 200,
      startHz: 120,
      endHz: 160,
      pointerHz: 195,
      pointerOffsetHz: 20,
    });

    expect(result).toEqual({
      startHz: 160,
      endHz: 200,
      centerHz: 180,
      sampleRateHz: 40,
    });
  });
});

// ───── Band panning with overflow detection ─────

describe("computeBandPannedWithOverflow", () => {
  // Realistic scenario: visible 88–108 MHz, band is 2.4 MHz wide.
  const VISIBLE_MIN = 88_000_000;
  const VISIBLE_MAX = 108_000_000;
  const BANDWIDTH = 2_400_000;

  /** Simulate a pointerdown at a given band position, then a pointer
   *  move to `nextPointerHz`. Returns the overflow-aware result. */
  const simulateDrag = (
    bandCenterHz: number,
    grabRelativeToStart: number,
    nextPointerHz: number,
  ) => {
    const startHz = bandCenterHz - BANDWIDTH / 2;
    const endHz = bandCenterHz + BANDWIDTH / 2;
    // pointerOffsetHz = pointer - bandStart (at grab time)
    const pointerOffsetHz = grabRelativeToStart;
    return computeBandPannedWithOverflow({
      visibleMinHz: VISIBLE_MIN,
      visibleMaxHz: VISIBLE_MAX,
      startHz,
      endHz,
      pointerHz: nextPointerHz,
      pointerOffsetHz,
    });
  };

  it("band slides freely across the full visible range (no overflow)", () => {
    // Band at center (98 MHz), grab at center of band
    // (pointerOffset = half bandwidth = 1.2 MHz from start).
    // Drag pointer to 92 MHz — band center should go to ~92 MHz.
    const grabOffset = BANDWIDTH / 2; // 1.2 MHz from band start
    const result = simulateDrag(98_000_000, grabOffset, 92_000_000);

    // requestedStart = 92M - 1.2M = 90.8M → within [88M, 105.6M]
    expect(result.overflowHz).toBe(0);
    expect(result.startHz).toBe(90_800_000);
    expect(result.endHz).toBe(93_200_000);
    expect(result.centerHz).toBe(92_000_000);
    expect(result.sampleRateHz).toBe(BANDWIDTH);
  });

  it("band slides to the LEFT edge of the visible range", () => {
    // Band at center (98 MHz), grab at band center.
    // Drag pointer to 89.2 MHz → bandStart = 89.2 - 1.2 = 88M (exact left edge).
    const grabOffset = BANDWIDTH / 2;
    const result = simulateDrag(98_000_000, grabOffset, 89_200_000);

    expect(result.overflowHz).toBe(0);
    expect(result.startHz).toBe(VISIBLE_MIN); // 88 MHz
    expect(result.endHz).toBe(VISIBLE_MIN + BANDWIDTH); // 90.4 MHz
    expect(result.sampleRateHz).toBe(BANDWIDTH);
  });

  it("band slides to the RIGHT edge of the visible range", () => {
    // Drag pointer to 106.8 MHz → bandStart = 106.8 - 1.2 = 105.6 → bandEnd = 108M
    const grabOffset = BANDWIDTH / 2;
    const result = simulateDrag(98_000_000, grabOffset, 106_800_000);

    expect(result.overflowHz).toBe(0);
    expect(result.startHz).toBe(VISIBLE_MAX - BANDWIDTH); // 105.6 MHz
    expect(result.endHz).toBe(VISIBLE_MAX); // 108 MHz
    expect(result.sampleRateHz).toBe(BANDWIDTH);
  });

  it("reports negative overflow when band is pushed past the LEFT edge", () => {
    // Drag pointer far left: 85 MHz → requestedStart = 85 - 1.2 = 83.8
    // overflow = 83.8 - 88 = -4.2 MHz
    const grabOffset = BANDWIDTH / 2;
    const result = simulateDrag(98_000_000, grabOffset, 85_000_000);

    expect(result.overflowHz).toBe(-4_200_000);
    // Band clamped to left edge
    expect(result.startHz).toBe(VISIBLE_MIN);
    expect(result.endHz).toBe(VISIBLE_MIN + BANDWIDTH);
    expect(result.sampleRateHz).toBe(BANDWIDTH);
  });

  it("reports positive overflow when band is pushed past the RIGHT edge", () => {
    // Drag pointer far right: 112 MHz → requestedStart = 112 - 1.2 = 110.8
    // maxStart = 108 - 2.4 = 105.6 → overflow = 110.8 - 105.6 = 5.2 MHz
    const grabOffset = BANDWIDTH / 2;
    const result = simulateDrag(98_000_000, grabOffset, 112_000_000);

    expect(result.overflowHz).toBe(5_200_000);
    expect(result.startHz).toBe(VISIBLE_MAX - BANDWIDTH);
    expect(result.endHz).toBe(VISIBLE_MAX);
    expect(result.sampleRateHz).toBe(BANDWIDTH);
  });

  it("no overflow when band is NOT at the edge, even if close", () => {
    // Band center at 90 MHz (1 MHz above minimum center), pointer
    // at the same position. Band should stay put, no overflow.
    const grabOffset = BANDWIDTH / 2;
    const result = simulateDrag(90_000_000, grabOffset, 90_000_000);

    expect(result.overflowHz).toBe(0);
    expect(result.centerHz).toBe(90_000_000);
  });

  it("simulates multi-step drag: slide across range then overflow at edge", () => {
    const grabOffset = BANDWIDTH / 2;

    // Step 1: Drag from center (98M) to 95M — free slide, no overflow
    const step1 = simulateDrag(98_000_000, grabOffset, 95_000_000);
    expect(step1.overflowHz).toBe(0);
    expect(step1.centerHz).toBe(95_000_000);

    // Step 2: Continue dragging to 89.2M — at left edge, no overflow yet
    const step2 = computeBandPannedWithOverflow({
      visibleMinHz: VISIBLE_MIN,
      visibleMaxHz: VISIBLE_MAX,
      startHz: step1.startHz,
      endHz: step1.endHz,
      pointerHz: 89_200_000,
      pointerOffsetHz: grabOffset,
    });
    expect(step2.overflowHz).toBe(0);
    expect(step2.startHz).toBe(VISIBLE_MIN);

    // Step 3: Push past edge to 87M — overflow detected
    const step3 = computeBandPannedWithOverflow({
      visibleMinHz: VISIBLE_MIN,
      visibleMaxHz: VISIBLE_MAX,
      startHz: step2.startHz,
      endHz: step2.endHz,
      pointerHz: 87_000_000,
      pointerOffsetHz: grabOffset,
    });
    expect(step3.overflowHz).toBe(-2_200_000); // 85.8M - 88M
    expect(step3.startHz).toBe(VISIBLE_MIN); // clamped
  });

  it("after spectrum pan, band can slide within the NEW visible range", () => {
    // Scenario: edge panning shifted the spectrum left by 5 MHz.
    // New visible range: 83M–103M. Band was at left edge (88M).
    // After pan, 88M is now mid-range. Band should slide freely again.
    const grabOffset = BANDWIDTH / 2;
    const NEW_VISIBLE_MIN = 83_000_000;
    const NEW_VISIBLE_MAX = 103_000_000;

    const result = computeBandPannedWithOverflow({
      visibleMinHz: NEW_VISIBLE_MIN,
      visibleMaxHz: NEW_VISIBLE_MAX,
      startHz: 88_000_000,
      endHz: 88_000_000 + BANDWIDTH,
      pointerHz: 92_000_000,
      pointerOffsetHz: grabOffset,
    });

    expect(result.overflowHz).toBe(0);
    expect(result.centerHz).toBe(92_000_000);
    expect(result.startHz).toBe(90_800_000);
  });

  it("preserves bandwidth through the entire drag cycle", () => {
    const grabOffset = BANDWIDTH / 2;
    // Drag all the way left, past edge, then back to center
    const positions = [
      95_000_000, 92_000_000, 89_200_000, 87_000_000, 89_200_000, 95_000_000,
      100_000_000,
    ];

    let currentStart = 98_000_000 - BANDWIDTH / 2;
    let currentEnd = 98_000_000 + BANDWIDTH / 2;

    for (const pointerHz of positions) {
      const result = computeBandPannedWithOverflow({
        visibleMinHz: VISIBLE_MIN,
        visibleMaxHz: VISIBLE_MAX,
        startHz: currentStart,
        endHz: currentEnd,
        pointerHz,
        pointerOffsetHz: grabOffset,
      });

      expect(result.sampleRateHz).toBe(BANDWIDTH);
      currentStart = result.startHz;
      currentEnd = result.endHz;
    }
  });
});

// ───── getPointerOffsetWithinBandHz ─────

describe("getPointerOffsetWithinBandHz", () => {
  it("returns positive offset when pointer is right of band start", () => {
    expect(getPointerOffsetWithinBandHz(150, 100)).toBe(50);
  });

  it("returns 0 when pointer is at band start", () => {
    expect(getPointerOffsetWithinBandHz(100, 100)).toBe(0);
  });

  it("returns 0 for non-finite input", () => {
    expect(getPointerOffsetWithinBandHz(NaN, 100)).toBe(0);
    expect(getPointerOffsetWithinBandHz(100, NaN)).toBe(0);
  });
});
