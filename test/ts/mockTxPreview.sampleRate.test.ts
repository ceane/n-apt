import { resolveTxPreviewSampleRateForSource } from "@n-apt/app/routes/pages/spectrum/mockTxPreview";

describe("resolveTxPreviewSampleRateForSource", () => {
  it("uses the current hardware rate for a HackRF Tx preview", () => {
    expect(
      resolveTxPreviewSampleRateForSource({
        isMockTxSource: false,
        viewerSampleRateHz: 3_200_000,
        sourceSampleRateHz: 5_000_000,
        fallbackSampleRateHz: 4_372_000,
      }),
    ).toBe(5_000_000);
  });
});
