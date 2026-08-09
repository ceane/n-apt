import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";

export interface MapLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zoom: number;
  color: string;
}

interface MapLocationsContextType {
  locations: MapLocation[];
  activeLocationId: string | null;
  recenterTick: number;
  addLocation: (name: string, lat: number, lng: number) => void;
  removeLocation: (id: string) => void;
  setActiveLocation: (id: string | null) => void;
  recenterLocation: (id: string) => void;
  currentLocation: MapLocation | null;
  previewLocation: MapLocation | null;
  setPreviewLocation: (loc: MapLocation | null) => void;
  isLoaded: boolean;
  loadError: Error | undefined;
  refreshCurrentLocation: () => void;
}

const MapLocationsContext = createContext<MapLocationsContextType | undefined>(
  undefined,
);

const PILL_COLORS = [
  "#5eead4", // teal
  "#93c5fd", // light blue
  "#c4b5fd", // purple
  "#fcd34d", // yellow
  "#86efac", // green
  "#fda4af", // rose
  "#fb923c", // orange
  "#a5f3fc", // cyan
];

const STORAGE_KEY = "n-apt-map-locations";

export const MapLocationsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Leaflet loads immediately without API key requirement
  const [isLoaded] = useState(true);
  const [loadError] = useState<Error | undefined>(undefined);

  const [locations, setLocations] = useState<MapLocation[]>(() => {
    // Load from localStorage on initialization
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [activeLocationId, setActiveLocationId] = useState<string | null>(
    "current",
  );
  const [recenterTick, setRecenterTick] = useState(0);
  const [currentLocation, setCurrentLocation] = useState<MapLocation | null>(
    null,
  );
  const [previewLocation, setPreviewLocation] = useState<MapLocation | null>(
    null,
  );

  // Persistence: Save to localStorage whenever locations change (excluding "current")
  useEffect(() => {
    const toSave = locations.filter((l: MapLocation) => l.id !== "current");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [locations]);

  // Lazily fetch the browser's current location. Only called on demand
  // (e.g. from the map page), never automatically on app load, so the
  // geolocation permission prompt only appears when the user asks for it.
  const refreshCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current: MapLocation = {
          id: "current",
          name: "Current Location",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          zoom: 15,
          color: "#5eead4",
        };
        setCurrentLocation(current);

        setLocations((prev) => {
          const filtered = prev.filter((l) => l.id !== "current");
          return [current, ...filtered];
        });
      },
      (err) => {
        console.warn("Geolocation failed:", err);
      },
    );
  }, []);

  const addLocation = useCallback((name: string, lat: number, lng: number) => {
    const newLocation: MapLocation = {
      id: `loc_${Date.now()}`,
      name,
      lat,
      lng,
      zoom: 15,
      color: PILL_COLORS[Math.floor(Math.random() * PILL_COLORS.length)],
    };
    setLocations((prev) => [...prev, newLocation]);
    setActiveLocationId(newLocation.id);
    setPreviewLocation(null); // Clear preview once saved
  }, []);

  const removeLocation = useCallback(
    (id: string) => {
      if (id === "current") return;
      setLocations((prev) => prev.filter((l) => l.id !== id));
      if (activeLocationId === id) {
        setActiveLocationId("current");
      }
    },
    [activeLocationId],
  );

  const setActiveLocation = useCallback((id: string | null) => {
    setActiveLocationId(id);
    if (id) setPreviewLocation(null); // Clear preview when switching to a saved loc
  }, []);

  const recenterLocation = useCallback((id: string) => {
    setActiveLocationId(id);
    setPreviewLocation(null);
    setRecenterTick((prev) => prev + 1);
  }, []);

  return (
    <MapLocationsContext.Provider
      value={{
        locations,
        activeLocationId,
        recenterTick,
        addLocation,
        removeLocation,
        setActiveLocation,
        recenterLocation,
        currentLocation,
        previewLocation,
        setPreviewLocation,
        isLoaded,
        loadError,
        refreshCurrentLocation,
      }}
    >
      {children}
    </MapLocationsContext.Provider>
  );
};

export const useMapLocations = () => {
  const context = useContext(MapLocationsContext);
  if (context === undefined) {
    throw new Error(
      "useMapLocations must be used within a MapLocationsProvider",
    );
  }
  return context;
};
