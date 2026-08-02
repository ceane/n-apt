import * as React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { AppBackButton } from "@n-apt/components/ui/AppBackButton";

jest.mock("@n-apt/hooks/useAuthentication", () => ({
  useAuthentication: jest.fn(),
}));

const { useAuthentication } = jest.requireMock("@n-apt/hooks/useAuthentication");

const theme = {
  mode: "dark" as const,
  typography: { sans: "sans-serif", mono: "monospace" },
  primary: "#0cf",
  background: "#111",
  border: "#333",
  surface: "#222",
  textSecondary: "#ccc",
  primaryAnchor: "rgba(0,204,255,0.1)",
};

const renderButton = (isAuthenticated: boolean) => {
  useAuthentication.mockReturnValue({
    isAuthenticated,
  });

  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <AppBackButton />
      </ThemeProvider>
    </MemoryRouter>,
  );
};

describe("AppBackButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("links to sign in when the user is not authenticated", () => {
    renderButton(false);

    expect(
      screen.getByRole("link", { name: /Back to Sign In/i }),
    ).toHaveAttribute("href", "/auth");
  });

  it("links to the start page when the user is authenticated", () => {
    renderButton(true);

    expect(
      screen.getByRole("link", { name: /Back to Start Page/i }),
    ).toHaveAttribute("href", "/get-started");
  });
});
