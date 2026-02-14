import { useState, useCallback, useRef, useEffect } from "react"
import styled, { keyframes } from "styled-components"

export type AuthState =
  | "connecting"
  | "awaiting_challenge"
  | "ready"
  | "authenticating"
  | "success"
  | "failed"
  | "timeout"

interface AuthenticationPromptProps {
  authState: AuthState
  error: string | null
  hasPasskeys: boolean
  onPasswordSubmit: (password: string) => void
  onPasskeyAuth: () => void
  onRegisterPasskey: () => void
}

const pulse = keyframes`
  0% { opacity: 0.4; }
  50% { opacity: 1; }
  100% { opacity: 0.4; }
`

const Container = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: #0a0a0a;
  padding: 40px;
  gap: 32px;
`

const Title = styled.h2`
  font-family: "JetBrains Mono", monospace;
  font-size: 18px;
  font-weight: 600;
  color: #e0e0e0;
  margin: 0;
  letter-spacing: 0.5px;
`

const StatusText = styled.p<{ $variant?: "info" | "error" | "success" }>`
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  color: ${(props) =>
    props.$variant === "error"
      ? "#ff4444"
      : props.$variant === "success"
        ? "#00d4ff"
        : "#666"};
  margin: 0;
  text-align: center;
  max-width: 400px;
  line-height: 1.6;
`

const Form = styled.form`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 360px;
`

const Input = styled.input`
  width: 100%;
  padding: 14px 18px;
  background-color: #141414;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  color: #e0e0e0;
  font-family: "JetBrains Mono", monospace;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease;
  box-sizing: border-box;

  &:focus {
    border-color: #00d4ff;
  }

  &::placeholder {
    color: #444;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const ActionButton = styled.button<{ $loading?: boolean; $secondary?: boolean }>`
  width: 24cqw;
  padding: 14px 24px;
  background-color: ${(props) =>
    props.$loading ? "#1a1a1a"
    : props.$secondary ? "#1a1a1a"
    : "#0d2a3a"};
  border: 1px solid ${(props) =>
    props.$loading ? "#2a2a2a"
    : props.$secondary ? "#444"
    : "#00d4ff"};
  border-radius: 8px;
  color: ${(props) =>
    props.$loading ? "#666"
    : props.$secondary ? "#888"
    : "#00d4ff"};
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  font-weight: 600;
  cursor: ${(props) => (props.$loading ? "not-allowed" : "pointer")};
  transition: all 0.2s ease;
  user-select: none;

  &:hover:not(:disabled) {
    background-color: ${(props) => (props.$secondary ? "#222" : "#0d3a4a")};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 360px;
  color: #444;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;

  &::before,
  &::after {
    content: "";
    flex: 1;
    height: 1px;
    background-color: #2a2a2a;
  }
`

const LinkButton = styled.button`
  background: none;
  border: none;
  color: #555;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.2s ease;

  &:hover {
    color: #00d4ff;
  }
`

const LoadingDot = styled.span`
  animation: ${pulse} 1.5s ease-in-out infinite;
`

const AuthenticationPrompt = ({
  authState,
  error,
  hasPasskeys,
  onPasswordSubmit,
  onPasskeyAuth,
  onRegisterPasskey,
}: AuthenticationPromptProps) => {
  const [password, setPassword] = useState("")
  const [showPasswordForm, setShowPasswordForm] = useState(!hasPasskeys)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (authState === "ready" && showPasswordForm && inputRef.current) {
      inputRef.current.focus()
    }
  }, [authState, showPasswordForm])

  useEffect(() => {
    setShowPasswordForm(!hasPasskeys)
  }, [hasPasskeys])

  const handlePasswordSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (password.trim() && (authState === "ready" || authState === "failed" || authState === "timeout")) {
        onPasswordSubmit(password)
      }
    },
    [password, authState, onPasswordSubmit],
  )

  const handleRegisterPasskey = useCallback(async () => {
    await onRegisterPasskey()
    // State changes are handled by parent component
  }, [onRegisterPasskey])

  const isLoading =
    authState === "connecting" ||
    authState === "awaiting_challenge" ||
    authState === "authenticating"
  const canInteract = authState === "ready" || authState === "failed" || authState === "timeout"
  const showActions = canInteract || authState === "authenticating"

  const getStatusMessage = () => {
    switch (authState) {
      case "connecting":
        return "Connecting to server..."
      case "awaiting_challenge":
        return "Establishing secure channel..."
      case "ready":
        return hasPasskeys
          ? "Enter your passkey or password to unlock the live SDR stream.\n\nAll data is encrypted end-to-end — your credentials establish the session key used to decrypt incoming frames. Streaming will begin only after successful authentication."
          : "Enter password to authenticate and start streaming"
      case "authenticating":
        return "Verifying credentials..."
      case "success":
        return "Authentication successful — starting stream..."
      case "failed":
        return error || "Authentication failed — please retry"
      case "timeout":
        return "Authentication timed out — please retry"
      default:
        return ""
    }
  }

  const getStatusVariant = (): "info" | "error" | "success" => {
    if (authState === "failed" || authState === "timeout") return "error"
    if (authState === "success") return "success"
    return "info"
  }

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
        dangerouslySetInnerHTML={{ __html: getStatusMessage().replace(/\n/g, '<br>') }}
      />

      {showActions && (
        <>
          {hasPasskeys && !showPasswordForm && (
            <>
              <ActionButton
                onClick={onPasskeyAuth}
                disabled={authState === "authenticating"}
                $loading={authState === "authenticating"}
              >
                {authState === "authenticating" ? "Authenticating..." : "Sign in with Passkey"}
              </ActionButton>
              <Divider>or</Divider>
              <LinkButton onClick={() => setShowPasswordForm(true)}>
                Use password instead
              </LinkButton>
            </>
          )}

          {(showPasswordForm || !hasPasskeys) && (
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
              <ActionButton
                type="submit"
                disabled={!password.trim() || authState === "authenticating"}
                $loading={authState === "authenticating"}
              >
                {authState === "authenticating"
                  ? "Authenticating..."
                  : authState === "failed" || authState === "timeout"
                    ? "Retry"
                    : "Authenticate"}
              </ActionButton>
              {hasPasskeys && showPasswordForm && (
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
              <LinkButton 
                onClick={handleRegisterPasskey}
              >
                Register a passkey for this device
              </LinkButton>
            </>
          )}
        </>
      )}
    </Container>
  )
}

export default AuthenticationPrompt
