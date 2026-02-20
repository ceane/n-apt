import React from "react";
import styled from "styled-components";
import { BodyAreasSection } from "./BodyAreasSection";
import { HotspotEditorSection } from "./HotspotEditorSection";

const Section = styled.div`
  margin-bottom: 24px;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
`;

const RouteContent = styled.div`
  padding: 4cqh 3cqw;
`;

const SectionDescription = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 16px;
`;

const PlaceholderText = styled.div`
  font-size: 12px;
  color: #888;
  padding: 12px;
`;

interface SidebarForRouteProps {
  activeTab: string;
}

export const SidebarForRoute: React.FC<SidebarForRouteProps> = ({ activeTab }) => {
  if (activeTab === "model3d") {
    return (
      <>
        <Section>
          <RouteContent>
            <SectionTitle>Body Areas</SectionTitle>
            <SectionDescription>
              Click an area to focus the camera
            </SectionDescription>
            <BodyAreasSection />
          </RouteContent>
        </Section>
      </>
    );
  }

  if (activeTab === "hotspoteditor") {
    return (
      <RouteContent>
        <HotspotEditorSection />
      </RouteContent>
    );
  }

  // For other routes, show a placeholder
  return (
    <Section>
      <SectionTitle>Route Settings</SectionTitle>
      <PlaceholderText>
        Settings for {activeTab} would go here
      </PlaceholderText>
    </Section>
  );
};
