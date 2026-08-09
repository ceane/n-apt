import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import "@testing-library/jest-dom";
import { SettingsRoute } from "@n-apt/app/routes/pages/SettingsRoute";
import { TestWrapper } from "./testUtils";

const renderRoute = (preloadedState?: unknown) =>
  render(
    <MemoryRouter>
      <TestWrapper preloadedState={preloadedState}>
        <SettingsRoute />
      </TestWrapper>
    </MemoryRouter>,
  );

describe("SettingsRoute", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the page title and all five section headings", () => {
    renderRoute();

    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Theme" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "SDR Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Login" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "I/Q Capture Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Snapshot & Fast Snapshot",
      }),
    ).toBeInTheDocument();
  });

  it("renders the section nav in the sidebar", () => {
    renderRoute();

    const navGroup = screen.getByRole("group", {
      name: "Settings sections",
    });
    expect(navGroup).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Theme" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "SDR Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Login" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "I/Q Capture Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Snapshot & Fast Snapshot" }),
    ).toBeInTheDocument();
  });

  it("shows the login bypass toggle and persists the preference", async () => {
    const user = userEvent.setup();
    renderRoute();

    const toggle = screen.getByRole("switch", {
      name: /Bypass after logging in/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem("n-apt-bypass-start-page")).toBe("true");
  });

  it("writes capture defaults to localStorage when changed", async () => {
    const user = userEvent.setup();
    renderRoute();

    const durationSelect = screen.getByRole("combobox", {
      name: /Default duration mode/i,
    });
    await user.selectOptions(durationSelect, "manual");

    const stored = JSON.parse(
      window.localStorage.getItem("n-apt-settings-defaults-v1") as string,
    );
    expect(stored.capture.captureDurationMode).toBe("manual");
  });

  it("writes snapshot defaults to localStorage when changed", async () => {
    const user = userEvent.setup();
    renderRoute();

    const fastStatsToggle = screen.getByRole("switch", {
      name: /Fast Snapshot: include stats/i,
    });
    expect(fastStatsToggle).toHaveAttribute("aria-checked", "false");

    await user.click(fastStatsToggle);
    expect(fastStatsToggle).toHaveAttribute("aria-checked", "true");

    const stored = JSON.parse(
      window.localStorage.getItem("n-apt-settings-defaults-v1") as string,
    );
    expect(stored.snapshot.fastSnapshotShowStats).toBe(true);
  });

  it("keeps the 0 Hz clamp enabled by default and toggles baseband mirroring", async () => {
    const user = userEvent.setup();
    renderRoute();

    const toggle = screen.getByRole("switch", {
      name: "Mirror I/Q baseband below 0Hz",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("renders the theme section with an App Theme selector", () => {
    renderRoute();

    expect(
      screen.getByRole("combobox", { name: /App Theme/i }),
    ).toBeInTheDocument();
  });

  it("renders SDR settings controls backed by the spectrum slice", () => {
    renderRoute({
      spectrum: {
        fftSize: 2048,
        fftWindow: "Rectangular",
        fftFrameRate: 10,
        sampleRateHz: 3_200_000,
        gain: 30,
        ppm: 0,
        tunerAGC: false,
        rtlAGC: false,
        temporalResolution: "lossless",
        powerScale: "dB",
      },
    });

    expect(screen.getByRole("combobox", { name: /Sample Rate/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /FFT Size/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /FFT Window/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /Gain/i })).toBeInTheDocument();
  });
});
