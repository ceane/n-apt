import { selectTxHopChannels } from "@n-apt/redux/selectors/spectrumSelectors";

describe("selectTxHopChannels", () => {
  it("returns a stable empty result when hop channels are missing", () => {
    const state = { spectrum: { txHopChannels: undefined } } as any;

    expect(selectTxHopChannels(state)).toBe(selectTxHopChannels(state));
  });
});
