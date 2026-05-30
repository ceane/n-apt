import React from "react";
import styled from "styled-components";
import { Route as RouteIcon } from "lucide-react";
import { Collapsible, Row } from "@n-apt/components/ui";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import {
  useMapRoutePaths,
  type RoutePoint,
} from "@n-apt/hooks/useMapRoutePaths";

const SearchGrid = styled.div`
  position: relative;
  display: grid;
  gap: 8px;
  min-width: 0;
`;

const InputGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
`;

const Input = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
`;

const Suggestions = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 6px;
  background: ${(props) => props.theme.surface};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  max-height: 220px;
  overflow-y: auto;
`;

const SuggestionButton = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  padding: 8px 10px;
  background: transparent;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  cursor: pointer;
  white-space: normal;
  line-height: 1.3;

  &:hover {
    background: ${(props) => props.theme.surfaceHover};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
`;

const Button = styled.button`
  flex: 1 1 140px;
  min-width: 0;
  padding: 7px 10px;
  border: none;
  border-radius: 4px;
  background: ${(props) => props.theme.primary};
  color: white;
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  cursor: pointer;
  white-space: normal;
  line-height: 1.2;
`;

const SegmentList = styled.div`
  display: grid;
  gap: 8px;
  margin-top: 12px;
`;

const SegmentItem = styled.div`
  border: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.surface};
  border-radius: 6px;
  padding: 8px;
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  min-width: 0;
  overflow-wrap: anywhere;
`;

const ResultList = styled.div`
  display: grid;
  gap: 8px;
  margin-top: 12px;
`;

const ResultItem = styled.div`
  border-left: 3px solid ${(props) => props.theme.primary};
  padding: 8px;
  background: ${(props) => props.theme.surfaceHover};
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  min-width: 0;
  overflow-wrap: anywhere;
`;

const Label = styled.div`
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${(props) => props.theme.textSecondary};
  margin-bottom: 4px;
`;

const formatPoint = (point: RoutePoint) =>
  `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;

export const MapRoutePathsSection: React.FC = () => {
  const { locations, activeLocationId } = useMapLocations();
  const {
    segments,
    addSegment,
    removeSegment,
    clearSegments,
    nearestEndpoints,
    mapBounds,
  } = useMapRoutePaths();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<any[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [startLat, setStartLat] = React.useState("");
  const [startLng, setStartLng] = React.useState("");
  const [endLat, setEndLat] = React.useState("");
  const [endLng, setEndLng] = React.useState("");

  const activeLocation = locations.find((loc) => loc.id === activeLocationId);

  const addFromInputs = () => {
    const start = { lat: Number(startLat), lng: Number(startLng) };
    const end = { lat: Number(endLat), lng: Number(endLng) };
    if (
      Number.isFinite(start.lat) &&
      Number.isFinite(start.lng) &&
      Number.isFinite(end.lat) &&
      Number.isFinite(end.lng)
    ) {
      addSegment(start, end);
    }
  };

  const useActiveLocationAsStart = () => {
    if (!activeLocation) return;
    setStartLat(String(activeLocation.lat));
    setStartLng(String(activeLocation.lng));
  };

  const useActiveLocationAsEnd = () => {
    if (!activeLocation) return;
    setEndLat(String(activeLocation.lat));
    setEndLng(String(activeLocation.lng));
  };

  const searchPlaces = React.useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(trimmed)}&limit=5&addressdetails=1&bounded=1${mapBounds ? `&viewbox=${mapBounds.west},${mapBounds.north},${mapBounds.east},${mapBounds.south}` : ""}`,
          {
            headers: {
              "User-Agent": "n-apt/1.0",
            },
          },
        );
        if (!response.ok) {
          throw new Error(`Search failed (${response.status})`);
        }
        const results = await response.json();
        setSearchResults(Array.isArray(results) ? results : []);
      } catch (error) {
        console.error("Route path search failed:", error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [mapBounds],
  );

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      void searchPlaces(searchQuery);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchQuery, searchPlaces]);

  const applyResultToStart = (place: any) => {
    if (place?.lat && place?.lon) {
      setStartLat(String(place.lat));
      setStartLng(String(place.lon));
      setSearchQuery("");
      setSearchResults([]);
    }
  };

  const applyResultToEnd = (place: any) => {
    if (place?.lat && place?.lon) {
      setEndLat(String(place.lat));
      setEndLng(String(place.lon));
      setSearchQuery("");
      setSearchResults([]);
    }
  };

  return (
    <Collapsible
      icon={<RouteIcon size={14} />}
      label="Route Paths /"
      defaultOpen={false}
    >
      <div style={{ width: "100%", minWidth: 0 }}>
        <SearchGrid>
          <div>
            <Label>Search address / intersection</Label>
            <Input
              placeholder="Type an address or street intersection"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {searchQuery.trim() && (
            <Suggestions>
              {searching ? (
                <SuggestionButton disabled>Searching…</SuggestionButton>
              ) : searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <div key={result.place_id} style={{ display: "grid" }}>
                    <SuggestionButton
                      onClick={() => applyResultToStart(result)}
                    >
                      Use as Start: {result.display_name}
                    </SuggestionButton>
                    <SuggestionButton onClick={() => applyResultToEnd(result)}>
                      Use as End
                    </SuggestionButton>
                  </div>
                ))
              ) : (
                <SuggestionButton disabled>No matches</SuggestionButton>
              )}
            </Suggestions>
          )}
        </SearchGrid>
        <InputGrid>
          <div>
            <Label>Start Lat</Label>
            <Input
              value={startLat}
              onChange={(e) => setStartLat(e.target.value)}
            />
          </div>
          <div>
            <Label>Start Lng</Label>
            <Input
              value={startLng}
              onChange={(e) => setStartLng(e.target.value)}
            />
          </div>
          <div>
            <Label>End Lat</Label>
            <Input value={endLat} onChange={(e) => setEndLat(e.target.value)} />
          </div>
          <div>
            <Label>End Lng</Label>
            <Input value={endLng} onChange={(e) => setEndLng(e.target.value)} />
          </div>
        </InputGrid>
        <ButtonRow>
          <Button onClick={useActiveLocationAsStart} disabled={!activeLocation}>
            Use Start
          </Button>
          <Button onClick={useActiveLocationAsEnd} disabled={!activeLocation}>
            Use End
          </Button>
        </ButtonRow>
        <ButtonRow>
          <Button onClick={addFromInputs}>Add Segment</Button>
          <Button onClick={clearSegments}>Clear</Button>
        </ButtonRow>

        <SegmentList>
          {segments.length === 0 ? (
            <SegmentItem>No route segments added yet.</SegmentItem>
          ) : (
            segments.map((segment, index) => (
              <SegmentItem key={segment.id}>
                <Row label={`Segment ${index + 1}`}>
                  <span>
                    {formatPoint(segment.start)} to {formatPoint(segment.end)}
                  </span>
                </Row>
                <ButtonRow>
                  <Button onClick={() => removeSegment(segment.id)}>
                    Remove
                  </Button>
                </ButtonRow>
              </SegmentItem>
            ))
          )}
        </SegmentList>

        <ResultList>
          {nearestEndpoints.length > 0 ? (
            nearestEndpoints.map((match) => (
              <ResultItem key={`${match.segmentId}-${match.tower.id}`}>
                <div>
                  {match.tower.radio} {match.tower.mcc}-{match.tower.mnc}
                </div>
                <div>
                  {match.distanceKm < 1
                    ? `${(match.distanceKm * 1000).toFixed(0)}m`
                    : `${match.distanceKm.toFixed(2)}km`}
                </div>
                <div>Along: {formatPoint(match.closestPoint)}</div>
              </ResultItem>
            ))
          ) : (
            <ResultItem>No endpoints matched these paths yet.</ResultItem>
          )}
        </ResultList>
      </div>
    </Collapsible>
  );
};
