import { CoordinateMapper } from "../../src/ts/utils/rendering/CoordinateMapper";
import { SnapshotRenderer } from "../../src/ts/utils/rendering/SnapshotRenderer";

describe("SnapshotRenderer", () => {
  it("rounds dB axis labels to whole numbers", () => {
    const renderer = new SnapshotRenderer(
      new CoordinateMapper(
        { x: 0, y: 0, width: 100, height: 50 },
        { min: 100, max: 200 },
        { min: -120, max: 0 },
        1,
      ),
      {
        bg: "#000",
        grid: "#111",
        line: "#222",
        shadow: "#333",
        text: "#fff",
        hwLine: "#444",
        hwText: "#555",
        cfText: "#666",
      },
    );

    const fillText = jest.fn();
    const mockContext = {
      setStroke: jest.fn(),
      setFill: jest.fn(),
      setFont: jest.fn(),
      setScaledFont: jest.fn(),
      setTextAlign: jest.fn(),
      setTextBaseline: jest.fn(),
      setLineJoin: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      closePath: jest.fn(),
      fillRect: jest.fn(),
      roundRect: jest.fn(),
      fillText,
      measureTextWidth: jest.fn(() => 10),
      save: jest.fn(),
      restore: jest.fn(),
      clipRect: jest.fn(),
    } as any;

    renderer.drawDbMarkers(mockContext, [-120, -89.6, -10.4, 0], "dB");

    expect(fillText).toHaveBeenCalledWith(
      "-120dB",
      expect.any(Number),
      expect.any(Number),
    );
    expect(fillText).toHaveBeenCalledWith(
      "-90",
      expect.any(Number),
      expect.any(Number),
    );
    expect(fillText).toHaveBeenCalledWith(
      "-10",
      expect.any(Number),
      expect.any(Number),
    );
    expect(fillText).toHaveBeenCalledWith(
      "0",
      expect.any(Number),
      expect.any(Number),
    );
    expect(
      fillText.mock.calls.every(
        ([text]) => typeof text === "string" && !text.includes("."),
      ),
    ).toBe(true);
  });

  it("offers a two-column stats layout when space is tight", () => {
    const renderer = new SnapshotRenderer(
      new CoordinateMapper(
        { x: 0, y: 0, width: 180, height: 120 },
        { min: 100, max: 200 },
        { min: -120, max: 0 },
        1,
      ),
      {
        bg: "#000",
        grid: "#111",
        line: "#222",
        shadow: "#333",
        text: "#fff",
        hwLine: "#444",
        hwText: "#555",
        cfText: "#666",
      },
    );

    const layouts = (renderer as any).buildStatsLayouts(
      [
        { line: "Frequency: 4.38MHz – 4.39MHz", fontSize: 12, width: 140 },
        { line: "Time: 2026-05-18", fontSize: 12, width: 100 },
        { line: "Device Name: Mock APT SDR", fontSize: 12, width: 135 },
        { line: "Onscreen", fontSize: 12, width: 60 },
        { line: "FFT size (# of points): 2048", fontSize: 12, width: 150 },
        { line: "Gain: 49.6dB | PPM: 1", fontSize: 12, width: 120 },
      ],
      12,
      10,
      18,
      180,
    );

    expect(layouts[0].columns).toBeDefined();
    expect(layouts[0].boxH).toBeLessThan(layouts[1].boxH);
  });

  it("prefers the single-column stats box when both layouts fit cleanly", () => {
    const renderer = new SnapshotRenderer(
      new CoordinateMapper(
        { x: 0, y: 0, width: 240, height: 180 },
        { min: 100, max: 200 },
        { min: -120, max: 0 },
        1,
      ),
      {
        bg: "#000",
        grid: "#111",
        line: "#222",
        shadow: "#333",
        text: "#fff",
        hwLine: "#444",
        hwText: "#555",
        cfText: "#666",
      },
    );

    const roundRect = jest.fn();
    const mockContext = {
      setStroke: jest.fn(),
      setFill: jest.fn(),
      setFont: jest.fn(),
      setScaledFont: jest.fn(),
      setTextAlign: jest.fn(),
      setTextBaseline: jest.fn(),
      setLineJoin: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      fill: jest.fn(),
      closePath: jest.fn(),
      fillRect: jest.fn(),
      roundRect,
      fillText: jest.fn(),
      measureTextWidth: jest.fn((text: string) => text.length * 6),
      save: jest.fn(),
      restore: jest.fn(),
      clipRect: jest.fn(),
    } as any;

    const anyRenderer = renderer as any;
    anyRenderer.buildStatsLayouts = jest.fn(() => [
      {
        kind: "double",
        boxW: 180,
        boxH: 48,
        columns: {
          splitIndex: 3,
          columnGap: 18,
          leftWidth: 80,
          rightWidth: 80,
        },
      },
      { kind: "single", boxW: 120, boxH: 72 },
    ]);
    anyRenderer.generateCandidatePositions = jest.fn(() => [{ x: 12, y: 12 }]);
    anyRenderer.measureBoxPlacement = jest.fn((_x, _y, bw: number) =>
      bw === 120
        ? { score: 10, overlapRatio: 0, safe: true }
        : { score: 1000, overlapRatio: 0, safe: true },
    );

    renderer.drawStatsBox(
      mockContext,
      [
        "Frequency: 4.38MHz - 4.39MHz",
        "Time: 2026-05-18",
        "Device Name: Mock APT SDR",
        "Onscreen",
        "FFT size (# of points): 2048",
        "Gain: 49.6dB | PPM: 1",
      ],
      new Float32Array([0, 0, 0, 0]),
      1,
    );

    expect(roundRect).toHaveBeenCalledWith(12, 12, 120, 72, 4);
  });
});
