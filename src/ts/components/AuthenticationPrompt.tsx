import React, { useState, useCallback, useRef, useEffect } from "react";
import styled, { keyframes } from "styled-components";
import { Button } from "@n-apt/components/ui/Button";

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

const Container = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: ${(props) => props.theme.background};
  padding: 40px;
  gap: 32px;
  min-height: 100dvh;
`;

const Title = styled.h2`
  font-family: "JetBrains Mono", monospace;
  font-size: 18px;
  font-weight: 600;
  color: ${(props) => props.theme.textPrimary};
  margin: 0;
  letter-spacing: 0.5px;
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
          ? "Enter your passkey or password to unlock the live SDR stream.\n\nAll data is encrypted end-to-end — your credentials establish the session key used to decrypt incoming frames. Streaming will begin only after successful authentication."
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
      <Title>
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
