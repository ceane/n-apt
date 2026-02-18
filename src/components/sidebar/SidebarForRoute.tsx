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

interface SidebarForRouteProps {
  activeTab: string;
}

export const SidebarForRoute: React.FC<SidebarForRouteProps> = ({ activeTab }) => {
  if (activeTab === "model3d") {
    return (
      <>
        <Section>
          <div style={{ padding: "4cqh 3cqw" }}>
            <SectionTitle>Body Areas</SectionTitle>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.50)", marginBottom: "16px" }}>
              Click an area to focus the camera
            </div>
            <BodyAreasSection />
          </div>
        </Section>
      </>
    );
  }

  if (activeTab === "hotspoteditor") {
    return (
      <div style={{ padding: "4cqh 3cqw" }}>
        <HotspotEditorSection />
      </div>
    );
  }

  // For other routes, show a placeholder
  return (
    <Section>
      <SectionTitle>Route Settings</SectionTitle>
      <div style={{ fontSize: "12px", color: "#888", padding: "12px" }}>
        Settings for {activeTab} would go here
      </div>
    </Section>
  );
};
