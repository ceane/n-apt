import React, { useState } from "react";
import styled from "styled-components";
import { useAppSelector, useAppDispatch } from "@n-apt/redux";
import { waterfallActions } from "@n-apt/redux";
import { Row, CollapsibleTitle } from "@n-apt/components/ui";
import { Toggle } from "@n-apt/components/ui/Toggle";

const Section = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  gap: inherit;
  box-sizing: border-box;
  width: 100%;
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
  const [isOpen, setIsOpen] = useState(false);
  const dispatch = useAppDispatch();
  const drawSignal3D = useAppSelector(state => state.waterfall.drawSignal3D);

  const isFileSource = sourceMode === "file";
  const isDisabled = isFileSource ? selectedFilesCount === 0 : false;

  const handleToggle = () => {
    dispatch(waterfallActions.setDrawSignal3D(!drawSignal3D));
  };

  return (
    <Section>
      <CollapsibleTitle
        label="FFT/Waterfall Drawing options"
        isOpen={isOpen}
        onToggle={() => setIsOpen((prev) => !prev)}
      />

      {isOpen && (
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
      )}
    </Section>
  );
};
