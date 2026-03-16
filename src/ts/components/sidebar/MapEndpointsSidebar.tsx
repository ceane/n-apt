import React from "react";
import styled from "styled-components";
import { CollapsibleTitle, CollapsibleBody, Row, usePrompt } from "@n-apt/components/ui";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import { Autocomplete } from "@react-google-maps/api";


const SidebarContainer = styled.div`
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  align-content: start;
  gap: 16px;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 24px
    calc(24px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  overflow-x: visible;
  position: relative;
  box-sizing: border-box;
  flex: 1;
  max-width: 100%;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  grid-column: 1 / -1;
  margin-top: 12px;
`;

const SearchInput = styled.input`
  background: #141414;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  color: #fff;
  padding: 8px 12px;
  font-size: 12px;
  font-family: "JetBrains Mono", monospace;
  width: 100%;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background: #1a1a1a;
  }

  &::placeholder {
    color: #444;
  }
`;

const PillGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  grid-column: 1 / -1;
  margin-bottom: 16px;
`;

const Pill = styled.button<{ $color: string; $active: boolean }>`
  background-color: ${(props: { $active: boolean; $color: string }) =>
    props.$active ? props.$color : "#141414"};
  color: ${(props: { $active: boolean; $color: string }) => (props.$active ? "#000" : props.$color)};
  border: 1px solid ${(props: { $color: string }) => props.$color};
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;

  &:hover {
    background-color: ${(props: { $color: string }) => props.$color};
    color: #000;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px ${(props: { $color: string }) => props.$color}44;
  }

  &:active {
    transform: translateY(0);
  }
`;

const ExternalLink = styled.a`
  color: #00d4ff;
  text-decoration: none;
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: normal;
  word-break: break-all;
  text-align: right;

  &:hover {
    color: #fff;
    text-decoration: underline;
  }
`;

const InfoParagraph = styled.p`
  grid-column: 1 / -1;
  font-size: 11px;
  color: #666;
  line-height: 1.5;
  margin: 16px 0 0 0;
  font-family: "JetBrains Mono", monospace;
  font-weight: 500;
`;

const PreviewContainer = styled.div`
  grid-column: 1 / -1;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const PreviewTitle = styled.div`
  font-size: 10px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
  font-family: "JetBrains Mono", monospace;
`;

const PreviewName = styled.div`
  font-size: 13px;
  color: #00d4ff;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const AddButton = styled.button`
  background: #00d4ff;
  color: #000;
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  font-family: "JetBrains Mono", monospace;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: #fff;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const PillWrapper = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const RemoveButton = styled.button`
  background: none;
  border: none;
  color: #ff4444;
  cursor: pointer;
  padding: 6px;
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  transition: opacity 0.2s;
  margin-left: 4px;
  border-radius: 50%;
  min-width: 24px;
  min-height: 24px;

  &:hover {
    opacity: 1;
    background: rgba(255, 68, 68, 0.1);
  }
`;

export const MapEndpointsSidebar: React.FC = () => {
  const [linksOpen, setLinksOpen] = React.useState(true);
  const [searchValue, setSearchValue] = React.useState("");
  const [autocomplete, setAutocomplete] = React.useState<google.maps.places.Autocomplete | null>(null);
  const showPrompt = usePrompt();

  const {
    locations,
    activeLocationId,
    setActiveLocation,
    addLocation,
    removeLocation,
    isLoaded,
    previewLocation,
    setPreviewLocation
  } = useMapLocations();

  const onAutocompleteLoad = (autocompleteInstance: google.maps.places.Autocomplete) => {
    setAutocomplete(autocompleteInstance);
  };

  const onPlaceChanged = () => {
    if (autocomplete !== null) {
      const place = autocomplete.getPlace();
      if (place.geometry && place.geometry.location) {
        const name = place.name || place.formatted_address || "Unnamed Location";
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        setPreviewLocation({
          id: "preview",
          name,
          lat,
          lng,
          zoom: 15,
          color: "#fff",
        });
        setSearchValue("");
      }
    }
  };

  const handleAddPreview = () => {
    if (previewLocation) {
      addLocation(previewLocation.name, previewLocation.lat, previewLocation.lng);
      setPreviewLocation(null); // Clear preview after adding
    }
  };

  const handleRemoveClick = (locationId: string, locationName: string) => {
    showPrompt({
      title: "Remove Location",
      message: `Are you sure you want to remove "${locationName}" from your saved locations?`,
      confirmText: "Remove",
      cancelText: "Cancel",
      onConfirm: () => removeLocation(locationId),
      variant: "danger"
    });
  };

  return (
    <SidebarContainer>
      <div style={{ gridColumn: "1 / -1", fontSize: "10px", color: "#666", lineHeight: "1.4", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
          <span style={{ fontSize: "12px", color: "#888" }}>CC BY-SA</span>
          <span>Cell Tower Data from <a href="https://opencellid.org/" target="_blank" rel="noopener noreferrer" style={{ color: "#00d4ff", textDecoration: "none" }}>OpenCelliD</a></span>
        </div>
        <div style={{ fontSize: "9px", color: "#555" }}>
          OpenCelliD Project is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License
        </div>
      </div>
      <SectionTitle>Locations</SectionTitle>

      {isLoaded ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <Autocomplete
            onLoad={onAutocompleteLoad}
            onPlaceChanged={onPlaceChanged}
            options={{
              types: ["geocode"],
              componentRestrictions: { country: "us" }
            }}
          >
            <SearchInput
              placeholder="Search for a location..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </Autocomplete>
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


      <CollapsibleTitle
        label="Useful Links /"
        isOpen={linksOpen}
        onToggle={() => setLinksOpen((prev) => !prev)}
      />
      {linksOpen && (
        <CollapsibleBody>
          <Row label="Radio Reference">
            <ExternalLink
              href="https://www.radioreference.com/db/browse/"
              target="_blank"
              rel="noopener noreferrer"
              title="Radio Reference Licenses/In Use Frequencies"
            >
              Licenses/In Use
            </ExternalLink>
          </Row>
          <Row label="FCC Search">
            <ExternalLink
              href="https://wireless2.fcc.gov/UlsApp/UlsSearch/searchLicense.jsp"
              target="_blank"
              rel="noopener noreferrer"
              title="FCC Universal Licensing System"
            >
              ULS Search
            </ExternalLink>
          </Row>
          <Row label="FCC ASR">
            <ExternalLink
              href="https://wireless2.fcc.gov/UlsApp/AsrSearch/asrRegistrationSearch.jsp"
              target="_blank"
              rel="noopener noreferrer"
              title="FCC Antenna Structure Registration"
            >
              ASR Search
            </ExternalLink>
          </Row>
        </CollapsibleBody>
      )}
      <InfoParagraph>
        There are over 2 million cell sites within the United States
      </InfoParagraph>
    </SidebarContainer>
  );
};

export default MapEndpointsSidebar;
