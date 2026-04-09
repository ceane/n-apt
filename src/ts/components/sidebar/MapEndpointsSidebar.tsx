import React from "react";
import styled from "styled-components";
import { MapLocationsSection } from "./MapLocationsSection";
import { MapNearestEndpointsSection } from "./MapNearestEndpointsSection";
import { MapUsefulLinksSection } from "./MapUsefulLinksSection";


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

const Attribution = styled.div`
  grid-column: 1 / -1;
  font-size: 10px;
  color: ${(props) => props.theme.textMuted};
  line-height: 1.4;
  margin-bottom: 16px;
`;

const AttributionRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
`;

const AttributionBadge = styled.span`
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
`;

const AttributionLink = styled.a`
  color: ${(props) => props.theme.primary};
  text-decoration: none;
`;

const AttributionDetail = styled.div`
  font-size: 9px;
  color: ${(props) => props.theme.metadataLabel};
`;

export const MapEndpointsSidebar: React.FC = () => {
  return (
    <SidebarContainer>
      <Attribution>
        <AttributionRow>
          <AttributionBadge>CC BY-SA</AttributionBadge>
          <span>Cell Tower Data from <AttributionLink href="https://opencellid.org/" target="_blank" rel="noopener noreferrer">OpenCelliD</AttributionLink></span>
        </AttributionRow>
        <AttributionDetail>
          OpenCelliD Project is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License
        </AttributionDetail>
      </Attribution>

      <MapLocationsSection />
      <MapNearestEndpointsSection />
      <MapUsefulLinksSection />
    </SidebarContainer>
  );
};

export default MapEndpointsSidebar;
