import React, { useCallback } from "react";
import styled from "styled-components";
import { useDemod, AnalysisType } from "@n-apt/contexts/DemodContext";
import { Button } from "@n-apt/components/ui";

const TriggersContainer = styled.div`
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
`;

const ControlSection = styled.div`
  display: grid;
  grid-template-columns: subgrid;
  grid-auto-flow: column;
  gap: 16px;
  margin: 16px auto;
  align-items: start;
  width: 100%;
`;

const PreviewSection = styled.div`
  background: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  height: 450px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.35);
`;

const MediaOverlay = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  font-size: 10px;
  color: ${(props) => props.theme.textMuted};
  font-family: "JetBrains Mono", monospace;
  text-transform: uppercase;
`;

const WaveformContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  height: 40px;
`;

const WaveBar = styled.div<{ $active: boolean }>`
  width: 3px;
  height: ${props => props.$active ? '100%' : '20%'};
  background: ${(props) => props.theme.primary};
  border-radius: 1px;
  animation: ${props => props.$active ? 'bounce 0.5s infinite ease-in-out' : 'none'};

  @keyframes bounce {
    0%, 100% { transform: scaleY(0.5); }
    50% { transform: scaleY(1.5); }
  }
`;

const ScriptText = styled.div`
  color: ${(props) => props.theme.success};
  font-family: "JetBrains Mono", monospace;
  font-size: 28px;
  font-weight: bold;
  text-align: center;
  max-width: 90%;
  animation: flicker 2s infinite;
  text-transform: uppercase;
  letter-spacing: 2px;
  line-height: 1.4;

  @keyframes flicker {
    0%, 100% { opacity: 1; text-shadow: 0 0 10px rgba(0, 255, 136, 0.35); }
    50% { opacity: 0.8; text-shadow: 0 0 20px rgba(0, 255, 136, 0.6); }
  }
`;

const TriggerCaptureSection = styled.div``

const TriggerButton = styled(Button)`

  &:hover:not(:disabled) {
    border-color: ${(props) => props.theme.primary};
    box-shadow: 0 0 20px ${(props) => props.theme.primaryAlpha};
    transform: translateY(-2px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Select = styled.select`
  background: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.border};
  color: ${(props) => props.theme.primary};
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-family: "JetBrains Mono", monospace;
  width: 100%;
  cursor: pointer;
  outline: none;

  &:hover {
    border-color: ${(props) => props.theme.borderHover};
  }

  &:focus {
    border-color: ${(props) => props.theme.primary};
  }
`;

const ToggleContainer = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
`;

const ToggleTrack = styled.div<{ $active: boolean }>`
  width: 36px;
  height: 20px;
  background: ${props => props.$active ? props.theme.primary : props.theme.surfaceHover};
  border-radius: 10px;
  position: relative;
  transition: background 0.3s ease;

  &::after {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    background: ${(props) => props.theme.textPrimary};
    border-radius: 50%;
    top: 3px;
    left: ${props => props.$active ? '19px' : '3px'};
    transition: left 0.3s ease;
  }
`;

const ToggleLabel = styled.span`
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: ${(props) => props.theme.textSecondary};
`;

const ResultCard = styled.div`
  background: ${(props) => props.theme.surface}66;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  padding: 16px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
`;

const ResultItem = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  color: ${(props) => props.theme.textSecondary};
`;

const AnalysisLabel = styled.div`
  font-size: 12px;
  color: ${(props) => props.theme.primary};
  font-family: "JetBrains Mono", monospace;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 8px;
`;

const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const VersionLabel = styled.div`
  font-size: 10px;
  color: #444;
`;

const AudioContainer = styled.div`
  text-align: center;
`;

const ToneLabel = styled.div`
  color: #00d4ff;
  font-size: 12px;
  margin-top: 12px;
  font-family: "JetBrains Mono";
`;

const InternalContainer = styled.div`
  text-align: center;
  width: 80%;
`;

const SignalAnalysisLabel = styled.div`
  color: #00d4ff;
  font-size: 12px;
  margin-bottom: 20px;
  font-family: "JetBrains Mono";
`;

const StatusText = styled.div`
  color: #555;
  font-size: 10px;
  margin-top: 30px;
`;

const SpeechContainer = styled.div`
  text-align: center;
  width: 80%;
`;

const VocalCaptureLabel = styled.div`
  color: #00ff88;
  font-size: 12px;
  margin-bottom: 20px;
  font-family: "JetBrains Mono";
`;

const SpeechBarsContainer = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 40px;
  justify-content: center;
  height: 60px;
  align-items: center;
`;

const SpeechBar = styled.div<{ $isCapturing: boolean }>`
  width: 4px;
  height: ${props => props.$isCapturing ? 'var(--bar-height, 4px)' : '4px'};
  background: ${props => props.$isCapturing ? '#00ff88' : '#333'};
  transition: height 0.05s ease;
  box-shadow: ${props => props.$isCapturing ? '0 0 10px rgba(0,255,136,0.3)' : 'none'};
  border-radius: 2px;
`;

const VisionContainer = styled.div<{ $isCapturing: boolean }>`
  width: 100%;
  height: 100%;
  background: ${props => props.$isCapturing ? '#ff0000' : '#111'};
  display: flex;
  align-items: center;
  justify-content: center;
`;

const RecIndicator = styled.div<{ $isCapturing: boolean }>`
  color: ${props => props.$isCapturing ? 'white' : '#333'};
  font-size: 20px;
  font-weight: bold;
  border: 4px solid;
`;

const CountdownOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 100;
`;

const CountdownLabel = styled.div`
  color: #ff4444;
  font-size: 16px;
  margin-bottom: 12px;
  letter-spacing: 4px;
`;

const CountdownNumber = styled.div`
  color: #ff4444;
  font-size: 120px;
  font-weight: bold;
  font-family: "JetBrains Mono";
`;

const AnalyzingOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0,212,255,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const AnalyzingText = styled.div`
  color: #00d4ff;
  font-size: 14px;
  font-weight: bold;
  font-family: "JetBrains Mono";
`;

const BaselineSelectorContainer = styled.div`
  margin-bottom: 16px;
`;

const BaselineLabel = styled.div`
  color: #888;
  font-size: 11px;
  margin-bottom: 8px;
  font-family: "JetBrains Mono";
`;

const ToggleContainerWrapper = styled.div`
  margin-bottom: 16px;
`;

const HiddenCheckbox = styled.input`
  display: none;
`;

const ToggleDescription = styled.div`
  font-size: 9px;
  color: #444;
  margin-top: 4px;
  padding-left: 46px;
`;

const TriggerButtonContent = styled.div`
  display: flex;
  justify-content: space-between;
  width: 100%;
  align-items: center;
`;

const TriggerButtonText = styled.span`
  font-weight: bold;
  color: #00d4ff;
`;

const TriggerDescription = styled.div`
  font-size: 11px;
  color: #666;
`;

const ResetButton = styled.button`
  background: transparent;
  border: none;
  color: #444;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  text-decoration: underline;
`;

const ResultCardStyled = styled(ResultCard)`
  margin-top: 0;
  border: 1px solid #00ff88;
  background: rgba(0, 255, 136, 0.05);
`;

const ResultHeader = styled.div`
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(0,255,136,0.2);
  padding-bottom: 8px;
  font-weight: bold;
`;

const ResultValue = styled.span`
  color: #fff;
`;

const ResultSummary = styled.div`
  color: #ccc;
  margin-top: 12px;
  line-height: 1.4;
`;

const WaitingContainer = styled.div`
  padding: 20px;
  border: 1px dashed #222;
  border-radius: 8px;
  text-align: center;
  color: #333;
  font-size: 11px;
`;

const SCRIPT_VARIANTS = [
  "The quick brown fox jumps over the lazy dog",
  "Sphinx of black quartz, judge my vow",
  "Pack my box with five dozen liquor jugs",
  "Five quacking zephyrs jolt my wax bed",
  "The five boxing wizards jump quickly",
  "How vexingly quick daft zebras jump",
  "Bright vixens jump; doozy fowl quack",
  "Quick wafting zephyrs vex bold Jim",
  "Two driven jocks help fax my big quiz",
  "Jinxed wizards pluck ivy from the big quilt"
];

export const DemodFromIQ: React.FC = () => {
  const {
    analysisSession,
    selectedBaseline,
    setSelectedBaseline,
    liveMode,
    setLiveMode,
    startAnalysis,
    clearAnalysis
  } = useDemod();

  const [scriptIndex, setScriptIndex] = React.useState(0);
  const [, setTick] = React.useState(0);

  // Refs for scrolling to results
  const resultsSectionRef = React.useRef<HTMLDivElement>(null);
  const wasPreviouslyAnalyzing = React.useRef(false);

  // Drive animation
  React.useEffect(() => {
    if (analysisSession.state === 'capturing') {
      const interval = setInterval(() => setTick(t => t + 1), 50);
      wasPreviouslyAnalyzing.current = true;
      return () => clearInterval(interval);
    }
  }, [analysisSession.state]);

  // Scroll to results when analysis completes
  React.useEffect(() => {
    if (analysisSession.state === 'result' && wasPreviouslyAnalyzing.current) {
      // Reset the flag
      wasPreviouslyAnalyzing.current = false;

      // Scroll to results section
      const scrollToResults = () => {
        if (resultsSectionRef.current) {
          resultsSectionRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }

        // Also try to scroll any sidebar results if they exist
        const sidebarResults = document.querySelector('[data-sidebar-results]');
        if (sidebarResults) {
          sidebarResults.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      };

      // Small delay to ensure DOM is updated
      setTimeout(scrollToResults, 100);
    }
  }, [analysisSession.state]);

  const playTone = useCallback(() => {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);

    // Smooth fade in/out to avoid clicking
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 10); // Longer play

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 10);
  }, []);

  const handleTrigger = (type: AnalysisType) => {
    // If audio-related, we need to wait for the actual capture start (after 3s countdown)
    // but the startAnalysis function handles its own internal timing.
    // To ensure sound is heard during capture, we'll delay it.
    if (type === 'audio' || type === 'internal') {
      setTimeout(() => playTone(), 3000); // Wait for countdown
    }

    if (type === 'internal' || type === 'speech') {
      setScriptIndex(Math.floor(Math.random() * SCRIPT_VARIANTS.length));
    }

    startAnalysis(type, liveMode);
  };

  const isBusy = analysisSession.state !== 'idle' && analysisSession.state !== 'result';
  const isCapturing = analysisSession.state === 'capturing';

  return (
    <TriggersContainer>
      <HeaderContainer>
        <AnalysisLabel>Demodulation Engine</AnalysisLabel>
        <VersionLabel>v2.4.0-BASELINE</VersionLabel>
      </HeaderContainer>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <PreviewSection>
          <MediaOverlay>Media Playback Interface</MediaOverlay>

          {selectedBaseline === 'audio' && (
            <AudioContainer>
              <WaveformContainer>
                {Array.from({ length: 20 }).map((_, i) => (
                  <WaveBar key={i} $active={isCapturing} style={{ animationDelay: `${i * 0.05}s` }} />
                ))}
              </WaveformContainer>
              <ToneLabel>440Hz SINE TONE</ToneLabel>
            </AudioContainer>
          )}

          {selectedBaseline === 'internal' && (
            <InternalContainer>
              <SignalAnalysisLabel>Signal Analysis</SignalAnalysisLabel>
              <ScriptText>
                {isCapturing ? SCRIPT_VARIANTS[scriptIndex] : "Ready for analysis"}
              </ScriptText>
              <StatusText>
                {isCapturing ? "Processing..." : "Ready"}
              </StatusText>
            </InternalContainer>
          )}

          {selectedBaseline === 'speech' && (
            <SpeechContainer>
              <VocalCaptureLabel>VOCAL CAPTURE INTERFACE</VocalCaptureLabel>
              <ScriptText style={{ color: '#00ff88' }}>
                {isCapturing ? SCRIPT_VARIANTS[scriptIndex] : "Ready for vocal input"}
              </ScriptText>
              <SpeechBarsContainer>
                {[...Array(20)].map((_, i) => {
                  // Create a sine wave pattern for the bars
                  const barHeight = isCapturing ? (10 + Math.sin(Date.now() * 0.01 + i * 0.3) * 25 + 25) : 4;
                  return (
                    <SpeechBar
                      key={i}
                      $isCapturing={isCapturing}
                      style={{ '--bar-height': `${barHeight}px` } as React.CSSProperties}
                    />
                  );
                })}
              </SpeechBarsContainer>
            </SpeechContainer>
          )}

          {selectedBaseline === 'vision' && (
            <VisionContainer $isCapturing={isCapturing}>
              <RecIndicator $isCapturing={isCapturing}>
                REC
              </RecIndicator>
            </VisionContainer>
          )}

          {analysisSession.state === 'capturing' && typeof analysisSession.countdown === 'number' && analysisSession.countdown > 0 && (
            <CountdownOverlay>
              <CountdownLabel>SEQUENCE STARTING IN</CountdownLabel>
              <CountdownNumber>{analysisSession.countdown}</CountdownNumber>
            </CountdownOverlay>
          )}

          {analysisSession.state === 'analyzing' && (
            <AnalyzingOverlay>
              <AnalyzingText>
                Demodulating N-APT...
              </AnalyzingText>
            </AnalyzingOverlay>
          )}
        </PreviewSection>

        <ControlSection>
          <BaselineSelectorContainer>
            <BaselineLabel>SELECT BASELINE VECTOR</BaselineLabel>
            <Select
              value={selectedBaseline}
              onChange={(e) => setSelectedBaseline(e.target.value as AnalysisType)}
              disabled={isBusy}
            >
              <option value="audio">Audio (Hearing)</option>
              <option value="internal">Audio (Internal)</option>
              <option value="speech">Speech</option>
              <option value="vision">Vision</option>
            </Select>
          </BaselineSelectorContainer>

          <ToggleContainerWrapper>
            <ToggleContainer>
              <HiddenCheckbox
                type="checkbox"
                checked={liveMode}
                onChange={(e) => setLiveMode(e.target.checked)}
                disabled={isBusy}
              />
              <ToggleTrack $active={liveMode} />
              <ToggleLabel style={{ color: liveMode ? '#00d4ff' : '#888' }}>
                LIVE CAPTURE (EPHEMERAL)
              </ToggleLabel>
            </ToggleContainer>
            <ToggleDescription>
              Discard IQ capture after analysis
            </ToggleDescription>
          </ToggleContainerWrapper>

          <TriggerCaptureSection>
            <TriggerButton disabled={isBusy} onClick={() => handleTrigger(selectedBaseline)}>
              <TriggerButtonContent>
                <TriggerButtonText>TRIGGER CAPTURE</TriggerButtonText>
              </TriggerButtonContent>
            </TriggerButton>
            <TriggerDescription>
              Initiate 5s reference capture for {selectedBaseline} analysis.
            </TriggerDescription>
          </TriggerCaptureSection>

          {analysisSession.state === 'result' && (
            <ResetButton onClick={clearAnalysis}>
              Reset Session
            </ResetButton>
          )}
        </ControlSection>

        <ControlSection ref={resultsSectionRef}>
          {analysisSession.state === 'result' ? (
            <ResultCardStyled>
              <ResultHeader>
                ANALYSIS REPORT: {analysisSession.type?.toUpperCase()}
              </ResultHeader>
              <ResultItem><span>Confidence:</span> <ResultValue>{(analysisSession.result.confidence * 100).toFixed(1)}%</ResultValue></ResultItem>
              <ResultItem><span>Match Rate:</span> <ResultValue>{(analysisSession.result.matchRate * 100).toFixed(1)}%</ResultValue></ResultItem>
              <ResultItem><span>SNR Delta:</span> <ResultValue>{analysisSession.result.snrDelta}</ResultValue></ResultItem>
              <ResultSummary>{analysisSession.result.summary}</ResultSummary>
            </ResultCardStyled>
          ) : (
            <WaitingContainer>
              WAITING FOR CAPTURE RESULT...
            </WaitingContainer>
          )}
        </ControlSection>
      </div>
    </TriggersContainer>
  );
};

export default DemodFromIQ;
