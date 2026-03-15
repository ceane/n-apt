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
        activeClumpIndex={state.activeClumpIndex}
        globalNoiseFloor={state.globalNoiseFloor}
        onDrawParamsChange={(params) =>
          dispatch({ type: "SET_DRAW_PARAMS", params })
        }
        onActiveClumpIndexChange={(index) =>
          dispatch({ type: "SET_ACTIVE_CLUMP_INDEX", index })
        }
        onGlobalNoiseFloorChange={(noise) =>
          dispatch({ type: "SET_GLOBAL_NOISE_FLOOR", noise })
        }
        onResetParams={() =>
          dispatch({ type: "RESET_DRAW_PARAMS" })
        }
      />
    </SidebarContent>
  );
};

export default DrawSignalSidebar;
