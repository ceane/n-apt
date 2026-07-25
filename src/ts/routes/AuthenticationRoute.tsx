import React, { useState, useCallback, useRef, useEffect } from "react";
import styled, {
  keyframes,
  ThemeProvider,
  ThemeContext,
} from "styled-components";
import { Link, useLocation } from "react-router-dom";
import { Canvas } from "@react-three/fiber";
import { Button } from "@n-apt/components/ui/Button";
import { FileSignal, Lock, Radio, SunMoon } from "lucide-react";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import {
  buildAppTheme,
  GlobalThemeStyle,
  useResolvedThemeMode,
  type AppStyledTheme,
} from "@n-apt/components/ui/Theme";
import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/components/Layout";
import nAptLogo from "@n-apt/public/images/icon.svg";
import { SDRs } from "@n-apt/components/3D/SDRs";

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

type AuthThemeMode = "system" | "dark" | "light";

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
) => {
  const segments = Math.max(24, Math.round(width / 48));
  const step = width / segments;
  const points = Array.from({ length: segments + 1 }, (_, index) => {
    const x = index * step;
    const y =
      baseline +
      Math.sin((x / width) * Math.PI * 2 * frequency + phase) * amplitude;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return points.join(" ");
};

const waveDrift = keyframes`
  0% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(-5%, 0, 0);
  }
  100% {
    transform: translate3d(0, 0, 0);
  }
`;

const waveDriftReverse = keyframes`
  0% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(5%, 0, 0);
  }
  100% {
    transform: translate3d(0, 0, 0);
  }
`;

const pillDropIntro = keyframes`
  0% {
    transform: translateY(-18px) scale(0.92);
  }
  18% {
    transform: translateY(0) scale(1.08);
  }
  30% {
    transform: translateY(1px) scale(0.98);
  }
  42% {
    transform: translateY(0) scale(1.01);
  }
  58% {
    transform: translateY(0) scale(1);
  }
  72% {
    transform: translateY(0) scale(1);
  }
  100% {
    transform: translateY(0) scale(1);
  }
`;

const Container = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: ${(props) => props.theme.background};
  padding: 40px;
  gap: 32px;
  min-height: 100dvh;
`;

const WaveBackground = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  opacity: 0.55;
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

const WavePath = styled.path<{ $delay?: string; $reverse?: boolean }>`
  fill: none;
  stroke: ${(props) => props.theme.primary ?? "#00d4ff"};
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.48;
  filter: blur(0.2px);
  animation: ${(props) => (props.$reverse ? waveDriftReverse : waveDrift)} 16s
    ease-in-out infinite;
  animation-delay: ${(props) => props.$delay ?? "0s"};

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
  z-index: 20;
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

const TextBackdrop = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: min(100%, 480px);
  padding: 20px 24px;
  backdrop-filter: blur(4px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  mask-image: radial-gradient(circle, black 60%, transparent 100%);
  -webkit-mask-image: radial-gradient(circle, black 60%, transparent 100%);
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

const AuthButton = styled(Button) <{
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

const AuthTopBar = styled.div`
  position: absolute;
  top: 24px;
  left: 24px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 4px;
  border-radius: 999px;
  background: ${(props) => props.theme.surface ?? "rgba(255, 255, 255, 0.04)"};
  border: 1px solid ${(props) => props.theme.border};
  backdrop-filter: blur(10px);
  z-index: 35;
  overflow: hidden;
  transform-origin: center center;
  perspective: 800px;
  animation: ${pillDropIntro} 0.7s ease-in-out 1;
  animation-fill-mode: forwards;
`;

const AuthTopBarLabel = styled.span`
  padding-left: 6px;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
`;

const AuthThemeButton = styled.button<{ $active?: boolean }>`
  appearance: none;
  border: 0;
  border-radius: 999px;
  padding: 6px 10px;
  background: ${(props) =>
    props.$active ? props.theme.primary : "transparent"};
  color: ${(props) =>
    props.$active ? props.theme.background : props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    color: ${(props) => props.theme.textPrimary};
    background: ${(props) =>
    props.$active ? props.theme.primary : props.theme.surfaceHover};
  }
`;

const ThemeRevealButton = styled.button<{ $expanded?: boolean }>`
  appearance: none;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: ${(props) => props.theme.textSecondary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 12px;
  cursor: pointer;
  padding: 6px 12px 6px 6px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition:
    color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    color: ${(props) => props.theme.textPrimary};
  }
`;

const ThemeControls = styled.div<{ $expanded?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: ${(props) => (props.$expanded ? "360px" : "0px")};
  opacity: ${(props) => (props.$expanded ? 1 : 0)};
  transform: ${(props) =>
    props.$expanded ? "translateX(0)" : "translateX(-8px)"};
  overflow: hidden;
  transition:
    max-width 0.28s ease,
    opacity 0.18s ease,
    transform 0.28s ease;
  pointer-events: ${(props) => (props.$expanded ? "auto" : "none")};
`;

const LoadingDot = styled.span`
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const LogoContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 24px;
`;

const Essentials = styled.section`
  width: min(100%, 760px);
  margin-top: 8px;
  padding: 16px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 14px;
  background: ${(props) => props.theme.surface ?? "rgba(0, 0, 0, 0.12)"};
  backdrop-filter: blur(12px);
  box-sizing: border-box;
`;

const EssentialsLabel = styled.p`
  margin: 0 0 12px;
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const EssentialsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const EssentialCard = styled.a`
  display: flex;
  min-height: 220px;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  color: ${(props) => props.theme.textPrimary};
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 10px;
  background: ${(props) => props.theme.background};
  text-decoration: none;
  transition: border-color 0.18s ease, transform 0.18s ease;

  &:hover {
    border-color: ${(props) => props.theme.primary};
    transform: translateY(-2px);
  }
`;

const CardIcon = styled.div`
  display: flex;
  height: 158px;
  align-items: center;
  justify-content: center;
  color: ${(props) => props.theme.primary};
  background: linear-gradient(135deg, ${(props) => props.theme.surface}, transparent);
  border-radius: 8px;
  overflow: hidden;
`;

const ModelPlaceholder = styled.div`
  display: flex;
  width: 82%;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px dashed ${(props) => props.theme.primary};
  border-radius: 5px;
  color: ${(props) => props.theme.primary};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transform: perspective(100px) rotateX(8deg) rotateY(-10deg);
`;

const SDRPreview = styled.div`
  width: 100%;
  height: 100%;

  canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
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
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const CardCapability = styled.span`
  color: ${(props) => props.theme.textMuted};
  font-family: ${(props) => props.theme.typography.mono};
  font-size: 9px;
  line-height: 1.4;
`;

const Logo = styled.img`
  width: 128px;
  height: 128px;
  filter: none;
  mix-blend-mode: normal;

  @media (prefers-color-scheme: dark) {
    filter: invert(1);
    mix-blend-mode: screen;
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
  const [themeExpanded, setThemeExpanded] = useState(false);
  const [themeIntroExpanded, setThemeIntroExpanded] = useState(true);
  const [showPasswordForm, setShowPasswordForm] = useState<boolean | null>(
    null,
  );
  const [waveFrame, setWaveFrame] = useState(0);
  const [waveViewportWidth, setWaveViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth,
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

  useEffect(() => {
    const id = window.setTimeout(() => setThemeIntroExpanded(false), 750);
    return () => window.clearTimeout(id);
  }, []);

  // Derive effective state: if user hasn't explicitly toggled, follow hasPasskeys
  const effectiveShowPasswordForm = showPasswordForm ?? !hasPasskeys;

  useEffect(() => {
    if (
      authState === "ready" &&
      effectiveShowPasswordForm &&
      inputRef.current
    ) {
      inputRef.current.focus();
    }
  }, [authState, effectiveShowPasswordForm]);

  // Reset user's explicit choice when hasPasskeys changes
  useEffect(() => {
    setShowPasswordForm(null);
  }, [hasPasskeys]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let raf = 0;
    let startTime = 0;

    const tick = (time: number) => {
      if (!startTime) startTime = time;
      setWaveFrame(time - startTime);
      raf = window.requestAnimationFrame(tick);
    };

    const handleResize = () => setWaveViewportWidth(window.innerWidth);

    handleResize();
    raf = window.requestAnimationFrame(tick);
    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const waveWidth = Math.max(waveViewportWidth, 1);
  const cycle = waveFrame / 1000;
  const amplitudeA = 18 + Math.sin(cycle * 0.8) * 10;
  const amplitudeB = 14 + Math.cos(cycle * 1.1) * 8;
  const minFrequency = Math.max(0.6, 480 / waveWidth);
  const maxFrequency = Math.max(1.1, waveWidth / 520);
  const frequencyA =
    minFrequency +
    (maxFrequency - minFrequency) * (0.5 + 0.5 * Math.sin(cycle * 0.45));
  const frequencyB =
    minFrequency +
    (maxFrequency - minFrequency) * (0.5 + 0.5 * Math.cos(cycle * 0.52 + 0.8));
  const phaseA = -cycle * 1.5;
  const phaseB = -cycle * 1.2 + Math.PI / 1.7;
  const wavePathA = makeWavePath(
    waveWidth,
    110,
    amplitudeA,
    frequencyA,
    phaseA,
  );
  const wavePathB = makeWavePath(
    waveWidth,
    130,
    amplitudeB,
    frequencyB,
    phaseB,
  );

  // No-op useEffect as digits are now persistent and purely CSS driven
  useEffect(() => { }, []);

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

  const isLoading =
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
        <AuthTopBar aria-label="Auth theme mode">
          <ThemeRevealButton
            type="button"
            $expanded={themeExpanded}
            onClick={() => {
              setThemeIntroExpanded(false);
              setThemeExpanded((value) => !value);
            }}
            aria-expanded={themeExpanded}
            aria-label={
              themeExpanded ? "Collapse theme picker" : "Expand theme picker"
            }
          >
            <Radio size={12} strokeWidth={2} />
            <span>Theme</span>
            <span>{themeExpanded ? "x" : ">"}</span>
          </ThemeRevealButton>
          <ThemeControls $expanded={themeExpanded || themeIntroExpanded}>
            <AuthThemeButton
              type="button"
              $active={authThemeMode === "system"}
              onClick={() => setAuthThemeMode("system")}
            >
              System
            </AuthThemeButton>
            <AuthThemeButton
              type="button"
              $active={authThemeMode === "light"}
              onClick={() => setAuthThemeMode("light")}
            >
              Light
            </AuthThemeButton>
            <AuthThemeButton
              type="button"
              $active={authThemeMode === "dark"}
              onClick={() => setAuthThemeMode("dark")}
            >
              Dark
            </AuthThemeButton>
          </ThemeControls>
        </AuthTopBar>
        <LearnMoreLink to="/learn-signals">
          <Radio size={12} strokeWidth={2} />
          <span>Learn More about Signals &gt;</span>
        </LearnMoreLink>
        <WaveBackground aria-hidden="true">
          <WaveSvg viewBox={`0 0 ${waveWidth} 240`} preserveAspectRatio="none">
            <WavePath d={wavePathA} />
            <WavePath d={wavePathB} $delay="-4s" $reverse />
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
        <LogoContainer>
          <Logo src={nAptLogo} alt="N-APT Logo" />
        </LogoContainer>
        <TextBackdrop>
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
        </TextBackdrop>

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
                  disabled={!password.trim() || authState === "authenticating"}
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
                    <LinkButton onClick={() => setShowPasswordForm(false)}>
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

            <Essentials aria-label="What you need to get started (and view signals in the air)">
              <EssentialsLabel>What you need to get started (and view signals in the air)</EssentialsLabel>
              <EssentialsGrid>
                <EssentialCard
                  to="/iq-captures"
                  as={Link}
                  aria-label="I/Q captures and files"
                >
                  <CardIcon>
                    <FileSignal size={30} strokeWidth={1.5} />
                  </CardIcon>
                  <CardFooter>
                    <CardCopy>
                      I/Q captures <small>learn more →</small>
                    </CardCopy>
                    <CardCapability>Playback .napt and .iq files</CardCapability>
                  </CardFooter>
                </EssentialCard>
                <EssentialCard
                  href="https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="RTL-SDR"
                >
                  <CardIcon>
                    <SDRPreview aria-label="RTL-SDR 3D model spinning">
                      <Canvas
                        camera={{ position: [2.1, 1.2, 2.5], fov: 35 }}
                        dpr={[1, 1.5]}
                        frameloop="demand"
                      >
                        <ambientLight intensity={1.2} />
                        <hemisphereLight args={["#dffaff", "#07131a", 1.6]} />
                        <directionalLight position={[0, 6, 2]} intensity={7} color="#ffffff" />
                        <spotLight
                          position={[0, 5, 2]}
                          angle={0.7}
                          penumbra={0.45}
                          intensity={12}
                          color="#ffffff"
                        />
                        <pointLight position={[-2, 1.5, 2]} intensity={5} color="#00d4ff" />
                        <pointLight position={[2, 0.5, 1]} intensity={4} color="#ffffff" />
                        <SDRs.rx.SpinningRTLSdr
                          scale={1.2}
                          position={[0, -0.2, 0]}
                          speed={0.8}
                        />
                      </Canvas>
                    </SDRPreview>
                  </CardIcon>
                  <CardFooter>
                    <CardCopy>
                      RTL-SDR <small>buy →</small>
                    </CardCopy>
                    <CardCapability>(Rx or read only)</CardCapability>
                  </CardFooter>
                </EssentialCard>
                <EssentialCard
                  href="https://greatscottgadgets.com/hackrf/one/"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="HackRF One"
                >
                  <CardIcon>
                    <SDRPreview aria-label="HackRF One 3D model spinning">
                      <Canvas
                        camera={{ position: [2.1, 1.2, 2.5], fov: 35 }}
                        dpr={[1, 1.5]}
                        frameloop="demand"
                      >
                        <ambientLight intensity={1.2} />
                        <hemisphereLight args={["#dffaff", "#07131a", 1.6]} />
                        <directionalLight position={[0, 6, 2]} intensity={7} color="#ffffff" />
                        <spotLight
                          position={[0, 5, 2]}
                          angle={0.7}
                          penumbra={0.45}
                          intensity={12}
                          color="#ffffff"
                        />
                        <pointLight position={[-2, 1.5, 2]} intensity={5} color="#00d4ff" />
                        <pointLight position={[2, 0.5, 1]} intensity={4} color="#ffffff" />
                        <SDRs.tx.SpinningHackRFOne
                          scale={0.72}
                          position={[0, -0.55, 0]}
                          speed={0.8}
                        />
                      </Canvas>
                    </SDRPreview>
                  </CardIcon>
                  <CardFooter>
                    <CardCopy>
                      HackRF One <small>buy →</small>
                    </CardCopy>
                    <CardCapability>
                      (Rx AND Tx, Half-Duplex or one mode at a time)
                    </CardCapability>
                  </CardFooter>
                </EssentialCard>
              </EssentialsGrid>
            </Essentials>
          </>
        )}
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
    location.pathname === "/learn-signals" ||
    location.pathname === "/iq-captures" ||
    location.pathname === "/fft-ifft" ||
    location.pathname.startsWith("/faq");

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
