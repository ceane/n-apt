import React from "react";
import styled from "styled-components";
import { Link } from "lucide-react";
import { Collapsible, Row } from "@n-apt/components/ui";

const SectionDivider = styled.div`
  height: 1px;
  background: ${(props) => props.theme.border};
  margin: 8px 0;
  width: 100%;
`;

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

const ExternalLink = styled.a`
  color: ${(props) => props.theme.primary};
  text-decoration: none;
  font-size: 11px;
  font-family: ${(props) => props.theme.typography.mono};

  &:hover {
    text-decoration: underline;
  }
`;

const InfoParagraph = styled.div`
  grid-column: 1 / -1;
  font-size: 10px;
  color: ${(props) => props.theme.textSecondary};
  font-style: italic;
  margin-top: 16px;
  line-height: 1.4;
`;

export const MapUsefulLinksSection: React.FC = () => {
  return (
    <>
      <Collapsible
        icon={<Link size={14} />}
        label="Useful Links /"
        defaultOpen={true}
      >
        <Row label="Radio Reference">
          <ExternalLink
            href="https://radioreference.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Database
          </ExternalLink>
        </Row>
        <Row label="Cell Tower Map">
          <ExternalLink
            href="https://cellmapper.net/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Coverage
          </ExternalLink>
        </Row>
        <Row label="FCC Search">
          <ExternalLink
            href="https://wireless2.fcc.gov/UlsApp/UlsSearch/searchLicense.jsp"
            target="_blank"
            rel="noopener noreferrer"
          >
            License Search
          </ExternalLink>
        </Row>
        <Row label="FCC ASR">
          <ExternalLink
            href="https://www.fcc.gov/site/antenna-structure-registration"
            target="_blank"
            rel="noopener noreferrer"
          >
            ASR Search
          </ExternalLink>
        </Row>

        <SectionDivider />

        <SectionTitle style={{ marginTop: "8px" }}>
          Tower Leasee Providers –
        </SectionTitle>

        <Row label="American Tower">
          <ExternalLink
            href="https://www.americantower.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Infrastructure
          </ExternalLink>
        </Row>
        <Row label="SBA Communications">
          <ExternalLink
            href="https://www.sbasite.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Tower Co
          </ExternalLink>
        </Row>
        <Row label="Vertical Bridge">
          <ExternalLink
            href="https://www.verticalbridge.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Towers
          </ExternalLink>
        </Row>
        <Row label="Crown Castle">
          <ExternalLink
            href="https://www.crowncastle.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Infrastructure
          </ExternalLink>
        </Row>
      </Collapsible>
      <InfoParagraph>
        Tower data provided by OpenCelliD. CC BY-SA 4.0 license. Not for commercial use without proper licensing.
      </InfoParagraph>
    </>
  );
};
