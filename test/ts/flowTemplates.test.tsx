import { flowTemplates } from "@n-apt/components/react-flow/flows/templates";

describe("Find Beats flow template", () => {
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
});
