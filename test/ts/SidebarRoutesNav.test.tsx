import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { SidebarRoutesNav } from "@n-apt/spectrum/sidebar/SidebarRoutesNav";
import { SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY } from "@n-apt/app/layout/sidebarRoutesExpanded";
import { buildAppTheme } from "@n-apt/ui/Theme";

const theme = buildAppTheme({
  accentColor: "#00ccff",
  fftColor: "#00ccff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

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
      screen.getByRole("button", { name: /^preferences & extras$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /3d human model/i }),
    ).not.toBeInTheDocument();
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

    expect(
      window.localStorage.getItem(SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY),
    ).toBe("false");
    expect(
      screen.queryByRole("button", { name: /demod n-apt with ml/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /see fft of n-apt/i }),
    ).toBeInTheDocument();
  });
});
