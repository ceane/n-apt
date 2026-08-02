import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { SidebarRoutesNav } from "@n-apt/components/sidebar/SidebarRoutesNav";
import { SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY } from "@n-apt/utils/sidebarRoutesExpanded";

const theme = {
  layout: { sidebarWidth: 280, sidebarMinWidth: 200 },
  spacing: {
    xxs: "2px",
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xxl: "24px",
  },
  typography: { mono: "monospace" },
  background: "#111",
  border: "#333",
  borderHover: "#555",
  surface: "#222",
  surfaceHover: "#2a2a2a",
  primary: "#0cf",
  textMuted: "#888",
  textSecondary: "#ccc",
  metadataLabel: "#666",
};

const renderNav = (
  pathname: string,
  onRouteClick = jest.fn(),
  expandedDefault?: string,
) => {
  if (expandedDefault !== undefined) {
    window.localStorage.setItem(
      SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY,
      expandedDefault,
    );
  } else {
    window.localStorage.removeItem(SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY);
  }

  return render(
    <ThemeProvider theme={theme}>
      <SidebarRoutesNav pathname={pathname} onRouteClick={onRouteClick} />
    </ThemeProvider>,
  );
};

describe("SidebarRoutesNav", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows all routes when expanded", () => {
    renderNav("/demodulate", jest.fn(), "true");

    expect(
      screen.getByRole("button", { name: /see fft of n-apt/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /demod n-apt with ml/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^settings$/i }),
    ).toBeInTheDocument();
  });

  it("shows only the active route when collapsed", () => {
    renderNav("/draw-signal", jest.fn(), "false");

    expect(
      screen.queryByRole("button", { name: /see fft of n-apt/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /draw n-apt with math/i }),
    ).toBeInTheDocument();
  });

  it("toggles expansion and persists to localStorage", async () => {
    const user = userEvent.setup();
    renderNav("/", jest.fn(), "true");

    await user.click(screen.getByRole("button", { name: /^routes$/i }));

    expect(window.localStorage.getItem(SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY)).toBe(
      "false",
    );
    expect(
      screen.queryByRole("button", { name: /demod n-apt with ml/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /see fft of n-apt/i }),
    ).toBeInTheDocument();
  });
});
