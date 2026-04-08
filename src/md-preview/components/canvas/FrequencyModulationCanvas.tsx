import React, { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SignalCanvasFrame, ZeroLine, WaveLabel, WaveLabelAnnotation, WaveTube, GridBackdrop } from "./shared";
import { theme } from "../../theme";

const FrequencyModulationScene: React.FC = () => {
  const { viewport } = useThree();
  const fmWave = useMemo(() => {
    const samples = 2400;
    const xMin = -viewport.width * 0.56;
    const xMax = viewport.width * 0.56;
    const pts: THREE.Vector3[] = [];
    let phase = 0;
    let prevX = xMin;
    const yOffset = -0.8;

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = THREE.MathUtils.lerp(xMin, xMax, t);
      const instantaneousFreq = THREE.MathUtils.lerp(8.0, 0.8, t);
      const amplitude = 1.2;

      if (i === 0) {
        phase = 0;
      } else {
        phase += (x - prevX) * Math.PI * instantaneousFreq * 0.25;
      }

      const y = Math.sin(phase) * amplitude;
      pts.push(new THREE.Vector3(x, y + yOffset, 0));
      prevX = x;
    }
    return pts;
  }, [viewport.width]);

  return (
    <>
      <GridBackdrop />
      <WaveTube points={fmWave} color={theme.colors.accent} thickness={0.028} z={0.12} segments={2200} />
    </>
  );
};

export const FrequencyModulationCanvas: React.FC = () => {
  return (
    <SignalCanvasFrame
      title="Frequency Modulation"
      overlay={(
        <>
          <ZeroLine style={{ top: "65%" }} aria-hidden="true" />
          <WaveLabel style={{ left: "22%", top: "25%" }}>
            Higher frequency <br />
            <WaveLabelAnnotation>(thinner, more cycles/second)</WaveLabelAnnotation>
          </WaveLabel>
          <WaveLabel style={{ left: "72%", top: "25%" }}>
            Lower frequency <br />
            <WaveLabelAnnotation>(wider, less cycles/second)</WaveLabelAnnotation>
          </WaveLabel>
        </>
      )}
    >
      <FrequencyModulationScene />
    </SignalCanvasFrame>
  );
};
