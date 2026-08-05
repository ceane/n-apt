import { getRouteProviderGroup } from "@n-apt/routes/RouteScopedProviders";

describe("route provider scope", () => {
  it("assigns demod routes to the demod provider group", () => {
    expect(getRouteProviderGroup("/demodulate")).toBe("demod");
    expect(getRouteProviderGroup("/demod")).toBe("demod");
  });

  it("assigns specialized routes without widening the demod group", () => {
    expect(getRouteProviderGroup("/3d-model")).toBe("model");
    expect(getRouteProviderGroup("/map-endpoints")).toBe("map");
    expect(getRouteProviderGroup("/draw-signal")).toBe("draw-signal");
    expect(getRouteProviderGroup("/settings")).toBe("none");
  });
});
