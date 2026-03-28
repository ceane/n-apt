import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { SignalCanvasFrame, OverlayText, GridBackdrop, DottedWave, DashedWave, useWavePoints } from "./shared";
import { theme } from "../../theme";

const waveAColor = "#7c3aed"; // Vibrant Violet for Wave A
const waveBColor = "#ec4899"; // Vibrant Pink for Wave B
const sidebandColor = "#06b6d4"; // Vibrant Cyan for sideband

const AnimationLabel = styled(OverlayText)`
  font-size: ${theme.fontSizes.small};
  font-weight: 700;
  color: ${theme.colors.text};
  max-width: min(36vw, 320px);
  white-space: nowrap;
`;

const MeterLabel = styled.div`
  position: absolute;
  left: 62%;
  top: 14.5%;
  transform: translateX(-50%);
  font-family: ${theme.fonts.mono};
  font-size: 0.72rem;
  font-weight: 700;
  color: #4b5563;
  letter-spacing: 0.02em;
  pointer-events: none;
  z-index: 2;
`;

const Meter = styled.div`
  position: absolute;
  left: 65.4%;
  top: 25.5%;
  width: 24px;
  height: 48.8%;
  pointer-events: none;
  z-index: 2;
`;

const MeterStem = styled.div`
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1.5px;
  transform: translateX(-50%);
  background: #4b5563;
`;

const MeterCap = styled.div<{ $top?: boolean }>`
  position: absolute;
  left: 50%;
  width: 14px;
  height: 2px;
  transform: translateX(-50%);
  background: #4b5563;
  ${({ $top }) => ($top ? "top: 0;" : "bottom: 0;")}
`;

const ZeroLine = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 49.8%;
  border-top: 1px solid rgba(92, 92, 92, 0.24);
  pointer-events: none;
  z-index: 1;
`;

const HeterodyningScene: React.FC = () => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setPhase((value) => (value + 0.01) % (Math.PI * 2));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const waveA = useWavePoints(phase * 0.8, 0.95, 1.35, 0); // Slower freq
  const waveB = useWavePoints(phase * 0.8 + Math.PI / 2.5, 0.95, 1.85, 0); // Faster freq, shifted phase
  const sideband = useWavePoints(phase * 0.8, 0.72, 0.75, 0, 280); // Lower freq sideband

  return (
    <>
      <GridBackdrop />
      <DashedWave points={waveA} color={waveAColor} z={0.12} opacity={0.7} thickness={0.06} dashLength={8} gapLength={4} />
      <DashedWave points={waveB} color={waveBColor} z={0.1} opacity={0.7} thickness={0.06} dashLength={8} gapLength={4} />
      <DottedWave points={sideband} color={sidebandColor} step={8} size={0.06} opacity={0.95} z={0.14} />
    </>
  );
};

export const HeterodyningCanvas: React.FC = () => {
  return (
    <SignalCanvasFrame
      title="Heterodyning"
      overlay={(
        <>
          <ZeroLine />
          <MeterLabel>Amplitude (A)</MeterLabel>
          <Meter aria-hidden="true">
            <MeterStem />
            <MeterCap $top />
            <MeterCap />
          </Meter>
          <AnimationLabel $bottom="96px" $left="16px" $color={theme.colors.text}>Sideband: 30 Hz (diff)  ⚡ Sideband at peak A²</AnimationLabel>
          <AnimationLabel $bottom="72px" $left="16px" $color={theme.colors.text}>Wave B: 3,000,000 Hz</AnimationLabel>
          <AnimationLabel $bottom="48px" $left="16px" $color={theme.colors.text}>Wave A: 3,000,030 Hz (30Hz more)</AnimationLabel>
          <AnimationLabel $bottom="16px" $left="16px" $color={theme.colors.text} $weight={700}>Energy / ⚡ Waves at peak in sync: 4A²</AnimationLabel>
        </>
      )}
    >
      <HeterodyningScene />
    </SignalCanvasFrame>
  );
};
