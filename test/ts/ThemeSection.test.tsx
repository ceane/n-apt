import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeSection } from "@n-apt/components/sidebar/ThemeSection";
import { useThemeStore } from "@n-apt/hooks/useThemeStore";
import { useAppSelector } from "@n-apt/redux";
import { TestWrapper } from "./testUtils";
import { ThemeProvider } from "styled-components";

const mockTheme = {
  primary: "#00d4ff",
};

// Test harness to check Redux state
const ThemeTestHarness: React.FC = () => {
  const appMode = useAppSelector((state) => state.theme.appMode);
  return <div data-testid="theme-state">{appMode}</div>;
};

describe("ThemeSection Component", () => {
  beforeEach(() => {
    useThemeStore.getState().resetTheme();
  });

  it("should render theme options when open", () => {
    render(
      <TestWrapper>
        <ThemeProvider theme={mockTheme}>
          <ThemeSection />
        </ThemeProvider>
      </TestWrapper>
    );

    // Initial state: closed
    expect(screen.queryByText("App Theme")).not.toBeInTheDocument();

    // Click to open
    const title = screen.getByText(/Theme/);
    fireEvent.click(title);

    expect(screen.getByText("App Theme")).toBeInTheDocument();
    expect(screen.getByText("Accent")).toBeInTheDocument();
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
  });

  it("should handle theme mode change", () => {
    render(
      <TestWrapper>
        <ThemeProvider theme={mockTheme}>
          <ThemeSection />
          <ThemeTestHarness />
        </ThemeProvider>
      </TestWrapper>
    );

    fireEvent.click(screen.getByText(/Theme/));

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
      </TestWrapper>
    );

    fireEvent.click(screen.getByText(/Theme/));

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
