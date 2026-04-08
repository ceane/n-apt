import React from "react";
import styled from "styled-components";
import { MapPin } from "lucide-react";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import { usePrompt } from "@n-apt/components/ui";

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 1rem;
  margin-bottom: 0;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SearchInput = styled.input`
  width: 100%;
  padding: 8px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 4px;
  background: ${(props) => props.theme.surface};
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
  }

  &::placeholder {
    color: ${(props) => props.theme.textSecondary};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SearchResults = styled.div`
  grid-column: 1 / -1;
  background: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 6px;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 8px;
`;

const SearchResultItem = styled.div`
  padding: 8px 12px;
  cursor: pointer;
  font-size: 11px;
  font-family: ${(props) => props.theme.typography.mono};
  color: ${(props) => props.theme.textPrimary};
  border-bottom: 1px solid ${(props) => props.theme.border};

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: ${(props) => props.theme.surfaceHover};
  }
`;

const PreviewContainer = styled.div`
  grid-column: 1 / -1;
  padding: 12px;
  background: ${(props) => props.theme.surfaceHover};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 6px;
  margin-top: 8px;
`;

const PreviewTitle = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
`;

const PreviewName = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.textPrimary};
  font-weight: 500;
  margin-bottom: 8px;
`;

const AddButton = styled.button`
  padding: 6px 12px;
  background: ${(props) => props.theme.primary};
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  cursor: pointer;

  &:hover {
    opacity: 0.8;
  }
`;

const PillGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  grid-column: 1 / -1;
  margin-top: 8px;
`;

const PillWrapper = styled.div`
  display: flex;
  align-items: center;
`;

const Pill = styled.button<{ $color: string; $active: boolean }>`
  padding: 4px 8px;
  background: ${(props) => props.$active ? props.$color : props.theme.surface};
  color: ${(props) => props.$active ? "white" : props.theme.textPrimary};
  border: 1px solid ${(props) => props.$color};
  border-radius: 12px;
  font-size: 10px;
  font-family: ${(props) => props.theme.typography.mono};
  cursor: pointer;

  &:hover {
    opacity: 0.8;
  }
`;

const RemoveButton = styled.button`
  margin-left: 4px;
  background: none;
  border: none;
  color: ${(props) => props.theme.textSecondary};
  cursor: pointer;
  font-size: 12px;

  &:hover {
    color: ${(props) => props.theme.danger};
  }
`;

export const MapLocationsSection: React.FC = () => {
  const [searchValue, setSearchValue] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<any[]>([]);
  const showPrompt = usePrompt();

  const {
    locations,
    activeLocationId,
    isLoaded,
    previewLocation,
    setActiveLocation,
    setPreviewLocation,
    addLocation,
    removeLocation,
  } = useMapLocations();

  // Nominatim search function
  const searchLocations = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=us&addressdetails=1&extratags=1`,
        {
          headers: {
            'User-Agent': 'n-apt/1.0'
          }
        }
      );

      if (response.ok) {
        const results = await response.json();

        // Process results to be less granular - focus on city, state, and major landmarks
        const processedResults = results.map((result: any) => {
          const address = result.address || {};
          let displayName = '';

          // Priority order for US locations
          if (address.city || address.town || address.village) {
            const city = address.city || address.town || address.village;
            const state = address.state || '';
            displayName = state ? `${city}, ${state}` : city;
          } else if (address.county && address.state) {
            displayName = `${address.county.replace(' County', '')}, ${address.state}`;
          } else if (address.state) {
            displayName = address.state;
          } else if (result.display_name) {
            // Fallback but clean up the display name
            displayName = result.display_name
              .split(',')
              .slice(0, 2) // Keep only first 2 parts
              .join(',')
              .replace(/, United States$/, '');
          }

          return {
            ...result,
            display_name: displayName || result.display_name,
            simplified_name: displayName
          };
        }).filter((result: any) => result.simplified_name);

        setSearchResults(processedResults);
      }
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    }
  };

  // Debounced search
  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchLocations(searchValue);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchValue]);

  const onPlaceSelect = (place: any) => {
    if (place && place.lat && place.lon) {
      const name = place.display_name || place.name || "Unnamed Location";
      const lat = parseFloat(place.lat);
      const lng = parseFloat(place.lon);

      setPreviewLocation({
        id: "preview",
        name,
        lat,
        lng,
        zoom: 15,
        color: "var(--color-text-primary)",
      });
      setSearchValue("");
      setSearchResults([]);
    }
  };

  const handleAddPreview = () => {
    if (previewLocation) {
      addLocation(previewLocation);
      setPreviewLocation(null);
    }
  };

  const handleRemoveClick = (id: string, name: string) => {
    showPrompt({
      title: "Remove Location",
      message: `Are you sure you want to remove "${name}" from saved locations?`,
      confirmText: "Remove",
      cancelText: "Cancel",
      onConfirm: () => {
        removeLocation(id);
      },
      variant: "danger"
    });
  };

  return (
    <>
      <SectionTitle>
        <MapPin size={14} />
        Locations
      </SectionTitle>

      {isLoaded ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <SearchInput
            placeholder="Search for a location..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
          />
          {searchResults.length > 0 && (
            <SearchResults>
              {searchResults.map((result, index) => (
                <SearchResultItem
                  key={index}
                  onClick={() => onPlaceSelect(result)}
                >
                  {result.simplified_name}
                </SearchResultItem>
              ))}
            </SearchResults>
          )}
        </div>
      ) : (
        <div style={{ gridColumn: "1 / -1" }}>
          <SearchInput
            placeholder="Loading Maps..."
            disabled
          />
        </div>
      )}

      {previewLocation && (
        <PreviewContainer>
          <PreviewTitle>Preview Selection</PreviewTitle>
          <PreviewName>{previewLocation.name}</PreviewName>
          <AddButton onClick={handleAddPreview}>Add to Saved</AddButton>
        </PreviewContainer>
      )}

      <PillGrid>
        {locations.map((loc) => (
          <PillWrapper key={loc.id}>
            <Pill
              $color={loc.color}
              $active={activeLocationId === loc.id}
              onClick={() => setActiveLocation(loc.id)}
            >
              {loc.name}
            </Pill>
            {loc.id !== "current" && (
              <RemoveButton onClick={(e) => {
                e.stopPropagation();
                handleRemoveClick(loc.id, loc.name);
              }}>
                ×
              </RemoveButton>
            )}
          </PillWrapper>
        ))}
      </PillGrid>
    </>
  );
};
