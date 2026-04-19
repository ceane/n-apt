import React, { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SignalCanvasFrame, ZeroLine, WaveLabel, WaveTube, GridBackdrop } from "@n-apt/md-preview/components/canvas/shared";
import { theme } from "@n-apt/md-preview/consts/theme";

const AmplitudeModulationScene: React.FC = () => {
  const { viewport } = useThree();
  const amWave = useMemo(() => {
    const samples = 2400;
    const xMin = -viewport.width * 0.56;
    const xMax = viewport.width * 0.56;
    const pts: THREE.Vector3[] = [];
    const cyclesAcrossCanvas = 4;

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(xMin, xMax, t);
      const amplitudeEnvelope = THREE.MathUtils.lerp(1.72, 0.18, t);
      const phase = t * Math.PI * 2 * cyclesAcrossCanvas;
      const y = Math.sin(phase) * amplitudeEnvelope;
      pts.push(new THREE.Vector3(x, y, 0));
    }

    return pts;
  }, [viewport.width]);

  return (
    <>
      <GridBackdrop />
      <WaveTube points={amWave} color={theme.colors.accent} thickness={0.028} z={0.12} segments={2200} />
    </>
  );
};

export const AmplitudeModulationCanvas: React.FC = () => {
  return (
    <SignalCanvasFrame
      title="Amplitude Modulation"
      overlay={(
        <>
          <WaveLabel style={{ left: "22%", top: "18%" }}>Higher amplitude</WaveLabel>
          <WaveLabel style={{ left: "72%", top: "33%" }}>Lower amplitude</WaveLabel>
          <WaveLabel style={{ left: "39%", top: "27%", color: "#858585", fontWeight: "normal" }}>Peak (crest)</WaveLabel>
          <WaveLabel style={{ left: "43%", top: "70%", color: "#858585", fontWeight: "normal" }}>Trough</WaveLabel>
          <ZeroLine aria-hidden="true" />
        </>
      )}
    >
      <AmplitudeModulationScene />
    </SignalCanvasFrame>
  );
};
