import React, { useMemo } from 'react';
import styled from 'styled-components';

interface PolarRadioWaveChartProps {
  aperture?: number; // Physical size of the antenna in the center
  gain?: number; // Scaling factor for the lobes
  lobesCount?: number; // Approximate number of sidelobes
  beamWidth?: number; // Width of the main lobe (degrees)
  frequency?: number; // Frequency in Hz (affects diffraction/wavelength)
  rotation?: number; // Orientation of the main lobe (degrees)
  width?: number;
  height?: number;
}

const ChartContainer = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0c;
  border-radius: 12px;
  overflow: hidden;
  font-family: 'Inter', sans-serif;
`;

const SvgRoot = styled.svg`
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 10px rgba(172, 119, 255, 0.3));
`;

export const PolarRadioWaveChart: React.FC<PolarRadioWaveChartProps> = ({
  aperture = 30,
  gain = 120,
  lobesCount = 4,
  beamWidth = 20,
  frequency = 2.4e9, // 2.4 GHz
  rotation = 0,
  width = 600,
  height = 600,
}) => {
  const center = { x: width / 2, y: height / 2 - 30 };
  const maxRadius = Math.min(width, height) / 2 - 70;

  // Polar grid constants
  const rings = [0.2, 0.4, 0.6, 0.8, 1.0];
  const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  // Mathematical model for the radiation pattern
  // We use a sinc-like function to simulate the diffraction pattern of a circular or rectangular aperture
  const patternPath = useMemo(() => {
    const points: string[] = [];
    const steps = 360; // Degrees of resolution
    const radRotation = (rotation * Math.PI) / 180;

    // λ(mm) = 300,000 / f(MHz)
    // We'll normalize the input frequency if it's in Hz
    const freqMhz = frequency > 1e6 ? frequency / 1e6 : frequency;
    const wavelengthMm = 300000 / (freqMhz || 1);

    // Physics HPBW
    const physicsBeamWidth = 51 * (wavelengthMm / (aperture || 1));
    const effectiveBeamWidth = Math.min(180, Math.max(beamWidth || 5, physicsBeamWidth));

    for (let i = 0; i <= steps; i++) {
      const theta = (i * Math.PI * 2) / steps; // Radians
      const relativeTheta = theta - radRotation;

      // Normalize theta to [-PI, PI] for the sync function centered at rotation
      let normTheta = relativeTheta;
      while (normTheta > Math.PI) normTheta -= Math.PI * 2;
      while (normTheta < -Math.PI) normTheta += Math.PI * 2;

      // Simplified Sinc function for the lobe pattern: sin(x)/x
      const k = 180 / effectiveBeamWidth; // Aperture factor
      const x = normTheta * k;

      let intensity = 0;
      if (Math.abs(x) < 0.001) {
        intensity = 1.0;
      } else {
        intensity = Math.pow(Math.sin(x) / x, 2);
      }

      // If Aperture < Wavelength, diffraction dominates (leaks behind much more)
      const diffractionRatio = Math.min(1.0, wavelengthMm / (aperture || 1));
      const diffractionFloor = 0.05 + 0.4 * diffractionRatio * (0.5 + 0.5 * Math.cos(normTheta));
      const finalIntensity = intensity + (1 - intensity) * diffractionFloor;

      // Map intensity to radius, ensure it starts from aperture
      const r = aperture + finalIntensity * (maxRadius - aperture);

      const px = center.x + r * Math.sin(theta);
      const py = center.y - r * Math.cos(theta);

      points.push(`${i === 0 ? 'M' : 'L'} ${px},${py}`);
    }

    return points.join(' ') + ' Z';
  }, [aperture, maxRadius, beamWidth, rotation, center.x, center.y]);

  return (
    <ChartContainer>
      <SvgRoot viewBox={`0 0 ${width} ${height}`}>
        {/* Background Grid - Rings */}
        {rings.map((r, i) => (
          <circle
            key={`ring-${i}`}
            cx={center.x}
            cy={center.y}
            r={aperture + r * (maxRadius - aperture)}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="1"
            strokeDasharray={i === rings.length - 1 ? "0" : "4 4"}
          />
        ))}

        {/* Background Grid - Angle Lines */}
        {angles.map((angle) => {
          const rad = (angle * Math.PI) / 180;
          const x2 = center.x + maxRadius * Math.sin(rad);
          const y2 = center.y - maxRadius * Math.cos(rad);
          return (
            <g key={`angle-${angle}`}>
              <line
                x1={center.x}
                y1={center.y}
                x2={x2}
                y2={y2}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
              <text
                x={center.x + (maxRadius + 20) * Math.sin(rad)}
                y={center.y - (maxRadius + 20) * Math.cos(rad)}
                fill="rgba(255,255,255,0.3)"
                fontSize="11"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {angle}°
              </text>
            </g>
          );
        })}

        {/* Diffraction Gradient Defs */}
        <defs>
          <radialGradient id="antennaGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ac77ff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ac77ff" stopOpacity="0.2" />
          </radialGradient>

          <linearGradient id="lobeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ac77ff" stopOpacity="0.6">
              <animate attributeName="stop-opacity" values="0.6;0.4;0.6" dur="3s" repeatCount="indefinite" />
            </stop>
            <stop offset="100%" stopColor="#77aaff" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* The Radiation Pattern (Lobes) */}
        <path
          d={patternPath}
          fill="url(#lobeGradient)"
          stroke="#ac77ff"
          strokeWidth="2"
          strokeLinejoin="round"
          style={{ transition: 'd 0.3s ease-out' }}
        />

        {/* Central Antenna Model */}
        <circle
          cx={center.x}
          cy={center.y}
          r={aperture}
          fill="#1a1a1e"
          stroke="#ac77ff"
          strokeWidth="2"
        />
        <circle
          cx={center.x}
          cy={center.y}
          r={aperture - 4}
          fill="url(#antennaGlow)"
        />

        {/* Antenna "Obstruction" lines to show physical presence */}
        <line
          x1={center.x - aperture}
          y1={center.y}
          x2={center.x + aperture}
          y2={center.y}
          stroke="rgba(172, 119, 255, 0.4)"
          strokeWidth="1"
        />
        <line
          x1={center.x}
          y1={center.y - aperture}
          x2={center.x}
          y2={center.y + aperture}
          stroke="rgba(172, 119, 255, 0.4)"
          strokeWidth="1"
        />

      </SvgRoot>
    </ChartContainer>
  );
};
