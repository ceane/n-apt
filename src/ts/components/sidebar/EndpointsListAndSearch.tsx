import React, { useState, useCallback } from "react";
import styled from "styled-components";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import { type TowerRecord } from "@n-apt/hooks/useTowers";

const Container = styled.div`
  grid-column: 1 / -1;
`;

const SearchButton = styled.button`
  width: 100%;
  background: ${(props) => props.theme.primary};
  color: ${(props) => props.theme.background};
  border: none;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 12px;

  &:hover {
    background: ${(props) => props.theme.textPrimary};
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    background: ${(props) => props.theme.textDisabled};
    cursor: not-allowed;
    transform: none;
  }
`;

const EndpointsList = styled.div`
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 6px;
  background: ${(props) => props.theme.surface};
`;

const EndpointItem = styled.div`
  padding: 8px 10px;
  border-bottom: 1px solid ${(props) => props.theme.border};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: ${(props) => props.theme.surfaceHover};
  }
`;

const EndpointHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
`;

const EndpointTitle = styled.div`
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
`;

const EndpointDistance = styled.div`
  color: ${(props) => props.theme.textSecondary};
  font-size: 9px;
`;

const EndpointDetails = styled.div`
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.3;
`;

const TechBadge = styled.span<{ $tech: string }>`
  display: inline-block;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 600;
  margin-right: 4px;
  margin-bottom: 2px;
  
  ${props => {
    switch (props.$tech) {
      case 'NR':
        return `
          background: #3b82f6;
          color: white;
        `;
      case 'LTE':
        return `
          background: #22c55e;
          color: white;
        `;
      case 'UMTS':
        return `
          background: #eab308;
          color: black;
        `;
      case 'GSM':
        return `
          background: #ef4444;
          color: white;
        `;
      default:
        return `
          background: #9ca3af;
          color: white;
        `;
    }
  }}
`;

const LoadingText = styled.div`
  text-align: center;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  padding: 20px;
`;

const ErrorText = styled.div`
  text-align: center;
  color: ${(props) => props.theme.danger};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  padding: 20px;
`;

const EmptyText = styled.div`
  text-align: center;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  padding: 20px;
  font-style: italic;
`;

interface NearestEndpoint {
  tower: TowerRecord;
  distance: number; // in kilometers
}

export const EndpointsListAndSearch: React.FC = () => {
  const { activeLocationId, locations } = useMapLocations();
  const [nearestEndpoints, setNearestEndpoints] = useState<NearestEndpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getCurrentLocation = useCallback(() => {
    const activeLoc = locations.find(l => l.id === activeLocationId);
    if (!activeLoc || activeLoc.lat === 0 || activeLoc.lng === 0) {
      return null;
    }
    return { lat: activeLoc.lat, lng: activeLoc.lng };
  }, [activeLocationId, locations]);

  const fetchNearestEndpoints = useCallback(async () => {
    const currentLoc = getCurrentLocation();
    if (!currentLoc) {
      setError("No valid location selected");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create a small bounding box around current location (approximately 1km radius)
      const radiusKm = 1.0;
      const latDelta = radiusKm / 111.0; // ~1km latitude
      const lngDelta = radiusKm / (111.0 * Math.cos(currentLoc.lat * Math.PI / 180));

      const params = new URLSearchParams({
        ne_lat: String(currentLoc.lat + latDelta),
        ne_lng: String(currentLoc.lng + lngDelta),
        sw_lat: String(currentLoc.lat - latDelta),
        sw_lng: String(currentLoc.lng - lngDelta),
        zoom: "15", // High zoom for detailed results
      });

      const response = await fetch(`/api/towers/bounds?${params}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.towers && Array.isArray(data.towers)) {
        // Calculate distances and sort by nearest
        const endpointsWithDistance = data.towers
          .map((tower: TowerRecord) => ({
            tower,
            distance: calculateDistance(currentLoc.lat, currentLoc.lng, tower.lat, tower.lon)
          }))
          .sort((a: NearestEndpoint, b: NearestEndpoint) => a.distance - b.distance)
          .slice(0, 10); // Take only the nearest 10

        setNearestEndpoints(endpointsWithDistance);
      } else {
        setNearestEndpoints([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch endpoints");
      setNearestEndpoints([]);
    } finally {
      setLoading(false);
    }
  }, [getCurrentLocation]);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const handleEndpointClick = (endpoint: NearestEndpoint) => {
    // Center the map on this endpoint
    const newLocation = {
      id: `endpoint_${endpoint.tower.id}`,
      name: `${endpoint.tower.radio} Tower ${endpoint.tower.mcc}-${endpoint.tower.mnc}`,
      lat: endpoint.tower.lat,
      lng: endpoint.tower.lon,
      zoom: 16,
      color: "#f59e0b"
    };

    // This would need to be integrated with the map location management
    // For now, just log it
    console.log("Navigate to endpoint:", newLocation);
  };

  const getCarrierName = (mcc: string, mnc: string): string => {
    // Simple carrier mapping - could be expanded
    if (mcc === "310") {
      if (mnc === "260") return "T-Mobile US";
      if (mnc === "410") return "AT&T Mobility";
    }
    if (mcc === "311" && mnc === "480") return "Verizon Wireless";
    return `${mcc}-${mnc}`;
  };

  return (
    <Container>
      <SearchButton
        onClick={fetchNearestEndpoints}
        disabled={loading || !getCurrentLocation()}
      >
        {loading ? "SEARCHING..." : "Display Nearest 10 Endpoints"}
      </SearchButton>

      {loading && (
        <EndpointsList>
          <LoadingText>Finding nearest endpoints...</LoadingText>
        </EndpointsList>
      )}

      {error && (
        <EndpointsList>
          <ErrorText>Error: {error}</ErrorText>
        </EndpointsList>
      )}

      {!loading && !error && nearestEndpoints.length === 0 && (
        <EndpointsList>
          <EmptyText>No endpoints found. Select a location and try again.</EmptyText>
        </EndpointsList>
      )}

      {!loading && !error && nearestEndpoints.length > 0 && (
        <EndpointsList>
          {nearestEndpoints.map((endpoint) => (
            <EndpointItem
              key={endpoint.tower.id}
              onClick={() => handleEndpointClick(endpoint)}
            >
              <EndpointHeader>
                <EndpointTitle>
                  <TechBadge $tech={endpoint.tower.radio}>
                    {endpoint.tower.radio}
                  </TechBadge>
                  {getCarrierName(endpoint.tower.mcc, endpoint.tower.mnc)}
                </EndpointTitle>
                <EndpointDistance>
                  {endpoint.distance < 1
                    ? `${(endpoint.distance * 1000).toFixed(0)}m`
                    : `${endpoint.distance.toFixed(1)}km`
                  }
                </EndpointDistance>
              </EndpointHeader>
              <EndpointDetails>
                LAC: {endpoint.tower.lac} | Cell: {endpoint.tower.cell}
                <br />
                {endpoint.tower.lat.toFixed(5)}, {endpoint.tower.lon.toFixed(5)}
              </EndpointDetails>
            </EndpointItem>
          ))}
        </EndpointsList>
      )}
    </Container>
  );
};
