import * as React from "react"

export type AuthState = "connecting" | "awaiting_challenge" | "ready" | "authenticating" | "success" | "failed" | "timeout"

interface AuthenticationPromptProps {
  authState: AuthState
  error: string | null
  hasPasskeys: boolean
  onPasswordSubmit: (password: string) => void
  onPasskeyAuth: () => void
  onRegisterPasskey: () => void
}

export default function AuthenticationPrompt({
  authState,
  error,
  hasPasskeys,
  onPasswordSubmit,
  onPasskeyAuth,
  onRegisterPasskey
}: AuthenticationPromptProps) {
  const [password, setPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(hasPasskeys)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password.trim()) {
      onPasswordSubmit(password.trim())
      setPassword("") // Clear password after submission
    }
  }

  const getStatusMessage = () => {
    switch (authState) {
      case "connecting":
        return "Connecting to server..."
      case "awaiting_challenge":
        return "Establishing secure channel..."
      case "ready":
        return hasPasskeys 
          ? "Enter your passkey or password to authenticate and start streaming"
          : "Enter password to authenticate and start streaming"
      case "authenticating":
        return "Verifying credentials..."
      case "success":
        return "Authentication successful — starting stream..."
      case "failed":
        return error ? `Authentication failed — ${error}` : "Authentication failed"
      case "timeout":
        return "Authentication timed out — please retry"
      default:
        return "Initializing..."
    }
  }

  const isLoading = authState === "connecting" || authState === "awaiting_challenge" || authState === "authenticating"

  return React.createElement("div", {
    "data-testid": "authentication-prompt",
    style: { padding: "20px", maxWidth: "400px", margin: "0 auto" }
  }, [
    React.createElement("h1", { key: "title" }, "Secure Access Required for N-APT"),
    React.createElement("p", { key: "status" }, getStatusMessage()),
    
    error && React.createElement("div", { 
      key: "error", 
      style: { color: "red", marginBottom: "20px" } 
    }, error),
    
    hasPasskeys && showPassword ? [
      React.createElement("button", {
        key: "passkey-btn",
        onClick: onPasskeyAuth,
        disabled: isLoading
      }, "Sign in with Passkey"),
      React.createElement("button", {
        key: "password-toggle",
        onClick: () => setShowPassword(false),
        disabled: isLoading
      }, "Use password instead")
    ] : [
      React.createElement("form", {
        key: "password-form",
        onSubmit: handleSubmit
      }, [
        React.createElement("input", {
          key: "password-input",
          type: "password",
          value: password,
          onChange: (e) => setPassword(e.target.value),
          placeholder: "Enter password",
          disabled: isLoading,
          "aria-label": "Password",
          role: "textbox" // Add explicit role for testing
        }),
        React.createElement("button", {
          key: "submit-btn",
          type: "submit",
          disabled: isLoading || !password.trim()
        }, isLoading ? "Authenticating..." : "Authenticate")
      ]),
      !hasPasskeys && React.createElement("button", {
        key: "register-btn",
        onClick: onRegisterPasskey,
        disabled: isLoading
      }, "Register a passkey"),
      hasPasskeys && React.createElement("button", {
        key: "passkey-toggle",
        onClick: () => setShowPassword(true),
        disabled: isLoading
      }, "Use passkey instead")
    ],
    
    (authState === "failed" || authState === "timeout") && React.createElement("button", {
      key: "retry-btn",
      onClick: () => {
        setPassword("")
        if (authState === "failed") {
          onPasswordSubmit("") // Trigger retry
        }
      }
    }, "Retry")
  ])
}
