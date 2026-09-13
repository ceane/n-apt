import {
  getRouteProviderGroup,
  RouteProviderLoading,
} from "@n-apt/app/routes/pages/RouteScopedProviders";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

describe("route provider scope", () => {
  it("assigns demod routes to the demod provider group", () => {
    expect(getRouteProviderGroup("/demodulate")).toBe("demod");
    expect(getRouteProviderGroup("/demod")).toBe("demod");
  });

  it("assigns specialized routes without widening the demod group", () => {
    expect(getRouteProviderGroup("/3d-model")).toBe("model");
    expect(getRouteProviderGroup("/map-endpoints")).toBe("map");
    expect(getRouteProviderGroup("/draw-signal")).toBe("draw-signal");
    expect(getRouteProviderGroup("/prefs")).toBe("none");
  });

  it("keeps a visible route shell while a scoped provider chunk loads", () => {
    render(React.createElement(RouteProviderLoading));

    expect(screen.getByTestId("route-provider-loading")).toBeVisible();
    expect(screen.getByText("Loading route…")).toBeVisible();
  });
});
