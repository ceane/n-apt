import React from "react";
import { HotspotEditorSimple } from "@n-apt/components/HotspotEditorSimple";
import { MainContent } from "@n-apt/components/Layout";

export const HotspotEditorRoute: React.FC = () => {
  return (
    <MainContent style={{ padding: 0, margin: 0 }}>
      <HotspotEditorSimple />
    </MainContent>
  );
};
