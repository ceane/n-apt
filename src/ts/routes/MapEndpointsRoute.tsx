import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import styled from "styled-components";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents
} from "react-leaflet";
import L from "leaflet";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import { type TowerRecord, useTowers } from "@n-apt/hooks/useTowers";
import { getCarrierName, getPotentialLeasee } from "@n-apt/utils/cellData";

const InfoWindowContent = styled.div`
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  padding: 12px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  min-width: 200px;
`;

const InfoTitle = styled.div`
  color: ${(props) => props.theme.primary};
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  border-bottom: 1px solid ${(props) => props.theme.border};
  padding-bottom: 4px;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
`;

const InfoLabel = styled.span`
  color: ${(props) => props.theme.textSecondary};
`;

const InfoValue = styled.span`
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
`;

const LeaseeBadge = styled.div`
  margin-top: 10px;
  padding: 6px;
  background: ${(props) => props.theme.surfaceHover};
  border-left: 3px solid ${(props) => props.theme.primary};
  color: ${(props) => props.theme.textSecondary};
  font-size: 10px;
  font-style: italic;
`;

const ControlSection = styled.div`
  margin-top: 12px;
  border-top: 1px solid ${(props) => props.theme.border};
  padding-top: 12px;
`;

const SectionTitle = styled.div`
  color: ${(props) => props.theme.textSecondary};
  margin-bottom: 8px;
  font-weight: bold;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.05em;
`;

const CarrierSelect = styled.select`
  width: 100%;
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  padding: 4px 8px;
  font-family: inherit;
  font-size: 11px;
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: ${(props) => props.theme.primary};
  }
`;

const CustomCarrierRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`;

const CarrierInput = styled.input`
  flex: 1;
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  padding: 4px;
  font-family: inherit;
  font-size: 10px;
  width: 100%;
  outline: none;

  &:focus {
    border-color: ${(props) => props.theme.primary};
  }
`;

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
  box-sizing: border-box;
`;

const MapWrapper = styled.div`
  flex: 1;
  position: relative;
  background-color: ${(props) => props.theme.surface};
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
  background: ${(props) => props.theme.background}b3;
  z-index: 10;
  font-family: "JetBrains Mono", monospace;
  color: ${(props) => props.theme.textSecondary};
`;

const ControlsPanel = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  min-width: 220px;
  padding: 10px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  background: ${(props) => props.theme.surface}d9;
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
  color: ${(props) => props.theme.textSecondary};
`;

const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

import { MapEndpointsHUD } from "@n-apt/components/MapEndpointsHUD";

// Helper component for map events
const MapEventHandler: React.FC<{
  onMapIdle: () => void;
  onMapClick: () => void;
}> = ({ onMapIdle, onMapClick }) => {
  useMapEvents({
    moveend: onMapIdle,
    zoomend: onMapIdle,
    click: onMapClick,
  });
  return null;
};

// Helper component for map center/zoom sync
const MapController: React.FC<{
  center: { lat: number; lng: number };
  zoom: number;
  onMapLoad: (map: L.Map) => void;
}> = ({ center, zoom, onMapLoad }) => {
  const map = useMap();

  useEffect(() => {
    onMapLoad(map);
  }, [map, onMapLoad]);

  return null;
};

// Helper component for theme-aware tiles
const ThemedTileLayer: React.FC = () => {
  const [isDark, setIsDark] = React.useState(false);

  React.useEffect(() => {
    // Check if we're in dark mode
    const checkTheme = () => {
      const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDark(isDarkMode);
    };

    checkTheme();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkTheme);

    return () => mediaQuery.removeEventListener('change', checkTheme);
  }, []);

  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
      url={isDark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      }
    />
  );
};

export const MapEndpointsRoute: React.FC = () => {
  const { locations, activeLocationId, isLoaded, loadError, previewLocation } = useMapLocations();
  const { towers, loading: towersLoading, error: towersError, truncated, totalFound, fetchTowersInBounds } = useTowers();
  const [center, setCenter] = useState({ lat: 37.7749, lng: -122.4194 }); // Default to SF for safety
  const [zoom, setZoom] = useState(15);
  const [map, setMap] = useState<L.Map | null>(null);
  const [selectedTech, setSelectedTech] = useState<string[]>(["LTE", "NR"]);
  const [selectedTower, setSelectedTower] = useState<TowerRecord | null>(null);
  const [mcc, setMcc] = useState<string>("");
  const [mnc, setMnc] = useState<string>("");
  const boundsDebounceRef = useRef<number | null>(null);

  const techFilter = useMemo(() => selectedTech.join(","), [selectedTech]);

  const onCarrierChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "all") {
      setMcc("");
      setMnc("");
    } else if (value === "custom") {
      // Keep existing custom values or clear them
    } else {
      const [newMcc, newMnc] = value.split("-");
      setMcc(newMcc);
      setMnc(newMnc);
    }
  };

  // Sync with active or preview location
  useEffect(() => {
    if (!isLoaded || !map) return;

    let targetLoc: any = previewLocation;
    if (!targetLoc) {
      targetLoc = locations.find((l: any) => l.id === activeLocationId);
    }

    if (targetLoc && targetLoc.lat !== 0 && targetLoc.lng !== 0) {
      const newCenter = L.latLng(targetLoc.lat, targetLoc.lng);
      setCenter({ lat: targetLoc.lat, lng: targetLoc.lng });
      setZoom(targetLoc.zoom);
      map.setView(newCenter, targetLoc.zoom);
    }
  }, [activeLocationId, locations, map, isLoaded, previewLocation]);

  const onLoad = useCallback((mapInstance: L.Map) => {
    setMap(mapInstance);
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
      neLat: ne.lat,
      neLng: ne.lng,
      swLat: sw.lat,
      swLng: sw.lng,
      zoom: map.getZoom() ?? zoom,
      tech: techFilter,
      range: "0,-1",
      mcc: mcc || undefined,
      mnc: mnc || undefined,
    });
  }, [map, isLoaded, fetchTowersInBounds, techFilter, zoom, mcc, mnc]);

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

    return L.divIcon({
      html: `<div style="background-color: ${fillColor}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid #ffffff; opacity: 0.8;"></div>`,
      iconSize: [24, 24],
      className: "tower-marker"
    });
  }, []);

  const carrierPresetValue = useMemo(() => {
    if (!mcc && !mnc) return "all";
    if (mcc === "310" && mnc === "260") return "310-260";
    if (mcc === "310" && mnc === "410") return "310-410";
    if (mcc === "311" && mnc === "480") return "311-480";
    return "custom";
  }, [mcc, mnc]);

  return (
    <PageContainer>
      <MapWrapper>
        <ControlsPanel>
          <MapEndpointsHUD
            currentCount={towers.length}
            truncated={truncated}
            totalFound={totalFound}
            towersLoading={towersLoading}
            towersError={towersError}
          />

          <ControlSection>
            <SectionTitle>Technology</SectionTitle>
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
          </ControlSection>

          <ControlSection>
            <SectionTitle>Carrier / Network</SectionTitle>
            <CarrierSelect value={carrierPresetValue} onChange={onCarrierChange}>
              <option value="all">All Carriers</option>
              <option value="310-260">T-Mobile US</option>
              <option value="310-410">AT&T Mobility</option>
              <option value="311-480">Verizon Wireless</option>
              <option value="custom">Custom MCC/MNC...</option>
            </CarrierSelect>

            {carrierPresetValue === "custom" && (
              <CustomCarrierRow>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "9px", color: "#666", marginBottom: "2px" }}>MCC</div>
                  <CarrierInput
                    placeholder="310"
                    value={mcc}
                    onChange={(e) => setMcc(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "9px", color: "#666", marginBottom: "2px" }}>MNC</div>
                  <CarrierInput
                    placeholder="260"
                    value={mnc}
                    onChange={(e) => setMnc(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  />
                </div>
              </CustomCarrierRow>
            )}
          </ControlSection>
        </ControlsPanel>
        {loadError && (
          <LoadingOverlay>
            Error loading map: {loadError.message}
          </LoadingOverlay>
        )}
        {!isLoaded ? (
          <LoadingOverlay>Loading maps...</LoadingOverlay>
        ) : (
          <MapContainer
            center={[center.lat, center.lng]}
            zoom={zoom}
            style={mapContainerStyle}
            whenReady={(mapInstance) => {
              onLoad(mapInstance.target);
            }}
          >
            <ThemedTileLayer />

            <MapEventHandler
              onMapIdle={onMapIdle}
              onMapClick={() => setSelectedTower(null)}
            />

            <MapController
              center={center}
              zoom={zoom}
              onMapLoad={onLoad}
            />

            {center.lat !== 0 && !previewLocation && (
              <Marker
                position={[center.lat, center.lng]}
                title="Active Location"
                icon={L.divIcon({
                  html: `<div style="background-color: #00d4ff; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #fff;"></div>`,
                  iconSize: [16, 16],
                  className: "active-location-marker"
                })}
                eventHandlers={{
                  click: () => setSelectedTower(null)
                }}
              />
            )}

            {previewLocation && (
              <Marker
                position={[previewLocation.lat, previewLocation.lng]}
                title="Preview"
                icon={L.divIcon({
                  html: `<div style="background-color: #fff; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #00d4ff; animation: bounce 1s infinite;"></div>`,
                  iconSize: [14, 14],
                  className: "preview-marker"
                })}
                eventHandlers={{
                  click: () => setSelectedTower(null)
                }}
              />
            )}

            {towers.map((tower) => (
              <Marker
                key={tower.id}
                position={[tower.lat, tower.lon]}
                title={`${tower.radio} ${tower.mcc}-${tower.mnc} LAC ${tower.lac} CELL ${tower.cell}`}
                icon={towerIcon(tower)}
                eventHandlers={{
                  click: () => setSelectedTower(tower)
                }}
              />
            ))}

            {selectedTower && (
              <Popup
                position={[selectedTower.lat, selectedTower.lon]}
                className="custom-popup"
              >
                <InfoWindowContent>
                  <InfoTitle>{getCarrierName(selectedTower.mcc, selectedTower.mnc)}</InfoTitle>
                  <InfoRow>
                    <InfoLabel>Radio Type:</InfoLabel>
                    <InfoValue>{selectedTower.radio.toUpperCase()}</InfoValue>
                  </InfoRow>
                  <InfoRow>
                    <InfoLabel>LAC / TAC:</InfoLabel>
                    <InfoValue>{selectedTower.lac}</InfoValue>
                  </InfoRow>
                  <InfoRow>
                    <InfoLabel>Cell ID:</InfoLabel>
                    <InfoValue>{selectedTower.cell}</InfoValue>
                  </InfoRow>
                  <InfoRow>
                    <InfoLabel>MCC-MNC:</InfoLabel>
                    <InfoValue>{selectedTower.mcc}-{selectedTower.mnc}</InfoValue>
                  </InfoRow>
                  <InfoRow>
                    <InfoLabel>Coords:</InfoLabel>
                    <InfoValue>{selectedTower.lat.toFixed(5)}, {selectedTower.lon.toFixed(5)}</InfoValue>
                  </InfoRow>
                  <LeaseeBadge>
                    Infrastructure provided by {getPotentialLeasee(selectedTower.id)} (Est.)
                  </LeaseeBadge>
                </InfoWindowContent>
              </Popup>
            )}
          </MapContainer>
        )}
      </MapWrapper>
    </PageContainer>
  );
};

export default MapEndpointsRoute;
