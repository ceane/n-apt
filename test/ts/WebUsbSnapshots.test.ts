import {
  buildWebUsbSnapshotStatsLines,
  getWebUsbSnapshotFilename,
  getWebUsbSnapshotOutputHeight,
  getNextWebUsbSnapshotMode,
  WEBUSB_SNAPSHOT_MODES,
  renderWebUsbSnapshot,
} from "@n-apt/webusb/webUsbSnapshots";

describe("standalone WebUSB snapshots", () => {
  const data = {
    waveform: new Float32Array([-90, -70, -35, -72]),
    centerFrequencyHz: 100_300_000,
    sampleRateHz: 3_200_000,
    fftSize: 32_768,
    gainDb: 49.6,
    ppm: 1,
    deviceName: "RTLSDRBlog Blog V4",
  };

  it("copies fast-snapshot stats for the current WebUSB frame", () => {
    expect(buildWebUsbSnapshotStatsLines(data, "2026-09-01 10:00:00 PDT")).toEqual([
      "98.7MHz – 101.9MHz",
      "2026-09-01 10:00:00 PDT",
      "Device Name: RTLSDRBlog Blog V4",
      "Onscreen",
      "FFT size (# of points): 32768",
      "Gain: 49.6dB | PPM: 1",
    ]);
  });

  it("adds the location line for the stats-plus-geolocation mode", () => {
    expect(
      buildWebUsbSnapshotStatsLines(
        {
          ...data,
          geolocation: { lat: "37.774900", lon: "-122.419400" },
        },
        "2026-09-01 10:00:00 PDT",
      ),
    ).toContain("Location: 37.774900, -122.419400");
  });

  it("renders a vector SVG and includes stats only when requested", () => {
    const withoutStats = renderWebUsbSnapshot(data, {
      format: "svg",
      width: 800,
      height: 400,
      showStats: false,
      timestampLabel: "2026-09-01 10:00:00 PDT",
    });
    const withStats = renderWebUsbSnapshot(data, {
      format: "svg",
      width: 800,
      height: 400,
      showStats: true,
      timestampLabel: "2026-09-01 10:00:00 PDT",
    });

    expect(typeof withoutStats).toBe("string");
    expect(withoutStats).toContain("<svg");
    expect(withoutStats).not.toContain("Device Name:");
    expect(withStats).toContain("Device Name: RTLSDRBlog Blog V4");
    expect(withStats).toContain("Gain: 49.6dB | PPM: 1");
  });

  it("uses the app stats-row heights for normal and location metadata", () => {
    expect(getWebUsbSnapshotOutputHeight(400, true)).toBe(515);
    expect(
      getWebUsbSnapshotOutputHeight(400, true, true),
    ).toBe(551);
  });

  it("adds a stats row to PNG snapshots when enabled", () => {
    const withoutStats = renderWebUsbSnapshot(data, {
      format: "png",
      width: 800,
      height: 400,
      showStats: false,
      timestampLabel: "2026-09-01 10:00:00 PDT",
    });
    const withStats = renderWebUsbSnapshot(data, {
      format: "png",
      width: 800,
      height: 400,
      showStats: true,
      timestampLabel: "2026-09-01 10:00:00 PDT",
    });

    expect(withStats).toBeInstanceOf(HTMLCanvasElement);
    expect(getWebUsbSnapshotOutputHeight(400, false)).toBe(400);
  });

  it("uses the selected image format in the downloaded filename", () => {
    expect(getWebUsbSnapshotFilename("png", "2026-09-01T10-00-00")).toBe(
      "webusb-spectrum-2026-09-01T10-00-00.png",
    );
    expect(getWebUsbSnapshotFilename("svg", "2026-09-01T10-00-00")).toBe(
      "webusb-spectrum-2026-09-01T10-00-00.svg",
    );
  });

  it("exposes the fast-snapshot mode order without changing image width", () => {
    expect(WEBUSB_SNAPSHOT_MODES).toEqual([
      { id: "image", label: "Image (2x wider)", format: "png" },
      { id: "svg", label: "SVG", format: "svg" },
      { id: "video", label: "Video", format: "png" },
    ]);
  });

  it("keeps stats toggle usable after geolocation is denied", () => {
    expect(getNextWebUsbSnapshotMode(1, true)).toBe(0);
    expect(getNextWebUsbSnapshotMode(0, true)).toBe(1);
    expect(getNextWebUsbSnapshotMode(1, false)).toBe(2);
  });
});
