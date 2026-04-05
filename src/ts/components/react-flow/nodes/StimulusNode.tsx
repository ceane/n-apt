import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { useDemod } from '@n-apt/contexts/DemodContext';
import type { AnalysisType } from '@n-apt/consts/types';

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

interface StimulusNodeProps {
  data: {
    label: string;
    stimulusOptions?: boolean;
    subtext?: string;
  };
}

const baselineOptions: Array<{ value: AnalysisType; label: string }> = [
  { value: 'audio', label: 'Audio (Hearing)' },
  { value: 'internal', label: 'Audio (Internal)' },
  { value: 'speech', label: 'Speech' },
  { value: 'vision', label: 'Vision' },
  { value: 'apt', label: 'APT' },
];

// Audio preview components
const AudioContainer = styled.div`
  text-align: center;
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
  background: ${(props) => props.theme.colors.primary};
  border-radius: 1px;
  animation: ${props => props.$active ? 'bounce 0.5s infinite ease-in-out' : 'none'};

  @keyframes bounce {
    0%, 100% { transform: scaleY(0.5); }
    50% { transform: scaleY(1.5); }
  }
`;

const ToneLabel = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  margin-top: ${({ theme }) => theme.spacing.md};
  font-family: ${({ theme }) => theme.typography.mono};
`;

// Internal preview components
const InternalContainer = styled.div`
  text-align: center;
  width: 80%;
`;

const SignalAnalysisLabel = styled.div`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  margin-bottom: 20px;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const StatusText = styled.div`
  color: ${({ theme }) => theme.colors.textMuted};
  font-size: 10px;
  margin-top: 30px;
`;

// Speech preview components
const SpeechContainer = styled.div`
  text-align: center;
  width: 80%;
`;

const VocalCaptureLabel = styled.div`
  color: ${({ theme }) => theme.colors.success};
  font-size: 12px;
  margin-bottom: 20px;
  font-family: ${({ theme }) => theme.typography.mono};
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
  background: ${props => props.$isCapturing ? props.theme.colors.success : props.theme.colors.border};
  transition: height 0.05s ease;
  box-shadow: ${props => props.$isCapturing ? `0 0 10px ${props.theme.colors.success}33` : 'none'};
  border-radius: 2px;
`;

// Vision preview components
const VisionContainer = styled.div<{ $isCapturing: boolean }>`
  width: 100%;
  height: 100%;
  background: ${props => props.$isCapturing ? props.theme.colors.danger : props.theme.colors.surface};
  display: flex;
  align-items: center;
  justify-content: center;
`;

const RecIndicator = styled.div<{ $isCapturing: boolean }>`
  color: ${props => props.$isCapturing ? props.theme.colors.textPrimary : props.theme.colors.border};
  font-size: 20px;
  font-weight: bold;
  border: 4px solid;
`;

const ScriptText = styled.div`
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  line-height: 1.6;
  text-align: center;
  color: ${({ theme }) => theme.colors.primary};
  margin: 12px 0;
  padding: 8px;
  background: ${({ theme }) => theme.colors.activeBackground};
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.primary}33;
`;

// Countdown and progress components
const CountdownContainer = styled.div`
  position: absolute;
  bottom: ${({ theme }) => theme.spacing.md};
  right: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.background}ee;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: ${({ theme }) => theme.spacing.sm};
  min-width: 120px;
  backdrop-filter: blur(10px);
`;

const CountdownNumber = styled.div`
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 24px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.danger};
  text-align: center;
  margin-bottom: 4px;
`;

const ProgressBar = styled.div<{ $progress: number }>`
  width: 100%;
  height: 4px;
  background: ${({ theme }) => theme.colors.border};
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 4px;
`;

const ProgressFill = styled.div<{ $progress: number }>`
  width: ${props => props.$progress}%;
  height: 100%;
  background: linear-gradient(90deg, ${({ theme }) => theme.colors.danger}, ${({ theme }) => theme.colors.danger}aa);
  transition: width 0.1s ease;
`;

const ProgressLabel = styled.div`
  font-size: 9px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary || theme.colors.primary};
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-family: ${({ theme }) => theme.typography.mono};
`;

const StimulusContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 220px;
`;

const StimulusContent = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const StimulusPreview = styled.div`
  min-height: 170px;
  border: 1px solid ${({ theme }) => theme.colors.borderHover};
  border-radius: 10px;
  background: linear-gradient(180deg, ${({ theme }) => theme.colors.background} 0%, ${({ theme }) => theme.colors.surface} 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
`;

const StimulusSelect = styled.select`
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.primary};
  font-family: ${({ theme }) => theme.typography.mono};
  
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
  
  option {
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const StimulusButton = styled.button<{ $disabled: boolean }>`
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.primary};
  background: ${({ theme, $disabled }) => $disabled ? theme.colors.surface : theme.colors.background};
  color: ${({ theme, $disabled }) => $disabled ? theme.colors.textDisabled : theme.colors.primary};
  font-weight: 700;
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  font-family: ${({ theme }) => theme.typography.mono};
  
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.activeBackground};
  }
`;

const StimulusLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  user-select: none;
`;

const StimulusSubtext = styled.div`
  font-size: 10px;
  line-height: 1.5;
  opacity: 0.75;
  text-align: center;
  padding: 0 8px;
  font-style: italic;
  word-wrap: break-word;
`;

const ResetButton = styled.button`
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  cursor: pointer;
  
  &:hover {
    background: ${({ theme }) => theme.colors.activeBackground};
  }
`;

const BaselineVectorContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: end;
`;

const BaselineVectorLabel = styled.div`
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.6;
  margin-bottom: 6px;
`;

const TitleText = styled.div`
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 12px;
  color: ${(props) => props.theme.colors.primary};
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const APTPreviewContainer = styled.div`
  position: relative;
  text-align: center;
  color: ${({ theme }) => theme.colors.primary};
  font-family: ${({ theme }) => theme.typography.mono};
`;

const APTPreviewTitle = styled.div`
  font-size: 11px;
  opacity: 0.55;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
`;

const APTPreviewMain = styled.div`
  font-size: 24px;
  letter-spacing: 0.2em;
  font-weight: 700;
`;

const APTPreviewSub = styled.div`
  font-size: 12px;
  margin-top: 10px;
  opacity: 0.75;
`;

export const StimulusNode: React.FC<StimulusNodeProps> = ({ data }) => {
  const { analysisSession, selectedBaseline, setSelectedBaseline, liveMode, setLiveMode, startAnalysis, clearAnalysis } = useDemod();
  const [previewMode, setPreviewMode] = useState<AnalysisType>(selectedBaseline);
  const [scriptIndex, setScriptIndex] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [progress, setProgress] = useState(0);

  const isBusy = analysisSession.state !== 'idle' && analysisSession.state !== 'result';
  const isCapturing = analysisSession.state === 'capturing';

  // Countdown timer logic
  useEffect(() => {
    if (isCapturing) {
      // Start with 5 second countdown
      setCountdown(5);
      setProgress(0);

      const countdownInterval = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            // After countdown, start progress for capture duration (5 seconds)
            const progressInterval = setInterval(() => {
              setProgress(prev => {
                if (prev >= 100) {
                  clearInterval(progressInterval);
                  return 100;
                }
                return prev + 20; // 20% per second for 5 seconds
              });
            }, 1000);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(countdownInterval);
    } else {
      setCountdown(0);
      setProgress(0);
    }
  }, [isCapturing]);

  // Animation state for speech bars
  const [, forceUpdate] = useState({});
  useEffect(() => {
    if (isCapturing) {
      const interval = setInterval(() => forceUpdate({}), 50);
      return () => clearInterval(interval);
    }
  }, [isCapturing]);

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

  const handleTrigger = () => {
    // If audio-related, we need to wait for the actual capture start (after 3s countdown)
    // but the startAnalysis function handles its own internal timing.
    // To ensure sound is heard during capture, we'll delay it.
    if (previewMode === 'audio' || previewMode === 'internal') {
      setTimeout(() => playTone(), 3000); // Wait for countdown
    }

    if (previewMode === 'internal' || previewMode === 'speech') {
      setScriptIndex(Math.floor(Math.random() * SCRIPT_VARIANTS.length));
    }

    setSelectedBaseline(previewMode);
    startAnalysis(previewMode, liveMode);
  };

  return (
    <StimulusContainer>
      <TitleText>{data.label}</TitleText>

      <StimulusContent>
        <StimulusPreview>
          {previewMode === 'audio' && (
            <AudioContainer>
              <WaveformContainer>
                {Array.from({ length: 20 }).map((_, i) => (
                  <WaveBar key={i} $active={isCapturing} style={{ animationDelay: `${i * 0.05}s` }} />
                ))}
              </WaveformContainer>
              <ToneLabel>440Hz SINE TONE</ToneLabel>
            </AudioContainer>
          )}

          {previewMode === 'internal' && (
            <InternalContainer>
              <SignalAnalysisLabel>Signal Analysis</SignalAnalysisLabel>
              <ScriptText>
                {isCapturing ? SCRIPT_VARIANTS[scriptIndex] : "Ready for analysis"}
              </ScriptText>
              <StatusText>
                {isCapturing ? 'Processing...' : 'Ready'}
              </StatusText>
            </InternalContainer>
          )}

          {previewMode === 'speech' && (
            <SpeechContainer>
              <VocalCaptureLabel>VOCAL CAPTURE INTERFACE</VocalCaptureLabel>
              <ScriptText style={{ color: '#00ff88' }}>
                {isCapturing ? SCRIPT_VARIANTS[scriptIndex] : "Ready for vocal input"}
              </ScriptText>
              <SpeechBarsContainer>
                {[...Array(20)].map((_, i) => {
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

          {previewMode === 'vision' && (
            <VisionContainer $isCapturing={isCapturing}>
              <RecIndicator $isCapturing={isCapturing}>
                REC
              </RecIndicator>
            </VisionContainer>
          )}

          {previewMode === 'apt' && (
            <APTPreviewContainer>
              <APTPreviewTitle>Stimulus Preview</APTPreviewTitle>
              <APTPreviewMain>{isCapturing ? 'RECORD' : 'APT FRAME'}</APTPreviewMain>
              <APTPreviewSub>
                {isCapturing ? 'Capturing APT frame' : 'APT frame capture'}
              </APTPreviewSub>
            </APTPreviewContainer>
          )}
        </StimulusPreview>

        {(countdown > 0 || progress > 0) && (
          <CountdownContainer>
            {countdown > 0 ? (
              <>
                <CountdownNumber>{countdown}</CountdownNumber>
                <ProgressLabel>Starting...</ProgressLabel>
              </>
            ) : (
              <>
                <ProgressBar $progress={progress}>
                  <ProgressFill $progress={progress} />
                </ProgressBar>
                <ProgressLabel>{progress < 100 ? 'Capturing...' : 'Complete!'}</ProgressLabel>
              </>
            )}
          </CountdownContainer>
        )}

        <BaselineVectorContainer>
          <div>
            <BaselineVectorLabel>
              Baseline Vector
            </BaselineVectorLabel>
            <StimulusSelect
              value={previewMode}
              onChange={(e) => setPreviewMode(e.target.value as AnalysisType)}
              disabled={isBusy}
            >
              {baselineOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </StimulusSelect>
          </div>
          <StimulusButton onClick={handleTrigger} disabled={isBusy} $disabled={isBusy}>
            TRIGGER
          </StimulusButton>
        </BaselineVectorContainer>

        <StimulusLabel>
          <input
            type="checkbox"
            checked={liveMode}
            onChange={(e) => setLiveMode(e.target.checked)}
            disabled={isBusy}
          />
          LIVE CAPTURE (EPHEMERAL)
        </StimulusLabel>

        <StimulusSubtext>
          {data.subtext || 'Capture N-APT signals with a known baseline for demod later. Media is played while recording in order to learn what is where.'}
        </StimulusSubtext>

        {analysisSession.state === 'result' && (
          <ResetButton onClick={clearAnalysis}>
            Reset Session
          </ResetButton>
        )}
      </StimulusContent>
    </StimulusContainer>
  );
};
