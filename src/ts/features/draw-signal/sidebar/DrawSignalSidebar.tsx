import React from "react";
import { useDrawSignalPagination } from "@n-apt/draw-signal/context/DrawSignalPaginationContext";
import { DrawSignalOptionsSidebar } from "@n-apt/draw-signal/sidebar/DrawSignalOptionsSidebar";
import { PolarCoordsRadiationSidebar } from "@n-apt/spectrum";

export const DrawSignalSidebar: React.FC = () => {
  const { pageIndex } = useDrawSignalPagination();
  return pageIndex === 0 ? (
    <DrawSignalOptionsSidebar />
  ) : (
    <PolarCoordsRadiationSidebar />
  );
};

export default DrawSignalSidebar;
