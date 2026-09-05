import { deriveSourceDerivedState } from "@n-apt/redux/selectors/performanceSelectors";
import type { SourceInfo } from "@n-apt/consts/schemas/websocket";

const makeSource = (overrides: Partial<SourceInfo>): SourceInfo => ({
  id: "source-1",
  name: "Mock Tx SDR",
  kind: "mock",
  capability: "mock",
  status: "streaming",
  loading_attempt: 0,
  loading_attempt_max: 0,
  supports_approx_dbm: true,
  sdr: {
    max_sample_rate: 4_372_000,
    sample_rate_options: [4_372_000],
    fft_display: {
      markers: [],
    },
    settings: {
      sample_rate: 4_372_000,
    },
  },
  ...overrides,
});

describe("deriveSourceDerivedState", () => {
  it("treats mock active sources as Tx-capable without a separate device profile", () => {
    expect(deriveSourceDerivedState(makeSource({})).deviceProfile?.kind).toBe(
      "mock_tx",
    );
  });

  it("treats tx_rx source capability as Tx-capable even with a generic kind", () => {
    expect(
      deriveSourceDerivedState(
        makeSource({ kind: "generic_sdr", capability: "tx_rx" }),
      ).deviceProfile?.kind,
    ).toBe("tx");
  });
});
