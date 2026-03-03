import React from "react";
import styled from "styled-components";
import { BodyAreasSection } from "./BodyAreasSection";
import { HotspotEditorSection } from "./HotspotEditorSection";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";

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

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 16px;
`;

const Tab = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 10px 8px;
  border: none;
  border-bottom: 2px solid ${(props) => (props.$active ? "rgba(123, 97, 255, 0.9)" : "transparent")};
  background: ${(props) => (props.$active ? "rgba(123, 97, 255, 0.08)" : "transparent")};
  color: ${(props) => (props.$active ? "rgba(255, 255, 255, 0.92)" : "rgba(255, 255, 255, 0.45)")};
  font-size: 11px;
  font-weight: 600;
  font-family: "JetBrains Mono", monospace;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 120ms ease;

  &:hover {
    color: rgba(255, 255, 255, 0.75);
    background: rgba(255, 255, 255, 0.04);
  }
`;

export const SidebarForRoute: React.FC = () => {
  const { sidebarTab, setSidebarTab } = useHotspotEditor();

  return (
    <>
      <TabBar>
        <Tab
          $active={sidebarTab === "select-areas"}
          onClick={() => setSidebarTab("select-areas")}
        >
          Select Areas
        </Tab>
        <Tab
          $active={sidebarTab === "make-hotspots"}
          onClick={() => setSidebarTab("make-hotspots")}
        >
          Make Hotspots
        </Tab>
      </TabBar>

      <RouteContent>
        {sidebarTab === "select-areas" && (
          <Section>
            <SectionTitle>Body Areas</SectionTitle>
            <SectionDescription>
              Click an area to focus the camera
            </SectionDescription>
            <BodyAreasSection />
          </Section>
        )}

        {sidebarTab === "make-hotspots" && <HotspotEditorSection />}
      </RouteContent>
    </>
  );
};
