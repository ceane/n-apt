import React, { useState, useCallback, useRef, useEffect } from "react";
import styled, {
  css,
  keyframes,
  ThemeProvider,
  ThemeContext,
} from "styled-components";
import { Link, useLocation } from "react-router";
import { Button } from "@n-apt/ui/Button";
import { ArrowRight, Lock, Radio, ThumbsUp, TriangleAlert } from "lucide-react";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import {
  buildAppTheme,
  GlobalThemeStyle,
  useResolvedThemeMode,
  type AppStyledTheme,
} from "@n-apt/ui/Theme";
import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/app/Layout";
import { Logo } from "@n-apt/ui/Logo";
import { AppThemePickerUI } from "@n-apt/ui/AppThemePicker";
import type { AppMode } from "@n-apt/redux/slices/themeSlice";
import { LazySDRCanvas } from "@n-apt/three-d/LazySDRCanvas";

export type AuthState =
  | "connecting"
  | "server_down"
  | "awaiting_challenge"
  | "ready"
  | "authenticating"
  | "success"
  | "failed"
  | "timeout";

interface AuthenticationRouteProps {
  children: React.ReactNode;
}

type AuthThemeMode = AppMode;

const AUTH_THEME_KEY = "n-apt-auth-theme-mode";

const getInitialAuthThemeMode = (): AuthThemeMode => {
  try {
    const stored = localStorage.getItem(AUTH_THEME_KEY);
    if (stored === "system" || stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }

  return "system";
};

const pulse = keyframes`
  0% { opacity: 0.4; }
  50% { opacity: 1; }
  100% { opacity: 0.4; }
`;

// Keep the complete signal → dense → twiddle → magnitude sequence visible
// within a short login-card glance.
const LOGIN_FFT_CYCLE_MS = 15_000;

export type LoginFftStage = "signal" | "dense" | "butterfly" | "magnitude";

export const getLoginFftStage = (elapsedMs: number): LoginFftStage => {
  const cycleTime =
    ((elapsedMs % LOGIN_FFT_CYCLE_MS) + LOGIN_FFT_CYCLE_MS) %
    LOGIN_FFT_CYCLE_MS;
  if (cycleTime < 4_000) return "signal";
  if (cycleTime < 6_000) return "dense";
  if (cycleTime < 8_750) return "butterfly";
  return "magnitude";
};

const WAVE_VIEWBOX_WIDTH = 1200;
const WAVE_VIEWBOX_HEIGHT = 720;
const HETERODYNE_PAIR_PHASE_OFFSET = 0.055;
const HETERODYNE_DENSE_PHASE_OFFSET = 0.075;
const INPUT_WAVE_STROKE_WIDTH = 6;
const DENSE_WAVE_STROKE_WIDTH = 3.5;
const FFT_SAMPLE_COUNT = 128;
const DENSE_SIGNAL_CYCLES = 18;
const WAVE_BASELINE = 360;
const WAVE_AMPLITUDE = 40;
const SPECTRUM_BASELINE = WAVE_VIEWBOX_HEIGHT;
const SPECTRUM_CURVE_TOP = 255;
const SPECTRUM_CURVE_FLOOR = 335;
const SPECTRUM_PEAK_SIGMA_BINS = 3.3;
const LOGIN_HEX_BYTE_COUNT = 18;
const LOGIN_HEX_FONT_SIZE = 20;
// The opening, closely spaced sine traces represent the two carriers in a
// heterodyne input. The SDR stages process the sampled signal as it is, without
// drawing a separate difference tone.
const heterodyneCarrierSamples = Array.from(
  { length: FFT_SAMPLE_COUNT },
  (_, index) => Math.sin((index / FFT_SAMPLE_COUNT) * Math.PI * 2 * 2.4),
);
// Keep the input stages as a clean, symmetric sine pair. Use a separate
// multi-tone signal only for the magnitude stage so its spectrum has several bins.
const spectrumComponents = [
  { cycles: 7, amplitude: 0.35 },
  { cycles: 18, amplitude: 0.28 },
  { cycles: 29, amplitude: 0.56 },
  { cycles: 39, amplitude: 0.35 },
  { cycles: 50, amplitude: 0.72 },
  { cycles: 60, amplitude: 0.26 },
];
const spectrumProfiles = [
  [0.55, 0.12, 0.72, 0.24, 1, 0.1],
  [0.25, 0.22, 0.35, 1, 0.28, 0.8],
  [0.42, 0.16, 1, 0.42, 0.72, 0.12],
] as const;
const makeSpectrumSamples = (profile: readonly number[]) => {
  const samples = Array.from({ length: FFT_SAMPLE_COUNT }, (_, index) =>
    spectrumComponents.reduce(
      (value, component, componentIndex) =>
        value +
        component.amplitude *
          profile[componentIndex] *
          Math.sin((index / FFT_SAMPLE_COUNT) * Math.PI * 2 * component.cycles),
      0,
    ),
  );
  const peak = Math.max(...samples.map(Math.abs)) || 1;
  return samples.map((sample) => sample / peak);
};

const makeTracePath = (
  values: readonly number[],
  baseline: number,
  scale: number,
  transform: (value: number) => number = (value) => value,
) =>
  Array.from({ length: FFT_SAMPLE_COUNT + 1 }, (_, index) => {
    const value = values[index % FFT_SAMPLE_COUNT];
    const x = (index / FFT_SAMPLE_COUNT) * WAVE_VIEWBOX_WIDTH;
    const y = baseline + transform(value) * scale;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");

const carrierSamplesAt = (seconds: number) =>
  heterodyneCarrierSamples.map((_, index) =>
    Math.sin(
      (index / FFT_SAMPLE_COUNT) * Math.PI * 2 * 2.4 +
        0.5 * seconds * Math.PI * 2,
    ),
  );
const densePhaseCyclesAt = (seconds: number) =>
  seconds <= 6
    ? 0.5 * (seconds - 4)
    : 1 +
      ((seconds - 6) / 2) * (0.5 - DENSE_SIGNAL_CYCLES / FFT_SAMPLE_COUNT / 5);
const denseSignalCyclesAt = (seconds: number) => {
  const transition = Math.max(0, Math.min(1, (seconds - 4) / 2));
  const easedTransition = transition * transition * (3 - 2 * transition);
  return 2.4 + (DENSE_SIGNAL_CYCLES - 2.4) * easedTransition;
};
const denseSignalSamplesAt = (seconds: number) => {
  const cycles = denseSignalCyclesAt(seconds);
  const phaseCycles = densePhaseCyclesAt(seconds);

  return Array.from({ length: FFT_SAMPLE_COUNT }, (_, index) =>
    Math.sin(
      (index / FFT_SAMPLE_COUNT) * Math.PI * 2 * cycles +
        phaseCycles * Math.PI * 2,
    ),
  );
};
const ease = (progress: number) => {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (3 - 2 * clamped);
};
const mix = (from: number, to: number, progress: number) =>
  from + (to - from) * ease(progress);
const makeYValues = (
  values: readonly number[],
  baseline: number,
  scale: number,
) =>
  Array.from(
    { length: FFT_SAMPLE_COUNT + 1 },
    (_, index) => baseline + values[index % FFT_SAMPLE_COUNT] * scale,
  );
const makePathFromYValues = (values: readonly number[]) =>
  values
    .map((y, index) => {
      const x = (index / FFT_SAMPLE_COUNT) * WAVE_VIEWBOX_WIDTH;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
const makeMagnitudeYValues = (values: readonly number[]) =>
  Array.from({ length: FFT_SAMPLE_COUNT + 1 }, (_, index) => {
    const magnitude = spectrumMagnitudeAt(values, index / 2);
    const level = Math.max(0, Math.min(1, magnitude / maxSpectrumMagnitude));
    return (
      SPECTRUM_CURVE_FLOOR - level * (SPECTRUM_CURVE_FLOOR - SPECTRUM_CURVE_TOP)
    );
  });
const extremaOf = (values: readonly number[]) => {
  const extrema: Array<{ index: number; peak: boolean }> = [];
  for (let index = 0; index < FFT_SAMPLE_COUNT; index += 1) {
    const previous = values[(index + FFT_SAMPLE_COUNT - 1) % FFT_SAMPLE_COUNT];
    const current = values[index];
    const next = values[(index + 1) % FFT_SAMPLE_COUNT];
    if (
      (current >= previous && current > next) ||
      (current <= previous && current < next)
    ) {
      // Positive signal peaks point down in this SVG because y increases down.
      extrema.push({ index, peak: current < previous && current <= next });
    }
  }
  return extrema;
};
const uniqueByte = (rawValue: number, usedValues: Set<number>) => {
  let value = rawValue;
  for (let distance = 1; usedValues.has(value); distance += 1) {
    const lower = rawValue - distance;
    const upper = rawValue + distance;
    if (lower >= 0 && !usedValues.has(lower)) value = lower;
    else if (upper <= 255 && !usedValues.has(upper)) value = upper;
  }
  usedValues.add(value);
  return value.toString(16).toUpperCase().padStart(2, "0");
};
const magnitudeBytesAt = (curveYValues: readonly number[]) => {
  const usedValues = new Set<number>();
  return Array.from({ length: LOGIN_HEX_BYTE_COUNT }, (_, index) => {
    const sampleIndex = Math.min(
      FFT_SAMPLE_COUNT,
      Math.round(((index + 0.5) * FFT_SAMPLE_COUNT) / LOGIN_HEX_BYTE_COUNT),
    );
    const level = Math.max(
      0,
      Math.min(
        1,
        (SPECTRUM_CURVE_FLOOR - curveYValues[sampleIndex]) /
          (SPECTRUM_CURVE_FLOOR - SPECTRUM_CURVE_TOP),
      ),
    );
    return uniqueByte(Math.round(level * 255), usedValues);
  });
};

const makeMagnitudeValues = (profile: readonly number[], amplitude: number) => {
  const input = makeSpectrumSamples(profile);
  const magnitudes = Array.from(
    { length: FFT_SAMPLE_COUNT / 2 + 1 },
    (_, bin) => {
      let real = 0;
      let imaginary = 0;
      for (let sample = 0; sample < FFT_SAMPLE_COUNT; sample += 1) {
        const angle = (2 * Math.PI * bin * sample) / FFT_SAMPLE_COUNT;
        real += input[sample] * Math.cos(angle);
        imaginary -= input[sample] * Math.sin(angle);
      }
      const oneSidedScale = bin === 0 || bin === FFT_SAMPLE_COUNT / 2 ? 1 : 2;
      return (Math.hypot(real, imaginary) / FFT_SAMPLE_COUNT) * oneSidedScale;
    },
  );

  // Keep the FFT peak values as anchors, then broaden them into readable lobes.
  return magnitudes.map(
    (_, bin) =>
      spectrumComponents.reduce((contour, component) => {
        const distance = (bin - component.cycles) / SPECTRUM_PEAK_SIGMA_BINS;
        return (
          contour +
          magnitudes[component.cycles] * Math.exp(-0.5 * distance * distance)
        );
      }, 0) * amplitude,
  );
};

const spectrumMagnitudeAt = (values: readonly number[], position: number) => {
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, values.length - 1);
  const fraction = position - lowerIndex;
  return (
    values[lowerIndex] + (values[upperIndex] - values[lowerIndex]) * fraction
  );
};

const spectrumValuesStart = makeMagnitudeValues(spectrumProfiles[0], 0.56);
const spectrumValuesMiddle = makeMagnitudeValues(spectrumProfiles[1], 1);
const spectrumValuesEnd = makeMagnitudeValues(spectrumProfiles[2], 0.64);
// Mirror fft_compute.wgsl: bit reversal, growing radix-2 groups, twiddle
// multiplication before sum/difference butterflies, then FFT shift.
const makeButterflyFrames = (input: readonly number[]) => {
  const bits = Math.log2(input.length);
  const real = input.map((_, index) => {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | ((index >> bit) & 1);
    }
    return input[reversed];
  });
  const imaginary = input.map(() => 0);
  const frames: number[][] = [];
  const snapshot = () => {
    // Project complex values onto the drawing plane; retain the imaginary
    // component so twiddle rotations remain visible in the trace.
    const projected = real.map((value, index) => value + imaginary[index] * 0.5);
    const scale = Math.max(...projected.map(Math.abs), 1e-9);
    frames.push(projected.map((value) => value / scale));
  };
  snapshot();
  for (let size = 2; size <= input.length; size *= 2) {
    const half = size / 2;
    for (let base = 0; base < input.length; base += size) {
      for (let offset = 0; offset < half; offset += 1) {
        const a = base + offset;
        const b = a + half;
        const angle = (-2 * Math.PI * offset) / size;
        const br = real[b];
        const bi = imaginary[b];
        real[b] = br * Math.cos(angle) - bi * Math.sin(angle);
        imaginary[b] = br * Math.sin(angle) + bi * Math.cos(angle);
      }
    }
    snapshot();
    for (let base = 0; base < input.length; base += size) {
      for (let offset = 0; offset < half; offset += 1) {
        const a = base + offset;
        const b = a + half;
        const ar = real[a];
        const ai = imaginary[a];
        const br = real[b];
        const bi = imaginary[b];
        real[a] = ar + br;
        imaginary[a] = ai + bi;
        real[b] = ar - br;
        imaginary[b] = ai - bi;
      }
    }
    snapshot();
  }
  const ordered = real.map((_, index) => {
    const shifted = (index + input.length / 2) % input.length;
    return real[shifted] + imaginary[shifted] * 0.5;
  });
  const scale = Math.max(...ordered.map(Math.abs), 1e-9);
  frames.push(ordered.map((value) => value / scale));
  return frames;
};
const butterflyFrames = makeButterflyFrames(makeSpectrumSamples(spectrumProfiles[0]));
const maxSpectrumMagnitude = Math.max(
  ...spectrumValuesStart,
  ...spectrumValuesMiddle,
  ...spectrumValuesEnd,
);
const carrierPathAt = (seconds: number) =>
  makeTracePath(carrierSamplesAt(seconds), WAVE_BASELINE, WAVE_AMPLITUDE);
const collapsedSpectrumPath = makePathFromYValues(
  Array(FFT_SAMPLE_COUNT + 1).fill(SPECTRUM_BASELINE),
);
const makeAreaPath = (tracePath: string) =>
  `${tracePath} L ${WAVE_VIEWBOX_WIDTH} ${SPECTRUM_BASELINE} L 0 ${SPECTRUM_BASELINE} Z`;
const collapsedAreaPath = makeAreaPath(collapsedSpectrumPath);

const Container = styled.div`
  flex: 1;
  position: relative;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  justify-items: center;
  align-items: stretch;
  align-content: stretch;
  background-color: ${(props) => props.theme.background};
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  padding: clamp(12px, 3.7vh, 40px) clamp(16px, 3vw, 40px);
  gap: clamp(12px, 3vh, 32px);

  @media (max-aspect-ratio: 4/3) {
    padding-block: clamp(12px, 2.4vh, 24px);
    gap: clamp(10px, 2vh, 20px);
  }

  @media (max-height: 760px) {
    padding-block: clamp(8px, 1.8vh, 14px);
    gap: clamp(10px, 2vh, 16px);
  }

  @media (max-width: 640px) {
    padding-inline: 16px;
    gap: 12px;
    grid-template-rows: auto auto;
    align-content: start;
    height: auto;
    min-height: 100dvh;
    overflow-x: hidden;
    overflow-y: auto;
  }
`;

const WaveBackground = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
`;

const WaveSvg = styled.svg`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
`;

const WavePath = styled.path`
  fill: none;
  stroke: ${(props) => props.theme.primary ?? "#00d4ff"};
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.473;
  filter: blur(0.2px);
`;

const InputWavePath = styled(WavePath)``;
const SecondWavePath = styled(WavePath)``;
const WaveZoomGroup = styled.g``;

const SpectrumArea = styled.path`
  fill: ${(props) => props.theme.primary ?? "#00d4ff"};
  opacity: 0.176;
  stroke: none;
`;

const SpectrumCurve = styled.path`
  fill: none;
  stroke: ${(props) => props.theme.primary ?? "#00d4ff"};
  stroke-width: 7;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.539;
`;

const Title = styled.h2`
  font-family: "JetBrains Mono", monospace;
  font-size: 18px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
  margin: 0;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusText = styled.p<{ $variant?: "info" | "error" | "success" }>`
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  color: ${(props) =>
    props.$variant === "error"
      ? (props.theme.danger ?? "#ff4444")
      : props.$variant === "success"
        ? (props.theme.primary ?? "#00d4ff")
        : props.theme.textSecondary};
  margin: 0;
  text-align: center;
  max-width: 400px;
  line-height: 1.6;

  code {
    display: inline-block;
    padding: 0.12em 0.38em;
    border-radius: 6px;
    border: 1px solid ${(props) => props.theme.border};
    background: ${(props) => props.theme.surface ?? "rgba(0, 0, 0, 0.08)"};
    color: ${(props) => props.theme.textPrimary};
    font-size: 0.95em;
    line-height: 1.2;
    white-space: nowrap;
  }

  strong {
    font-weight: 700;
  }
`;

const TitleText = styled.span`
  animation: none;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 360px;
`;

const Input = styled.input`
  width: 100%;
  padding: 14px 18px;
  background-color: ${(props) => props.theme.surface ?? "#141414"};
  border: 1px solid ${(props) => props.theme.border ?? "#2a2a2a"};
  border-radius: 8px;
  color: ${(props) => props.theme.textPrimary};
  font-family: "JetBrains Mono", monospace;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease;
  box-sizing: border-box;

  &:focus {
    border-color: ${(props) => props.theme.primary};
  }

  &::placeholder {
    color: ${(props) => props.theme.textMuted};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const AuthButton = styled(Button)<{
  $variant?: "primary" | "secondary" | "danger";
}>`
  width: 24cqw;
  padding: 14px 24px;
  font-size: 13px;
  font-weight: 700;

  ${(props) =>
    props.$variant === "primary" &&
    `
      background-color: ${props.theme.surface};
      border: 1px solid ${props.theme.primary} !important;
      color: ${props.theme.primary};
      box-shadow: none;

      &:hover {
        background-color: ${props.theme.primary}0d;
        border-color: ${props.theme.primary} !important;
        color: ${props.theme.primary};
        box-shadow: 0 0 0 1px ${props.theme.primary}33, 0 0 14px ${props.theme.primary}22;
      }

      &:disabled {
        color: ${props.theme.textMuted};
      }
    `}

  ${(props) =>
    props.$variant === "secondary" &&
    `
      background-color: ${props.theme.surface};
      border: 1px solid ${props.theme.border} !important;
      color: ${props.theme.textSecondary};
      box-shadow: none;

      &:hover {
        background-color: ${props.theme.surfaceHover};
        border-color: ${props.theme.borderHover} !important;
        color: ${props.theme.textPrimary};
        box-shadow: 0 0 0 1px ${props.theme.borderHover}33;
      }
    `}
`;

const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 360px;
  color: ${(props) => props.theme.textMuted};
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;

  &::before,
  &::after {
    content: "";
    flex: 1;
    height: 1px;
    background-color: ${(props) => props.theme.border};
  }
`;

const EnrollmentHint = styled.p`
  width: min(100%, 360px);
  margin: 0;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
`;

const LinkButton = styled.button.attrs({ type: "button" })`
  background: none;
  border: none;
  color: ${(props) => props.theme.textMuted};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.2s ease;

  &:hover {
    color: ${(props) => props.theme.primary};
  }
`;

const LegalNotice = styled.p`
  width: min(100%, 360px);
  margin: 0;
  color: ${(props) => props.theme.textMuted};
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  line-height: 1.6;
  text-align: center;

  a {
    color: ${(props) => props.theme.primary};
    font-weight: 800;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  a:hover {
    text-decoration: underline;
  }
`;

const LearnMoreLink = styled(Link)`
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  top: -30px;
  right: 4px;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
  text-decoration: none;
  transition: color 0.2s ease;
  z-index: 30;

  &:hover {
    color: ${(props) => props.theme.primary};
  }
`;

const _LoadingDot = styled.span`
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const LogoContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: clamp(4px, 1.5vh, 16px);

  @media (max-height: 760px) {
    margin-bottom: clamp(0px, 1vh, 8px);
  }

  @media (max-width: 640px) {
    padding-top: 48px;
  }
`;

const Essentials = styled.section`
  width: min(100%, 1440px);
  min-width: 0;
  grid-row: 2;
  height: 100%;
  min-height: 0;
  position: relative;
  z-index: 1;

  @media (max-width: 640px) {
    height: auto;
    min-height: 670px;
  }
`;

const LoginShowcase = styled.div`
  display: grid;
  min-width: 0;
  grid-column: 1;
  grid-row: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 0 minmax(0, 1fr);
  align-items: center;
`;

const LoginHeadingTrack = styled.div`
  position: sticky;
  left: 0;
  z-index: 3;
  width: 100%;
  grid-column: 1;
  grid-row: 1;
  height: 0;
  justify-self: stretch;
  overflow: visible;
`;

const DeviceShowcase = styled.section`
  display: grid;
  min-width: 0;
  grid-column: span 2;
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-columns: var(--card-track) var(--card-track);
  grid-template-rows: 0 minmax(0, 1fr);
  align-content: stretch;
  align-items: center;
  column-gap: var(--track-gap);
`;

const DeviceHeadingTrack = styled.div`
  position: sticky;
  left: 0;
  z-index: 3;
  width: 0;
  grid-column: 1 / -1;
  grid-row: 1;
  height: 0;
  justify-self: start;
  overflow: visible;
`;

const EssentialsLabel = styled.h2`
  position: absolute;
  top: -30px;
  left: 4px;
  width: max-content;
  white-space: nowrap;
  margin: 0;
  padding: 0;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  background: transparent;
  backdrop-filter: none;
  pointer-events: none;
`;

const EssentialsGrid = styled.div`
  --track-gap: 18px;
  --card-track: calc((100% - var(--track-gap)) / 1.5);
  --card-height: min(100%, 720px);
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  grid-auto-columns: var(--card-track);
  grid-auto-flow: column;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  gap: var(--track-gap);
  overflow-x: auto;
  overscroll-behavior-x: none;
  scroll-behavior: auto;
  padding: 42px 2px clamp(8px, 1.2vh, 14px);
  scrollbar-color: ${(props) => props.theme.primary}
    ${(props) => props.theme.surface};

  @media (max-width: 640px) {
    --track-gap: 12px;
    --card-track: 84vw;
    --card-height: 620px;
    height: 670px;
    min-height: 670px;
  }
`;

const EssentialCard = styled.a`
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  min-height: 440px;
  flex-direction: column;
  justify-content: space-between;
  gap: 20px;
  padding: clamp(20px, 3vw, 36px);
  color: ${(props) => props.theme.textPrimary};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 16px;
  background: linear-gradient(
    150deg,
    ${(props) => props.theme.surface},
    ${(props) => props.theme.background} 70%
  );
  text-decoration: none;
  transition:
    border-color 0.18s ease,
    transform 0.18s ease;
  @media (max-width: 640px) {
    min-height: 420px;
    padding: 20px;
  }

  &:hover {
    border-color: ${(props) => props.theme.primary};
    transform: translateY(-2px);
  }
`;

const SDRCard = styled(EssentialCard)`
  height: var(--card-height);
  align-self: center;
  min-height: 0;
  box-sizing: border-box;
  gap: 0;
  padding: 0;

  @media (max-width: 640px) {
    min-height: 620px;
    padding: 0;
  }
`;

const CardIcon = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  height: clamp(220px, 28vw, 340px);
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.primary};
  background: linear-gradient(
    135deg,
    ${(props) => props.theme.surface},
    transparent
  );
  border-radius: 8px;
  overflow: hidden;
`;

const SDRCanvasArea = styled(CardIcon)`
  width: 100%;
  height: auto;
  min-height: 0;
  flex: 1 1 auto;
  border-radius: 0;
  background: transparent;
`;

const LoginCard = styled.div`
  position: relative;
  grid-row: 2;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  width: auto;
  align-self: center;
  box-sizing: border-box;
  height: var(--card-height);
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 5vh clamp(20px, 3vw, 36px) 2vh;
  color: ${(props) => props.theme.textPrimary};
  border: 1px solid ${(props) => props.theme.primary}88;
  border-radius: 16px;
  background: linear-gradient(
    150deg,
    ${(props) => props.theme.surface},
    ${(props) => props.theme.background} 70%
  );
  > *:not(${WaveBackground}) {
    position: relative;
    z-index: 1;
  }

  ${AuthButton} {
    width: min(100%, 360px);
  }

  ${StatusText} {
    max-width: 520px;
  }

  @media (max-width: 640px) {
    min-height: 620px;
    padding: 5vh 20px 2vh;
  }
`;

const LoginCardIntro = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
`;

const LoginCardActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: clamp(8px, 1.2vh, 14px);
  width: 100%;
`;

const CardCopy = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;

  small {
    color: ${(props) => props.theme.textMuted};
    font-size: 10px;
    font-weight: 400;
  }
`;

const CardFooter = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SDRCardFooter = styled(CardFooter)`
  flex: 0 0 auto;
  gap: 16px;
  padding: 20px clamp(20px, 3vw, 36px) 24px;
  border-top: 1px solid ${(props) => props.theme.border};
  background: ${(props) => props.theme.surface};
`;

const SDRFooterTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`;

const SDRTitle = styled(CardCopy)`
  justify-content: flex-start;
  font-size: 17px;
  letter-spacing: 0.015em;
`;

const BuyBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 8px 12px;
  color: ${(props) => props.theme.primary};
  border: 1px solid ${(props) => props.theme.primary}66;
  border-radius: 999px;
  background: ${(props) => props.theme.background};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  transition: background 0.18s ease;

  ${SDRCard}:hover & {
    background: ${(props) => props.theme.primary}12;
  }
`;

const SDRSpecs = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 640px) {
    gap: 6px;
  }
`;

const SDRSpec = styled.div<{ $unsupported?: boolean }>`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  background: ${({ $unsupported, theme }) =>
    $unsupported ? theme.surface : theme.background};
  opacity: ${({ $unsupported }) => ($unsupported ? 0.58 : 1)};

  @media (max-width: 640px) {
    padding: 8px;
  }
`;

const SDRSpecLabel = styled.span`
  min-width: 0;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
`;

const SDRSpecValue = styled.span<{
  $tone?: "good" | "warning" | "muted" | "yellow";
}>`
  display: inline-flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: ${({ $tone, theme }) =>
    $tone === "yellow"
      ? "#b8860b"
      : $tone === "good"
        ? "light-dark(#15803d, #4ade80)"
        : $tone === "warning"
          ? "light-dark(#b45309, #fbbf24)"
          : theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;

  @media (max-width: 640px) {
    gap: 4px;
    font-size: 10px;
    align-items: flex-start;

    svg {
      width: 12px;
      height: 12px;
      flex: 0 0 12px;
    }
  }
`;

interface AuthenticationUIProps {
  authState: AuthState;
  error: string | null;
  hasPasskeys: boolean;
  hasFidoSecurityKey: boolean;
  onPasswordSubmit: (password: string) => void;
  onPasskeyAuth: () => void;
  onFidoKeyAuth: () => void;
  onRegisterPasskey: (password: string) => void;
  onRegisterFidoKey: (password: string) => Promise<void> | void;
}

export const AuthenticationUI = ({
  authState,
  error,
  hasPasskeys,
  hasFidoSecurityKey,
  onPasswordSubmit,
  onPasskeyAuth,
  onFidoKeyAuth,
  onRegisterPasskey,
  onRegisterFidoKey,
}: AuthenticationUIProps) => {
  const themeContext = React.useContext(ThemeContext);
  const baseTheme = (themeContext ??
    buildAppTheme({
      accentColor: "#00d4ff",
      fftColor: "#00d4ff",
      appMode: "system",
      resolvedMode: "dark",
      waterfallTheme: "classic",
    })) as AppStyledTheme;
  const [password, setPassword] = useState("");
  const [authThemeMode, setAuthThemeMode] = useState<AuthThemeMode>(
    getInitialAuthThemeMode,
  );
  const [showPasswordForm, setShowPasswordForm] = useState<boolean | null>(
    null,
  );
  const [isFidoEnrollmentFlow, setIsFidoEnrollmentFlow] = useState(false);
  const [isFidoEnrollmentPending, setIsFidoEnrollmentPending] = useState(false);
  const [fidoEnrollmentError, setFidoEnrollmentError] = useState<string | null>(null);
  const [binaryDigits] = useState(() => {
    const used = new Set<string>();
    return Array.from({ length: LOGIN_HEX_BYTE_COUNT }, (_, id) => {
      let value = "00";
      do {
        value = Math.floor(Math.random() * 256)
          .toString(16)
          .toUpperCase()
          .padStart(2, "0");
      } while (used.has(value));
      used.add(value);
      return { id, value };
    });
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const loginCardRef = useRef<HTMLDivElement>(null);
  const inputWaveRef = useRef<SVGPathElement>(null);
  const secondWaveRef = useRef<SVGPathElement>(null);
  const spectrumAreaRef = useRef<SVGPathElement>(null);
  const spectrumCurveRef = useRef<SVGPathElement>(null);
  const spectrumRevealRef = useRef<SVGRectElement>(null);
  const waveSvgRef = useRef<SVGSVGElement>(null);
  const byteGlyphScaleYRef = useRef(1);
  const zoomGroupRef = useRef<SVGGElement>(null);
  const byteRefs = useRef<Array<SVGTextElement | null>>([]);
  const bytePositionRefs = useRef<Array<{ x: number; y: number } | null>>([]);
  const resolvedAuthThemeMode = useResolvedThemeMode(authThemeMode);
  const authTheme = React.useMemo(
    () =>
      buildAppTheme({
        accentColor: baseTheme.primary,
        fftColor: baseTheme.fft,
        appMode: authThemeMode,
        resolvedMode: resolvedAuthThemeMode,
        waterfallTheme: baseTheme.waterfallTheme,
      }),
    [authThemeMode, baseTheme, resolvedAuthThemeMode],
  );

  useEffect(() => {
    try {
      localStorage.setItem(AUTH_THEME_KEY, authThemeMode);
    } catch {
      // localStorage unavailable
    }
  }, [authThemeMode]);

  // Derive effective state: if user hasn't explicitly toggled, follow hasPasskeys
  const hasWebAuthnLogin = hasPasskeys || hasFidoSecurityKey;
  const effectiveShowPasswordForm = showPasswordForm ?? !hasWebAuthnLogin;

  useEffect(() => {
    if (authState !== "ready" || !effectiveShowPasswordForm) return;
    const carousel = carouselRef.current;
    const loginCard = loginCardRef.current;
    if (!carousel || !loginCard) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting)
          inputRef.current?.focus({ preventScroll: true });
      },
      { root: carousel, threshold: 0.5 },
    );
    observer.observe(loginCard);
    return () => observer.disconnect();
  }, [authState, effectiveShowPasswordForm]);

  // Reset user's explicit choice when hasPasskeys changes
  useEffect(() => {
    setShowPasswordForm(null);
  }, [hasPasskeys, hasFidoSecurityKey]);

  useEffect(() => {
    const svg = waveSvgRef.current;
    if (!svg) return;

    const updateGlyphScale = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const xScale = width / WAVE_VIEWBOX_WIDTH;
      const yScale = height / WAVE_VIEWBOX_HEIGHT;
      byteGlyphScaleYRef.current = xScale / yScale;
    };
    const bounds = svg.getBoundingClientRect();
    updateGlyphScale(bounds.width, bounds.height);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]) => {
      updateGlyphScale(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    let startedAt: number | undefined;

    const update = (now: number) => {
      startedAt ??= now;
      const seconds = ((now - startedAt) / 1000) % 15;
      let samples = carrierSamplesAt(seconds * 2);
      let pairCycles = 2.4;
      let zoom = 1;
      let reveal = 0;
      let inputVisible = seconds < 8.75;
      let magnitudeVisible = false;
      let fillVisible = false;
      let curveY: number[];
      const denseWaveProgress =
        seconds >= 4 && seconds < 8.75
          ? ease(Math.min(1, (seconds - 4) / 0.45))
          : 0;
      const pairPhaseOffset = mix(
        HETERODYNE_PAIR_PHASE_OFFSET,
        HETERODYNE_DENSE_PHASE_OFFSET,
        denseWaveProgress,
      );
      const waveStrokeWidth = mix(
        INPUT_WAVE_STROKE_WIDTH,
        DENSE_WAVE_STROKE_WIDTH,
        denseWaveProgress,
      );
      inputWaveRef.current?.style.setProperty(
        "stroke-width",
        `${waveStrokeWidth}px`,
      );
      secondWaveRef.current?.style.setProperty(
        "stroke-width",
        `${waveStrokeWidth}px`,
      );

      if (seconds < 4) {
        samples = carrierSamplesAt(seconds);
        curveY = makeYValues(samples, WAVE_BASELINE, WAVE_AMPLITUDE);
        zoom = 2.4 - 1.4 * ease(seconds / 4);
        inputVisible = true;
      } else if (seconds < 6) {
        pairCycles = denseSignalCyclesAt(seconds);
        samples = denseSignalSamplesAt(seconds);
        curveY = makeYValues(samples, WAVE_BASELINE, WAVE_AMPLITUDE);
        inputVisible = true;
      } else {
        magnitudeVisible = seconds >= 8.75 && seconds < 14.5;
        fillVisible = seconds >= 8.75 && seconds < 14.5;
        if (seconds < 8.75) {
          pairCycles = DENSE_SIGNAL_CYCLES;
          const binProgress = Math.max(0, (seconds - 8) / 0.75);
          const denseY = makeYValues(
            denseSignalSamplesAt(seconds),
            WAVE_BASELINE,
            WAVE_AMPLITUDE,
          );
          let foldedY: number[];
          if (seconds < 6.6) {
            const target = makeYValues(butterflyFrames[0], WAVE_BASELINE, WAVE_AMPLITUDE);
            foldedY = denseY.map((value, index) => mix(value, target[index], (seconds - 6) / 0.6));
          } else {
            const framePosition = seconds < 7.25
              ? (seconds - 6.6) / 0.65
              : 1 + Math.min(1, (seconds - 7.25) / 0.75) * (butterflyFrames.length - 2);
            const lower = Math.floor(framePosition);
            const upper = Math.min(lower + 1, butterflyFrames.length - 1);
            const from = makeYValues(butterflyFrames[lower], WAVE_BASELINE, WAVE_AMPLITUDE);
            const to = makeYValues(butterflyFrames[upper], WAVE_BASELINE, WAVE_AMPLITUDE);
            foldedY = from.map((value, index) => mix(value, to[index], framePosition - lower));
          }
          const spectrumY = makeMagnitudeYValues(spectrumValuesStart);
          curveY = foldedY.map((value, index) =>
            mix(value, spectrumY[index], binProgress),
          );
        } else if (seconds < 10.25) {
          reveal = Math.min(1, (seconds - 8.75) / 0.75);
          const from = makeMagnitudeYValues(spectrumValuesStart);
          const to = makeMagnitudeYValues(spectrumValuesMiddle);
          const progress = (seconds - 8.75) / 1.5;
          curveY = from.map((value, index) => mix(value, to[index], progress));
        } else if (seconds < 11.75) {
          reveal = 1;
          const from = makeMagnitudeYValues(spectrumValuesMiddle);
          const to = makeMagnitudeYValues(spectrumValuesEnd);
          const progress = (seconds - 10.25) / 1.5;
          curveY = from.map((value, index) => mix(value, to[index], progress));
        } else if (seconds < 14.5) {
          reveal = 1;
          curveY = makeMagnitudeYValues(spectrumValuesEnd);
        } else {
          const progress = (seconds - 14.5) / 0.5;
          const from = makeMagnitudeYValues(spectrumValuesEnd);
          samples = carrierSamplesAt(seconds * 2);
          const to = makeYValues(samples, WAVE_BASELINE, WAVE_AMPLITUDE);
          curveY = from.map((value, index) => mix(value, to[index], progress));
          zoom = 1 + 1.4 * ease(progress);
          inputVisible = true;
        }
      }

      const d = makePathFromYValues(curveY);
      inputWaveRef.current?.setAttribute("d", d);
      secondWaveRef.current?.setAttribute("d", d);
      secondWaveRef.current?.setAttribute(
        "transform",
        `translate(${(WAVE_VIEWBOX_WIDTH * pairPhaseOffset) / pairCycles} 0)`,
      );
      spectrumCurveRef.current?.setAttribute("d", d);
      spectrumAreaRef.current?.setAttribute("d", makeAreaPath(d));
      spectrumRevealRef.current?.setAttribute(
        "width",
        String(WAVE_VIEWBOX_WIDTH * reveal),
      );
      zoomGroupRef.current?.setAttribute(
        "transform",
        `translate(${WAVE_VIEWBOX_WIDTH / 2} 0) scale(${zoom} 1) translate(${-WAVE_VIEWBOX_WIDTH / 2} 0)`,
      );
      inputWaveRef.current?.setAttribute(
        "visibility",
        inputVisible ? "visible" : "hidden",
      );
      secondWaveRef.current?.setAttribute(
        "visibility",
        inputVisible ? "visible" : "hidden",
      );
      spectrumCurveRef.current?.setAttribute(
        "visibility",
        magnitudeVisible ? "visible" : "hidden",
      );
      spectrumAreaRef.current?.setAttribute(
        "visibility",
        fillVisible ? "visible" : "hidden",
      );

      // Match the preview: use extrema of the live dense wave, then carry each
      // byte into its magnitude bin during the fold. The SVG group transform
      // applies equally to wave, fill, and labels.
      const byteWave =
        seconds >= 14.5
          ? samples
          : denseSignalSamplesAt(Math.min(seconds, 8.75));
      const extrema = extremaOf(seconds >= 6 && seconds < 8 ? curveY : byteWave);
      const activeByteCount = Math.min(extrema.length, binaryDigits.length);
      const selectedExtrema: typeof extrema = [];
      let previousExtremum = -1;
      for (let index = 0; index < activeByteCount; index += 1) {
        const target = activeByteCount === 1
          ? 0
          : (index * (extrema.length - 1)) / (activeByteCount - 1);
        const peak = index % 2 === 0 ? extrema[0].peak : !extrema[0].peak;
        const lastCandidate = extrema.length - (activeByteCount - index);
        let best = previousExtremum + 1;
        let distance = Infinity;
        for (let candidate = best; candidate <= lastCandidate; candidate += 1) {
          if (extrema[candidate].peak !== peak) continue;
          const candidateDistance = Math.abs(candidate - target);
          if (candidateDistance < distance) {
            best = candidate;
            distance = candidateDistance;
          }
        }
        selectedExtrema.push(extrema[best]);
        previousExtremum = best;
      }
      const byteCurveY = seconds >= 6 && seconds < 8
        ? curveY
        : makeYValues(byteWave, WAVE_BASELINE, WAVE_AMPLITUDE);
      const bytesAreMagnitude = seconds >= 8.75 && seconds < 14.5;
      if (bytesAreMagnitude) {
        magnitudeBytesAt(curveY).forEach((value, index) => {
          const node = byteRefs.current[index];
          if (node && node.textContent !== value) node.textContent = value;
        });
      }
      const binPosition = (index: number, yValues: readonly number[]) => {
        const sampleIndex = Math.min(
          FFT_SAMPLE_COUNT,
          Math.round(((index + 0.5) * FFT_SAMPLE_COUNT) / binaryDigits.length),
        );
        return {
          x: (WAVE_VIEWBOX_WIDTH * sampleIndex) / FFT_SAMPLE_COUNT,
          y: Math.max(12, yValues[sampleIndex] - 22),
        };
      };
      binaryDigits.forEach((_, index) => {
        const node = byteRefs.current[index];
        const point = selectedExtrema[index];
        if (!node) return;
        if (seconds < 4) {
          bytePositionRefs.current[index] = null;
          node.setAttribute("visibility", "hidden");
          return;
        }
        const peakPosition = point
          ? {
              x: (WAVE_VIEWBOX_WIDTH * point.index) / FFT_SAMPLE_COUNT,
              y: byteCurveY[point.index] + (point.peak ? -24 : 40),
            }
          : seconds < 14.5
            ? bytePositionRefs.current[index]
            : null;
        if (!peakPosition) {
          bytePositionRefs.current[index] = null;
          node.setAttribute("visibility", "hidden");
          return;
        }
        let position = peakPosition;
        if (seconds >= 8 && seconds < 8.75) {
          const target = binPosition(
            index,
            makeMagnitudeYValues(spectrumValuesStart),
          );
          const progress = (seconds - 8) / 0.75;
          position = {
            x: mix(peakPosition.x, target.x, progress),
            y: mix(peakPosition.y, target.y, progress),
          };
        } else if (seconds >= 8.75 && seconds < 14.5) {
          position = binPosition(index, curveY);
        } else if (seconds >= 14.5) {
          const source = binPosition(
            index,
            makeMagnitudeYValues(spectrumValuesEnd),
          );
          const progress = (seconds - 14.5) / 0.5;
          position = {
            x: mix(source.x, peakPosition.x, progress),
            y: mix(source.y, peakPosition.y, progress),
          };
        }
        bytePositionRefs.current[index] = position;
        node.setAttribute("x", String(position.x));
        node.setAttribute("y", String(position.y));
        const scaleY = byteGlyphScaleYRef.current;
        node.setAttribute(
          "transform",
          `translate(${position.x} ${position.y}) scale(1 ${scaleY}) translate(${-position.x} ${-position.y})`,
        );
        node.setAttribute("visibility", "visible");
      });

      frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [binaryDigits]);

  const handlePasswordSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (
        password.trim() &&
        (authState === "ready" ||
          authState === "failed" ||
          authState === "timeout")
      ) {
        onPasswordSubmit(password.trim());
      }
    },
    [password, authState, onPasswordSubmit],
  );

  const handleFidoEnrollment = useCallback(async () => {
    const enrollmentPassword = password.trim();
    if (!enrollmentPassword) {
      setFidoEnrollmentError(
        "Enter your password to authorize enrollment, then tap your security key when prompted.",
      );
      inputRef.current?.focus({ preventScroll: true });
      return;
    }

    setFidoEnrollmentError(null);
    setIsFidoEnrollmentPending(true);
    try {
      await onRegisterFidoKey(enrollmentPassword);
    } finally {
      setIsFidoEnrollmentPending(false);
    }
  }, [onRegisterFidoKey, password]);

  const handleRegisterPasskey = useCallback(async () => {
    if (!password.trim()) return;
    await onRegisterPasskey(password.trim());
    // State changes are handled by parent component
  }, [onRegisterPasskey, password]);

  const _isLoading =
    authState === "connecting" ||
    authState === "server_down" ||
    authState === "awaiting_challenge" ||
    authState === "authenticating";
  const canInteract =
    authState === "ready" || authState === "failed" || authState === "timeout";
  const showActions = canInteract || authState === "authenticating";

  const getStatusMessage = (): React.ReactNode => {
    switch (authState) {
      case "connecting":
        return "Connecting to server...";
      case "server_down":
        return (
          <>
            Try to restart the server by running <code>npm run dev</code> and
            wait until this message is gone
          </>
        );
      case "awaiting_challenge":
        return "Establishing secure channel...";
      case "ready":
        return (
          <>
            To use the web app, choose <strong>Passkey, Password or FIDO security key</strong> to unlock.
            <br />
            <br />
            Streaming frames from radios (compatible SDRs) and I/Q captures are
            encrypted — your credentials are used to decrypt incoming frames and files.
          </>
        );
      case "authenticating":
        return "Verifying credentials...";
      case "success":
        return "Authentication successful — starting stream...";
      case "failed":
        return error
          ? error
          : "Authentication failed — Server disconnected 500";
      case "timeout":
        return "Authentication timed out — please retry";
      default:
        return "";
    }
  };

  const getStatusVariant = (): "info" | "error" | "success" => {
    if (authState === "failed" || authState === "timeout") return "error";
    if (authState === "success") return "success";
    return "info";
  };

  return (
    <ThemeProvider theme={authTheme}>
      <GlobalThemeStyle theme={authTheme} />
      <Container>
        <AppThemePickerUI
          mode={authThemeMode}
          onModeChange={setAuthThemeMode}
          placement="floating"
          autoIntroExpand
        />
        <LogoContainer>
          <Logo alt="N-APT Logo" />
        </LogoContainer>
        <Essentials aria-label="Login and browse SDR hardware">
          <EssentialsGrid ref={carouselRef}>
            <LoginShowcase>
              <LoginHeadingTrack>
                <LearnMoreLink to="/learn">
                  <Radio size={10} strokeWidth={2} />
                  <span>Learn More about Signals</span>
                </LearnMoreLink>
              </LoginHeadingTrack>
              <LoginCard ref={loginCardRef} id="login-card" aria-label="Login">
              <WaveBackground aria-hidden="true">
                <WaveSvg
                  ref={waveSvgRef}
                  viewBox={`0 0 ${WAVE_VIEWBOX_WIDTH} ${WAVE_VIEWBOX_HEIGHT}`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <clipPath
                      id="login-spectrum-reveal"
                      clipPathUnits="userSpaceOnUse"
                    >
                      <rect
                        ref={spectrumRevealRef}
                        x="0"
                        y="0"
                        width="0"
                        height={WAVE_VIEWBOX_HEIGHT}
                      />
                    </clipPath>
                  </defs>
                  <WaveZoomGroup ref={zoomGroupRef}>
                    <SpectrumArea
                      ref={spectrumAreaRef}
                      d={collapsedAreaPath}
                      clipPath="url(#login-spectrum-reveal)"
                      visibility="hidden"
                    />
                    <SecondWavePath
                      ref={secondWaveRef}
                      d={carrierPathAt(0)}
                      transform={`translate(${(WAVE_VIEWBOX_WIDTH * HETERODYNE_PAIR_PHASE_OFFSET) / 2.4} 0)`}
                    />
                    <InputWavePath ref={inputWaveRef} d={carrierPathAt(0)} />
                    <SpectrumCurve
                      ref={spectrumCurveRef}
                      d={collapsedSpectrumPath}
                    />
                    <g
                      fill={authTheme.primary}
                      opacity="0.9"
                      fontFamily="Courier New, monospace"
                      fontSize={LOGIN_HEX_FONT_SIZE}
                      fontWeight="900"
                      stroke={authTheme.primary}
                      strokeWidth="0.35"
                      paintOrder="stroke fill"
                      textAnchor="middle"
                    >
                      {binaryDigits.map((digit) => (
                        <text
                          key={digit.id}
                          ref={(node) => {
                            byteRefs.current[digit.id] = node;
                          }}
                          x="0"
                          y="0"
                          visibility="hidden"
                        >
                          {digit.value}
                        </text>
                      ))}
                    </g>
                  </WaveZoomGroup>
                </WaveSvg>
              </WaveBackground>
              <LoginCardIntro>
                <Title>
                  <Lock size={16} strokeWidth={2} />
                  {authState === "server_down" ? (
                    <TitleText>Server is down</TitleText>
                  ) : (
                    <TitleText>Secure Access Required for N-APT</TitleText>
                  )}
                </Title>
        <StatusText $variant={getStatusVariant()} role="status" aria-live="polite">
          {isFidoEnrollmentPending ? (
            <>
              <_LoadingDot aria-hidden="true">● </_LoadingDot>
              Enrollment in progress. Follow each browser prompt and tap your security key when asked; it may prompt twice.
            </>
          ) : (
            getStatusMessage()
          )}
                </StatusText>
              </LoginCardIntro>
              <LoginCardActions>
                {showActions && (
                  <>
                    <LegalNotice>
                      By continuing you are agreeing to the{" "}
                      <Link to="/terms">Terms of Use</Link> and{" "}
                      <Link to="/privacy">Privacy Policy</Link>.
                    </LegalNotice>
                    {hasWebAuthnLogin && !effectiveShowPasswordForm && (
                      <>
                        {hasPasskeys && <AuthButton
                          $variant="primary"
                          onClick={onPasskeyAuth}
                          disabled={authState === "authenticating"}
                        >
                          {authState === "authenticating" ? "Authenticating..." : "Use Passkey"}
                        </AuthButton>}
                        {hasFidoSecurityKey && <AuthButton
                          $variant={hasPasskeys ? "secondary" : "primary"}
                          onClick={onFidoKeyAuth}
                          disabled={authState === "authenticating"}
                        >
                          {authState === "authenticating" ? "Authenticating..." : "Use FIDO Security Key"}
                        </AuthButton>}
                        <Divider>or</Divider>
                        <LinkButton onClick={() => {
                          setIsFidoEnrollmentFlow(false);
                          setShowPasswordForm(true);
                        }}>
                          Use Password
                        </LinkButton>
                        {!hasFidoSecurityKey && canInteract && (
                          <LinkButton onClick={() => {
                            setFidoEnrollmentError(null);
                            setIsFidoEnrollmentFlow(true);
                            setShowPasswordForm(true);
                          }}>
                            Set up FIDO vault with security key
                          </LinkButton>
                        )}
                      </>
                    )}

                    {effectiveShowPasswordForm && (
                      <Form onSubmit={handlePasswordSubmit}>
                        <Input
                          ref={inputRef}
                          type="password"
                          placeholder={isFidoEnrollmentFlow ? "Password to authorize FIDO enrollment" : "Password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={authState === "authenticating"}
                          autoComplete="off"
                        />
                        {isFidoEnrollmentFlow && (
                          <EnrollmentHint>
                            Your password authorizes adding a login key. After verification, follow the browser prompts and tap your key when asked; it may prompt twice.
                          </EnrollmentHint>
                        )}
                        <AuthButton
                          type="submit"
                          $variant="primary"
                          disabled={
                            !password.trim() || authState === "authenticating"
                          }
                        >
                          {authState === "authenticating"
                            ? "Authenticating..."
                            : authState === "failed" || authState === "timeout"
                              ? "Retry"
                              : "Authenticate"}
                        </AuthButton>
                        {hasWebAuthnLogin && effectiveShowPasswordForm && (
                          <>
                            <Divider>or</Divider>
                            <LinkButton
                              onClick={() => setShowPasswordForm(false)}
                            >
                              Other sign-in methods
                            </LinkButton>
                          </>
                        )}
                        {!hasFidoSecurityKey && canInteract && (
                          <>
                            <AuthButton
                              type="button"
                              $variant="secondary"
                              onClick={handleFidoEnrollment}
                              disabled={isFidoEnrollmentPending}
                            >
                              {isFidoEnrollmentPending
                                ? "Waiting for security key…"
                                : "Set up FIDO vault with security key"}
                            </AuthButton>
                            {fidoEnrollmentError && (
                              <StatusText $variant="error" role="alert">
                                {fidoEnrollmentError}
                              </StatusText>
                            )}
                          </>
                        )}
                      </Form>
                    )}

                    {!hasPasskeys && effectiveShowPasswordForm && canInteract && (
                      <>
                        <Divider>setup</Divider>
                        <LinkButton
                          onClick={handleRegisterPasskey}
                          disabled={!password.trim()}
                        >
                          Register a passkey
                        </LinkButton>
                      </>
                    )}
                  </>
                )}
              </LoginCardActions>
              </LoginCard>
            </LoginShowcase>
            <DeviceShowcase aria-label="SDR hardware for seeing signals in the air">
              <DeviceHeadingTrack>
                <EssentialsLabel>
                  What you need to see signals in the air
                </EssentialsLabel>
              </DeviceHeadingTrack>
              <SDRCard
                href="https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/"
                target="_blank"
                rel="noreferrer"
                aria-label="RTL-SDR"
              >
                <SDRCanvasArea>
                  <LazySDRCanvas
                    variant="rtl"
                    withAntenna
                    framing="wide"
                    fitToCanvas
                  />
                </SDRCanvasArea>
                <SDRCardFooter>
                  <SDRFooterTop>
                    <SDRTitle>RTL-SDR</SDRTitle>
                    <BuyBadge>
                      Buy device <ArrowRight size={13} />
                    </BuyBadge>
                  </SDRFooterTop>
                  <SDRSpecs role="group" aria-label="Device capabilities">
                    <SDRSpec>
                      <SDRSpecLabel>Mode</SDRSpecLabel>
                      <SDRSpecValue>Simplex</SDRSpecValue>
                    </SDRSpec>
                    <SDRSpec>
                      <SDRSpecLabel>Receive</SDRSpecLabel>
                      <SDRSpecValue $tone="good">
                        <ThumbsUp size={14} aria-hidden="true" /> Good
                        (500kHz-1.766GHz)
                      </SDRSpecValue>
                    </SDRSpec>
                    <SDRSpec $unsupported aria-disabled="true">
                      <SDRSpecLabel>Transmit</SDRSpecLabel>
                      <SDRSpecValue $tone="muted">No Tx</SDRSpecValue>
                    </SDRSpec>
                  </SDRSpecs>
                </SDRCardFooter>
              </SDRCard>
              <SDRCard
                href="https://greatscottgadgets.com/hackrf/one/"
                target="_blank"
                rel="noreferrer"
                aria-label="HackRF One"
              >
                <SDRCanvasArea>
                  <LazySDRCanvas variant="hackrf" />
                </SDRCanvasArea>
                <SDRCardFooter>
                  <SDRFooterTop>
                    <SDRTitle>HackRF One</SDRTitle>
                    <BuyBadge>
                      Buy device <ArrowRight size={13} />
                    </BuyBadge>
                  </SDRFooterTop>
                  <SDRSpecs>
                    <SDRSpec>
                      <SDRSpecLabel>Mode</SDRSpecLabel>
                      <SDRSpecValue>Half-duplex</SDRSpecValue>
                    </SDRSpec>
                    <SDRSpec>
                      <SDRSpecLabel>Receive</SDRSpecLabel>
                      <SDRSpecValue $tone="warning">
                        <TriangleAlert size={14} aria-hidden="true" />
                        Poor below HF (&lt;HF)
                      </SDRSpecValue>
                      <SDRSpecValue $tone="yellow">
                        <ThumbsUp size={14} aria-hidden="true" />
                        {" "}Ok (1MHz-6GHz)
                      </SDRSpecValue>
                    </SDRSpec>
                    <SDRSpec>
                      <SDRSpecLabel>Transmit</SDRSpecLabel>
                      <SDRSpecValue $tone="good">
                        <ThumbsUp size={14} aria-hidden="true" /> Good
                      </SDRSpecValue>
                    </SDRSpec>
                  </SDRSpecs>
                </SDRCardFooter>
              </SDRCard>
            </DeviceShowcase>
          </EssentialsGrid>
        </Essentials>
      </Container>
    </ThemeProvider>
  );
};

export const AuthenticationRoute: React.FC<AuthenticationRouteProps> = ({
  children,
}) => {
  const location = useLocation();
  const {
    authState,
    isAuthenticated,
    authError,
    hasPasskeys,
    hasFidoSecurityKey,
    isInitialAuthCheck,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleFidoKeyAuth,
    handleRegisterPasskey,
    handleRegisterFidoKey,
  } = useAuthentication();
  const isPublicRoute =
    location.pathname === "/terms" ||
    location.pathname === "/privacy" ||
    location.pathname === "/license" ||
    location.pathname === "/responsible-use" ||
    location.pathname.startsWith("/learn");

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isInitialAuthCheck) {
    return (
      <InitializingContainer>
        <InitializingTitle>Initializing N-APT</InitializingTitle>
        <InitializingText>
          Establishing secure connection and verifying session…
        </InitializingText>
      </InitializingContainer>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthenticationUI
        authState={authState}
        error={authError}
        hasPasskeys={hasPasskeys}
        hasFidoSecurityKey={hasFidoSecurityKey}
        onPasswordSubmit={handlePasswordAuth}
        onPasskeyAuth={handlePasskeyAuth}
        onFidoKeyAuth={handleFidoKeyAuth}
        onRegisterPasskey={handleRegisterPasskey}
        onRegisterFidoKey={handleRegisterFidoKey}
      />
    );
  }

  return <>{children}</>;
};

export default AuthenticationRoute;
