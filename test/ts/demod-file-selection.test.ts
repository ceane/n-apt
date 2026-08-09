import { getDemodFileSelectionActions } from "@n-apt/demodulation/sidebar/DemodulateSidebar";

describe("demod file selection", () => {
  it("enters file mode before starting playback processing", () => {
    const files = [{ id: "file-1", name: "capture.napt" }];

    expect(getDemodFileSelectionActions(files)).toEqual([
      { type: "SET_SOURCE_MODE", mode: "file" },
      { type: "SET_SELECTED_FILES", files },
      { type: "TRIGGER_STITCH" },
    ]);
  });
});
