import React from "react";
import styled from "styled-components";
import { CollapsibleTitle, CollapsibleBody, Row } from "@n-apt/components/ui";

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

export const MapEndpointsSidebar: React.FC = () => {
  const [linksOpen, setLinksOpen] = React.useState(true);

  return (
    <SidebarContainer>
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
        </CollapsibleBody>
      )}
    </SidebarContainer>
  );
};

export default MapEndpointsSidebar;
