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
});
