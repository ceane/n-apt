import { getMockTxPreviewRequestKey } from "../../src/ts/routes/SpectrumRoute";

describe("getMockTxPreviewRequestKey", () => {
  it("changes when TX preview bandwidth changes", () => {
    const base = getMockTxPreviewRequestKey({
      sourceId: "mock-tx",
      centerFrequencyHz: 137_100_000,
      sampleRateHz: 2_400_000,
      signal: "apt",
      powerDbm: -18,
    });

    expect(
      getMockTxPreviewRequestKey({
        sourceId: "mock-tx",
        centerFrequencyHz: 137_100_000,
        sampleRateHz: 218_000,
        signal: "apt",
        powerDbm: -18,
      }),
    ).not.toBe(base);
  });
});
