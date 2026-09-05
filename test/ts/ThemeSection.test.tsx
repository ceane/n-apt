import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeSection } from "@n-apt/settings/sidebar/ThemeSection";
import { useAppSelector } from "@n-apt/redux";
import { TestWrapper } from "./testUtils";
import { ThemeProvider } from "styled-components";
import { THEME_TOKENS } from "@n-apt/consts/theme";

const mockTheme = {
  mode: "dark" as const,
  requestedMode: "system" as const,
  waterfallTheme: "classic",
  colors: THEME_TOKENS.colors.dark,
  typography: THEME_TOKENS.typography,
  spacing: THEME_TOKENS.spacing,
  layout: THEME_TOKENS.layout,
  primary: "#00d4ff",
  primaryAlpha: "#00d4ff33",
  primaryAnchor: "#00d4ff1a",
  fft: "#00d4ff",
  cssVariables: {},
};

// Test harness to check Redux state
const ThemeTestHarness: React.FC = () => {
  const appMode = useAppSelector((state) => state.theme.appMode);
  return <div data-testid="theme-state">{appMode}</div>;
};

describe("ThemeSection Component", () => {
  it("should render theme options when open", () => {
    render(
      <TestWrapper>
        <ThemeProvider theme={mockTheme}>
          <ThemeSection />
        </ThemeProvider>
      </TestWrapper>,
    );

    expect(screen.getByText("App Theme")).toBeInTheDocument();
    expect(screen.getByText("Accent Color")).toBeInTheDocument();
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
  });

  it("should handle theme mode change", () => {
    render(
      <TestWrapper>
        <ThemeProvider theme={mockTheme}>
          <ThemeSection />
          <ThemeTestHarness />
        </ThemeProvider>
      </TestWrapper>,
    );

    const select = screen.getByDisplayValue("System");
    act(() => {
      fireEvent.change(select, { target: { value: "dark" } });
    });

    // Check Redux state
    expect(screen.getByTestId("theme-state")).toHaveTextContent("dark");
  });

  it("should handle reset button", () => {
    render(
      <TestWrapper>
        <ThemeProvider theme={mockTheme}>
          <ThemeSection />
          <ThemeTestHarness />
        </ThemeProvider>
      </TestWrapper>,
    );

    // Change something first
    const select = screen.getByDisplayValue("System");
    act(() => {
      fireEvent.change(select, { target: { value: "light" } });
    });

    const resetButton = screen.getByText("Reset Theme to Defaults");
    fireEvent.click(resetButton);

    // Check that it reset to system
    expect(screen.getByTestId("theme-state")).toHaveTextContent("system");
  });
});
