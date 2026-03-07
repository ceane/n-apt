import React from "react";
import { renderHook, act } from "@testing-library/react";
import { MapLocationsProvider, useMapLocations } from "@n-apt/hooks/useMapLocations";

// Mock @react-google-maps/api
jest.mock("@react-google-maps/api", () => ({
  useJsApiLoader: () => ({
    isLoaded: true,
    loadError: null,
  }),
}));

// Mock @n-apt/utils/env
jest.mock("@n-apt/utils/env", () => ({
  getGoogleMapsApiKey: () => "mock-api-key",
}));

// Mock Geolocation
const mockGeolocation = {
  getCurrentPosition: jest.fn().mockImplementation((success) =>
    success({
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
      },
    })
  ),
};
(global.navigator as any).geolocation = mockGeolocation;

describe("useMapLocations Hook", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <MapLocationsProvider>{children}</MapLocationsProvider>
  );

  it("should initialize with current location", async () => {
    const { result } = renderHook(() => useMapLocations(), { wrapper });

    // Geolocation is called on mount
    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalled();

    // After mount, current location should be in the list
    expect(result.current.locations).toHaveLength(1);
    expect(result.current.locations[0].id).toBe("current");
    expect(result.current.locations[0].name).toBe("Current Location");
    expect(result.current.currentLocation?.lat).toBe(40.7128);
  });

  it("should add a new location", async () => {
    const { result } = renderHook(() => useMapLocations(), { wrapper });

    act(() => {
      result.current.addLocation("Test Spot", 50, 50);
    });

    expect(result.current.locations).toHaveLength(2);
    expect(result.current.locations.find(l => l.name === "Test Spot")).toBeDefined();
    expect(result.current.activeLocationId).toMatch(/^loc_/);
  });

  it("should remove a location", async () => {
    const { result } = renderHook(() => useMapLocations(), { wrapper });

    act(() => {
      result.current.addLocation("To Remove", 10, 10);
    });
    const locId = result.current.activeLocationId!;

    expect(result.current.locations.length).toBe(2);

    act(() => {
      result.current.removeLocation(locId);
    });

    expect(result.current.locations.length).toBe(1);
    expect(result.current.activeLocationId).toBe("current");
  });

  it("should handle preview location", () => {
    const { result } = renderHook(() => useMapLocations(), { wrapper });

    const preview = {
      id: "preview",
      name: "Preview",
      lat: 1,
      lng: 2,
      zoom: 15,
      color: "#000",
    };

    act(() => {
      result.current.setPreviewLocation(preview);
    });

    expect(result.current.previewLocation).toEqual(preview);

    act(() => {
      result.current.addLocation("Saved", 1, 2);
    });

    // Preview should be cleared after saving
    expect(result.current.previewLocation).toBeNull();
  });
});
