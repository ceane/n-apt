import React from "react";
import styled from "styled-components";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import DrawMockNAPTSidebar from "@n-apt/components/sidebar/DrawMockNAPTSidebar";

const SidebarContent = styled.div`
  padding: 0 24px;
`;

export const DrawSignalSidebar: React.FC = () => {
  const { state, dispatch } = useSpectrumStore();

  return (
    <SidebarContent>
      <DrawMockNAPTSidebar
        drawParams={state.drawParams}
        onDrawParamsChange={(params) => dispatch({ type: "SET_DRAW_PARAMS", params })}
      />
    </SidebarContent>
  );
};

export default DrawSignalSidebar;
