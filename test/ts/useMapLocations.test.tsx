import React from "react";
import { renderHook, act } from "@testing-library/react";
import {
  MapLocationsProvider,
  useMapLocations,
} from "@n-apt/maps/hooks/useMapLocations";

// Mock Leaflet
jest.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>,
  TileLayer: () => <div />,
  Marker: () => <div />,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMap: () => ({
    setView: jest.fn(),
    getBounds: jest.fn(() => ({
      getNorthEast: () => ({ lat: 1, lng: 2 }),
      getSouthWest: () => ({ lat: 3, lng: 4 }),
    })),
    getZoom: () => 15,
  }),
  useMapEvents: () => null,
}));

jest.mock("leaflet", () => ({
  Map: jest.fn(),
  TileLayer: jest.fn(),
  Marker: jest.fn(),
  Popup: jest.fn(),
  divIcon: jest.fn(),
  latLng: jest.fn(),
}));

// Mock @n-apt/app/infrastructure/services/env
jest.mock("@n-apt/app/infrastructure/services/env", () => ({
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
    }),
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

  it("does not request geolocation on mount (lazy by design)", () => {
    const { result } = renderHook(() => useMapLocations(), { wrapper });

    // Geolocation must NOT be called on mount — the permission prompt should
    // only appear when the user actually asks for their location.
    expect(mockGeolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(result.current.locations).toHaveLength(0);
    expect(result.current.currentLocation).toBeNull();
  });

  it("populates current location when refreshCurrentLocation is called", async () => {
    const { result } = renderHook(() => useMapLocations(), { wrapper });

    act(() => {
      result.current.refreshCurrentLocation();
    });

    expect(mockGeolocation.getCurrentPosition).toHaveBeenCalled();

    // After the request resolves, current location should be in the list
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

    expect(result.current.locations).toHaveLength(1);
    expect(
      result.current.locations.find(
        ({ name }: { name: string }) => name === "Test Spot",
      ),
    ).toBeDefined();
    expect(result.current.activeLocationId).toMatch(/^loc_/);
  });

  it("should remove a location", async () => {
    const { result } = renderHook(() => useMapLocations(), { wrapper });

    act(() => {
      result.current.addLocation("To Remove", 10, 10);
    });
    const locId = result.current.activeLocationId!;

    expect(result.current.locations.length).toBe(1);

    act(() => {
      result.current.removeLocation(locId);
    });

    expect(result.current.locations.length).toBe(0);
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
