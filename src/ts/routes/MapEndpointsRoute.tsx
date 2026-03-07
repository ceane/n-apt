import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import styled from "styled-components";
import {
  GoogleMap,
  Marker,
} from "@react-google-maps/api";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import { type TowerRecord, useTowers } from "@n-apt/hooks/useTowers";

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: #050505;
  color: #fff;
  box-sizing: border-box;
`;

const MapWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: #1a1a1a;
  overflow: hidden;
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10;
  font-family: "JetBrains Mono", monospace;
  color: #888;
`;

const ControlsPanel = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 11;
  min-width: 220px;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(5, 5, 5, 0.85);
  backdrop-filter: blur(2px);
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
`;

const FiltersRow = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 8px;
`;

const FilterLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
`;

const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

const darkMapStyles = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#263c3f" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6b9a76" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#38414e" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212a37" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ca5b3" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#746855" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1f2835" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#f3d19c" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#2f3948" }],
  },
  {
    featureType: "transit.station",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#515c6d" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#17263c" }],
  },
];

export const MapEndpointsRoute: React.FC = () => {
  const { locations, activeLocationId, isLoaded, loadError, previewLocation } = useMapLocations();
  const { towers, loading: towersLoading, error: towersError, fetchTowersInBounds } = useTowers();
  const [center, setCenter] = useState({ lat: 37.7749, lng: -122.4194 }); // Default to SF for safety
  const [zoom, setZoom] = useState(15);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [selectedTech, setSelectedTech] = useState<string[]>(["LTE", "NR"]);
  const boundsDebounceRef = useRef<number | null>(null);

  const techFilter = useMemo(() => selectedTech.join(","), [selectedTech]);

  // Sync with active or preview location
  useEffect(() => {
    if (!isLoaded) return;

    let targetLoc: any = previewLocation;
    if (!targetLoc) {
      targetLoc = locations.find((l: any) => l.id === activeLocationId);
    }

    if (targetLoc && targetLoc.lat !== 0 && targetLoc.lng !== 0) {
      const newCenter = { lat: targetLoc.lat, lng: targetLoc.lng };
      setCenter(newCenter);
      setZoom(targetLoc.zoom);
      if (map) {
        map.panTo(newCenter);
      }
    }
  }, [activeLocationId, locations, map, isLoaded, previewLocation]);

  const onLoad = useCallback((m: google.maps.Map) => {
    setMap(m);
  }, []);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  const toggleTech = useCallback((tech: string) => {
    setSelectedTech((prev) => {
      if (prev.includes(tech)) {
        const next = prev.filter((t) => t !== tech);
        return next.length > 0 ? next : prev;
      }
      return [...prev, tech];
    });
  }, []);

  const fetchTowersForCurrentBounds = useCallback(() => {
    if (!map || !isLoaded) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    fetchTowersInBounds({
      neLat: ne.lat(),
      neLng: ne.lng(),
      swLat: sw.lat(),
      swLng: sw.lng(),
      zoom: map.getZoom() ?? zoom,
      tech: techFilter,
      range: "0,-1",
    });
  }, [map, isLoaded, fetchTowersInBounds, techFilter, zoom]);

  const onMapIdle = useCallback(() => {
    if (boundsDebounceRef.current !== null) {
      window.clearTimeout(boundsDebounceRef.current);
    }
    boundsDebounceRef.current = window.setTimeout(() => {
      fetchTowersForCurrentBounds();
    }, 250);
  }, [fetchTowersForCurrentBounds]);

  useEffect(() => {
    fetchTowersForCurrentBounds();
  }, [fetchTowersForCurrentBounds]);

  useEffect(() => {
    return () => {
      if (boundsDebounceRef.current !== null) {
        window.clearTimeout(boundsDebounceRef.current);
      }
    };
  }, []);

  const towerIcon = useCallback((tower: TowerRecord) => {
    const radio = tower.radio?.toUpperCase();
    const fillColor =
      radio === "NR"
        ? "#3b82f6"
        : radio === "LTE"
          ? "#22c55e"
          : radio === "UMTS"
            ? "#eab308"
            : radio === "GSM"
              ? "#ef4444"
              : "#9ca3af";

    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 4,
      fillColor,
      fillOpacity: 0.8,
      strokeColor: "#ffffff",
      strokeWeight: 1,
    };
  }, []);

  return (
    <PageContainer>
      <MapWrapper>
        <ControlsPanel>
          <div>Towers in view: {towers.length.toLocaleString()}</div>
          <div style={{ color: towersLoading ? "#93c5fd" : "#9ca3af" }}>
            {towersLoading ? "Loading towers..." : "Ready"}
          </div>
          {towersError ? <div style={{ color: "#f87171" }}>{towersError}</div> : null}
          <FiltersRow>
            <FilterLabel>
              <input
                type="checkbox"
                checked={selectedTech.includes("LTE")}
                onChange={() => toggleTech("LTE")}
              />
              LTE
            </FilterLabel>
            <FilterLabel>
              <input
                type="checkbox"
                checked={selectedTech.includes("NR")}
                onChange={() => toggleTech("NR")}
              />
              5G
            </FilterLabel>
            <FilterLabel>
              <input
                type="checkbox"
                checked={selectedTech.includes("UMTS")}
                onChange={() => toggleTech("UMTS")}
              />
              3G
            </FilterLabel>
            <FilterLabel>
              <input
                type="checkbox"
                checked={selectedTech.includes("GSM")}
                onChange={() => toggleTech("GSM")}
              />
              2G
            </FilterLabel>
          </FiltersRow>
        </ControlsPanel>
        {loadError && (
          <LoadingOverlay>
            Error loading Google Maps: {loadError.message}
          </LoadingOverlay>
        )}
        {!isLoaded ? (
          <LoadingOverlay>Loading Engine...</LoadingOverlay>
        ) : (
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={center}
            zoom={zoom}
            onLoad={onLoad}
            onUnmount={onUnmount}
            onIdle={onMapIdle}
            options={{
              styles: darkMapStyles,
              disableDefaultUI: false,
              backgroundColor: "#1a1a1a",
            }}
          >
            {center.lat !== 0 && !previewLocation && (
              <Marker
                position={center}
                title="Active Location"
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: "#00d4ff",
                  fillOpacity: 1,
                  strokeColor: "#fff",
                  strokeWeight: 2,
                }}
              />
            )}
            {previewLocation && (
              <Marker
                position={{ lat: previewLocation.lat, lng: previewLocation.lng }}
                title="Preview"
                animation={google.maps.Animation.BOUNCE}
                icon={{
                  path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                  scale: 7,
                  fillColor: "#fff",
                  fillOpacity: 1,
                  strokeColor: "#00d4ff",
                  strokeWeight: 2,
                }}
              />
            )}
            {towers.map((tower) => (
              <Marker
                key={tower.id}
                position={{ lat: tower.lat, lng: tower.lon }}
                title={`${tower.radio} ${tower.mcc}-${tower.mnc} LAC ${tower.lac} CELL ${tower.cell}`}
                icon={towerIcon(tower)}
              />
            ))}
          </GoogleMap>
        )}
      </MapWrapper>
    </PageContainer>
  );
};

export default MapEndpointsRoute;
