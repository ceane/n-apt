import React, { useState, useCallback, useRef, useEffect } from "react";
import styled, {
  createGlobalStyle,
  keyframes,
  ThemeProvider,
  ThemeContext,
} from "styled-components";
import { Link, useLocation } from "react-router";
import { Button } from "@n-apt/ui/Button";
import { ArrowRight, Lock, Radio, ThumbsUp, TriangleAlert } from "lucide-react";
import { Tooltip } from "@n-apt/ui/Tooltip";
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

const makeWavePath = (
  width: number,
  baseline: number,
  amplitude: number,
  frequency: number,
  phase: number,
  offsetX = 0,
) => {
  const segments = Math.max(24, Math.round(width / 48));
  const step = width / segments;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const x = index * step + offsetX;
    const y =
      baseline +
      Math.sin((index / segments) * Math.PI * 2 * frequency + phase) *
        amplitude;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return points.join(" ");
};

const WAVE_VIEWBOX_WIDTH = 1200;
const WAVE_PATH_WIDTH = 1800;
const WAVE_PATH_OFFSET = (WAVE_VIEWBOX_WIDTH - WAVE_PATH_WIDTH) / 2;
const wavePathA = makeWavePath(
  WAVE_PATH_WIDTH,
  110,
  28,
  1.35,
  0,
  WAVE_PATH_OFFSET,
);
const wavePathB = makeWavePath(
  WAVE_PATH_WIDTH,
  130,
  28,
  1.35,
  0,
  WAVE_PATH_OFFSET,
);

const WaveMotionProperties = createGlobalStyle`
  @property --wave-wavelength-scale {
    syntax: "<number>";
    inherits: true;
    initial-value: 1;
  }

  @property --wave-progress {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
  }
`;

const waveDrift = keyframes`
  0% {
    transform: translate3d(0, 0, 0) scaleX(var(--wave-wavelength-scale));
  }
  50% {
    transform: translate3d(-5%, 0, 0) scaleX(var(--wave-wavelength-scale));
  }
  100% {
    transform: translate3d(0, 0, 0) scaleX(var(--wave-wavelength-scale));
  }
`;

const waveDriftReverse = keyframes`
  0% {
    transform: translate3d(0, 0, 0) scaleX(var(--wave-wavelength-scale));
  }
  50% {
    transform: translate3d(5%, 0, 0) scaleX(var(--wave-wavelength-scale));
  }
  100% {
    transform: translate3d(0, 0, 0) scaleX(var(--wave-wavelength-scale));
  }
`;

const waveProgress = keyframes`
  from { --wave-progress: 0; }
  to { --wave-progress: 1; }
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
  --wave-wavelength-scale: 1;
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(140vw, 1400px);
  height: auto;
  transform: translate(-50%, -50%);
  overflow: visible;

  @supports (transform: scaleX(random(0.8, 1.2))) {
    --wave-wavelength-scale: random(--wave-wavelength, 0.8, 1.2);
  }
`;

const WavePath = styled.path<{
  $reverse?: boolean;
}>`
  fill: none;
  stroke: ${(props) => props.theme.primary ?? "#00d4ff"};
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.48;
  filter: blur(0.2px);
  animation: ${(props) => (props.$reverse ? waveDriftReverse : waveDrift)} 1s
    ease-in-out infinite;

  @supports (transform: translateX(calc(1px * progress(0.5, 0, 1)))) and
    (transform: translateX(calc(1px * abs(-1)))) {
    animation-name: ${waveProgress};
    animation-duration: 1s;
    animation-timing-function: linear;
    transform: translate3d(
        calc(
          ${(props) => (props.$reverse ? "-1" : "1")} * 5% *
            (1 - abs(2 * progress(no-clamp var(--wave-progress), 0, 1) - 1))
        ),
        0,
        0
      )
      scaleX(var(--wave-wavelength-scale));
  }

  @supports (color: color-contrast(white vs black, white)) {
    stroke: color-contrast(
      ${(props) => props.theme.background} vs
        ${(props) => props.theme.primary ?? "#00d4ff"},
      #ffffff,
      #00d4ff,
      #66e6ff
    );
  }

  @media (prefers-color-scheme: dark) {
    opacity: 0.84;
    stroke: ${(props) => props.theme.primary ?? "#00d4ff"};

    @supports (color: color-contrast(white vs black, white)) {
      stroke: color-contrast(
        ${(props) => props.theme.background} vs
          ${(props) => props.theme.primary ?? "#00d4ff"},
        #ffffff,
        #00d4ff,
        #9ff3ff
      );
    }
  }
`;

const binaryTravel = keyframes`
  0% {
    left: -5%;
    opacity: 0;
    transform: translateY(10px) scale(0.6);
  }
  10% {
    opacity: 0.6;
  }
  30% {
    opacity: 1;
    transform: translateY(-5px) scale(1.1);
  }
  70% {
    opacity: 1;
    transform: translateY(10px) scale(1);
  }
  90% {
    opacity: 0.6;
  }
  100% {
    left: 105%;
    opacity: 0;
    transform: translateY(0) scale(0.8);
  }
`;

const BinaryDigitContainer = styled.div<{ $delay: number; $duration: number }>`
  position: absolute;
  pointer-events: none;
  z-index: 0;
  top: var(--digit-y, 50%);
  animation: ${binaryTravel} ${(props) => props.$duration}s linear infinite;
  animation-delay: ${(props) => props.$delay}s;
  opacity: 0;
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
  onRegisterPasskey: () => void;
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
      y: number;
      size: number;
      delay: number;
      duration: number;
    }>
  >(() => {
    const digits = [];
    // Generate pool of 12 persistent hex bytes
    for (let i = 0; i < 12; i++) {
      const isWaveA = i < 24;
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
        y: isWaveA ? 40 + Math.random() * 8 : 52 + Math.random() * 8, // Lane-based Y
        size: 8 + Math.random() * 16,
        delay: -(Math.random() * 20), // Significant negative delay to spread them across the screen immediately
        duration: 8 + Math.random() * 8, // Variety in speed
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
    await onRegisterPasskey();
    // State changes are handled by parent component
  }, [onRegisterPasskey]);

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
      <WaveMotionProperties />
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
                  <WavePath d={wavePathA} />
                  <WavePath d={wavePathB} $reverse />
                </WaveSvg>
                {binaryDigits.map((digit) => (
                  <BinaryDigitContainer
                    key={digit.id}
                    $delay={digit.delay}
                    $duration={digit.duration}
                    style={
                      {
                        "--digit-y": `${digit.y}%`,
                      } as React.CSSProperties
                    }
                  >
                    <BinaryDigitInner $size={digit.size}>
                      {digit.value}
                    </BinaryDigitInner>
                  </BinaryDigitContainer>
                ))}
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
                      <LinkButton onClick={handleRegisterPasskey}>
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
