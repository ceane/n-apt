import React, { useCallback } from "react";
import styled from "styled-components";
import { useDemod, AnalysisType } from "../../contexts/DemodContext";

const TriggersContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  background: #0d0d0d;
  border: 1px solid #222;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
`;

const MainGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const ControlSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const PreviewSection = styled.div`
  background: #000;
  border: 1px solid #1a1a1a;
  border-radius: 12px;
  height: 450px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 0 50px rgba(0, 0, 0, 1);
`;

const MediaOverlay = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  font-size: 10px;
  color: #555;
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
  background: #00d4ff;
  border-radius: 1px;
  animation: ${props => props.$active ? 'bounce 0.5s infinite ease-in-out' : 'none'};

  @keyframes bounce {
    0%, 100% { transform: scaleY(0.5); }
    50% { transform: scaleY(1.5); }
  }
`;

const ScriptText = styled.div`
  color: #00ff88;
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
    0%, 100% { opacity: 1; text-shadow: 0 0 10px rgba(0, 255, 136, 0.5); }
    50% { opacity: 0.8; text-shadow: 0 0 20px rgba(0, 255, 136, 0.8); }
  }
`;

const TriggerButton = styled.button`
  background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
  border: 1px solid #333;
  color: #eee;
  padding: 16px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-family: "JetBrains Mono", monospace;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  text-align: left;

  &:hover:not(:disabled) {
    border-color: #00d4ff;
    box-shadow: 0 0 20px rgba(0, 212, 255, 0.1);
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
  background: #1a1a1a;
  border: 1px solid #333;
  color: #00d4ff;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-family: "JetBrains Mono", monospace;
  width: 100%;
  cursor: pointer;
  outline: none;

  &:hover {
    border-color: #444;
  }

  &:focus {
    border-color: #00d4ff;
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
  background: ${props => props.$active ? '#00d4ff' : '#222'};
  border-radius: 10px;
  position: relative;
  transition: background 0.3s ease;

  &::after {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    background: #fff;
    border-radius: 50%;
    top: 3px;
    left: ${props => props.$active ? '19px' : '3px'};
    transition: left 0.3s ease;
  }
`;

const ToggleLabel = styled.span`
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: #888;
`;

const ResultCard = styled.div`
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 16px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
`;

const ResultItem = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  color: #888;
`;

const AnalysisLabel = styled.div`
  font-size: 12px;
  color: #00d4ff;
  font-family: "JetBrains Mono", monospace;
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 8px;
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

export const AnalysisTriggers: React.FC = () => {
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

  // Drive animation
  React.useEffect(() => {
    if (analysisSession.state === 'capturing') {
      const interval = setInterval(() => setTick(t => t + 1), 50);
      return () => clearInterval(interval);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <AnalysisLabel>Reference Based Demodulation Engine</AnalysisLabel>
        <div style={{ fontSize: '10px', color: '#444' }}>v2.4.0-BASELINE</div>
      </div>

      <MainGrid>
        <ControlSection>
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#888', fontSize: '11px', marginBottom: 8, fontFamily: 'JetBrains Mono' }}>SELECT BASELINE VECTOR</div>
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
          </div>

          <div style={{ marginBottom: 16 }}>
            <ToggleContainer>
               <input 
                  type="checkbox" 
                  checked={liveMode} 
                  onChange={(e) => setLiveMode(e.target.checked)} 
                  style={{ display: 'none' }}
                  disabled={isBusy}
               />
               <ToggleTrack $active={liveMode} />
               <ToggleLabel style={{ color: liveMode ? '#00d4ff' : '#888' }}>
                 LIVE CAPTURE (EPHEMERAL)
               </ToggleLabel>
            </ToggleContainer>
            <div style={{ fontSize: '9px', color: '#444', marginTop: 4, paddingLeft: 46 }}>
              Discard IQ capture after analysis
            </div>
          </div>

          <TriggerButton disabled={isBusy} onClick={() => handleTrigger(selectedBaseline)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', color: '#00d4ff' }}>TRIGGER CAPTURE</span>
              <span style={{ fontSize: '10px', opacity: 0.6 }}>IQ SYNC</span>
            </div>
            <div style={{ fontSize: '11px', color: '#666' }}>
              Initiate 5s reference capture for {selectedBaseline} analysis.
            </div>
          </TriggerButton>

          {analysisSession.state === 'result' && (
            <button 
              onClick={clearAnalysis}
              style={{ background: 'transparent', border: 'none', color: '#444', fontSize: '11px', cursor: 'pointer', textAlign: 'left', textDecoration: 'underline' }}
            >
              Reset Session
            </button>
          )}
        </ControlSection>

        <PreviewSection>
          <MediaOverlay>Media Playback Interface</MediaOverlay>
          
          {selectedBaseline === 'audio' && (
            <div style={{ textAlign: 'center' }}>
              <WaveformContainer>
                {Array.from({ length: 20 }).map((_, i) => (
                  <WaveBar key={i} $active={isCapturing} style={{ animationDelay: `${i * 0.05}s` }} />
                ))}
              </WaveformContainer>
              <div style={{ color: '#00d4ff', fontSize: '12px', marginTop: 12, fontFamily: 'JetBrains Mono' }}>
                440Hz SINE TONE
              </div>
            </div>
          )}

          {selectedBaseline === 'internal' && (
            <div style={{ textAlign: 'center', width: '80%' }}>
              <div style={{ color: '#00d4ff', fontSize: '12px', marginBottom: 20, fontFamily: 'JetBrains Mono' }}>INTERNAL SCRIPT RECONSTRUCTION</div>
              <ScriptText>
                {isCapturing ? SCRIPT_VARIANTS[scriptIndex] : "--- STANDBY FOR INJECTION ---"}
              </ScriptText>
              <div style={{ color: '#555', fontSize: '10px', marginTop: 30 }}>
                {isCapturing ? "STREAMING NEURAL VECTORS AT 12.5kbps..." : "CARRIER SYNC ACQUIRED"}
              </div>
            </div>
          )}

          {selectedBaseline === 'speech' && (
            <div style={{ textAlign: 'center', width: '80%' }}>
              <div style={{ color: '#00ff88', fontSize: '12px', marginBottom: 20, fontFamily: 'JetBrains Mono' }}>VOCAL CAPTURE INTERFACE</div>
              <ScriptText style={{ color: '#00ff88' }}>
                {isCapturing ? SCRIPT_VARIANTS[scriptIndex] : "--- AWAITING VOCAL INPUT ---"}
              </ScriptText>
              <div style={{ display: 'flex', gap: 6, marginTop: 40, justifyContent: 'center', height: 60, alignItems: 'center' }}>
                {[...Array(20)].map((_, i) => {
                  // Create a sine wave pattern for the bars
                  return (
                    <div 
                      key={i} 
                      style={{ 
                        width: 4, 
                        height: isCapturing ? (10 + Math.sin(Date.now() * 0.01 + i * 0.3) * 25 + 25) : 4, 
                        background: isCapturing ? '#00ff88' : '#333', 
                        transition: 'height 0.05s ease',
                        boxShadow: isCapturing ? '0 0 10px rgba(0,255,136,0.3)' : 'none',
                        borderRadius: '2px'
                      }} 
                    />
                  );
                })}
              </div>
            </div>
          )}

          {selectedBaseline === 'vision' && (
            <div style={{ width: '100%', height: '100%', background: isCapturing ? '#ff0000' : '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ color: isCapturing ? 'white' : '#333', fontSize: '20px', fontWeight: 'bold', border: '4px solid' }}>
                REC
              </div>
            </div>
          )}

          {analysisSession.state === 'capturing' && typeof analysisSession.countdown === 'number' && analysisSession.countdown > 0 && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
              <div style={{ color: '#ff4444', fontSize: '16px', marginBottom: 12, letterSpacing: '4px' }}>SEQUENCE STARTING IN</div>
              <div style={{ color: '#ff4444', fontSize: '120px', fontWeight: 'bold', fontFamily: 'JetBrains Mono' }}>{analysisSession.countdown}</div>
            </div>
          )}

          {analysisSession.state === 'analyzing' && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,212,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ color: '#00d4ff', fontSize: '14px', fontWeight: 'bold', fontFamily: 'JetBrains Mono' }}>
                Demodulating N-APT...
              </div>
            </div>
          )}
        </PreviewSection>

        <ControlSection>
          {analysisSession.state === 'result' ? (
            <ResultCard style={{ marginTop: 0, border: '1px solid #00ff88', background: 'rgba(0, 255, 136, 0.05)' }}>
              <div style={{ marginBottom: 16, borderBottom: '1px solid rgba(0,255,136,0.2)', paddingBottom: 8, fontWeight: 'bold' }}>
                ANALYSIS REPORT: {analysisSession.type?.toUpperCase()}
              </div>
              <ResultItem><span>Confidence:</span> <span style={{ color: '#fff' }}>{(analysisSession.result.confidence * 100).toFixed(1)}%</span></ResultItem>
              <ResultItem><span>Match Rate:</span> <span style={{ color: '#fff' }}>{(analysisSession.result.matchRate * 100).toFixed(1)}%</span></ResultItem>
              <ResultItem><span>SNR Delta:</span> <span style={{ color: '#fff' }}>{analysisSession.result.snrDelta}</span></ResultItem>
              <div style={{ color: '#ccc', marginTop: 12, lineHeight: 1.4 }}>{analysisSession.result.summary}</div>
            </ResultCard>
          ) : (
            <div style={{ padding: 20, border: '1px dashed #222', borderRadius: 8, textAlign: 'center', color: '#333', fontSize: '11px' }}>
              WAITING FOR CAPTURE RESULT...
            </div>
          )}
        </ControlSection>
      </MainGrid>
    </TriggersContainer>
  );
};

export default AnalysisTriggers;
