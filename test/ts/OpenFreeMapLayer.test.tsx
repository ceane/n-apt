import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { useMap } from "react-leaflet";
import { OpenFreeMapLayer } from "@n-apt/maps/OpenFreeMapLayer";

jest.mock("@maplibre/maplibre-gl-leaflet", () => ({
  maplibreGL: jest.fn(),
}));

jest.mock(
  "maplibre-gl",
  () => ({
    setWorkerUrl: jest.fn(),
  }),
  { virtual: true },
);

jest.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => "/worker.mjs", {
  virtual: true,
});

jest.mock("react-leaflet", () => ({
  useMap: jest.fn(),
}));

const mockLeafletMap = {
  attributionControl: {
    addAttribution: jest.fn(),
    removeAttribution: jest.fn(),
  },
  removeLayer: jest.fn(),
};

const mockUseMap = useMap as jest.Mock;
const mockMaplibreGL = maplibreGL as jest.Mock;

describe("OpenFreeMapLayer", () => {
  let matchMediaListener: (() => void) | undefined;
  let mediaQuery: { matches: boolean; addEventListener: jest.Mock; removeEventListener: jest.Mock };
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    jest.clearAllMocks();
    mediaQuery = {
      matches: false,
      addEventListener: jest.fn((_event, listener) => {
        matchMediaListener = listener;
      }),
      removeEventListener: jest.fn(),
    };
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => mediaQuery),
    });
    mockUseMap.mockReturnValue(mockLeafletMap);
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  test("loads OpenFreeMap styles for the system theme and cleans up its layer", () => {
    const lightLayer = { addTo: jest.fn() };
    const darkLayer = { addTo: jest.fn() };
    lightLayer.addTo.mockReturnValue(lightLayer);
    darkLayer.addTo.mockReturnValue(darkLayer);
    mockMaplibreGL
      .mockReturnValueOnce(lightLayer)
      .mockReturnValueOnce(darkLayer);

    const { unmount } = render(<OpenFreeMapLayer />);

    expect(mockMaplibreGL).toHaveBeenNthCalledWith(1, {
      style: "https://tiles.openfreemap.org/styles/positron",
      attributionControl: false,
    });
    expect(lightLayer.addTo).toHaveBeenCalledWith(mockLeafletMap);
    expect(mockLeafletMap.attributionControl.addAttribution).toHaveBeenCalled();

    act(() => {
      mediaQuery.matches = true;
      matchMediaListener?.();
    });

    expect(mockMaplibreGL).toHaveBeenNthCalledWith(2, {
      style: "https://tiles.openfreemap.org/styles/dark",
      attributionControl: false,
    });
    expect(mockLeafletMap.removeLayer).toHaveBeenCalledWith(lightLayer);
    expect(darkLayer.addTo).toHaveBeenCalledWith(mockLeafletMap);

    unmount();

    expect(mockLeafletMap.removeLayer).toHaveBeenLastCalledWith(darkLayer);
    expect(mockLeafletMap.attributionControl.removeAttribution).toHaveBeenCalled();
  });
});
