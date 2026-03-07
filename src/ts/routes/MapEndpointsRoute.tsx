import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import styled from "styled-components";
import {
  GoogleMap,
  Marker,
  InfoWindow,
} from "@react-google-maps/api";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import { type TowerRecord, useTowers } from "@n-apt/hooks/useTowers";
import { getCarrierName, getPotentialLeasee } from "@n-apt/utils/cellData";

const InfoWindowContent = styled.div`
  background: #000;
  color: #fff;
  padding: 12px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  min-width: 200px;
  border: 1px solid #333;
`;

const InfoTitle = styled.div`
  color: #00d4ff;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  border-bottom: 1px solid #333;
  padding-bottom: 4px;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
`;

const InfoLabel = styled.span`
  color: #888;
`;

const InfoValue = styled.span`
  color: #eee;
  font-weight: 500;
`;

const LeaseeBadge = styled.div`
  margin-top: 10px;
  padding: 6px;
  background: #1a1a1a;
  border-radius: 4px;
  border-left: 3px solid #00d4ff;
  color: #bbb;
  font-size: 10px;
  font-style: italic;
`;

const ControlSection = styled.div`
  margin-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 12px;
`;

const SectionTitle = styled.div`
  color: #888;
  margin-bottom: 8px;
  font-weight: bold;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.05em;
`;

const CarrierSelect = styled.select`
  width: 100%;
  background: #111;
  color: #eee;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 4px 8px;
  font-family: inherit;
  font-size: 11px;
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: #00d4ff;
  }
`;

const CustomCarrierRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`;

const CarrierInput = styled.input`
  flex: 1;
  background: #111;
  color: #eee;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 4px;
  font-family: inherit;
  font-size: 10px;
  width: 100%;
  outline: none;

  &:focus {
    border-color: #00d4ff;
  }
`;

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
  { elementType: "labels", stylers: [{ visibility: "off" }] },
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
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
  {
    featureType: "poi",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative",
    stylers: [{ visibility: "off" }]
  }
];

export const MapEndpointsRoute: React.FC = () => {
  const { locations, activeLocationId, isLoaded, loadError, previewLocation } = useMapLocations();
  const { towers, loading: towersLoading, error: towersError, fetchTowersInBounds } = useTowers();
  const [center, setCenter] = useState({ lat: 37.7749, lng: -122.4194 }); // Default to SF for safety
  const [zoom, setZoom] = useState(15);
  const [map, setMap] = useState<google.maps.Map | null>(null);
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

    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 4,
      fillColor,
      fillOpacity: 0.8,
      strokeColor: "#ffffff",
      strokeWeight: 1,
    };
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
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Towers in view:</span>
            <span>{towers.length.toLocaleString()}</span>
          </div>
          <div style={{ color: towersLoading ? "#93c5fd" : "#9ca3af", fontSize: "10px", marginTop: "2px" }}>
            {towersLoading ? "SYNCING..." : "LIVE"}
          </div>
          {towersError ? <div style={{ color: "#f87171", fontSize: "10px" }}>{towersError}</div> : null}

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
            onClick={() => setSelectedTower(null)}
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
                onClick={() => setSelectedTower(tower)}
              />
            ))}

            {selectedTower && (
              <InfoWindow
                position={{ lat: selectedTower.lat, lng: selectedTower.lon }}
                onCloseClick={() => setSelectedTower(null)}
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
              </InfoWindow>
            )}
          </GoogleMap>
        )}
      </MapWrapper>
    </PageContainer>
  );
};

export default MapEndpointsRoute;
