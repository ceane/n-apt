import React, { useState } from 'react';
import { SourceSettingsSection } from './SourceSettingsSection';
import { ThemeProvider, styled } from 'styled-components';

const SidebarContainer = styled.div`
  background-color: #0a0a0a;
  padding: 20px;
  width: 350px;
  height: 100vh;
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 16px;
  align-content: start;
`;

const theme = {
  primary: '#00d4ff',
  primaryAnchor: 'rgba(0, 212, 255, 0.1)',
  fft: '#00d4ff',
  mode: 'dark',
};

export const LiveSource = () => {
  const [gain, setGain] = useState(40);
  const [ppm, setPpm] = useState(0);
  const [tunerAGC, setTunerAGC] = useState(false);
  const [rtlAGC, setRtlAGC] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <SidebarContainer>
        <SourceSettingsSection
          sourceMode="live"
          gain={gain}
          ppm={ppm}
          tunerAGC={tunerAGC}
          rtlAGC={rtlAGC}
          stitchSourceSettings={{ gain: 0, ppm: 0 }}
          isConnected={true}
          onGainChange={setGain}
          onPpmChange={setPpm}
          onTunerAGCChange={setTunerAGC}
          onRtlAGCChange={setRtlAGC}
          onStitchSourceSettingsChange={() => {}}
          onAgcModeChange={() => {}}
        />
      </SidebarContainer>
    </ThemeProvider>
  );
};

export const FileSource = () => {
  const [stitchSettings, setStitchSettings] = useState({ gain: 20, ppm: 57 });

  return (
    <ThemeProvider theme={theme}>
      <SidebarContainer>
        <SourceSettingsSection
          sourceMode="file"
          gain={0}
          ppm={0}
          tunerAGC={false}
          rtlAGC={false}
          stitchSourceSettings={stitchSettings}
          isConnected={true}
          onGainChange={() => {}}
          onPpmChange={() => {}}
          onTunerAGCChange={() => {}}
          onRtlAGCChange={() => {}}
          onStitchSourceSettingsChange={setStitchSettings}
          onAgcModeChange={() => {}}
        />
      </SidebarContainer>
    </ThemeProvider>
  );
};

export const Disconnected = () => (
  <ThemeProvider theme={theme}>
    <SidebarContainer>
      <SourceSettingsSection
        sourceMode="live"
        gain={0}
        ppm={0}
        tunerAGC={false}
        rtlAGC={false}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isConnected={false}
        onGainChange={() => {}}
        onPpmChange={() => {}}
        onTunerAGCChange={() => {}}
        onRtlAGCChange={() => {}}
        onStitchSourceSettingsChange={() => {}}
        onAgcModeChange={() => {}}
      />
    </SidebarContainer>
  </ThemeProvider>
);

export default {
  title: 'Sidebar/Source Settings',
};
