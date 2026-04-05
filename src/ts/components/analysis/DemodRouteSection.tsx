import React, { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { Play, File as FileIcon, Download, Clock, HardDrive, Brain, Zap, Maximize, X } from "lucide-react";
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  Connection,
  ConnectionMode,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlowProvider
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDemod } from "@n-apt/contexts/DemodContext";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { StimulusNode } from "@n-apt/components/react-flow/nodes";
import { Channels } from "@n-apt/components/sidebar/Channels";
import { useAppSelector, useAppDispatch, sendSettings, sendPowerScaleCommand, setTemporalResolution, setPowerScale, setDisplayMode } from "@n-apt/redux";
import { liveDataRef } from "@n-apt/redux/middleware/websocketMiddleware";
import { SignalDisplaySection } from "@n-apt/components/sidebar/SignalDisplaySection";
import { SourceSettingsSection } from "@n-apt/components/sidebar/SourceSettingsSection";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { formatFrequency } from "@n-apt/utils/frequency";

const FlowContainer = styled.div`
  width: 100%;
  height: 100%;
  background-color: ${(props) => props.theme.background};
  border: 1px solid ${(props) => props.theme.border};
  overflow: hidden;
  position: relative;
  z-index: 1;
  isolation: isolate;
  flex: 1;
`;

const FullscreenOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.95);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  padding: 40px;
  backdrop-filter: blur(20px);
  animation: fadeIn 0.2s ease-out;

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;

const ModalContent = styled.div`
  background: #0a0a0a;
  border: 1px solid #1f1f1f;
  border-radius: 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  box-shadow: 0 50px 100px -20px rgba(0, 0, 0, 0.5);
`;

const CloseButton = styled.button`
  position: absolute;
  top: 20px;
  right: 20px;
  background: #1f1f1f;
  border: 1px solid #333;
  color: #fff;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
  transition: all 0.2s;
  
  &:hover {
    background: #e1000022;
    border-color: #e1000044;
    color: #ff4444;
    transform: scale(1.1);
  }
`;
const NodeSubgrid = styled.div`
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 12px;
  box-sizing: border-box;
  width: 320px;
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
`;

const ControlBar = styled.div`
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background-color: ${(props) => props.theme.surface};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
`;

const PlayButton = styled.button`
  background-color: ${(props) => props.theme.primary};
  color: white;
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 16px;

  &:hover {
    background-color: ${(props) => props.theme.primaryHover};
    transform: scale(1.05);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const StyledReactFlow = styled(ReactFlow)`
  width: 100%;
  height: 100%;

  .react-flow__controls {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    border-radius: 8px !important;
  }

  .react-flow__controls-button {
    background-color: ${(props) => props.theme.surface} !important;
    border: 1px solid ${(props) => props.theme.border} !important;
    color: ${(props) => props.theme.textPrimary} !important;
  }

  .react-flow__controls-button:hover {
    background-color: ${(props) => props.theme.surfaceHover} !important;
  }
`;

const NodeContainer = styled.div`
  background-color: ${(props) => props.theme.surface}e6;
  backdrop-filter: blur(8px);
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  padding: 16px;
  min-width: 180px;
  text-align: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;

  &:hover {
    transform: translateY(-2px);
    border-color: ${(props) => props.theme.primary};
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .node-title {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 12px;
    color: ${(props) => props.theme.primary};
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .node-description {
    font-size: 11px;
    color: ${(props) => props.theme.textSecondary};
    text-align: center;
    line-height: 1.4;
  }
`;

// Helper component for Symbols Table
const SymbolsTable: React.FC<{ frequencyRange: { min: number; max: number } | null }> = ({ frequencyRange }) => {
  const [isLive, setIsLive] = useState(false);
  const [liveData, setLiveData] = useState(() => Array(4).fill(null).map(() => ({
    symbol: "(+, -)",
    i: 128,
    q: 128,
    phase: 45,
    power: -20.000
  })));

  useEffect(() => {
    const interval = setInterval(() => {
      const live = liveDataRef.current;
      if (live && live.iq_data && live.iq_data.length > 0) {
        setIsLive(true);
        const samples = live.iq_data;
        const count = 4;
        const stride = Math.floor(samples.length / (count * 2));

        setLiveData(Array(4).fill(null).map((_, idx) => {
          const base = idx * stride * 2;
          const iVal = samples[base] ?? 128;
          const qVal = samples[base + 1] ?? 128;

          const sI = iVal >= 128 ? '+' : '-';
          const sQ = qVal >= 128 ? '+' : '-';

          const phaseRad = Math.atan2(qVal - 128, iVal - 128);
          const phaseDeg = Math.round(((phaseRad * 180) / Math.PI + 360) % 360);

          const magnitude = Math.sqrt(Math.pow((iVal - 128) / 128, 2) + Math.pow((qVal - 128) / 128, 2));
          const powerDbm = -70 + (magnitude * 50);

          return {
            symbol: `(${sI}, ${sQ})`,
            i: iVal,
            q: qVal,
            phase: phaseDeg,
            power: powerDbm,
          };
        }));
      } else {
        setIsLive(false);
        setLiveData((prev: any[]) => prev.map((_, idx) => {
          // Mock APT-like symbol pattern: Cyclic oscillation
          const phase = (Date.now() / 500) + (idx * Math.PI / 2);
          const iVal = Math.round(128 + 100 * Math.cos(phase));
          const qVal = Math.round(128 + 100 * Math.sin(phase));

          const sI = iVal >= 128 ? '+' : '-';
          const sQ = qVal >= 128 ? '+' : '-';

          return {
            symbol: `(${sI}, ${sQ})`,
            i: iVal,
            q: qVal,
            phase: Math.round(((phase * 180) / Math.PI + 360) % 360),
            power: -65 + Math.sin(Date.now() / 1000) * 5,
          };
        }));
      }
    }, 150);
    return () => clearInterval(interval);
  }, []);

  const freqRes = frequencyRange
    ? `${formatFrequency(frequencyRange.min)} - ${formatFrequency(frequencyRange.max)}`
    : "Baseline Sweep";

  const labels = [
    { key: "symbol", label: "Symbol" },
    { key: "iq", label: "I, Q Values" },
    { key: "phase", label: "Phase Angle" },
    { key: "power", label: "Power Level" },
  ];

  const tableContainerStyle: React.CSSProperties = {
    background: '#0a0a0a',
    border: '1px solid #1f1f1f',
    borderRadius: '8px',
    overflow: 'hidden',
    fontSize: '11px',
    fontFamily: 'var(--font-mono, monospace)',
    width: '100%',
    contain: 'layout paint'
  };

  const headerStyle = {
    display: 'grid',
    gridTemplateColumns: '150px 1fr',
    background: '#161616',
    padding: '12px 18px',
    borderBottom: '1px solid #1f1f1f',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600
  };

  return (
    <div style={tableContainerStyle}>
      {/* Table Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ color: '#00d4ff', letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '11px' }}>Symbol Analysis</div>
          <div style={{
            fontSize: '8px',
            background: isLive ? '#00ff8822' : '#ffaa0022',
            color: isLive ? '#00ff88' : '#ffaa00',
            padding: '2px 6px',
            borderRadius: '4px',
            fontWeight: 800,
            letterSpacing: '0.05em'
          }}>
            {isLive ? 'LIVE STREAM' : 'MOCK MODE'}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '11px', fontWeight: 400, opacity: 0.8 }}>
          <span style={{ color: '#888', marginRight: '8px' }}>Frequency Span:</span>
          {freqRes}
        </div>
      </div>

      {/* Sub-Header Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '150px repeat(4, 1fr)',
        borderBottom: '1px solid #1f1f1f',
        background: '#ffffff03'
      }}>
        <div style={{ padding: '8px 18px', color: '#888', fontStyle: 'italic', fontSize: '9px' }}>Parameters</div>
        <div style={{ padding: '8px', textAlign: 'center', color: '#555', fontSize: '9px' }}>Stream 1</div>
        <div style={{ padding: '8px', textAlign: 'center', color: '#555', fontSize: '9px' }}>Stream 2</div>
        <div style={{ padding: '8px', textAlign: 'center', color: '#555', fontSize: '9px' }}>Stream 3</div>
        <div style={{ padding: '8px', textAlign: 'center', color: '#00d4ff', fontSize: '9px', fontWeight: 600 }}>Aggregate</div>
      </div>

      {/* Rows */}
      <div style={{ padding: '8px 0' }}>
        {labels.map((row, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '150px repeat(4, 1fr)',
            padding: '8px 0',
            borderBottom: i === labels.length - 1 ? 'none' : '1px solid #ffffff05'
          }}>
            <div style={{
              paddingLeft: '18px',
              color: '#888',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              borderLeft: '2px solid transparent'
            }}>
              {row.label}
            </div>
            {liveData.map((data: any, j: number) => {
              const isAvg = j === 3;
              let val = "";
              if (row.key === 'symbol') val = data.symbol;
              if (row.key === 'phase') val = `${data.phase}\u00b0`;
              if (row.key === 'power') val = `${data.power.toFixed(3)} dBm`;

              return (
                <div key={j} style={{
                  textAlign: 'center',
                  color: isAvg ? '#00d4ff' : '#ddd',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  fontSize: '13px',
                  fontWeight: isAvg ? 700 : 400,
                  opacity: isAvg ? 1 : 0.8,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis'
                }}>
                  {row.key === 'iq' ? (
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <span style={{ color: '#555' }}>{data.i}</span>
                      <span style={{ color: '#00d4ff' }}>{data.q}</span>
                    </div>
                  ) : val}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

// Helper component for Bitstream Viewer
const BitstreamViewer: React.FC<{ frequencyRange: { min: number; max: number } | null }> = ({ frequencyRange }) => {
  const { wsConnection } = useSpectrumStore();
  const reduxDeviceName = useAppSelector((s) => s.websocket.deviceName);
  const deviceName = wsConnection.deviceName || reduxDeviceName || "SDR Device";
  const fftSize = useAppSelector(state => state.spectrum.fftSize);
  const rowsCount = 10;
  const colsCount = 8;
  const [isLive, setIsLive] = useState(false);
  const [streamData, setStreamData] = useState(() => ({
    rowsData: Array(rowsCount).fill(0).map(() =>
      Array(colsCount).fill(0).map(() => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0'))
    )
  }));

  const getLogicalBase = () => {
    const min = frequencyRange?.min || 100;
    return (Math.floor(min * 100) * 16) + (fftSize % 1024);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const live = liveDataRef.current;
      if (live && live.iq_data && live.iq_data.length >= (rowsCount * colsCount)) {
        setIsLive(true);
        const samples = live.iq_data;
        const rows = [];
        const timeOffset = Math.floor(Date.now() / 250) % 20;
        for (let i = 0; i < rowsCount; i++) {
          const row = [];
          for (let j = 0; j < colsCount; j++) {
            const byte = samples[timeOffset + i * colsCount + j] ?? 0;
            row.push(byte.toString(16).toUpperCase().padStart(2, '0'));
          }
          rows.push(row);
        }
        setStreamData({ rowsData: rows });
      } else {
        setIsLive(false);
        setStreamData(prev => {
          const nextRows = [...prev.rowsData.slice(1)];
          const rowIdx = (prev.rowsData.length + Math.floor(Date.now() / 150)) % 256;

          // Generate Mock APT Frame structure
          // Row 0: Sync A, Row 128: Sync B, others: data/telemetry
          const newRow = Array(colsCount).fill(0).map((_, col) => {
            const framePos = rowIdx % 32;
            if (framePos === 0) return (col < 4 ? "00" : "FF"); // Sync Pattern Start
            if (framePos === 1) return (col < 4 ? "FF" : "00"); // Sync Pattern End
            if (framePos === 2) return "00"; // Space
            if (framePos === 3) return (rowIdx.toString(16).toUpperCase().padStart(2, '0')); // Counter

            // Telemetry / Image Gradient
            const val = (rowIdx * 4 + col * 16) % 256;
            return val.toString(16).toUpperCase().padStart(2, '0');
          });

          nextRows.push(newRow);
          return { rowsData: nextRows };
        });
      }
    }, 150); // Faster refresh for bits
    return () => clearInterval(interval);
  }, []);

  const { rowsData: data } = streamData;
  const logicalBase = getLogicalBase();

  const tableContainerStyle: React.CSSProperties = {
    background: '#0a0a0a',
    border: '1px solid #1f1f1f',
    borderRadius: '8px',
    overflow: 'hidden',
    fontFamily: 'var(--font-mono, monospace)',
    width: '100%',
    contain: 'layout paint'
  };

  const headerStyle = {
    display: 'grid',
    gridTemplateColumns: 'minmax(200px, 1fr) 1fr minmax(200px, 1fr)',
    background: '#161616',
    padding: '12px 18px',
    borderBottom: '1px solid #1f1f1f',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 600,
    alignItems: 'center'
  };

  const freqMin = frequencyRange?.min || 18.000;
  const freqMax = frequencyRange?.max || 18.200;
  const fullSpanTag = `${formatFrequency(freqMin)} - ${formatFrequency(freqMax)}`;
  const totalSpan = freqMax - freqMin;
  const step = totalSpan / rowsCount;
  const stepLabel = formatFrequency(step);

  return (
    <div style={tableContainerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ color: '#00d4ff', letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '11px', fontWeight: 800 }}>
            {deviceName}
          </div>
          <div style={{
            fontSize: '8px',
            background: isLive ? '#00ff8822' : '#ffaa0022',
            color: isLive ? '#00ff88' : '#ffaa00',
            padding: '2px 6px',
            borderRadius: '4px',
            fontWeight: 800,
            letterSpacing: '0.05em'
          }}>
            {isLive ? 'LIVE' : 'MOCK'}
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: '11px', color: '#00d4ff', opacity: 0.8, letterSpacing: '0.05em' }}>
          {fullSpanTag}
        </div>
        <div style={{ textAlign: 'right', fontSize: '11px', fontWeight: 400, opacity: 0.5, letterSpacing: '0.02em' }}>
          <span style={{ marginRight: '8px' }}>FFT:</span>
          <span style={{ color: '#fff', fontWeight: 600 }}>{fftSize} bins</span>
        </div>
      </div>

      {/* Meta-Diagnostic Bar */}
      <div style={{
        padding: '10px 20px',
        fontSize: '9px',
        color: '#666',
        borderBottom: '1px solid #ffffff0a',
        display: 'flex',
        justifyContent: 'space-between',
        background: '#ffffff02',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        fontWeight: 600
      }}>
        <div><span style={{ color: '#00d4ff', marginRight: '6px' }}>RESOLUTION:</span> {stepLabel}</div>
        <div><span style={{ color: '#00d4ff', marginRight: '6px' }}>ORIGIN:</span> 0x{logicalBase.toString(16).toUpperCase()}</div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        borderBottom: '1px solid #ffffff0a',
        background: '#ffffff02',
        padding: '2px 0'
      }}>
        <div style={{ padding: '10px 20px', color: '#666', fontStyle: 'italic', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Memory Offset</div>
        <div style={{ padding: '10px 12px', color: '#666', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Raw High-Density Signal Buffer (Hex)</div>
      </div>

      <div style={{ padding: '12px 0' }}>
        {data.map((row, i) => {
          const rowOffset = (logicalBase + i * colsCount).toString(16).toUpperCase().padStart(8, '0');
          const rowFreqStart = freqMin + i * step;
          const rowFreqEnd = freqMin + (i + 1) * step;

          return (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              padding: '12px 0',
              borderBottom: i === data.length - 1 ? 'none' : '1px solid #ffffff05',
              alignItems: 'center'
            }}>
              <div style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{
                  fontSize: '15px',
                  color: '#fff',
                  letterSpacing: '0.08em',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontWeight: 500,
                  opacity: 0.9
                }}>{rowOffset}</div>
                <div style={{
                  fontSize: '11px',
                  color: '#00d4ff',
                  opacity: 0.7,
                  fontFamily: 'var(--font-mono, monospace)',
                  letterSpacing: '-0.02em'
                }}>
                  {formatFrequency(rowFreqStart)} - {formatFrequency(rowFreqEnd)}
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${colsCount}, 1fr)`,
                fontSize: '20px',
                color: '#fff',
                paddingLeft: '30px',
                paddingRight: '20px'
              }}>
                {row.map((byte, bIdx) => (
                  <span key={bIdx} style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    color: bIdx === 0 ? '#00d4ff' : '#ddd',
                    fontWeight: bIdx === 0 ? 700 : 400,
                    opacity: bIdx === 0 ? 1 : 0.8,
                    textAlign: 'left'
                  }}>
                    {byte}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Helper component for Signal Options Node
const SignalOptions: React.FC = () => {
  const dispatch = useAppDispatch();
  const spectrum = useAppSelector(state => state.spectrum);
  const {
    wsConnection,
    sampleRateMHz
  } = useSpectrumStore();

  const {
    isConnected,
    sdrSettings: liveSdrSettingsConfig,
    backend: liveBackend,
    deviceProfile: liveDeviceProfileToUse,
    autoFftOptions: liveAutoFftOptions
  } = wsConnection;

  const {
    maxFrameRate,
    fftSizeOptions,
    setFftSize,
    setFftWindow: handleFftWindow,
    setFftFrameRate,
    setGain,
    setPpm,
    setTunerAGC,
    setRtlAGC,
    scheduleCoupledAdjustment
  } = useSdrSettings({
    maxSampleRate: (sampleRateMHz || 3.2) * 1_000_000,
    sdrSettings: liveSdrSettingsConfig,
    onSettingsChange: (settings) => dispatch(sendSettings(settings))
  });

  return (
    <NodeSubgrid className="nodrag nopan">
      <SignalDisplaySection
        sourceMode="live"
        maxSampleRate={(sampleRateMHz || 3.2) * 1_000_000}
        fileCapturedRange={null}
        fftFrameRate={spectrum.fftFrameRate}
        maxFrameRate={maxFrameRate}
        fftSize={spectrum.fftSize}
        fftSizeOptions={fftSizeOptions}
        fftWindow={spectrum.fftWindow || "Rectangular"}
        temporalResolution={spectrum.displayTemporalResolution}
        autoFftOptions={liveAutoFftOptions}
        backend={liveBackend}
        deviceProfile={liveDeviceProfileToUse}
        powerScale={spectrum.powerScale}
        displayMode={spectrum.displayMode || "fft"}
        onFftFrameRateChange={setFftFrameRate}
        onFftSizeChange={setFftSize}
        onFftWindowChange={handleFftWindow}
        onTemporalResolutionChange={(res) => dispatch(setTemporalResolution(res))}
        onPowerScaleChange={(ps) => {
          dispatch(setPowerScale(ps));
          dispatch(sendPowerScaleCommand(ps));
        }}
        onDisplayModeChange={(mode) => dispatch(setDisplayMode(mode))}
        scheduleCoupledAdjustment={scheduleCoupledAdjustment}
      />
      <SourceSettingsSection
        sourceMode="live"
        ppm={spectrum.ppm}
        gain={spectrum.gain}
        tunerAGC={spectrum.tunerAGC}
        rtlAGC={spectrum.rtlAGC}
        stitchSourceSettings={{ gain: 0, ppm: 0 }}
        isConnected={isConnected}
        onPpmChange={setPpm}
        onGainChange={setGain}
        onTunerAGCChange={setTunerAGC}
        onRtlAGCChange={setRtlAGC}
        onStitchSourceSettingsChange={() => { }}
        onAgcModeChange={(tuner, rtl) => {
          setTunerAGC(tuner);
          setRtlAGC(rtl);
        }}
      />
    </NodeSubgrid>
  );
};

const CustomNode: React.FC<{ data: any; id: string }> = ({ data, id }) => {
  const { sessionToken } = useAuthentication();
  const { wsConnection } = useSpectrumStore();
  const reduxDeviceName = useAppSelector((s) => s.websocket.deviceName);
  const deviceName = wsConnection.deviceName || reduxDeviceName || "SDR Device";
  const [isFullscreen, setIsFullscreen] = useState(false);

  const FullscreenModal: React.FC<{ children: React.ReactNode; title: string }> = ({ children, title }) => {
    return createPortal(
      <FullscreenOverlay>
        <ModalContent>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 30px',
            borderBottom: '1px solid #1f1f1f',
            background: '#161616'
          }}>
            <div>
              <div style={{ fontSize: '12px', color: '#00d4ff', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>Diagnostic View</div>
              <div style={{ fontSize: '24px', fontWeight: 700, color: '#fff' }}>{title}</div>
            </div>
            <CloseButton onClick={() => setIsFullscreen(false)}>
              <X size={24} />
            </CloseButton>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {children}
          </div>
        </ModalContent>
      </FullscreenOverlay>,
      document.body
    );
  };

  const renderNodeContent = () => {
    const { state: spectrumState, sampleRateMHz } = useSpectrumStore();
    const { activeSignalArea, frequencyRange, lastKnownRanges, vizZoom, vizPanOffset } = spectrumState;
    const areaKey = activeSignalArea || "A"; // Default to A if none active yet

    // Calculate visible frequency range based on zoom and pan for labeling
    const calculateVisible = () => {
      const minFreq = 0;
      const maxFreq = 2000; // Cap
      const hardwareSpan = sampleRateMHz || 3.2;

      const safeZoom = (Number.isFinite(vizZoom) && vizZoom > 0) ? vizZoom : 1;

      if (!frequencyRange) {
        return lastKnownRanges[areaKey] || { min: minFreq, max: minFreq + hardwareSpan };
      }

      const hardwareCenter = (frequencyRange.min + frequencyRange.max) / 2;
      const visualSpan = hardwareSpan / safeZoom;
      const halfVisualSpan = visualSpan / 2;
      let visualCenter = hardwareCenter + vizPanOffset;

      visualCenter = Math.max(
        minFreq + halfVisualSpan,
        Math.min(maxFreq - halfVisualSpan, visualCenter),
      );

      return {
        min: visualCenter - halfVisualSpan,
        max: visualCenter + halfVisualSpan,
      };
    };

    const freqRange = calculateVisible();

    if (data.sourceNode) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '180px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              padding: '8px',
              background: '#00d4ff1a',
              borderRadius: '8px',
              border: '1px solid #00d4ff33',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <span style={{ fontSize: '20px' }}>📡</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#00d4ff',
                opacity: 0.9
              }}>
                Source
              </div>
              <div style={{
                fontSize: '13px',
                fontWeight: 500,
                color: '#fff',
                fontFamily: 'var(--font-mono, monospace)',
                letterSpacing: '-0.02em'
              }}>
                {deviceName}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (data.coremlOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              🧠 ML Inference
            </div>
          </div>
        </>
      );
    }

    if (data.spikeOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              ⚡ Spike Detect
            </div>
          </div>
        </>
      );
    }

    if (data.beatOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              🥁 Beat Detect
            </div>
          </div>
        </>
      );
    }

    if (data.fftOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              📊 FFT Transform
            </div>
          </div>
        </>
      );
    }

    if (data.waterfallOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              🌊 Waterfall
            </div>
          </div>
        </>
      );
    }

    if (data.spectogramOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '9px', textAlign: 'center' }}>
              🖼️ 128x128 ML
            </div>
          </div>
        </>
      );
    }

    if (data.channelNode) {
      return (
        <div style={{ minWidth: '260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ padding: '6px', background: '#a855f722', borderRadius: '6px' }}>
              <Zap size={14} color="#a855f7" />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Channel</div>
              <div style={{ fontSize: '9px', opacity: 0.45, fontFamily: 'monospace' }}>Signal Area</div>
            </div>
          </div>
          {/* Provide a grid context so Channels' subgrid works outside of the sidebar */}
          {/* Use 'nodrag nopan' class so sliders are interactive within React Flow */}
          <div className="nodrag nopan" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', width: '100%' }}>
            <Channels variant="spectrum" hideTitle={true} />
          </div>
        </div>
      );
    }

    if (data.signalOptions) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="node-title">Signal Configuration</div>
          <SignalOptions />
        </div>
      );
    }

    if (data.channelOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <select style={{
              width: '100%',
              padding: '4px',
              fontSize: '10px',
              backgroundColor: 'transparent',
              border: `1px solid currentColor`,
              borderRadius: '4px',
              color: 'inherit'
            }}>
              <option value="">Select Channel...</option>
              <option value="channel1">Channel 1</option>
              <option value="channel2">Channel 2</option>
              <option value="channel3">Channel 3</option>
            </select>
          </div>
        </>
      );
    }

    if (data.spanOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="number"
                placeholder="Start"
                style={{
                  width: '60px',
                  padding: '2px',
                  fontSize: '9px',
                  backgroundColor: 'transparent',
                  border: `1px solid currentColor`,
                  borderRadius: '2px',
                  color: 'inherit'
                }}
              />
              <span>-</span>
              <input
                type="number"
                placeholder="End"
                style={{
                  width: '60px',
                  padding: '2px',
                  fontSize: '9px',
                  backgroundColor: 'transparent',
                  border: `1px solid currentColor`,
                  borderRadius: '2px',
                  color: 'inherit'
                }}
              />
              <span style={{ fontSize: '9px' }}>Hz</span>
            </div>
          </div>
        </>
      );
    }

    if (data.stimulusOptions) {
      return <StimulusNode data={data} />;
    }

    if (data.tempoNoteOptions) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="node-title">{data.label}</div>
          <div style={{ width: 220, height: 70, border: '1px solid #666', backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#888', borderRadius: '4px' }}>
            Measure Canvas
          </div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
            🎵 Musical Pattern Detection
          </div>
        </div>
      );
    }

    if (data.radioOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              📻 Fast Demod Radio
            </div>
          </div>
        </>
      );
    }

    if (data.streamOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              ▶️ Real-time Stream
            </div>
          </div>
        </>
      );
    }

    if (data.aptOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              🖼️ Auto Picture TX
            </div>
          </div>
        </>
      );
    }

    if (data.fmOptions) {
      return (
        <>
          <div className="node-title">{data.label}</div>
          <div className="node-description">
            <div style={{ fontSize: '10px', textAlign: 'center' }}>
              📻 FM Demod
            </div>
          </div>
        </>
      );
    }

    if (data.analysisOptions) {
      const result = data.result;
      if (!result) return null;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px', textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ padding: '6px', background: '#e100ff22', borderRadius: '4px' }}>
              <Brain size={16} color="#e100ff" />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#e100ff' }}>BASELINE ANALYSIS</div>
              <div style={{ fontSize: '9px', opacity: 0.6, fontFamily: 'monospace' }}>Neural Vector Result</div>
            </div>
          </div>

          <div style={{
            background: '#00000044',
            border: '1px solid #ffffff11',
            borderRadius: '6px',
            padding: '10px',
            fontSize: '11px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ opacity: 0.6 }}>Frequency Span</div>
              <div style={{ color: '#00d4ff', fontWeight: 700 }}>{formatFrequency(freqRange.min)} - {formatFrequency(freqRange.max)}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ opacity: 0.6 }}>SNR Delta:</span>
              <span style={{ fontFamily: 'monospace' }}>{result.snrDelta}</span>
            </div>
            <div style={{ fontSize: '10px', lineHeight: 1.4, marginTop: '4px', borderTop: '1px solid #ffffff11', paddingTop: '8px' }}>
              {result.summary}
            </div>
          </div>
        </div>
      );
    }

    if (data.fileOptions) {
      const result = data.result;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px', textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ padding: '6px', background: '#00ff8822', borderRadius: '4px' }}>
              <FileIcon size={16} color="#00ff88" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#00ff88' }}>REFERENCE CAPTURE</div>
                <div style={{
                  fontSize: '8px',
                  background: '#00ff8822',
                  color: '#00ff88',
                  padding: '2px 4px',
                  borderRadius: '3px',
                  textTransform: 'uppercase',
                  fontWeight: 'bold'
                }}>
                  {data.vector || 'RAW'}
                </div>
              </div>
              <div style={{ fontSize: '9px', opacity: 0.6, fontFamily: 'monospace' }}>{result.jobId}</div>
            </div>
          </div>

          <div style={{
            background: '#00000044',
            border: '1px solid #ffffff11',
            borderRadius: '6px',
            padding: '8px',
            fontSize: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={12} style={{ opacity: 0.5 }} />
              <span>{result.timestamp ? new Date(result.timestamp).toLocaleString() : 'N/A'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <HardDrive size={12} style={{ opacity: 0.5 }} />
              <span>{(result.fileSize / (1024 * 1024)).toFixed(2)} MB</span>
            </div>
          </div>

          <a
            href={result.naptFilePath}
            download
            style={{
              background: '#00ff88',
              color: '#000',
              textDecoration: 'none',
              padding: '8px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '4px',
              cursor: 'pointer'
            }}
          >
            <Download size={14} />
            DOWNLOAD .NAPT
          </a>
        </div>
      );
    }

    // Default/Output node content 
    if (data.outputNode && data.result) {
      const result = data.result;
      // naptFilePath is the /api/capture/download?jobId=... URL from the backend
      // Append session token required by the download endpoint
      const fullDownloadUrl = result.naptFilePath
        ? (() => {
          const base = result.naptFilePath.startsWith('http')
            ? result.naptFilePath
            : `${window.location.origin}${result.naptFilePath}`;
          return sessionToken ? `${base}&token=${encodeURIComponent(sessionToken)}` : base;
        })()
        : undefined;

      const formatDuration = (ms: number) => {
        const s = Math.round(ms / 1000);
        if (s < 60) return `${s}s`;
        return `${Math.floor(s / 60)}m ${s % 60}s`;
      };

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '240px', textAlign: 'left' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ padding: '6px', background: '#e100ff22', borderRadius: '6px' }}>
              <Brain size={16} color="#e100ff" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Output</span>
                {data.vector && (
                  <span style={{
                    fontSize: '9px',
                    background: '#e100ff22',
                    color: '#e100ff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    fontWeight: 700,
                  }}>{data.vector}</span>
                )}
              </div>
              <div style={{ fontSize: '9px', opacity: 0.45, fontFamily: 'monospace', marginTop: '1px' }}>{result.jobId}</div>
            </div>
          </div>

          {/* Metrics */}
          <div style={{
            background: '#00000055',
            border: '1px solid #ffffff0e',
            borderRadius: '8px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '7px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
              <span style={{ opacity: 0.55 }}>Confidence</span>
              <span style={{ color: '#00ff88', fontWeight: 700, fontFamily: 'monospace' }}>{(result.confidence * 100).toFixed(1)}%</span>
            </div>
            {result.matchRate && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ opacity: 0.55 }}>Match Rate</span>
                <span style={{ fontFamily: 'monospace' }}>{(result.matchRate * 100).toFixed(1)}%</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
              <span style={{ opacity: 0.55 }}>SNR Delta</span>
              <span style={{ fontFamily: 'monospace' }}>{result.snrDelta}</span>
            </div>
            {result.duration != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ opacity: 0.55 }}>Duration</span>
                <span style={{ fontFamily: 'monospace' }}>{formatDuration(result.duration)}</span>
              </div>
            )}
            <div style={{ height: '1px', background: '#ffffff0e' }} />
            <div style={{ fontSize: '10px', lineHeight: 1.5, opacity: 0.65 }}>{result.summary}</div>
          </div>

          {/* Reference Capture */}
          {fullDownloadUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '8px 10px',
                background: '#00ff8808',
                border: '1px solid #00ff8820',
                borderRadius: '6px',
                fontSize: '10px',
              }}>
                <FileIcon size={12} color="#00ff88" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: '#00ff88', fontSize: '10px' }}>Reference I/Q Capture</span>
                  {result.timestamp && (
                    <span style={{ opacity: 0.5, fontSize: '9px', fontFamily: 'monospace' }}>
                      {new Date(result.timestamp).toLocaleString()}
                    </span>
                  )}
                  {result.fileSize && result.fileSize > 0 ? (
                    <span style={{ opacity: 0.5, fontSize: '9px' }}>
                      {(result.fileSize / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  ) : null}
                </div>
              </div>
              {/* Use button + window.location.href instead of target=_blank to avoid popup blocking in React Flow */}
              <button
                onClick={() => { window.location.href = fullDownloadUrl; }}
                style={{
                  background: '#00ff88',
                  color: '#000',
                  border: 'none',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                <Download size={13} />
                DOWNLOAD .NAPT
              </button>
            </div>
          )}
        </div>
      );
    }

    if (data.symbolOptions) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '580px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <div className="node-title" style={{ margin: 0 }}>Symbol (I/Q) Analysis</div>
            <button
              onClick={() => setIsFullscreen(true)}
              style={{ background: 'transparent', border: 'none', color: '#00d4ff', cursor: 'pointer', opacity: 0.6, padding: '4px' }}
            >
              <Maximize size={14} />
            </button>
          </div>
          <SymbolsTable frequencyRange={freqRange} />
          {isFullscreen && (
            <FullscreenModal title="Symbol (I/Q) Analysis">
              <div style={{ padding: '20px', height: '100%', overflow: 'auto' }}>
                <SymbolsTable frequencyRange={freqRange} />
              </div>
            </FullscreenModal>
          )}
        </div>
      );
    }

    if (data.signalOptions) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div className="node-title">Signal Configuration</div>
          <SignalOptions />
        </div>
      );
    }
    if (data.bitstreamOptions) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '580px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <div className="node-title" style={{ margin: 0 }}>Bitstream Analysis</div>
            <button
              onClick={() => setIsFullscreen(true)}
              style={{ background: 'transparent', border: 'none', color: '#00d4ff', cursor: 'pointer', opacity: 0.6, padding: '4px' }}
            >
              <Maximize size={14} />
            </button>
          </div>
          <BitstreamViewer frequencyRange={freqRange} />
          {isFullscreen && (
            <FullscreenModal title="Bitstream Analysis">
              <div style={{ padding: '20px', height: '100%', overflow: 'auto' }}>
                <BitstreamViewer frequencyRange={freqRange} />
              </div>
            </FullscreenModal>
          )}
        </div>
      );
    }
    if (data.outputNode) {
      // Idle/processing state
      const isProcessing = data.state && data.state !== 'idle' && data.state !== 'result';

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '180px', alignItems: 'center' }}>
          <div className="node-title" style={{ marginBottom: 0 }}>Output</div>
          {isProcessing ? (
            <div style={{ fontSize: '10px', opacity: 0.6, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={12} color="#ffaa00" />
              <span style={{ color: '#ffaa00' }}>Processing... ({data.state})</span>
            </div>
          ) : (
            <div style={{ fontSize: '10px', opacity: 0.4 }}>Awaiting analysis results</div>
          )}
        </div>
      );
    }

    return (
      <>
        <div className="node-title">{data.label}</div>
        <div className="node-description">{data.description}</div>
      </>
    );
  };

  return (
    <NodeContainer data-nodeid={id}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#666', border: '1px solid #999', width: '8px', height: '8px' }}
      />
      {renderNodeContent()}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#666', border: '1px solid #999', width: '8px', height: '8px' }}
      />
    </NodeContainer>
  );
};

// Inner component that uses React Flow hooks
const DemodRouteSectionInner: React.FC = () => {
  const { setNodes, setEdges, analysisSession } = useDemod();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { deleteElements } = useReactFlow();

  // Define node types
  const nodeTypes = useMemo(() => ({
    custom: CustomNode,
  }), []);

  // Define initial nodes — Source → Channel → Stimulus → Output
  const initialNodes: Node[] = useMemo(() => [
    {
      id: 'source',
      type: 'custom',
      position: { x: 250, y: 50 },
      data: {
        label: 'Source',
        sourceNode: true,
        nonRemovable: true,
      },
    },
    {
      id: 'channel',
      type: 'custom',
      position: { x: 250, y: 260 },
      data: {
        label: 'Channel',
        channelNode: true,
        nonRemovable: true,
      },
    },
    {
      id: 'signalOptions',
      type: 'custom',
      position: { x: 250, y: 480 },
      data: {
        label: 'Signal Configuration',
        signalOptions: true,
      },
    },
    {
      id: 'symbols',
      type: 'custom',
      position: { x: 50, y: 850 },
      data: {
        label: 'Symbol (I/Q) Analysis',
        symbolOptions: true,
      },
    },
    {
      id: 'bitstream',
      type: 'custom',
      position: { x: 50, y: 1250 },
      data: {
        label: 'Bitstream Analysis',
        bitstreamOptions: true,
      },
    },
    {
      id: 'stimulus',
      type: 'custom',
      position: { x: 250, y: 1750 },
      data: {
        label: 'Stimulus',
        stimulusOptions: true,
        subtext: 'Capture N-APT signals with a know baseline for demod later. Media is played while recording in order to learn what is where.',
      },
    },
    {
      id: 'output',
      type: 'custom',
      position: { x: 250, y: 2250 },
      data: { outputNode: true, state: 'idle' },
    },
  ], []);

  const initialEdges: Edge[] = useMemo(() => [
    {
      id: 'e-source-channel',
      source: 'source',
      target: 'channel',
      animated: true,
      style: { stroke: '#00d4ff', strokeWidth: 2 },
    },
    {
      id: 'e-channel-signalOptions',
      source: 'channel',
      target: 'signalOptions',
      animated: true,
      style: { stroke: '#00d4ffaa', strokeWidth: 2, strokeDasharray: '5 5' },
    },
    {
      id: 'e-signalOptions-symbols',
      source: 'signalOptions',
      target: 'symbols',
      animated: true,
      style: { stroke: '#00d4ffaa', strokeWidth: 2, strokeDasharray: '5 5' },
    },
    {
      id: 'e-symbols-bitstream',
      source: 'symbols',
      target: 'bitstream',
      animated: true,
      style: { stroke: '#00d4ffaa', strokeWidth: 2, strokeDasharray: '5 5' },
    },
    {
      id: 'e-bitstream-stimulus',
      source: 'bitstream',
      target: 'stimulus',
      animated: true,
      style: { stroke: '#a855f7', strokeWidth: 2 },
    },
    {
      id: 'e-stimulus-output',
      source: 'stimulus',
      target: 'output',
      animated: true,
      style: { stroke: '#e100ff', strokeWidth: 2 },
    },
  ], []);

  const [nodes, setNodesLocal, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdgesLocal, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(nodes);
    setEdges(edges);
  }, [nodes, edges, setNodes, setEdges]);

  // Track which sessions have already produced an output node
  const processedSessionsRef = useRef<Set<string>>(new Set());

  // Count output nodes for positioning
  const outputCountRef = useRef(0);

  // Populate Output node (or chain new ones) when a capture completes
  useEffect(() => {
    if (analysisSession.state !== 'result' || !analysisSession.result) return;

    const sessionKey = analysisSession.result.jobId;
    if (!sessionKey || processedSessionsRef.current.has(sessionKey)) return;

    processedSessionsRef.current.add(sessionKey);
    const idx = outputCountRef.current;
    outputCountRef.current += 1;

    if (idx === 0) {
      // Update the static 'output' node in-place
      setNodesLocal(nds => nds.map(n => {
        if (n.id !== 'output') return n;
        return {
          ...n,
          data: {
            ...n.data,
            state: 'result',
            result: analysisSession.result,
            vector: analysisSession.type,
          },
        };
      }));
    } else {
      // Chain a new output node below the previous one
      const prevId = idx === 1 ? 'output' : `output-${[...processedSessionsRef.current][idx - 1]}`;
      const newId = `output-${sessionKey}`;

      const newNode: Node = {
        id: newId,
        type: 'custom',
        position: { x: 250, y: 580 + idx * 420 },
        data: {
          outputNode: true,
          state: 'result',
          result: analysisSession.result,
          vector: analysisSession.type,
        },
      };

      const newEdge: Edge = {
        id: `e-${prevId}-${newId}`,
        source: prevId,
        target: newId,
        animated: true,
        style: { stroke: '#888', strokeWidth: 1.5, strokeDasharray: '5 3' },
      };

      setNodesLocal(nds => [...nds, newNode]);
      setEdgesLocal(eds => [...eds, newEdge]);
    }
  }, [analysisSession, setNodesLocal, setEdgesLocal]);

  // Reset on new session
  useEffect(() => {
    if (analysisSession.state === 'idle') {
      processedSessionsRef.current = new Set();
      outputCountRef.current = 0;
      setNodesLocal(initialNodes);
      setEdgesLocal(initialEdges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisSession.state]);

  const onConnect = useCallback(
    (params: Connection) => setEdgesLocal((eds) => addEdge(params, eds)),
    [setEdgesLocal]
  );

  // Handle drag and drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const nodeData = JSON.parse(type);

      // Calculate position
      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const position = {
        x: event.clientX - reactFlowBounds.left - 75,
        y: event.clientY - reactFlowBounds.top - 40,
      };

      const newNode: Node = {
        id: `${nodeData.id}-${Date.now()}`,
        type: nodeData.type,
        position,
        data: nodeData.data,
      };

      setNodesLocal((nds) => nds.concat(newNode));
    },
    [setNodesLocal]
  );

  // Handle keyboard shortcuts
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteElements({ nodes: [], edges: [] });
      }
    },
    [deleteElements]
  );

  // Add keyboard event listener
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onKeyDown]);

  return (
    <FlowContainer
      ref={reactFlowWrapper}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <StyledReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#666" />
        <Controls />
      </StyledReactFlow>

      <ControlBar>
        <PlayButton onClick={() => console.log('Play button clicked')}>
          <Play size={20} />
        </PlayButton>
      </ControlBar>
    </FlowContainer>
  );
};

// Main component that wraps with ReactFlowProvider
export const DemodRouteSection: React.FC = () => {
  return (
    <ReactFlowProvider>
      <DemodRouteSectionInner />
    </ReactFlowProvider>
  );
};

export default DemodRouteSection;
