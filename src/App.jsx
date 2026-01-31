import { useState, useEffect, useCallback, useRef } from 'react';
import styled from 'styled-components';
import Sidebar from './components/Sidebar';
import SpectrumVisualizer from './components/SpectrumVisualizer';
import StitcherVisualizer from './components/StitcherVisualizer';
import DrawMockNAPT from './components/DrawMockNAPT';
import HumanModelViewer from './components/HumanModelViewer';
import { useWebSocket } from './hooks/useWebSocket';

const AppContainer = styled.div`
  display: flex;
  width: 100%;
  height: 100vh;
  background-color: #0a0a0a;
`;

const MainContent = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const PlaceholderContent = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #444;
  font-size: 14px;
`;

const TabContainer = styled.div`
  display: flex;
  background-color: #0d0d0d;
  border-bottom: 1px solid #1a1a1a;
  padding: 0 20px;
`;

const Tab = styled.button`
  padding: 12px 24px;
  background-color: ${props => props.$active ? '#1a1a1a' : 'transparent'};
  border: none;
  border-bottom: 2px solid ${props => props.$active ? '#00d4ff' : 'transparent'};
  color: ${props => props.$active ? '#00d4ff' : '#666'};
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    color: ${props => props.$active ? '#00d4ff' : '#888'};
    background-color: #1a1a1a;
  }
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`;

function App() {
  // Main tabs: 'spectrum', 'draw-signal', '3d-model'
  const [mainTab, setMainTab] = useState('spectrum');
  
  // Spectrum-specific state
  const [activeTab, setActiveTab] = useState('visualizer');
  const [activeSignalArea, setActiveSignalArea] = useState('A');
  const [frequencyRange, setFrequencyRange] = useState({ min: 0, max: 3.2 });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const isVisualizer = activeTab === 'visualizer';
  const isStitcher = activeTab === 'stitcher';
  const { isConnected, isDeviceConnected, isPaused, data, sendFrequencyRange, sendPauseCommand } = useWebSocket('ws://localhost:8765', isVisualizer && mainTab === 'spectrum');

  // Use ref for stitch handler to avoid stale closures
  const stitchHandlerRef = useRef(null);

  const handleStitch = useCallback(() => {
    console.log('App.jsx handleStitch called, stitchHandlerRef.current:', typeof stitchHandlerRef.current);
    if (stitchHandlerRef.current) {
      stitchHandlerRef.current();
    } else {
      console.error('stitchHandlerRef.current is null! Visualizer may not be ready.');
    }
  }, []);

  const handleClear = () => {
    setSelectedFiles([]);
  };

  // Trigger pause when leaving visualizer tab, resume when returning
  useEffect(() => {
    if (isConnected && mainTab === 'spectrum') {
      sendPauseCommand(!isVisualizer);
    }
  }, [isVisualizer, isConnected, sendPauseCommand, mainTab]);

  const handleSignalAreaChange = (area) => {
    // Only reset frequency range when switching to a different area
    if (area !== activeSignalArea) {
      setActiveSignalArea(area);
      // Update frequency range based on selected area
      if (area === 'A') {
        setFrequencyRange({ min: 0, max: 3.2 });
      } else if (area === 'B') {
        setFrequencyRange({ min: 26, max: 28.2 });
      }
    }
  };

  const handleFrequencyRangeChange = (range) => {
    setFrequencyRange(range);
    // Send the new frequency range to the server
    sendFrequencyRange(range);
  };

  const renderContent = () => {
    switch (mainTab) {
      case 'spectrum':
        return (
          <>
            <Sidebar
              isConnected={isConnected}
              isDeviceConnected={isDeviceConnected}
              isPaused={isPaused}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              activeSignalArea={activeSignalArea}
              onSignalAreaChange={handleSignalAreaChange}
              onFrequencyRangeChange={handleFrequencyRangeChange}
              onPauseToggle={() => sendPauseCommand(!isPaused)}
              selectedFiles={selectedFiles}
              onSelectedFilesChange={setSelectedFiles}
              onStitch={handleStitch}
              onClear={handleClear}
            />
            <MainContent>
              {isVisualizer ? (
                <SpectrumVisualizer
                  data={data}
                  frequencyRange={frequencyRange}
                  activeSignalArea={activeSignalArea}
                  isPaused={isPaused}
                />
              ) : isStitcher ? (
                <StitcherVisualizer
                  selectedFiles={selectedFiles}
                  onStitch={(handler) => {
                    console.log('App.jsx onStitch called with handler:', typeof handler);
                    stitchHandlerRef.current = handler;
                  }}
                  onClear={handleClear}
                />
              ) : (
                <PlaceholderContent>
                  N-APT Live Deep Analysis - Coming Soon
                </PlaceholderContent>
              )}
            </MainContent>
          </>
        );
      case 'draw-signal':
        return (
          <MainContent style={{ overflow: 'auto' }}>
            <div style={{ padding: '20px', height: '100%' }}>
              <DrawMockNAPT />
            </div>
          </MainContent>
        );
      case '3d-model':
        return (
          <MainContent>
            <HumanModelViewer />
          </MainContent>
        );
      default:
        return null;
    }
  };

  return (
    <AppContainer>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <TabContainer>
          <Tab $active={mainTab === 'spectrum'} onClick={() => setMainTab('spectrum')}>
            Spectrum Analyzer
          </Tab>
          <Tab $active={mainTab === 'draw-signal'} onClick={() => setMainTab('draw-signal')}>
            Draw Signal Form
          </Tab>
          <Tab $active={mainTab === '3d-model'} onClick={() => setMainTab('3d-model')}>
            3D Human Model
          </Tab>
        </TabContainer>
        <ContentArea>
          {renderContent()}
        </ContentArea>
      </div>
    </AppContainer>
  );
}

export default App;
