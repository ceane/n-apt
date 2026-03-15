import React, { useState } from 'react';
import { PolarRadioWaveWebGPU } from "@n-apt/components/3D/PolarRadioWaveWebGPU";
import styled from 'styled-components';

const DemoWrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  background: #050507;
  color: #fff;
  padding: 40px;
  box-sizing: border-box;
  overflow: auto;
`;

const ControlsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 40px;
  background: rgba(255, 255, 255, 0.05);
  padding: 24px;
  border-radius: 12px;
  border: 1px solid rgba(172, 119, 255, 0.1);
`;

const ControlItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;

  label {
    font-size: 12px;
    color: #ac77ff;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
  }

  input {
    width: 100%;
    accent-color: #ac77ff;
  }
`;

const ChartWrapper = styled.div`
  flex: 1;
  min-height: 500px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
`;

export const PolarChartDemo: React.FC = () => {
  const [antennaRadius, setAntennaRadius] = useState(40);
  const [beamWidth, setBeamWidth] = useState(30);
  const [rotation, setRotation] = useState(0);

  return (
    <DemoWrapper>
      <h1 style={{ marginTop: 0, fontSize: '24px', fontWeight: 300 }}>Polar Radio Wave Architecture</h1>
      <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '32px' }}>
        Modeling diffraction limits and lobe structures relative to antenna physical geometry.
      </p>

      <ControlsGrid>
        <ControlItem>
          <label>Antenna Physical Radius: {antennaRadius}px</label>
          <input
            type="range" min="10" max="100"
            value={antennaRadius}
            onChange={(e) => setAntennaRadius(Number(e.target.value))}
          />
        </ControlItem>

        <ControlItem>
          <label>Beam Width: {beamWidth}°</label>
          <input
            type="range" min="5" max="90"
            value={beamWidth}
            onChange={(e) => setBeamWidth(Number(e.target.value))}
          />
        </ControlItem>

        <ControlItem>
          <label>Orientation: {rotation}°</label>
          <input
            type="range" min="0" max="360"
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value))}
          />
        </ControlItem>
      </ControlsGrid>

      <ChartWrapper>
        <PolarRadioWaveWebGPU
          aperture={antennaRadius}
          beamWidth={beamWidth}
          rotation={rotation}
        />
      </ChartWrapper>
    </DemoWrapper>
  );
};
