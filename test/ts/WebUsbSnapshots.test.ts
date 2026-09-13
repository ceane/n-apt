import {
  buildWebUsbSnapshotStatsLines,
  getWebUsbSnapshotFilename,
  getWebUsbSnapshotOutputHeight,
  getWebUsbSnapshotStatsLayout,
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

  it("uses the app timezone label and matching snapshot filename stamp", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-01T17:00:00.000Z"));
    try {
      expect(buildWebUsbSnapshotStatsLines(data)[1]).toBe(
        "2026-09-01 10:00:00 America/Los_Angeles",
      );
      expect(getWebUsbSnapshotFilename("png")).toBe(
        "webusb-spectrum-2026-09-01T17-00-00.png",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("stacks long timezone stats instead of allowing the columns to collide", () => {
    const lines = buildWebUsbSnapshotStatsLines(
      {
        ...data,
        geolocation: { lat: "37.335620", lon: "-121.885758" },
        locationLabel: "Downtown Historic District, San Jose, California, United States",
      },
      "2026-09-01 15:57:08 America/Los_Angeles",
    );

    const narrowLayout = getWebUsbSnapshotStatsLayout(lines, 800);
    expect(narrowLayout.stacked).toBe(true);
    expect(narrowLayout.fontSize).toBe(14);
    expect(narrowLayout.locationLines.length).toBeGreaterThan(1);
    expect(narrowLayout.locationLineYOffsets[1] - narrowLayout.locationLineYOffsets[0])
      .toBeLessThan(30);
    const wrappedColumnsLayout = getWebUsbSnapshotStatsLayout(lines, 900);
    expect(wrappedColumnsLayout.stacked).toBe(false);
    expect(wrappedColumnsLayout.locationStartYOffset)
      .toBeGreaterThan(wrappedColumnsLayout.columnRowCount * 30);
    expect(getWebUsbSnapshotStatsLayout(lines, 1600).stacked).toBe(false);
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

  it("adds the reverse-geocoded place to the coordinate line", () => {
    expect(
      buildWebUsbSnapshotStatsLines({
        ...data,
        geolocation: { lat: "37.774900", lon: "-122.419400" },
        locationLabel: "Mission District, San Francisco, California, United States",
      }),
    ).toContain(
      "Location: 37.774900, -122.419400 – Mission District, San Francisco, California, United States",
    );
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
