import * as React from "react";
import {
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: jest.fn(() => ({
    authState: "ready" as const,
    isAuthenticated: false,
    authError: null,
    hasPasskeys: true,
    isInitialAuthCheck: false,
    handlePasswordAuth: jest.fn(),
    handlePasskeyAuth: jest.fn(),
    handleRegisterPasskey: jest.fn(),
  })),
}));

import {
  AuthenticationUI,
  type AuthState,
} from "@n-apt/routes/AuthenticationRoute";

describe("AuthenticationRoute", () => {
  const defaultProps = {
    authState: "ready" as AuthState,
    error: null,
    hasPasskeys: true,
    onPasswordSubmit: jest.fn(),
    onPasskeyAuth: jest.fn(),
    onRegisterPasskey: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render authentication prompt correctly", () => {
    render(<AuthenticationUI {...defaultProps} />);
    expect(
      screen.getByText("Secure Access Required for N-APT"),
    ).toBeInTheDocument();
  });

  it("should show loading state during authentication", () => {
    render(
      <AuthenticationUI {...defaultProps} authState="authenticating" />,
    );
    expect(screen.getByText("Authenticating...")).toBeInTheDocument();
  });

  it("should show success state", () => {
    render(<AuthenticationUI {...defaultProps} authState="success" />);
    expect(
      screen.getByText("Authentication successful — starting stream..."),
    ).toBeInTheDocument();
  });

  it("should show error state", () => {
    const errorMessage = "Invalid credentials";
    render(
      <AuthenticationUI
        {...defaultProps}
        authState="failed"
        error={errorMessage}
        hasPasskeys={false}
      />,
    );
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("should show timeout state", () => {
    render(
      <AuthenticationUI
        {...defaultProps}
        authState="timeout"
        hasPasskeys={false}
      />,
    );
    expect(
      screen.getByText("Authentication timed out — please retry"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("should display passkey option when available", () => {
    render(<AuthenticationUI {...defaultProps} hasPasskeys={true} />);
    expect(
      screen.getByRole("button", { name: /Sign in with Passkey/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Use password instead")).toBeInTheDocument();
  });

  it("should not display passkey option when not available", () => {
    render(<AuthenticationUI {...defaultProps} hasPasskeys={false} />);
    expect(
      screen.queryByRole("button", { name: /Sign in with Passkey/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Authenticate/ }),
    ).toBeInTheDocument();
  });

  it("should show password form when passkey available and user clicks 'Use password instead'", () => {
    render(<AuthenticationUI {...defaultProps} hasPasskeys={true} />);

    // Initially passkey form should be shown
    expect(
      screen.getByRole("button", { name: /Sign in with Passkey/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /Password/ }),
    ).not.toBeInTheDocument();

    // Click to show password form
    fireEvent.click(screen.getByText("Use password instead"));

    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Authenticate/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Use passkey instead")).toBeInTheDocument();
  });

  it("should handle password submission", async () => {
    const mockPasswordSubmit = jest.fn();
    render(
      <AuthenticationUI
        {...defaultProps}
        onPasswordSubmit={mockPasswordSubmit}
        hasPasskeys={false}
      />,
    );

    const passwordInput = screen.getByPlaceholderText("Password");
    const submitButton = screen.getByRole("button", { name: /Authenticate/ });

    await userEvent.type(passwordInput, "test-password");
    fireEvent.click(submitButton);

    expect(mockPasswordSubmit).toHaveBeenCalledWith("test-password");
  });

  it("should handle passkey authentication", () => {
    const mockPasskeyAuth = jest.fn();
    render(
      <AuthenticationUI
        {...defaultProps}
        onPasskeyAuth={mockPasskeyAuth}
        hasPasskeys={true}
      />,
    );

    const passkeyButton = screen.getByRole("button", {
      name: /Sign in with Passkey/,
    });
    fireEvent.click(passkeyButton);

    expect(mockPasskeyAuth).toHaveBeenCalled();
  });

  it("should handle passkey registration", () => {
    const mockRegisterPasskey = jest.fn();
    render(
      <AuthenticationUI
        {...defaultProps}
        onRegisterPasskey={mockRegisterPasskey}
        hasPasskeys={false}
      />,
    );

    const registerButton = screen.getByRole("button", {
      name: /Register a passkey/,
    });
    fireEvent.click(registerButton);

    expect(mockRegisterPasskey).toHaveBeenCalled();
  });

  it("should disable submit button when password is empty", async () => {
    render(<AuthenticationUI {...defaultProps} hasPasskeys={false} />);

    const submitButton = screen.getByRole("button", { name: /Authenticate/ });
    expect(submitButton).toBeDisabled();

    const passwordInput = screen.getByPlaceholderText("Password");
    await userEvent.type(passwordInput, "test");

    expect(submitButton).not.toBeDisabled();
  });

  it("should show appropriate status message for different auth states", () => {
    const testCases = [
      {
        state: "connecting" as AuthState,
        expectedMessage: /Connecting to server/,
      },
      {
        state: "awaiting_challenge" as AuthState,
        expectedMessage: /Establishing secure channel/,
      },
      {
        state: "ready" as AuthState,
        expectedMessage: /Enter your passkey or password/,
      },
      {
        state: "authenticating" as AuthState,
        expectedMessage: /Verifying credentials/,
      },
    ];

    testCases.forEach(({ state, expectedMessage }) => {
      const { unmount } = render(
        <AuthenticationUI {...defaultProps} authState={state} />,
      );
      expect(screen.getByText(expectedMessage)).toBeInTheDocument();
      unmount();
    });
  });

  it("should show different message for ready state without passkeys", () => {
    render(<AuthenticationUI {...defaultProps} hasPasskeys={false} />);
    expect(
      screen.getByText("Enter password to authenticate and start streaming"),
    ).toBeInTheDocument();
  });
});
