import { flowTemplates } from "@n-apt/demodulation/react-flow/flows/templates";
import { resolveDemodNodeEntry } from "@n-apt/demodulation/react-flow/nodes/nodeRegistry";

describe("reverse engineering demod flow", () => {
  const flow = flowTemplates.find(({ id }) => id === "reverse-engineering");

  it("provides role-bound RTL-SDR receive and HackRF transmit branches", () => {
    expect(flow).toBeDefined();
    expect(flow?.nodes.find(({ id }) => id === "source")?.data).toEqual(
      expect.objectContaining({
        sourceNode: true,
        sourceBindingGroup: "reverse-engineering",
        preferredRxName: "RTL-SDR",
        preferredTxName: "HackRF",
      }),
    );
    expect(
      flow?.nodes.filter((node) => node.data?.sourceRole === "rx").length,
    ).toBeGreaterThan(0);
    expect(
      flow?.nodes.filter((node) => node.data?.sourceRole === "tx").length,
    ).toBeGreaterThan(0);
  });

  it("includes A/B/C tuning, transmit pattern control, and saved observations", () => {
    expect(
      flow?.nodes.find(({ id }) => id === "rx-channel")?.data,
    ).toEqual(expect.objectContaining({ channelNode: true, channelLabels: ["A", "B", "C"] }));
    expect(flow?.nodes.some((node) => node.data?.experimentControlOptions)).toBe(
      true,
    );
    expect(flow?.nodes.some((node) => node.data?.experimentObservationOptions)).toBe(
      true,
    );
    expect(flow?.edges.map(({ source, target }) => `${source}->${target}`)).toEqual(
      expect.arrayContaining([
        "source->rx-channel",
        "source->tx-settings",
        "tx-settings->experiment-control",
        "experiment-control->tx-signal-config",
        "rx-signal-config->rx-fft",
        "rx-fft->experiment-observation",
      ]),
    );
  });

  it("explains that the RTL-SDR receive window limits what Tx can be observed", () => {
    expect(flow?.description).toMatch(/3\.2\s*MS\/s/i);
    expect(flow?.description).toMatch(/20\s*MHz/i);
    expect(flow?.nodes.find(({ id }) => id === "rx-channel")?.data?.description).toMatch(
      /3\.2\s*MS\/s/i,
    );
  });

  it("registers the experiment controls used by the flow picker", () => {
    expect(resolveDemodNodeEntry({ experimentControlOptions: true })).not.toBeNull();
    expect(resolveDemodNodeEntry({ experimentObservationOptions: true })).not.toBeNull();
  });
});
