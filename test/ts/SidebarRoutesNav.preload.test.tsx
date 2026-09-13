import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { SidebarRoutesNav } from "@n-apt/spectrum/sidebar/SidebarRoutesNav";
import { SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY } from "@n-apt/app/layout/sidebarRoutesExpanded";
import { buildAppTheme } from "@n-apt/ui/Theme";

jest.mock("@n-apt/app/routes/pages/RouteScopedProviders", () => ({
  preloadDemodChunk: jest.fn(),
}));

import { preloadDemodChunk } from "@n-apt/app/routes/pages/RouteScopedProviders";

const theme = buildAppTheme({
  accentColor: "#00ccff",
  fftColor: "#00ccff",
  appMode: "dark",
  resolvedMode: "dark",
  waterfallTheme: "classic",
});

const renderNav = (pathname: string, onRouteClick = jest.fn()) => {
  window.localStorage.setItem(SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY, "true");
  return render(
    <ThemeProvider theme={theme}>
      <SidebarRoutesNav pathname={pathname} onRouteClick={onRouteClick} />
    </ThemeProvider>,
  );
};

describe("SidebarRoutesNav preload", () => {
  beforeEach(() => {
    window.localStorage.clear();
    (preloadDemodChunk as jest.Mock).mockClear();
  });

  it("preloads the demod chunk when hovering the demod nav entry", async () => {
    const user = userEvent.setup();
    renderNav("/settings");

    await user.hover(
      screen.getByRole("button", { name: /demod n-apt with ml/i }),
    );

    expect(preloadDemodChunk).toHaveBeenCalledTimes(1);
  });

  it("does not preload when hovering non-demod nav entries", async () => {
    const user = userEvent.setup();
    renderNav("/settings");

    await user.hover(
      screen.getByRole("button", { name: /^preferences & extras$/i }),
    );

    expect(preloadDemodChunk).not.toHaveBeenCalled();
  });

  it("preloads the demod chunk when focusing the demod nav entry", () => {
    renderNav("/settings");

    const demodButton = screen.getByRole("button", {
      name: /demod n-apt with ml/i,
    });
    demodButton.focus();

    expect(preloadDemodChunk).toHaveBeenCalledTimes(1);
  });
});
