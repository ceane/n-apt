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

const LOGIN_FFT_CYCLE_MS = 30_000;
const LOGIN_FFT_CYCLE_DURATION = `${LOGIN_FFT_CYCLE_MS / 1000}s`;

export type LoginFftStage = "signal" | "dense" | "butterfly" | "magnitude";

export const getLoginFftStage = (elapsedMs: number): LoginFftStage => {
  const cycleTime =
    ((elapsedMs % LOGIN_FFT_CYCLE_MS) + LOGIN_FFT_CYCLE_MS) %
    LOGIN_FFT_CYCLE_MS;
  if (cycleTime < 10_000) return "signal";
  if (cycleTime < 15_000) return "dense";
  if (cycleTime < 20_000) return "butterfly";
  return "magnitude";
};

const WAVE_VIEWBOX_WIDTH = 1200;
const FFT_SAMPLE_COUNT = 128;
const WAVE_BASELINE = 120;
const WAVE_AMPLITUDE = 26;
const SPECTRUM_BASELINE = 218;
// The opening, closely spaced sine traces represent the two carriers in a
// heterodyne input. The SDR stages process the sampled signal as it is, without
// drawing a separate difference tone.
const heterodyneCarrierSamples = Array.from(
  { length: FFT_SAMPLE_COUNT },
  (_, index) => Math.sin((index / FFT_SAMPLE_COUNT) * Math.PI * 2 * 2.4),
);
const sourceComponents = [
  { cycles: 4.7, amplitude: 0.48, phase: 0.1 },
  { cycles: 11.8, amplitude: 0.3, phase: 1.4 },
  { cycles: 18.35, amplitude: 0.18, phase: 2.1 },
  { cycles: 26.6, amplitude: 0.12, phase: 0.8 },
  { cycles: 39.2, amplitude: 0.08, phase: 2.8 },
  { cycles: 52.4, amplitude: 0.06, phase: 1.7 },
];
const rawSourceSamples = Array.from(
  { length: FFT_SAMPLE_COUNT },
  (_, index) => {
    const position = index / FFT_SAMPLE_COUNT;
    const signal = sourceComponents.reduce(
      (value, component) =>
        value +
        component.amplitude *
          Math.sin(position * Math.PI * 2 * component.cycles + component.phase),
      0,
    );
    const noise = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
    return signal + ((noise - Math.floor(noise)) * 2 - 1) * 0.035;
  },
);
const sourcePeak = Math.max(...rawSourceSamples.map(Math.abs));
const sourceSamples = rawSourceSamples.map((sample) => sample / sourcePeak);

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

const makeMagnitudeValues = (amplitude: number) => {
  const input = sourceSamples.map((sample) => sample * amplitude);
  return Array.from({ length: FFT_SAMPLE_COUNT / 2 + 1 }, (_, bin) => {
    let real = 0;
    let imaginary = 0;
    for (let sample = 0; sample < FFT_SAMPLE_COUNT; sample += 1) {
      const angle = (2 * Math.PI * bin * sample) / FFT_SAMPLE_COUNT;
      real += input[sample] * Math.cos(angle);
      imaginary -= input[sample] * Math.sin(angle);
    }
    const oneSidedScale = bin === 0 || bin === FFT_SAMPLE_COUNT / 2 ? 1 : 2;
    return (Math.hypot(real, imaginary) / FFT_SAMPLE_COUNT) * oneSidedScale;
  });
};

const spectrumMagnitudeAt = (values: readonly number[], position: number) => {
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, values.length - 1);
  const fraction = position - lowerIndex;
  return (
    values[lowerIndex] + (values[upperIndex] - values[lowerIndex]) * fraction
  );
};

const spectrumValuesStart = makeMagnitudeValues(0.52);
const spectrumValuesMiddle = makeMagnitudeValues(0.96);
const spectrumValuesEnd = makeMagnitudeValues(0.58);
const makeAreaPath = (tracePath: string) =>
  `${tracePath} L ${WAVE_VIEWBOX_WIDTH} ${SPECTRUM_BASELINE} L 0 ${SPECTRUM_BASELINE} Z`;

const sourceWavePath = makeTracePath(
  sourceSamples,
  WAVE_BASELINE,
  WAVE_AMPLITUDE,
);
const heterodyneCarrierPath = makeTracePath(
  heterodyneCarrierSamples,
  WAVE_BASELINE,
  WAVE_AMPLITUDE,
);
const rectifiedWavePath = makeTracePath(
  sourceSamples,
  WAVE_BASELINE,
  WAVE_AMPLITUDE,
  (value) => -Math.abs(value),
);
const makeSpectrumPath = (values: readonly number[]) =>
  Array.from({ length: FFT_SAMPLE_COUNT + 1 }, (_, index) => {
    const x = (index / FFT_SAMPLE_COUNT) * WAVE_VIEWBOX_WIDTH;
    const magnitude = spectrumMagnitudeAt(values, index / 2);
    const y = SPECTRUM_BASELINE - magnitude * 240;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");

const spectrumPathStart = makeSpectrumPath(spectrumValuesStart);
const spectrumPathMiddle = makeSpectrumPath(spectrumValuesMiddle);
const spectrumPathEnd = makeSpectrumPath(spectrumValuesEnd);
const spectrumPathReturn = heterodyneCarrierPath;
const collapsedAreaPath = makeAreaPath(
  makeTracePath(
    sourceSamples.map(() => 0),
    SPECTRUM_BASELINE,
    0,
  ),
);
const spectrumAreaPathStart = makeAreaPath(spectrumPathStart);
const spectrumAreaPathMiddle = makeAreaPath(spectrumPathMiddle);
const spectrumAreaPathEnd = makeAreaPath(spectrumPathEnd);
const animationKeyTimes =
  "0;0.3333;0.5;0.5417;0.6;0.6667;0.7167;0.8333;0.9833;1";
const FftLabel = styled.text`
  fill: ${(props) => props.theme.primary ?? "#00d4ff"};
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  letter-spacing: 0.08em;
`;

const waveZoomOut = keyframes`
  0% { transform: scaleX(2.4); }
  33.333% { transform: scaleX(1); }
  98.333% { transform: scaleX(1); }
  100% { transform: scaleX(2.4); }
`;

const secondWaveVisibility = keyframes`
  0%, 66.5% { visibility: visible; }
  66.667%, 98.2% { visibility: hidden; }
  98.333% { visibility: visible; }
  100% { visibility: visible; }
`;

const magnitudeVisibility = keyframes`
  0%, 66.5% { visibility: hidden; }
  66.667%, 98% { visibility: visible; }
  98.333%, 100% { visibility: hidden; }
`;

const foldLabelVisibility = keyframes`
  0%, 49.9% { visibility: hidden; }
  50%, 54% { visibility: visible; }
  54.167%, 100% { visibility: hidden; }
`;

const butterflyLabelVisibility = keyframes`
  0%, 54.1% { visibility: hidden; }
  54.167%, 59.9% { visibility: visible; }
  60%, 100% { visibility: hidden; }
`;

const twiddleLabelVisibility = keyframes`
  0%, 59.9% { visibility: hidden; }
  60%, 66.5% { visibility: visible; }
  66.667%, 100% { visibility: hidden; }
`;

const hexByteReflow = keyframes`
  0%, 49.9% {
    left: var(--digit-x);
    top: var(--digit-y);
  }
  54.167%, 98.333% {
    left: var(--output-x);
    top: var(--output-y);
  }
  100% {
    left: var(--digit-x);
    top: var(--digit-y);
  }
`;

const denseBytesVisibility = keyframes`
  0%, 33.2% { visibility: hidden; }
  33.333%, 98.333% { visibility: visible; }
  100% { visibility: hidden; }
`;

const FoldLabel = styled(FftLabel)`
  visibility: hidden;
  animation: ${foldLabelVisibility} ${LOGIN_FFT_CYCLE_DURATION} steps(1, end)
    infinite;
`;

const ButterflyLabel = styled(FftLabel)`
  visibility: hidden;
  animation: ${butterflyLabelVisibility} ${LOGIN_FFT_CYCLE_DURATION} steps(1, end)
    infinite;
`;

const TwiddleLabel = styled(FftLabel)`
  visibility: hidden;
  animation: ${twiddleLabelVisibility} ${LOGIN_FFT_CYCLE_DURATION} steps(1, end)
    infinite;
`;

const MagnitudeDetails = styled.g`
  visibility: hidden;
  animation: ${magnitudeVisibility} ${LOGIN_FFT_CYCLE_DURATION} steps(1, end)
    infinite;
`;

const Container = styled.div`
  flex: 1;
  position: relative;
  box-sizing: border-box;
  display: grid;
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
  }
`;

const WaveBackground = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  opacity: 0.55;
  z-index: 0;
`;

const WaveSvg = styled.svg`
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(140vw, 1400px);
  height: auto;
  transform: translate(-50%, -50%);
  overflow: visible;
`;

const WavePath = styled.path`
  fill: none;
  stroke: ${(props) => props.theme.primary ?? "#00d4ff"};
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.86;
  filter: blur(0.2px);
`;

const SecondWavePath = styled(WavePath)`
  animation: ${secondWaveVisibility} ${LOGIN_FFT_CYCLE_DURATION} steps(1, end)
    infinite;
`;

const WaveZoomGroup = styled.g`
  transform-box: fill-box;
  transform-origin: center;
  animation: ${waveZoomOut} ${LOGIN_FFT_CYCLE_DURATION} linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transform: none;
  }
`;

const HexByteLayer = styled.div`
  position: absolute;
  inset: 0;

  @media (prefers-reduced-motion: reduce) {
    opacity: 0;
  }
`;

const SpectrumArea = styled.path`
  fill: ${(props) => props.theme.primary ?? "#00d4ff"};
  opacity: 0.16;
  stroke: none;
`;

const BinaryDigitContainer = styled.div<{ $dense?: boolean }>`
  position: absolute;
  pointer-events: none;
  z-index: 0;
  left: var(--digit-x, 50%);
  top: var(--digit-y, 50%);
  animation: ${hexByteReflow} ${LOGIN_FFT_CYCLE_DURATION} linear infinite;
  opacity: 0.6;

  ${(props) =>
    props.$dense &&
    css`
      visibility: hidden;
      animation:
        ${hexByteReflow} ${LOGIN_FFT_CYCLE_DURATION} linear infinite,
        ${denseBytesVisibility} ${LOGIN_FFT_CYCLE_DURATION} steps(1, end) infinite;
    `}
`;

const BinaryDigitInner = styled.div<{
  $size: number;
}>`
  color: ${(props) => props.theme.primary ?? "#00d4ff"};
  font-family: "Courier New", monospace;
  font-weight: bold;
  font-size: ${(props) => props.$size}px;
  text-shadow: 0 0 12px ${(props) => props.theme.primary ?? "#00d4ff"}aa;
  white-space: nowrap;
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
  font-weight: 600;

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

const LinkButton = styled.button`
  background: none;
  border: none;
  color: ${(props) => props.theme.textMuted};
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
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
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
`;

const LearnMoreLink = styled(Link)`
  position: absolute;
  top: 24px;
  right: 24px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) =>
    props.theme.typography?.mono ?? '"JetBrains Mono", monospace'};
  font-size: 12px;
  font-weight: 500;
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
`;

const Essentials = styled.section`
  width: min(100%, 1440px);
  grid-row: 2;
  height: 100%;
  min-height: 0;
  position: relative;
  z-index: 1;
`;

const DeviceShowcase = styled.section`
  display: grid;
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
    --card-height: min(100%, 680px);
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
  justify-content: center;
  gap: 18px;
  padding: clamp(20px, 3vw, 36px);
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
    padding: 20px;
  }
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

const SDRSpec = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  background: ${(props) => props.theme.background};

  @media (max-width: 640px) {
    padding: 8px;
  }
`;

const SDRSpecLabel = styled.span`
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const SDRSpecValue = styled.span<{ $tone?: "good" | "warning" | "muted" }>`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: ${({ $tone, theme }) =>
    $tone === "good"
      ? "light-dark(#15803d, #4ade80)"
      : $tone === "warning"
        ? "light-dark(#b45309, #fbbf24)"
        : theme.textPrimary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;

  @media (max-width: 640px) {
    gap: 4px;
    font-size: 10px;

    svg {
      width: 12px;
      height: 12px;
    }
  }
`;

interface AuthenticationUIProps {
  authState: AuthState;
  error: string | null;
  hasPasskeys: boolean;
  onPasswordSubmit: (password: string) => void;
  onPasskeyAuth: () => void;
  onRegisterPasskey: (password: string) => void;
}

export const AuthenticationUI = ({
  authState,
  error,
  hasPasskeys,
  onPasswordSubmit,
  onPasskeyAuth,
  onRegisterPasskey,
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
  const [binaryDigits] = useState<
    Array<{
      id: number;
      value: string;
      x: number;
      y: number;
      outputX: number;
      outputY: number;
      size: number;
    }>
  >(() => {
    const digits = [];
    // Keep a readable byte stream with the input, then pack it above the fold.
    for (let i = 0; i < 24; i++) {
      // Generate random hex byte like "7A 0B"
      const byte1 = Math.floor(Math.random() * 256)
        .toString(16)
        .toUpperCase()
        .padStart(2, "0");
      const byte2 = Math.floor(Math.random() * 256)
        .toString(16)
        .toUpperCase()
        .padStart(2, "0");
      digits.push({
        id: i,
        value: `${byte1} ${byte2}`,
        x: 4 + (i % 12) * 8.1,
        y: 42 + (i < 12 ? 0 : 11) + Math.random() * 3,
        outputX: 27 + (i % 6) * 8,
        outputY: 10 + Math.floor(i / 6) * 6,
        size: 8 + Math.random() * 2,
      });
    }
    return digits;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const loginCardRef = useRef<HTMLDivElement>(null);
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
  const effectiveShowPasswordForm = showPasswordForm ?? !hasPasskeys;

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
  }, [hasPasskeys]);

  // No-op useEffect as digits are now persistent and purely CSS driven
  useEffect(() => {}, []);

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

  const getStatusMessage = () => {
    switch (authState) {
      case "connecting":
        return "Connecting to server...";
      case "server_down":
        return "Try to restart the server by running <code>npm run dev</code> and wait until this message is gone";
      case "awaiting_challenge":
        return "Establishing secure channel...";
      case "ready":
        return hasPasskeys
          ? "Enter your passkey or password to unlock the web app and features such as software defined radio (SDR) streaming, I/Q playback and more.\n\nStreaming data and I/Q captures are encrypted — your credentials establish the session key used to decrypt incoming frames and files."
          : "Enter password to authenticate and start streaming";
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
        <LearnMoreLink to="/learn">
          <Radio size={12} strokeWidth={2} />
          <span>Learn More about Signals &gt;</span>
        </LearnMoreLink>
        <LogoContainer>
          <Logo alt="N-APT Logo" />
        </LogoContainer>
        <Essentials aria-label="Login and browse SDR hardware">
          <EssentialsGrid ref={carouselRef}>
            <LoginCard ref={loginCardRef} id="login-card" aria-label="Login">
              <WaveBackground aria-hidden="true">
                <WaveSvg
                  viewBox={`0 0 ${WAVE_VIEWBOX_WIDTH} 240`}
                  preserveAspectRatio="none"
                >
                  <WaveZoomGroup>
                    <SpectrumArea d={collapsedAreaPath}>
                      <animate
                        attributeName="d"
                        values={`${collapsedAreaPath};${collapsedAreaPath};${collapsedAreaPath};${collapsedAreaPath};${collapsedAreaPath};${collapsedAreaPath};${spectrumAreaPathStart};${spectrumAreaPathMiddle};${spectrumAreaPathEnd};${collapsedAreaPath}`}
                        keyTimes={animationKeyTimes}
                        dur={LOGIN_FFT_CYCLE_DURATION}
                        repeatCount="indefinite"
                      />
                    </SpectrumArea>
                    <SecondWavePath
                      d={heterodyneCarrierPath}
                      transform="translate(8 0)"
                    >
                      <animate
                        attributeName="d"
                        values={`${heterodyneCarrierPath};${heterodyneCarrierPath};${sourceWavePath};${rectifiedWavePath};${rectifiedWavePath};${rectifiedWavePath};${spectrumPathStart};${spectrumPathMiddle};${spectrumPathEnd};${heterodyneCarrierPath}`}
                        keyTimes={animationKeyTimes}
                        dur={LOGIN_FFT_CYCLE_DURATION}
                        repeatCount="indefinite"
                      />
                    </SecondWavePath>
                    <WavePath d={heterodyneCarrierPath}>
                      <animate
                        attributeName="d"
                        values={`${heterodyneCarrierPath};${heterodyneCarrierPath};${sourceWavePath};${rectifiedWavePath};${rectifiedWavePath};${rectifiedWavePath};${spectrumPathStart};${spectrumPathMiddle};${spectrumPathEnd};${spectrumPathReturn}`}
                        keyTimes={animationKeyTimes}
                        dur={LOGIN_FFT_CYCLE_DURATION}
                        repeatCount="indefinite"
                      />
                    </WavePath>
                  </WaveZoomGroup>
                  <FoldLabel x="600" y="38" textAnchor="middle">
                    FOLD · MIRROR THE LOWER HALF
                  </FoldLabel>
                  <ButterflyLabel x="600" y="38" textAnchor="middle">
                    BUTTERFLY · SUM / DIFFERENCE
                  </ButterflyLabel>
                  <TwiddleLabel x="600" y="38" textAnchor="middle">
                    TWIDDLE · BIN PLACEMENT
                  </TwiddleLabel>
                  <MagnitudeDetails>
                    <path
                      d={`M 0 ${SPECTRUM_BASELINE} L ${WAVE_VIEWBOX_WIDTH} ${SPECTRUM_BASELINE}`}
                      stroke="currentColor"
                      strokeWidth="1"
                    />
                    <FftLabel x={WAVE_VIEWBOX_WIDTH / 2 - 24} y="40">
                      |X(k)|
                    </FftLabel>
                    <FftLabel x={WAVE_VIEWBOX_WIDTH - 120} y="238">
                      FREQUENCY
                    </FftLabel>
                  </MagnitudeDetails>
                </WaveSvg>
                <HexByteLayer>
                  {binaryDigits.map((digit) => (
                    <BinaryDigitContainer
                      key={digit.id}
                      $dense={digit.id >= 12}
                      style={
                        {
                          "--digit-x": `${digit.x}%`,
                          "--digit-y": `${digit.y}%`,
                          "--output-x": `${digit.outputX}%`,
                          "--output-y": `${digit.outputY}%`,
                        } as React.CSSProperties
                      }
                    >
                      <BinaryDigitInner $size={digit.size}>
                        {digit.value}
                      </BinaryDigitInner>
                    </BinaryDigitContainer>
                  ))}
                </HexByteLayer>
              </WaveBackground>
              <Title>
                <Lock size={16} strokeWidth={2} />
                {authState === "server_down" ? (
                  <TitleText>Server is down</TitleText>
                ) : (
                  <TitleText>Secure Access Required for N-APT</TitleText>
                )}
              </Title>
              <StatusText
                $variant={getStatusVariant()}
                dangerouslySetInnerHTML={{
                  __html: getStatusMessage().replace(/\n/g, "<br>"),
                }}
              />
              {showActions && (
                <>
                  <LegalNotice>
                    By continuing you are agreeing to the{" "}
                    <Link to="/terms">Terms of Use</Link> and{" "}
                    <Link to="/privacy">Privacy Policy</Link>.
                  </LegalNotice>
                  {hasPasskeys && !effectiveShowPasswordForm && (
                    <>
                      <AuthButton
                        $variant="primary"
                        onClick={onPasskeyAuth}
                        disabled={authState === "authenticating"}
                      >
                        {authState === "authenticating"
                          ? "Authenticating..."
                          : "Sign in with Passkey"}
                      </AuthButton>
                      <Divider>or</Divider>
                      <LinkButton onClick={() => setShowPasswordForm(true)}>
                        Use password instead
                      </LinkButton>
                    </>
                  )}

                  {(effectiveShowPasswordForm || !hasPasskeys) && (
                    <Form onSubmit={handlePasswordSubmit}>
                      <Input
                        ref={inputRef}
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={authState === "authenticating"}
                        autoComplete="off"
                      />
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
                      {hasPasskeys && effectiveShowPasswordForm && (
                        <>
                          <Divider>or</Divider>
                          <LinkButton
                            onClick={() => setShowPasswordForm(false)}
                          >
                            Use passkey instead
                          </LinkButton>
                        </>
                      )}
                    </Form>
                  )}

                  {!hasPasskeys && canInteract && (
                    <>
                      <Divider>setup</Divider>
                      <LinkButton
                        onClick={handleRegisterPasskey}
                        disabled={!password.trim()}
                      >
                        Register a passkey for this device
                      </LinkButton>
                    </>
                  )}
                </>
              )}
            </LoginCard>
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
                      </SDRSpecValue>
                    </SDRSpec>
                    <SDRSpec>
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
    isInitialAuthCheck,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleRegisterPasskey,
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
        onPasswordSubmit={handlePasswordAuth}
        onPasskeyAuth={handlePasskeyAuth}
        onRegisterPasskey={handleRegisterPasskey}
      />
    );
  }

  return <>{children}</>;
};

export default AuthenticationRoute;
