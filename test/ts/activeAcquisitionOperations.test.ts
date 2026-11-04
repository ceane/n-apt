describe("active acquisition operations during Fast Refresh", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("keeps an active acquisition lease visible across module re-evaluation", () => {
    let release: (() => void) | undefined;
    jest.isolateModules(() => {
      const registry =
        require("@n-apt/spectrum/activeAcquisitionOperations") as typeof import("@n-apt/spectrum/activeAcquisitionOperations");
      release = registry.registerActiveAcquisitionOperation(
        "reference-capture",
        "rtl-1",
      );
    });

    jest.resetModules();
    let reloadedRegistry:
      | typeof import("@n-apt/spectrum/activeAcquisitionOperations")
      | undefined;
    jest.isolateModules(() => {
      reloadedRegistry = require("@n-apt/spectrum/activeAcquisitionOperations");
    });

    expect(reloadedRegistry!.hasActiveAcquisitionOperations("rtl-1")).toBe(
      true,
    );
    release!();
    expect(reloadedRegistry!.hasActiveAcquisitionOperations("rtl-1")).toBe(
      false,
    );
  });

  it("keeps reference capture frames lossless until the capture lease is released", () => {
    const demand =
      require("@n-apt/app/infrastructure/streams/streamDeliveryDemand") as typeof import("@n-apt/app/infrastructure/streams/streamDeliveryDemand");
    const registry =
      require("@n-apt/spectrum/activeAcquisitionOperations") as typeof import("@n-apt/spectrum/activeAcquisitionOperations");
    const sourceId = "rtl-reference-capture";

    const release = registry.registerActiveAcquisitionOperation(
      "audio-reference-capture",
      sourceId,
      { streamDeliveryPolicy: "lossless" },
    );

    expect(demand.getStreamDeliveryDemandPolicy({ sourceId, mode: "rx" })).toBe(
      "lossless",
    );
    release();
    expect(demand.getStreamDeliveryDemandPolicy({ sourceId, mode: "rx" })).toBe(
      "latest",
    );
  });
});
