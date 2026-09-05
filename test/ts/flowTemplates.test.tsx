import { flowTemplates } from "@n-apt/demodulation/react-flow/flows/templates";

describe("Find Beats flow template", () => {
  it("places Tx Suite directly under Reference Capture", () => {
    expect(flowTemplates.slice(0, 2).map(({ id }) => id)).toEqual([
      "default",
      "tx-suite",
    ]);
  });

  it("uses a Waterfall visualization instead of an FFT node", () => {
    const template = flowTemplates.find(({ id }) => id === "find-beats");

    expect(template).toBeDefined();
    expect(template?.nodes.map(({ id }) => id)).toEqual([
      "source",
      "channel",
      "waterfall",
      "beat",
    ]);
    expect(template?.nodes.find(({ id }) => id === "fft")).toBeUndefined();
    expect(template?.nodes.find(({ id }) => id === "waterfall")?.data).toEqual(
      expect.objectContaining({
        waterfallOptions: true,
        showMiniVfo: true,
        miniVfoPosition: "top",
      }),
    );
  });

  it("routes channel data through Waterfall before beat detection", () => {
    const template = flowTemplates.find(({ id }) => id === "find-beats");

    expect(
      template?.edges.map(({ source, target }) => `${source}->${target}`),
    ).toEqual(["source->channel", "channel->waterfall", "waterfall->beat"]);
  });

  it("uses Reference Capture (Default) as the default capture pipeline", () => {
    const template = flowTemplates.find(({ id }) => id === "default");
    expect(template).toBeDefined();
    expect(template?.label).toBe("Reference Capture (Default)");
    expect(template?.description).toBe(
      "Capture a reference signal for demodulation",
    );
    expect(template?.nodes.map(({ id }) => id)).toEqual([
      "source",
      "channel",
      "signal-config",
      "stimulus",
      "output",
    ]);
  });

  it("builds Try N-APT Audio as Span with FFT and Waterfall Analysis into Radio", () => {
    const template = flowTemplates.find(({ id }) => id === "apt-audio");

    expect(template).toBeDefined();
    expect(template?.label).toBe("Try N-APT Audio");
    expect(template?.nodes.map(({ id }) => id)).toEqual([
      "source",
      "span",
      "fft",
      "waterfall-analysis",
      "radio",
    ]);
    expect(
      template?.nodes.find(({ id }) => id === "waterfall-analysis")?.data,
    ).toEqual(
      expect.objectContaining({
        waterfallOptions: true,
        analysisOptions: true,
      }),
    );
    expect(
      template?.edges.map(({ source, target }) => `${source}->${target}`),
    ).toEqual([
      "source->span",
      "span->fft",
      "span->waterfall-analysis",
      "fft->radio",
      "waterfall-analysis->radio",
    ]);
  });
});
