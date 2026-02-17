import React from "react";
import styled from "styled-components";
import HotspotEditor from "@n-apt/components/HotspotEditor";

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

export const HotspotEditorRoute: React.FC = () => {
  const handleHotspotsChange = () => {
    // You can save these to localStorage or state here
    console.log("Hotspots changed");
  };

  return (
    <MainContent style={{ padding: 0, margin: 0 }}>
      <HotspotEditor
        onHotspotsChange={handleHotspotsChange}
      />
    </MainContent>
  );
};
