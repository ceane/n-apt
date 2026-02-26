import * as React from "react";

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

export default function AuthenticationPrompt({
  authState,
  error,
  hasPasskeys,
  onPasswordSubmit,
  onPasskeyAuth,
  onRegisterPasskey,
}: AuthenticationPromptProps) {
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(hasPasskeys);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onPasswordSubmit(password.trim());
      setPassword(""); // Clear password after submission
    }
  };

  const getStatusMessage = () => {
    switch (authState) {
      case "connecting":
        return "Connecting to server...";
      case "awaiting_challenge":
        return "Establishing secure channel...";
      case "ready":
        return hasPasskeys
          ? "Enter your passkey or password to authenticate and start streaming"
          : "Enter password to authenticate and start streaming";
      case "authenticating":
        return "Verifying credentials...";
      case "success":
        return "Authentication successful — starting stream...";
      case "failed":
        return error ? `Authentication failed — ${error}` : "Authentication failed";
      case "timeout":
        return "Authentication timed out — please retry";
      default:
        return "Initializing...";
    }
  };

  const isLoading =
    authState === "connecting" ||
    authState === "awaiting_challenge" ||
    authState === "authenticating";

  return (
    <div
      data-testid="authentication-prompt"
      style={{ padding: "20px", maxWidth: "400px", margin: "0 auto" }}
    >
      <h1>Secure Access Required for N-APT</h1>
      <p>{getStatusMessage()}</p>

      {error && <div style={{ color: "red", marginBottom: "20px" }}>{error}</div>}

      {hasPasskeys && showPassword ? (
        <>
          <button onClick={onPasskeyAuth} disabled={isLoading} data-testid="passkey-btn">
            {authState === "authenticating" ? "Authenticating..." : "Sign in with Passkey"}
          </button>
          <button
            onClick={() => setShowPassword(false)}
            disabled={isLoading}
            data-testid="password-toggle"
          >
            Use password instead
          </button>
        </>
      ) : (
        <>
          <form onSubmit={handleSubmit} data-testid="password-form">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              disabled={isLoading}
              aria-label="Password"
              role="textbox"
              data-testid="password-input"
            />
            <button type="submit" disabled={isLoading || !password.trim()} data-testid="submit-btn">
              {isLoading ? "Authenticating..." : "Authenticate"}
            </button>
          </form>
          {!hasPasskeys && (
            <button onClick={onRegisterPasskey} disabled={isLoading} data-testid="register-btn">
              Register a passkey
            </button>
          )}
          {hasPasskeys && (
            <button
              onClick={() => setShowPassword(true)}
              disabled={isLoading}
              data-testid="passkey-toggle-show"
            >
              Use passkey instead
            </button>
          )}
        </>
      )}

      {(authState === "failed" || authState === "timeout") && (
        <button
          onClick={() => {
            setPassword("");
            if (authState === "failed") {
              onPasswordSubmit(""); // Trigger retry
            }
          }}
          data-testid="retry-btn"
        >
          Retry
        </button>
      )}
    </div>
  );
}
