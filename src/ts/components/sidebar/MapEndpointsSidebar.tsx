import React from "react";
import styled from "styled-components";
import { usePrompt } from "@n-apt/components/ui";
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

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${(props) => props.theme.metadataLabel};
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
  grid-column: 1 / -1;
  margin-top: 12px;
`;

const SearchInput = styled.input`
  background: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 6px;
  color: ${(props) => props.theme.textPrimary};
  padding: 8px 12px;
  font-size: 12px;
  font-family: ${(props) => props.theme.typography.mono};
  width: 100%;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${(props) => props.theme.primary};
    background: ${(props) => props.theme.surfaceHover};
  }

  &::placeholder {
    color: ${(props) => props.theme.textDisabled};
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
    props.$active ? props.$color : "var(--color-surface)"};
  color: ${(props: { $active: boolean; $color: string }) => (props.$active ? "var(--color-background)" : props.$color)};
  border: 1px solid ${(props: { $color: string }) => props.$color};
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 11px;
  font-family: ${(props) => props.theme.typography.mono};
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;

  &:hover {
    background-color: ${(props: { $color: string }) => props.$color};
    color: var(--color-background);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px ${(props: { $color: string }) => props.$color}44;
  }

  &:active {
    transform: translateY(0);
  }
`;

const ExternalLink = styled.a`
  color: ${(props) => props.theme.primary};
  text-decoration: none;
  font-size: 11px;
  font-family: ${(props) => props.theme.typography.mono};
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: normal;
  word-break: break-all;
  text-align: right;

  &:hover {
    color: ${(props) => props.theme.textPrimary};
    text-decoration: underline;
  }
`;

const InfoParagraph = styled.p`
  grid-column: 1 / -1;
  font-size: 11px;
  color: ${(props) => props.theme.textMuted};
  line-height: 1.5;
  margin: 16px 0 0 0;
  font-family: ${(props) => props.theme.typography.mono};
  font-weight: 500;
`;

const PreviewContainer = styled.div`
  grid-column: 1 / -1;
  background: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.borderHover};
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const PreviewTitle = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
  font-family: ${(props) => props.theme.typography.mono};
`;

const PreviewName = styled.div`
  font-size: 13px;
  color: ${(props) => props.theme.primary};
  font-weight: 600;
  font-family: ${(props) => props.theme.typography.mono};
`;

const AddButton = styled.button`
  background: ${(props) => props.theme.primary};
  color: ${(props) => props.theme.background};
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  font-family: ${(props) => props.theme.typography.mono};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) => props.theme.textPrimary};
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
  color: ${(props) => props.theme.danger};
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
    background: ${(props) => `${props.theme.danger}1a`};
  }
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

const SectionDivider = styled.div`
  height: 1px;
  background: ${(props) => props.theme.border};
  margin: 8px 0;
  width: 100%;
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
