import {
  getSourceStorageIdentity,
  getSourceViewStorageKeyForSource,
} from "@n-apt/spectrum/utils/sourcePersistence";

describe("sourcePersistence", () => {
  it("uses backend stream_key before serial number for source-scoped visualizer state", () => {
    const source = {
      id: "rtl-sdr-0",
      serial_number: "DUPLICATE",
      stream_key: "rtl-sdr-0",
    };

    expect(getSourceStorageIdentity(source)).toBe("rtl-sdr-0");
    expect(getSourceViewStorageKeyForSource(source)).toBe(
      "napt-spectrum-view-v1:rtl-sdr-0",
    );
  });
});
