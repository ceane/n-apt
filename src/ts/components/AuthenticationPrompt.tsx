import React, { useState, useCallback, useRef, useEffect } from "react";
import styled, { keyframes } from "styled-components";
import { Button } from "@n-apt/components/ui/Button";
import { Lock } from "lucide-react";
import nAptLogo from "../../../images/icon.svg";

export type AuthState =
  | "connecting"
  | "awaiting_challenge"
  | "ready"
  | "authenticating"
  | "success"
  | "failed"
  | "timeout";

interface AuthenticationPromptProps {
  authState: AuthState;
  error: string | null;
  hasPasskeys: boolean;
  onPasswordSubmit: (password: string) => void;
  onPasskeyAuth: () => void;
  onRegisterPasskey: () => void;
}

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
    const y = baseline + Math.sin((x / width) * Math.PI * 2 * frequency + phase) * amplitude;
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

const Container = styled.div`
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
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
  animation: ${(props) => (props.$reverse ? waveDriftReverse : waveDrift)}
    16s ease-in-out infinite;
  animation-delay: ${(props) => props.$delay ?? "0s"};

  @supports (color: color-contrast(white vs black, white)) {
    stroke: color-contrast(
      ${(props) => props.theme.background}
      vs
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
        ${(props) => props.theme.background}
        vs
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

// Placeholder since we are moving to a single animation
const placeholderKeyframes = keyframes`from{opacity:1}to{opacity:1}`;

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
  font-family: 'Courier New', monospace;
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
      ? props.theme.danger ?? "#ff4444"
      : props.$variant === "success"
        ? props.theme.primary ?? "#00d4ff"
        : props.theme.textSecondary};
  margin: 0;
  text-align: center;
  max-width: 400px;
  line-height: 1.6;
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

const LoadingDot = styled.span`
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const LogoContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 24px;
`;

const Logo = styled.img`
  width: 128px;
  height: 128px;
  mix-blend-mode: multiply;

  
  @media (prefers-color-scheme: dark) {
    filter: invert(1);
    mix-blend-mode: screen;
  }
`;

const AuthenticationPrompt = ({
  authState,
  error,
  hasPasskeys,
  onPasswordSubmit,
  onPasskeyAuth,
  onRegisterPasskey,
}: AuthenticationPromptProps) => {
  const [password, setPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState<boolean | null>(
    null,
  );
  const [waveFrame, setWaveFrame] = useState(0);
  const [waveViewportWidth, setWaveViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth,
  );
  const [binaryDigits] = useState<Array<{
    id: number;
    value: '0' | '1';
    y: number;
    size: number;
    delay: number;
    duration: number;
  }>>(() => {
    const digits = [];
    // Generate pool of 40 persistent digits
    for (let i = 0; i < 40; i++) {
      const isWaveA = i < 24;
      digits.push({
        id: i,
        value: Math.random() > 0.5 ? '1' : '0',
        y: isWaveA ? (40 + Math.random() * 8) : (52 + Math.random() * 8), // Lane-based Y
        size: 8 + Math.random() * 16,
        delay: -(Math.random() * 20), // Significant negative delay to spread them across the screen immediately
        duration: 8 + Math.random() * 8 // Variety in speed
      });
    }
    return digits;
  });
  const inputRef = useRef<HTMLInputElement>(null);

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
  const frequencyA = minFrequency + (maxFrequency - minFrequency) * (0.5 + 0.5 * Math.sin(cycle * 0.45));
  const frequencyB = minFrequency + (maxFrequency - minFrequency) * (0.5 + 0.5 * Math.cos(cycle * 0.52 + 0.8));
  const phaseA = -cycle * 1.5;
  const phaseB = -cycle * 1.2 + Math.PI / 1.7;
  const wavePathA = makeWavePath(waveWidth, 110, amplitudeA, frequencyA, phaseA);
  const wavePathB = makeWavePath(waveWidth, 130, amplitudeB, frequencyB, phaseB);

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
        onPasswordSubmit(password);
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
    authState === "awaiting_challenge" ||
    authState === "authenticating";
  const canInteract =
    authState === "ready" || authState === "failed" || authState === "timeout";
  const showActions = canInteract || authState === "authenticating";

  const getStatusMessage = () => {
    switch (authState) {
      case "connecting":
        return "Connecting to server...";
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
    <Container>
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
            style={{
              '--digit-y': `${digit.y}%`,
            } as React.CSSProperties}
          >
            <BinaryDigitInner
              $size={digit.size}
            >
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
          {isLoading ? (
            <LoadingDot>Secure Access Required for N-APT</LoadingDot>
          ) : (
            "Secure Access Required for N-APT"
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
        </>
      )}
    </Container>
  );
};

export default AuthenticationPrompt;
