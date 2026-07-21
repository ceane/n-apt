import {
  selectSelectedFiles,
  selectWebSocketSources,
} from "../../src/ts/redux/selectors/performanceSelectors";

describe("demod selectors", () => {
  it("returns a stable empty source list when sources are unavailable", () => {
    const state = { websocket: {} } as any;

    expect(selectWebSocketSources(state)).toBe(selectWebSocketSources(state));
  });

  it("returns a stable empty file list when selected files are unavailable", () => {
    const state = { waterfall: {} } as any;

    expect(selectSelectedFiles(state)).toBe(selectSelectedFiles(state));
  });
});
