import { useRef, useCallback, useState } from 'react'
import styled from 'styled-components'
import InfoPopover from '@n-apt/components/InfoPopover'
import FrequencyRangeSlider from '@n-apt/components/FrequencyRangeSlider'

const SidebarContainer = styled.aside`
  width: 360px;
  min-width: 360px;
  height: 100vh;
  background-color: #0d0d0d;
  border-right: 1px solid #1a1a1a;
  display: flex;
  flex-direction: column;
  padding: 24px;
  overflow-y: auto;
  overflow-x: visible;
  position: relative;
`

const ConnectionStatusContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
`

const ConnectionStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 70%;
  padding: 12px 16px;
  background-color: #141414;
  border-radius: 8px;
  border: 1px solid #1f1f1f;
`

const StatusDot = styled.div<{ $connected: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${props => props.$connected ? '#00d4ff' : '#ff4444'};
  box-shadow: ${props => props.$connected ? '0 0 8px #00d4ff' : '0 0 8px #ff4444'};
  flex-shrink: 0;
`

const StatusText = styled.span`
  font-size: 12px;
  color: #888;
  font-weight: 500;
`

const PauseButton = styled.button<{ $paused: boolean }>`
  flex: 0 0 25%;
  padding: 12px 8px;
  background-color: ${props => props.$paused ? '#2a2a2a' : '#1a1a1a'};
  border: 1px solid ${props => props.$paused ? '#00d4ff' : '#2a2a2a'};
  border-radius: 8px;
  color: ${props => props.$paused ? '#00d4ff' : '#ccc'};
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #2a2a2a;
    border-color: #00d4ff;
    color: #00d4ff;
  }
`

const TabContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
`

const Tab = styled.button<{ $active: boolean }>`
  padding: 12px 16px;
  background-color: ${props => props.$active ? '#1a1a1a' : 'transparent'};
  border: 1px solid ${props => props.$active ? '#2a2a2a' : 'transparent'};
  border-radius: 8px;
  color: ${props => props.$active ? '#00d4ff' : '#666'};
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background-color: #1a1a1a;
    color: ${props => props.$active ? '#00d4ff' : '#888'};
  }
`

const Section = styled.div`
  margin-bottom: 24px;
`

const SectionTitle = styled.div`
  font-size: 11px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;

  &::after {
    content: '/';
    color: #444;
  }
`

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: #141414;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #1a1a1a;
  user-select: none;
`

const SettingLabelContainer = styled.div`
  display: flex;
  align-items: center;
`

const SettingLabel = styled.span`
  font-size: 12px;
  color: #777;
`

const SettingValue = styled.span`
  font-size: 12px;
  color: #ccc;
  font-weight: 500;
`

const SettingSelect = styled.select`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  min-width: 80px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ccc' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6,9 12,15 18,9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 2px center;
  background-size: 12px;
  padding-right: 20px;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  option {
    background-color: #1a1a1a;
    color: #ccc;
    font-family: 'JetBrains Mono', monospace;
  }
`

const SettingInput = styled.input`
  background-color: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: #ccc;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  width: 50px;
  text-align: center;

  &:hover {
    border-color: #2a2a2a;
  }

  &:focus {
    outline: none;
    border-color: #00d4ff;
    background-color: rgba(0, 212, 255, 0.05);
  }

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &[type=number] {
    -moz-appearance: textfield;
  }
`

interface SidebarProps {
  isConnected: boolean
  isDeviceConnected: boolean
  isPaused: boolean
  activeTab: string
  onTabChange: (tab: string) => void
  activeSignalArea: string
  onSignalAreaChange: (area: string) => void
  onFrequencyRangeChange: (range: { min: number; max: number }) => void
  onPauseToggle: () => void
  selectedFiles: { name: string }[]
  onSelectedFilesChange: (files: { name: string }[]) => void
  onStitch: () => void
  onClear: () => void
}

const Sidebar = ({
  isConnected,
  isDeviceConnected,
  isPaused,
  activeTab,
  onTabChange,
  activeSignalArea,
  onSignalAreaChange,
  onFrequencyRangeChange,
  onPauseToggle,
  selectedFiles,
  onSelectedFilesChange,
  onStitch,
  onClear
}: SidebarProps) => {
  // FFT Settings state
  const [fftSize, setFftSize] = useState(103432)
  const [fftWindow, setFftWindow] = useState('Rectangular')
  const [fftFrameRate, setFftFrameRate] = useState(60)
  
  // Stitcher state (using props to sync with App component)
  const setSelectedFiles = onSelectedFilesChange

  // Use refs to track last notified values to prevent excessive updates
  const lastNotifiedRangeRef = useRef({ min: 0, max: 3.2 })

  const handleAreaARangeChange = useCallback((range: { min: number; max: number }) => {
    if (activeSignalArea === 'A') {
      // Always notify for real-time spectral drift effect
      lastNotifiedRangeRef.current = range
      onFrequencyRangeChange?.(range)
    }
  }, [activeSignalArea, onFrequencyRangeChange])

  const handleAreaBRangeChange = useCallback((range: { min: number; max: number }) => {
    if (activeSignalArea === 'B') {
      const minDiff = Math.abs(range.min - lastNotifiedRangeRef.current.min)
      const maxDiff = Math.abs(range.max - lastNotifiedRangeRef.current.max)
      if (minDiff > 0.01 || maxDiff > 0.01) {
        lastNotifiedRangeRef.current = range
        onFrequencyRangeChange?.(range)
      }
    }
  }, [activeSignalArea, onFrequencyRangeChange])

  return (
    <SidebarContainer>
      <TabContainer>
        <Tab 
          $active={activeTab === 'visualizer'} 
          onClick={() => onTabChange('visualizer')}
        >
          Live N-APT visualizer
        </Tab>
        <Tab 
          $active={activeTab === 'stitcher'} 
          onClick={() => onTabChange('stitcher')}
        >
          N-APT stitcher & I/Q replay
        </Tab>
        <Tab 
          $active={activeTab === 'analysis'} 
          onClick={() => onTabChange('analysis')}
        >
          N-APT live deep analysis
        </Tab>
      </TabContainer>

      {activeTab === 'visualizer' && (
        <>
      <ConnectionStatusContainer>
        <ConnectionStatus>
          <StatusDot $connected={isConnected && isDeviceConnected} />
          <StatusText>
            {!isConnected 
              ? 'Disconnected' 
              : isDeviceConnected 
                ? 'Connected to server and device' 
                : 'Connected to server but device not connected'}
          </StatusText>
        </ConnectionStatus>

        {isConnected && (
          <PauseButton $paused={isPaused} onClick={onPauseToggle}>
            {isPaused ? 'Resume' : 'Pause'}
          </PauseButton>
        )}
      </ConnectionStatusContainer>

      <Section>
        <SectionTitle>Source</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>RTL-SDR v4</SettingLabel>
            <InfoPopover 
              title="RTL-SDR v4"
              content="Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
            />
          </SettingLabelContainer>
          <SettingValue>{isConnected && isDeviceConnected ? 'Active' : 'Unavailable'}</SettingValue>
        </SettingRow>
      </Section>

      <Section>
        <SectionTitle>Signal areas of interest</SectionTitle>
        <FrequencyRangeSlider 
          label="A"
          minFreq={0}
          maxFreq={4.75}
          visibleMin={0}
          visibleMax={3.2}
          isActive={activeSignalArea === 'A'}
          onActivate={() => onSignalAreaChange?.('A')}
          onRangeChange={handleAreaARangeChange}
        />
        <FrequencyRangeSlider 
          label="B"
          minFreq={24.15}
          maxFreq={30}
          visibleMin={26}
          visibleMax={28.2}
          isActive={activeSignalArea === 'B'}
          onActivate={() => onSignalAreaChange?.('B')}
          onRangeChange={handleAreaBRangeChange}
        />
      </Section>

      <Section>
        <SectionTitle>Signal kind</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>N-APT</SettingLabel>
            <InfoPopover
              title="N-APT"
              content="NOAA Automatic Picture Transmission - Weather satellite imagery transmitted in analog format."
            />
          </SettingLabelContainer>
          <SettingValue>Active</SettingValue>
        </SettingRow>
      </Section>

      <Section>
        <SectionTitle>Signal display</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>FFT Size</SettingLabel>
            <InfoPopover
              title="FFT Size"
              content="Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."
            />
          </SettingLabelContainer>
          <SettingSelect value={fftSize} onChange={(e) => setFftSize(Number(e.target.value))}>
            <option value={8192}>8192</option>
            <option value={16384}>16384</option>
            <option value={32768}>32768</option>
            <option value={65536}>65536</option>
            <option value={103432}>103432</option>
            <option value={131072}>131072</option>
            <option value={262144}>262144</option>
          </SettingSelect>
        </SettingRow>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>FFT Window</SettingLabel>
            <InfoPopover
              title="FFT Window"
              content="Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium."
            />
          </SettingLabelContainer>
          <SettingSelect value={fftWindow} onChange={(e) => setFftWindow(e.target.value)}>
            <option value="Rectangular">Rectangular</option>
            <option value="Blackman">Blackman</option>
            <option value="Nuttall">Nuttall</option>
          </SettingSelect>
        </SettingRow>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>FFT Frame Rate</SettingLabel>
            <InfoPopover
              title="FFT Frame Rate"
              content="Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit."
            />
          </SettingLabelContainer>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <SettingInput
              type="number"
              value={fftFrameRate}
              onChange={(e) => setFftFrameRate(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
              min="1"
              max="120"
            />
            <span style={{ fontSize: '12px', color: '#ccc', fontWeight: '500' }}>fps</span>
          </div>
        </SettingRow>
      </Section>

      <Section>
        <SectionTitle>Source Settings</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>PPM</SettingLabel>
            <InfoPopover 
              title="PPM Correction"
              content="Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit."
            />
          </SettingLabelContainer>
          <SettingValue>1</SettingValue>
        </SettingRow>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Gain</SettingLabel>
            <InfoPopover 
              title="Gain Setting"
              content="Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur."
            />
          </SettingLabelContainer>
          <SettingValue>+49.06dB</SettingValue>
        </SettingRow>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Bandwidth</SettingLabel>
            <InfoPopover 
              title="Bandwidth"
              content="At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum."
            />
          </SettingLabelContainer>
          <SettingValue>3.2MHz (max)</SettingValue>
        </SettingRow>
      </Section>
        </>
      )}

      {activeTab === 'stitcher' && (
        <>
      <Section>
        <SectionTitle>File selection</SectionTitle>
        <SettingRow>
          <SettingLabelContainer>
            <SettingLabel>Choose files...</SettingLabel>
          </SettingLabelContainer>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="file"
              accept=".c64"
              multiple
              style={{
                display: 'none'
              }}
              id="fileInput"
              onChange={(e) => e.target.files && setSelectedFiles(Array.from(e.target.files))}
            />
            <PauseButton 
              $paused={false} 
              onClick={() => document.getElementById('fileInput')?.click()}
              style={{ flex: 'none', fontSize: '11px', padding: '8px 12px' }}
            >
              Browse
            </PauseButton>
          </div>
        </SettingRow>
      </Section>

      {selectedFiles.length > 0 && (
        <>
      <Section>
        <SectionTitle>Selected files ({selectedFiles.length})</SectionTitle>
        {selectedFiles.map((file, index) => (
          <SettingRow key={index}>
            <SettingLabelContainer>
              <SettingLabel style={{ fontSize: '11px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </SettingLabel>
            </SettingLabelContainer>
            <PauseButton
              $paused={false}
              onClick={() => setSelectedFiles(selectedFiles.filter((_, i) => i !== index))}
              style={{ flex: 'none', fontSize: '10px', padding: '4px 8px', background: 'transparent' }}
            >
              Remove
            </PauseButton>
          </SettingRow>
        ))}
      </Section>

      <Section>
        <div style={{ display: 'flex', gap: '8px' }}>
          <PauseButton
            $paused={false}
            onClick={() => onStitch()}
            style={{ flex: 1 }}
          >
            Stitch spectrum
          </PauseButton>
          <PauseButton
            $paused={false}
            onClick={() => onClear()}
            style={{ flex: 1, background: 'transparent' }}
          >
            Clear
          </PauseButton>
        </div>
      </Section>
        </>
      )}
        </>
      )}
    </SidebarContainer>
  )
}

export default Sidebar
