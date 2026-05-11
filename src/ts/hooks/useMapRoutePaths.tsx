import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { type TowerRecord } from "@n-apt/hooks/useTowers";

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface RouteSegment {
  id: string;
  start: RoutePoint;
  end: RoutePoint;
}

export interface RouteEndpointMatch {
  tower: TowerRecord;
  distanceKm: number;
  closestPoint: RoutePoint;
  segmentId: string;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface MapRoutePathsContextType {
  segments: RouteSegment[];
  nearestEndpoints: RouteEndpointMatch[];
  routePoints: RoutePoint[];
  mapBounds: MapBounds | null;
  addSegment: (start: RoutePoint, end: RoutePoint) => void;
  removeSegment: (id: string) => void;
  clearSegments: () => void;
  setNearestEndpoints: (matches: RouteEndpointMatch[]) => void;
  setMapBounds: (bounds: MapBounds | null) => void;
}

const MapRoutePathsContext = createContext<
  MapRoutePathsContextType | undefined
>(undefined);

const EARTH_RADIUS_KM = 6371;

const toRad = (value: number) => (value * Math.PI) / 180;

const calculateDistanceKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const projectPointToSegment = (
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
) => {
  const latScale = 111.32;
  const lngScale =
    111.32 * Math.cos(toRad((start.lat + end.lat + point.lat) / 3));

  const px = point.lng * lngScale;
  const py = point.lat * latScale;
  const sx = start.lng * lngScale;
  const sy = start.lat * latScale;
  const ex = end.lng * lngScale;
  const ey = end.lat * latScale;

  const dx = ex - sx;
  const dy = ey - sy;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return {
      closestPoint: start,
      distanceKm: calculateDistanceKm(
        point.lat,
        point.lng,
        start.lat,
        start.lng,
      ),
    };
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lengthSquared),
  );
  const closestPoint = {
    lat: (sy + t * dy) / latScale,
    lng: (sx + t * dx) / lngScale,
  };

  return {
    closestPoint,
    distanceKm: calculateDistanceKm(
      point.lat,
      point.lng,
      closestPoint.lat,
      closestPoint.lng,
    ),
  };
};

export const useRouteSegmentDistances = (
  towers: TowerRecord[],
  segments: RouteSegment[],
) => {
  return useMemo(() => {
    if (!segments.length || !towers.length) return [];

    const matches = towers.flatMap((tower) =>
      segments.map((segment) => {
        const projected = projectPointToSegment(
          { lat: tower.lat, lng: tower.lon },
          segment.start,
          segment.end,
        );

        return {
          tower,
          segmentId: segment.id,
          closestPoint: projected.closestPoint,
          distanceKm: projected.distanceKm,
        };
      }),
    );

    return matches
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 20);
  }, [segments, towers]);
};

export const MapRoutePathsProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [segments, setSegments] = useState<RouteSegment[]>([]);
  const [nearestEndpoints, setNearestEndpoints] = useState<RouteEndpointMatch[]>(
    [],
  );
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);

  const routePoints = useMemo(
    () => segments.flatMap((segment) => [segment.start, segment.end]),
    [segments],
  );

  const addSegment = useCallback((start: RoutePoint, end: RoutePoint) => {
    setSegments((prev) => [
      ...prev,
      {
        id: `segment_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        start,
        end,
      },
    ]);
  }, []);

  const removeSegment = useCallback((id: string) => {
    setSegments((prev) => prev.filter((segment) => segment.id !== id));
  }, []);

  const clearSegments = useCallback(() => {
    setSegments([]);
    setNearestEndpoints([]);
  }, []);

  return (
    <MapRoutePathsContext.Provider
      value={{
        segments,
        nearestEndpoints,
        routePoints,
        mapBounds,
        addSegment,
        removeSegment,
        clearSegments,
        setNearestEndpoints,
        setMapBounds,
      }}
    >
      {children}
    </MapRoutePathsContext.Provider>
  );
};

export const useMapRoutePaths = () => {
  const context = useContext(MapRoutePathsContext);
  if (!context) {
    throw new Error("useMapRoutePaths must be used within MapRoutePathsProvider");
  }
  return context;
};
