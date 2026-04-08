import React, { useState } from "react";
import styled from "styled-components";
import { useAppSelector, useAppDispatch, setDrawSignal3D } from "@n-apt/redux";
import { Row, Collapsible } from "@n-apt/components/ui";
import { Toggle } from "@n-apt/components/ui/Toggle";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  padding: ${(props) => (props.theme.mode === "light" ? props.theme.spacing.sm : 0)};
  background-color: ${(props) => (props.theme.mode === "light" ? props.theme.surface : "transparent")};
  border-radius: 8px;
  border: ${(props) =>
    props.theme.mode === "light" ? `1px solid ${props.theme.border}` : "none"};
  box-sizing: border-box;
  width: 100%;
  color: ${(props) => props.theme.textPrimary};
`;

interface FFTWaterfallSectionProps {
  sourceMode: "live" | "file";
  deviceState: string;
  isConnected: boolean;
  selectedFilesCount: number;
}

export const FFTWaterfallSection: React.FC<FFTWaterfallSectionProps> = ({
  sourceMode,
  deviceState: _deviceState,
  isConnected: _isConnected,
  selectedFilesCount,
}) => {
  const [isOpen] = useState(false);
  const dispatch = useAppDispatch();
  const drawSignal3D = useAppSelector(state => state.waterfall.drawSignal3D);

  const isFileSource = sourceMode === "file";
  const isDisabled = isFileSource ? selectedFilesCount === 0 : false;

  const handleToggle = () => {
    dispatch(setDrawSignal3D(!drawSignal3D));
  };

  return (
    <Section>
      <Collapsible
        label="FFT/Waterfall Drawing options"
        defaultOpen={isOpen}
      >
        <Row
          label="Draw Signal 3D"
          tooltipTitle="3D FFT Waterfall"
          tooltip="Render FFT frames as stacked lines in 3D space, creating a waterfall visualization effect."
        >
          <Toggle
            $active={drawSignal3D}
            disabled={isDisabled}
            onClick={handleToggle}
          >
            {drawSignal3D ? "ON" : "OFF"}
          </Toggle>
        </Row>
      </Collapsible>
    </Section>
  );
};
