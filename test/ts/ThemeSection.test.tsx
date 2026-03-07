import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeSection } from "@n-apt/components/sidebar/ThemeSection";
import { ThemeProvider } from "styled-components";
import { useThemeStore } from "@n-apt/hooks/useThemeStore";

const mockTheme = {
  primary: "#00d4ff",
};

describe("ThemeSection Component", () => {
  beforeEach(() => {
    useThemeStore.getState().resetTheme();
  });

  it("should render theme options when open", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <ThemeSection />
      </ThemeProvider>
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
      <ThemeProvider theme={mockTheme}>
        <ThemeSection />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText(/Theme/));

    const select = screen.getByDisplayValue("System");
    fireEvent.change(select, { target: { value: "dark" } });

    expect(useThemeStore.getState().appMode).toBe("dark");
  });

  it("should handle reset button", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <ThemeSection />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText(/Theme/));

    // Change something
    act(() => {
      useThemeStore.getState().setAppMode("light");
    });

    const resetButton = screen.getByText("Reset Theme to Defaults");
    fireEvent.click(resetButton);

    expect(useThemeStore.getState().appMode).toBe("system");
  });
});

// Helper for 'act' if needed in components
import { act } from "react";
