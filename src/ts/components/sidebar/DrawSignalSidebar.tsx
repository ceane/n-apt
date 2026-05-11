import React from "react";
import { useDrawSignalPagination } from "@n-apt/contexts/DrawSignalPaginationContext";
import { DrawSignalOptionsSidebar } from "@n-apt/components/sidebar/DrawSignalOptionsSidebar";
import { PolarCoordsRadiationSidebar } from "@n-apt/components/sidebar/PolarCoordsRadiationSidebar";

export const DrawSignalSidebar: React.FC = () => {
  const { pageIndex } = useDrawSignalPagination();
  return pageIndex === 0 ? (
    <DrawSignalOptionsSidebar />
  ) : (
    <PolarCoordsRadiationSidebar />
  );
};

export default DrawSignalSidebar;
