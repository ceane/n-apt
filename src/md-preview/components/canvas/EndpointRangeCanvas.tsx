import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { LevaPanel, useControls, useCreateStore } from 'leva';
import { motion } from 'framer-motion';
import { CanvasImage } from './shared';
import { PretextCanvasText, type PretextCanvasTextRef } from '../../../ts/components/pretext/PretextCanvasText';

const COLORS = {
  bg: '#F3F4F6',
  text: '#111827',
  muted: '#6B7280',
  accent: '#3B82F6',
};

const CanvasContainer = styled.div`
  width: 100%;
  height: 100%;
  overflow: hidden;
  contain: strict;
  position: relative;
  background-color: #E0E0E2;
  background-image:
    linear-gradient(to right, #D7D8DA 2px, transparent 2px),
    linear-gradient(to bottom, #D7D8DA 2px, transparent 2px);
  background-size: 64px 64px;
  background-position: center bottom;
  aspect-ratio: 16/9;
  font-family: 'JetBrains Mono', 'DM Mono', monospace;
  color: ${COLORS.text};
`;

const pulse = keyframes`
  0% { transform: translate(50%, -50%) scale(0.95); opacity: 0.8; }
  50% { transform: translate(50%, -50%) scale(1.05); opacity: 0.6; }
  100% { transform: translate(50%, -50%) scale(0.95); opacity: 0.8; }
`;

const radiate = keyframes`
  0% { transform: translate(50%, -50%) scale(0.6); opacity: 0; }
  30% { opacity: 1; }
  70% { opacity: 1; }
  100% { transform: translate(50%, -50%) scale(1.4); opacity: 0; }
`;

const BlobCoverage = styled.div<{ size: number; color: string }>`
  position: absolute;
  right: 15%;
  top: 50%;
  width: ${props => props.size}%;
  height: ${props => props.size * 1.5}%;
  background: ${props => props.color};
  box-shadow: 0 0 100px 50px ${props => props.color};
  border-radius: 40% 60% 70% 30% / 40% 50% 60% 50%;
  transform: translate(50%, -50%);
  filter: blur(40px);
  opacity: 0.85;
  z-index: 1;
  animation: ${pulse} 4s ease-in-out infinite;
`;

const RainbowWave = styled.div<{ range: number }>`
  position: absolute;
  right: 15%;
  top: 25%; /* align with tower antenna */
  width: ${props => props.range * 1.2}%;
  height: ${props => props.range * 1.2 * 1.5}%;
  transform: translate(50%, -50%);
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(255, 0, 0, 0.4) 0%,
    rgba(255, 154, 0, 0.4) 20%,
    rgba(208, 222, 33, 0.4) 40%,
    rgba(79, 220, 74, 0.4) 60%,
    rgba(63, 218, 216, 0.4) 80%,
    rgba(47, 201, 226, 0.4) 100%
  );
  filter: blur(20px);
  z-index: 0;
  pointer-events: none;
  animation: ${radiate} 2.5s ease-out infinite;
`;

const ControlPanel = styled(motion.div)`
  position: absolute;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 10;
  width: 20rem;
  max-width: calc(100vw - 2rem);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid rgba(42, 42, 42, 0.3);
  background-color: rgba(255, 255, 255, 0.8);
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
`;

const PretextLayer = styled.canvas`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 8;
`;

const ResetDot = styled.div`
  position: absolute;
  bottom: 1.5rem;
  right: 1.5rem;
  width: 1rem;
  height: 1rem;
  background-color: rgba(42, 42, 42, 0.3);
  border-radius: 50%;
  cursor: pointer;
  z-index: 9;
  transition: background-color 0.2s;
  &:hover {
    background-color: rgba(42, 42, 42, 0.6);
  }
`;

export function EndpointRangeCanvas() {
  const shouldUseStaticFallback = typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined;

  const store = useCreateStore();

  const { freq, power, antWidth, antHeight, elevation, azimuth } = useControls({
    freq: { value: 1.6, min: 0.1, max: 3000, step: 0.1, label: 'Freq (MHz)' },
    power: { value: 5, min: 0.1, max: 100, step: 0.1, label: 'Power (W)' },
    antWidth: { value: 1.5, min: 0.5, max: 10, step: 0.1, label: 'Ant Width (ft)' },
    antHeight: { value: 4, min: 0.5, max: 20, step: 0.1, label: 'Ant Height (ft)' },
    elevation: { value: 25, min: 1, max: 500, step: 1, label: 'Elevation (ft)' },
    azimuth: { value: 5, min: 0, max: 360, step: 1, label: 'Azimuth (ft/deg)' },
  }, { store });

  const { losStr, multipathStr, skyStr, range0Val, range22Val, coverageSize, blobColor } = useMemo(() => {
    let losStr = 'Somewhat no';
    if (freq >= 300) losStr = 'Yes';
    else if (freq < 30) losStr = 'No';

    const multipathStr = freq > 10 ? 'Yes' : 'No';
    const skyStr = freq < 30 ? 'Yes' : 'No';

    const ptDbm = 10 * Math.log10(power * 1000);
    const gainDB = 10 * Math.log10(antWidth * antHeight * 0.5) + (elevation / 100);
    const eirp = ptDbm + gainDB;

    const lossLocal = eirp - (-40);
    const dKmLocal = Math.pow(10, (lossLocal - 20 * Math.log10(freq) - 32.44) / 20);

    const loss22 = eirp - (-22);
    const dKm22 = Math.pow(10, (loss22 - 20 * Math.log10(freq) - 32.44) / 20);

    let range0Val = Math.round(dKmLocal * 3280.84);
    let range22Val = Math.round(dKm22 * 3280.84);

    if (freq < 30) {
      range0Val = Math.round(range0Val * 0.05);
      range22Val = Math.round(range22Val * 0.05);
    }

    const normPower = Math.min(Math.max((ptDbm - 20) / 30, 0), 1);
    const size = 30 + (normPower * 70);

    let color = 'rgba(100, 150, 255, 0.8)';
    if (freq < 10) color = 'rgba(147, 51, 234, 0.8)'; // purple
    else if (freq < 100) color = 'rgba(56, 189, 248, 0.8)'; // light blue
    else color = 'rgba(16, 185, 129, 0.8)'; // emerald

    return {
      losStr,
      multipathStr,
      skyStr,
      range0Val: isNaN(range0Val) ? 0 : range0Val,
      range22Val: isNaN(range22Val) ? 0 : range22Val,
      coverageSize: size,
      blobColor: color
    };
  }, [freq, power, antWidth, antHeight, elevation, azimuth]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const textsRef = useRef<Record<string, PretextCanvasTextRef>>({});
  const setRef = (key: string) => (el: PretextCanvasTextRef | null) => {
    if (el) textsRef.current[key] = el;
  };

  const [dim, setDim] = useState({ w: 800, h: 450 });
  const [panelKey, setPanelKey] = useState(0);
  const particlesRef = useRef<{ char: string, x: number, y: number, vx: number, vy: number, opacity: number }[]>([]);
  const wavesRef = useRef<{ angle: number, wavelength: number, amplitude: number, speed: number, offsetX: number, offsetY: number }[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDim({ w: entries[0].contentRect.width, h: entries[0].contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== dim.w || canvas.height !== dim.h) {
      canvas.width = dim.w;
      canvas.height = dim.h;
    }

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== dim.w * dpr) {
      canvas.width = dim.w * dpr;
      canvas.height = dim.h * dpr;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // ==========================================
    // ANTENNA EMISSION ORIGIN CONFIGURATION
    // Adjust these coordinates to map the physical antenna!
    // ==========================================
    const antennaOrigin = {
      x: dim.w * 0.932,
      y: dim.h * 0.38,
      width: 20,   // Increase this to spread emissions horizontally
      height: 70,  // Increase this to spread emissions vertically
      showDebugOutline: false // Set to false to hide the red placement box
    };

    if (antennaOrigin.showDebugOutline) {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        antennaOrigin.x - antennaOrigin.width / 2,
        antennaOrigin.y - antennaOrigin.height / 2,
        Math.max(1, antennaOrigin.width), // draw at least a dot
        Math.max(1, antennaOrigin.height)
      );
    }

    // Draw standard strings
    Object.values(textsRef.current).forEach(t => t.draw(ctx));

    // Draw customized titles (using native draw to enforce bold weight safely)
    ctx.font = `bold ${Math.min(24, dim.w * 0.05)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("How far away?", dim.w / 2, dim.h * 0.12);

    ctx.font = `normal ${Math.min(12, dim.w * 0.025)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = COLORS.muted;
    ctx.textBaseline = "top";
    ctx.fillText("The distance an endpoint's signal can reach", dim.w / 2, dim.h * 0.12 + 10);

    // Initialize/Draw sine waves
    if (wavesRef.current.length === 0) {
      for (let i = 0; i < 8; i++) {
        // Angles around 360deg, spread evenly with slight jitter
        wavesRef.current.push({
          angle: (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.2,
          wavelength: 0.02 + Math.random() * 0.05, // angular frequency mapping
          amplitude: 15 + Math.random() * 25,
          speed: 0.2 + Math.random() * 0.4, // significantly slower oscillation
          offsetX: Math.random() - 0.5,
          offsetY: Math.random() - 0.5
        });
      }
    }

    const timePhase = Date.now() / 200;

    ctx.lineWidth = 1.5;
    const rayLength = dim.w * 0.9;
    const numPoints = 80;

    wavesRef.current.forEach((w) => {
      ctx.beginPath();
      const phase = timePhase * w.speed;

      // Map origin offset mapping
      const waveStartX = antennaOrigin.x + (w.offsetX * antennaOrigin.width);
      const waveStartY = antennaOrigin.y + (w.offsetY * antennaOrigin.height);

      for (let j = 0; j < numPoints; j++) {
        const t = j / numPoints; // 0 to 1 distance proportion
        const dist = t * rayLength;

        // Damping sine amplitude as it begins to prevent jumping directly at the antenna origin
        const startDamping = Math.min(1, dist / 40);
        const perpOffset = Math.sin(dist * w.wavelength - phase) * w.amplitude * startDamping;

        const px = waveStartX + Math.cos(w.angle) * dist + Math.cos(w.angle + Math.PI / 2) * perpOffset;
        const py = waveStartY + Math.sin(w.angle) * dist + Math.sin(w.angle + Math.PI / 2) * perpOffset;

        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }

      // Gradient alpha fade out via simple pre-baked flat stroke matching blob colors (e.g. emerald/green)
      ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`;
      ctx.stroke();
    });

    // Particle spawning (radiating all around the endpoint, reaching lower boundaries)
    if (Math.random() < 0.25) {
      particlesRef.current.push({
        char: Math.random() > 0.5 ? '1' : '0',
        x: antennaOrigin.x + (Math.random() * antennaOrigin.width - antennaOrigin.width / 2),
        y: antennaOrigin.y + (Math.random() * antennaOrigin.height - antennaOrigin.height / 2),
        vx: (Math.random() - 0.7) * 4, // mostly left, some right
        vy: (Math.random() - 0.3) * 5, // large spread mostly down, some up
        opacity: 0.8
      });
    }

    // Process particles (flow from antenna, bounce off mid-point so they don't collide with text text)
    ctx.font = `14px "JetBrains Mono", monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Midpoint X bound to protect text column
    const bounceX = dim.w * 0.55;

    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      let p = particlesRef.current[i];
      p.x += p.vx;
      p.y += p.vy;

      // Reflect off invisible text wall boundary
      if (p.x < bounceX && p.vx < 0) {
        p.vx = -p.vx;
        p.opacity *= 0.8;
      }

      // Reflect off top/bottom container screen
      if (p.y < 0 && p.vy < 0) p.vy = -p.vy;
      if (p.y > dim.h && p.vy > 0) p.vy = -p.vy;

      p.opacity -= 0.003;

      if (p.opacity <= 0 || p.x > dim.w + 50) {
        particlesRef.current.splice(i, 1);
      } else {
        // dynamic color matching
        ctx.fillStyle = `rgba(233, 233, 233, ${p.opacity})`;
        ctx.fillText(p.char, p.x, p.y);
      }
    }

    ctx.restore();
  }, [dim]);

  // Use requestAnimationFrame loop to continuously redraw so pretext strings popping back in `isReady` state update seamlessly.
  useEffect(() => {
    let frameId: number;
    const render = () => {
      drawAll();
      frameId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frameId);
  }, [drawAll]);
  const colXLabel = Math.max(20, dim.w * 0.08);
  const colXValue = colXLabel + Math.max(280, dim.w * 0.35);
  const scaleOffsetX = colXValue + 15;
  const fontSizeVar = dim.w < 600 ? 10 : 12; // Lowered specific scaling sizes min
  const startY = dim.h * 0.28;
  const gap = fontSizeVar * 1.8; // Adjusted to be 1.8 ratio to compensate for smaller font but retain space
  const fontFam = '"JetBrains Mono", monospace';

  const freqStr = Number(freq.toFixed(3));
  const powerStr = Number(power.toFixed(3));

  // Range text logic
  const formatRange = (ft: number) => {
    let scale = "room";
    if (ft > 26400) scale = "way out there"; // > 5 mi
    else if (ft > 10560) scale = "across town"; // > 2 mi
    else if (ft > 2640) scale = "neighborhood"; // > 0.5 mi
    else if (ft > 660) scale = "block";
    else if (ft > 100) scale = "floor";
    else scale = "room";

    let distStr = "";
    if (ft >= 5280) {
      distStr = `${(ft / 5280).toFixed(2)}mi`;
    } else {
      distStr = `${Math.round(ft).toLocaleString()}ft`;
    }

    return { distStr, scale };
  };

  const { distStr: r0, scale: s0 } = formatRange(range0Val);
  const { distStr: r22, scale: s22 } = formatRange(range22Val);

  return (
    <CanvasContainer ref={containerRef}>
      <PretextLayer ref={canvasRef} />

      {/* Info Rows */}
      <PretextCanvasText
        ref={setRef('row1L')}
        text="Frequency"
        fontSize={fontSizeVar}
        color="#000"
        x={colXLabel}
        y={startY}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row1V')}
        text={`${freqStr}MHz`}
        fontSize={fontSizeVar}
        color="#000"
        x={colXValue}
        y={startY}
        anchorX="right"
        font={fontFam}
      />

      <PretextCanvasText
        ref={setRef('row2L')}
        text="Power (from antenna)"
        fontSize={fontSizeVar}
        color="#000"
        x={colXLabel}
        y={startY + gap}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row2V')}
        text={`${powerStr}W`}
        fontSize={fontSizeVar}
        color="#000"
        x={colXValue}
        y={startY + gap}
        anchorX="right"
        font={fontFam}
      />

      <PretextCanvasText
        ref={setRef('row3L')}
        text="Antenna Size"
        fontSize={fontSizeVar}
        color="#000"
        x={colXLabel}
        y={startY + gap * 2}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row3V')}
        text={`${antWidth}ft x ${antHeight}ft`}
        fontSize={fontSizeVar}
        color="#000"
        x={colXValue}
        y={startY + gap * 2}
        anchorX="right"
        font={fontFam}
      />

      <PretextCanvasText
        ref={setRef('row4L')}
        text="Elevation"
        fontSize={fontSizeVar}
        color="#000"
        x={colXLabel}
        y={startY + gap * 3}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row4V')}
        text={`${elevation}ft`}
        fontSize={fontSizeVar}
        color="#000"
        x={colXValue}
        y={startY + gap * 3}
        anchorX="right"
        font={fontFam}
      />

      <PretextCanvasText
        ref={setRef('row5L')}
        text="Azimuth"
        fontSize={fontSizeVar}
        color="#000"
        x={colXLabel}
        y={startY + gap * 4}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row5V')}
        text={`${azimuth}ft`}
        fontSize={fontSizeVar}
        color="#000"
        x={colXValue}
        y={startY + gap * 4}
        anchorX="right"
        font={fontFam}
      />

      {/* Physics rows */}
      <PretextCanvasText
        ref={setRef('row6L')}
        text="Line of sight"
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXLabel}
        y={startY + gap * 5.2}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row6V')}
        text={losStr}
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXValue}
        y={startY + gap * 5.2}
        anchorX="right"
        font={fontFam}
      />

      <PretextCanvasText
        ref={setRef('row7L')}
        text="Multipath"
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXLabel}
        y={startY + gap * 6.2}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row7V')}
        text={multipathStr}
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXValue}
        y={startY + gap * 6.2}
        anchorX="right"
        font={fontFam}
      />

      <PretextCanvasText
        ref={setRef('row8L')}
        text="Sky interactions"
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXLabel}
        y={startY + gap * 7.2}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row8V')}
        text={skyStr}
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXValue}
        y={startY + gap * 7.2}
        anchorX="right"
        font={fontFam}
      />

      {/* Result rows */}
      <PretextCanvasText
        ref={setRef('row9L')}
        text="Range"
        fontSize={fontSizeVar + 2}
        color="#000"
        x={colXLabel}
        y={startY + gap * 8.7}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row9V')}
        text={`~${r0}`}
        fontSize={fontSizeVar + 2}
        color="#000"
        x={colXValue}
        y={startY + gap * 8.7}
        anchorX="right"
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row9S')}
        text={`(${s0})`}
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={scaleOffsetX}
        y={startY + gap * 8.7}
        anchorX="left"
        font={fontFam}
      />

      <PretextCanvasText
        ref={setRef('row10L')}
        text="Range at -22dBm"
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXLabel}
        y={startY + gap * 9.7}
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row10V')}
        text={`~${r22}`}
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={colXValue}
        y={startY + gap * 9.7}
        anchorX="right"
        font={fontFam}
      />
      <PretextCanvasText
        ref={setRef('row10S')}
        text={`(${s22})`}
        fontSize={fontSizeVar}
        color={COLORS.muted}
        x={scaleOffsetX}
        y={startY + gap * 9.7}
        anchorX="left"
        font={fontFam}
      />
      {/* -------------------------------------------------------------------------------------- */}

      <RainbowWave range={coverageSize * 1.5} />
      <BlobCoverage size={coverageSize} color={blobColor} />

      {!shouldUseStaticFallback && (
        <CanvasImage
          src="omni-tower.svg"
          alt="Endpoint Tower"
          right="15%"
          bottom="0px"
          height="75%"
          zIndex={9}
          objectFit="contain"
          transform="translateX(50%)"
          pointerEvents="none"
        />
      )}

      {!shouldUseStaticFallback && (
        <ResetDot onClick={() => setPanelKey(k => k + 1)} title="Reset Controls" />
      )}

      {!shouldUseStaticFallback && (
        <ControlPanel key={panelKey} drag dragMomentum={false} style={{ touchAction: 'none' }}>
          <LevaPanel
            store={store}
            fill
            flat
            titleBar={{ title: 'Controls', filter: false }}
            theme={{
              colors: {
                elevation1: 'rgba(255, 255, 255, 0.8)',
                elevation2: '#E0E0E2',
                elevation3: 'rgba(42, 42, 42, 0.3)',
                accent1: COLORS.accent,
                highlight1: COLORS.text,
                toolTipBackground: 'rgba(255, 255, 255, 0.8)',
                toolTipText: COLORS.text,
              }
            }}
          />
        </ControlPanel>
      )}
    </CanvasContainer>
  );
}

export default EndpointRangeCanvas;
