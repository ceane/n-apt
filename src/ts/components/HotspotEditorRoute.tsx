import React from "react";
import styled from "styled-components";
import { HotspotEditorSimple } from "@n-apt/components/HotspotEditorSimple";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

export const HotspotEditorRoute: React.FC = () => {
  const { hotspots } = useHotspotEditor();

  const handleHotspotsChange = () => {
    // Hotspots are managed by the context
    console.log("Hotspots changed:", hotspots.length);
  };

  return (
    <MainContent style={{ padding: 0, margin: 0 }}>
      <HotspotEditorSimple />
    </MainContent>
  );
};
