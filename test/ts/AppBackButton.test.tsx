import * as React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { AppBackButton } from "@n-apt/ui/AppBackButton";
import { buildAppTheme } from "@n-apt/ui/Theme";

jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: jest.fn(),
}));

const { useAuthentication } = jest.requireMock("@n-apt/app/hooks/useAuthentication");

const theme = buildAppTheme({
  accentColor: "#00ccff",
  fftColor: "#00ccff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

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
