import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import "@testing-library/jest-dom";
import { PreferencesRoute } from "@n-apt/app/routes/pages/SettingsRoute";
import { TestWrapper } from "./testUtils";

const renderRoute = (preloadedState?: unknown) =>
  render(
    <MemoryRouter>
      <TestWrapper preloadedState={preloadedState}>
        <PreferencesRoute />
      </TestWrapper>
    </MemoryRouter>,
  );

describe("PreferencesRoute", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the page title and all six section headings", () => {
    renderRoute();

    expect(
      screen.getByRole("heading", { name: "Preferences & Extras" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Theme" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "SDR Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "I/Q Capture Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Snapshot & Fast Snapshot",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Extras" })).toBeInTheDocument();
  });

  it("renders the section nav in the sidebar", () => {
    renderRoute();

    const navGroup = screen.getByRole("group", {
      name: "Preferences sections",
    });
    expect(navGroup).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theme" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "SDR Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "I/Q Capture Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Snapshot & Fast Snapshot" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extras" })).toBeInTheDocument();
  });

  it("groups attribution and useful cards in the Extras section", () => {
    renderRoute();

    const miscellaneous = document.querySelector(
      '[data-settings-section="extras"]',
    );
    expect(miscellaneous).not.toBeNull();
    expect(
      within(miscellaneous as HTMLElement).getByText("Attribution"),
    ).toBeInTheDocument();
    expect(
      within(miscellaneous as HTMLElement).getByRole("link", {
        name: /^3D Human Model/i,
      }),
    ).toHaveAttribute("href", "/3d-model");
    expect(
      within(miscellaneous as HTMLElement).getByRole("link", {
        name: /^See hardware gallery/i,
      }),
    ).toHaveAttribute("href", "/3d-model-gallery");
    expect(
      within(miscellaneous as HTMLElement).getByRole("link", {
        name: /^More about N-APT/i,
      }),
    ).toHaveAttribute("href", "https://ceane.github.io/n-apt");
    const logoutLink = within(miscellaneous as HTMLElement).getByRole("link", {
      name: /^Log out/i,
    });
    expect(logoutLink).toHaveAttribute("href", "/logout");
    expect(logoutLink).toHaveTextContent(
      "Logging out prevents unauthorized use of the app or access to your I/Q captures.",
    );
    expect(miscellaneous?.querySelector('[data-columns="3"]')).not.toBeNull();
  });

  it("shows YAML and editable frontend maximum frame-rate defaults", () => {
    renderRoute({
      websocket: {
        activeSourceId: null,
        sources: [],
        signalsDefaults: {
          sample_rate: 3_200_000,
          center_frequency: 1_600_000,
          gain: { tuner_gain: 46.9, rtl_agc: false, tuner_agc: false },
          ppm: 1,
          fft: { default_size: 2048, max_frame_rate: 120 },
          display: { min_db: -120, max_db: 0, padding: 20 },
          devices: {},
        },
      },
    });

    expect(screen.getByText("120 fps")).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Frontend maximum frame rate" }),
    ).toHaveValue(120);
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
      name: "Mirror spectrum below 0Hz",
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

  it("credits the SDR++ waterfall colormap authors", () => {
    renderRoute();

    expect(
      screen.getByRole("link", { name: "SDR++ colormap collection" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/AlexandreRouma/SDRPlusPlus/tree/master/root/res/colormaps",
    );
    expect(screen.getByText("SDR++").closest("div")).toHaveStyle({
      marginTop: "12px",
    });
    const authorList = screen.getByRole("list", {
      name: "SDR++ waterfall colormap authors",
    });
    const authorRows = within(authorList).getAllByRole("listitem");
    expect(authorRows).toHaveLength(7);
    expect(authorRows.map((row) => row.textContent)).toEqual([
      "Youssef Touil — Classic",
      "Paul (PD0SWL) — Classic Green",
      "Ryzerth — Electric, Grey Scale, WebSDR",
      "csete — GQRX",
      "B.I.D.S. — Inferno, Magma, Plasma, Viridis",
      "Yaroslav Andrianov — Smoke, Temper Colors, Vivid",
      "Google AI — Turbo",
    ]);
  });

  it("uses the active device's FFT sizes and keeps frame rate editable below its logical maximum", async () => {
    const user = userEvent.setup();
    renderRoute({
      spectrum: {
        fftSize: 2048,
        fftSizeOptions: [1024, 2048, 4096],
        fftWindow: "Rectangular",
        fftFrameRate: 1,
        sampleRateHz: 8_192,
        gain: 30,
        ppm: 0,
        tunerAGC: false,
        rtlAGC: false,
        temporalResolution: "lossless",
        powerScale: "dB",
      },
      websocket: {
        activeSourceId: "hackrf-0",
        sources: [
          {
            id: "hackrf-0",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "rx",
            status: "receiving",
            loading_attempt: 0,
            loading_attempt_max: 3,
            supports_approx_dbm: false,
            capabilities: {
              fft: { sizes: [2048, 4096, 8192] },
            },
            sdr: {
              max_sample_rate: 20_000_000,
              sample_rate_options: [8192],
              fft_display: { markers: [] },
              settings: { sample_rate: 8192 },
            },
          },
        ],
      },
    });

    expect(
      screen.getByRole("combobox", { name: /Sample Rate/i }),
    ).toBeInTheDocument();
    const fftSize = screen.getByRole("combobox", { name: /FFT Size/i });
    expect(fftSize).toHaveValue("2048");
    expect(
      Array.from((fftSize as HTMLSelectElement).options).map(
        (option) => option.value,
      ),
    ).toEqual(["2048", "4096", "8192"]);
    expect(screen.getByText("HackRF One")).toBeInTheDocument();
    const frameRate = screen.getByRole("spinbutton", {
      name: /Frame Rate \(logical\)/i,
    });
    expect(frameRate).toHaveValue(1);
    expect(frameRate).toHaveAttribute("max", "4");
    await user.selectOptions(fftSize, "4096");
    expect(frameRate).toHaveValue(1);
    await user.clear(frameRate);
    await user.type(frameRate, "2");
    expect(frameRate).toHaveValue(2);
    await user.selectOptions(fftSize, "8192");
    expect(frameRate).toHaveValue(1);
    expect(
      screen.getByRole("combobox", { name: /FFT Window/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: /Gain/i }),
    ).toBeInTheDocument();
  });

  it("uses the frontend default ceiling when signals defaults are unavailable", () => {
    renderRoute({
      spectrum: {
        sampleRateHz: 20_000_000,
        fftSize: 2048,
        fftFrameRate: 120,
      },
      websocket: { activeSourceId: null, sources: [], signalsDefaults: null },
    });

    const frameRate = screen.getByRole("spinbutton", {
      name: /Frame Rate \(logical\)/i,
    });
    expect(frameRate).toHaveAttribute("max", "120");
    expect(screen.getByText("Max 120 fps")).toBeInTheDocument();
  });

  it("uses the active device's sample rate options with the frequency formatter", () => {
    renderRoute({
      spectrum: {
        sampleRateHz: 2_400_000,
        fftSize: 2048,
        fftWindow: "Rectangular",
        fftFrameRate: 10,
        gain: 30,
        ppm: 0,
        tunerAGC: false,
        rtlAGC: false,
      },
      websocket: {
        activeSourceId: "hackrf-0",
        sources: [
          {
            id: "hackrf-0",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "rx",
            status: "receiving",
            loading_attempt: 0,
            loading_attempt_max: 3,
            supports_approx_dbm: false,
            sdr: {
              max_sample_rate: 20_000_000,
              sample_rate_options: [8_000_000, 10_000_000, 20_000_000],
              fft_display: { markers: [] },
              settings: { sample_rate: 2_400_000 },
            },
          },
        ],
      },
    });

    const select = screen.getByRole("combobox", {
      name: /Sample Rate/i,
    }) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["8000000", "10000000", "20000000"]);

    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["8MHz", "10MHz", "20MHz"]);

    // Current rate is not in the device list; the select snaps to the first.
    expect(select.value).toBe("8000000");
  });

  it("falls back to the signals.yaml default rate when no device options are reported", () => {
    renderRoute({
      spectrum: { sampleRateHz: 3_200_000 },
      websocket: {
        activeSourceId: null,
        sources: [],
        signalsDefaults: {
          sample_rate: 3_200_000,
          center_frequency: 1_600_000,
          gain: { tuner_gain: 46.9, rtl_agc: false, tuner_agc: false },
          ppm: 1,
          fft: {
            default_size: 2048,
            default_frame_rate: 10,
            max_size: 262144,
            max_frame_rate: 60,
            size_to_frame_rate: {},
          },
          display: { min_db: -120, max_db: 0, padding: 20 },
          devices: {},
        },
      },
    });

    const select = screen.getByRole("combobox", {
      name: /Sample Rate/i,
    }) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["3200000"]);

    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["3.2MHz"]);
  });

  it("resolves the device sample rate spec from signals.yaml as a fallback", () => {
    renderRoute({
      spectrum: { sampleRateHz: 3_200_000 },
      websocket: {
        activeSourceId: "hackrf-0",
        sources: [
          {
            id: "hackrf-0",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "rx",
            status: "receiving",
            loading_attempt: 0,
            loading_attempt_max: 3,
            supports_approx_dbm: false,
            sdr: {
              max_sample_rate: 20_000_000,
              sample_rate_options: [],
              fft_display: { markers: [] },
              settings: { sample_rate: 3_200_000 },
            },
          },
        ],
        signalsDefaults: {
          sample_rate: 3_200_000,
          center_frequency: 1_600_000,
          gain: { tuner_gain: 46.9, rtl_agc: false, tuner_agc: false },
          ppm: 1,
          fft: {
            default_size: 2048,
            default_frame_rate: 10,
            max_size: 262144,
            max_frame_rate: 60,
            size_to_frame_rate: {},
          },
          display: { min_db: -120, max_db: 0, padding: 20 },
          devices: {
            hackrf_one: {
              duplex_mode: "Half-duplex",
              max_sample_rate: 20_000_000,
              sample_rate: {
                value: "__NAPT_SAMPLE_RATE_CHANNEL__",
                min: "__NAPT_SAMPLE_RATE_FLOOR__",
                max: "__NAPT_SAMPLE_RATE_MAX__",
              },
            },
          },
        },
      },
    });

    // The active HackRF has no per-source options, so the spec from
    // signals.yaml (floor..max curated range) provides the fallback list.
    const select = screen.getByRole("combobox", {
      name: /Sample Rate/i,
    }) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual([
      "3200000",
      "4000000",
      "5000000",
      "6400000",
      "8000000",
      "10000000",
      "12800000",
      "16000000",
      "20000000",
    ]);
  });

  it("syncs the chosen sample rate to the backend settings", async () => {
    const user = userEvent.setup();
    renderRoute({
      spectrum: { sampleRateHz: 8_000_000 },
      websocket: {
        activeSourceId: "hackrf-0",
        sources: [
          {
            id: "hackrf-0",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "rx",
            status: "receiving",
            loading_attempt: 0,
            loading_attempt_max: 3,
            supports_approx_dbm: false,
            sdr: {
              max_sample_rate: 20_000_000,
              sample_rate_options: [8_000_000, 10_000_000, 20_000_000],
              fft_display: { markers: [] },
              settings: { sample_rate: 8_000_000 },
            },
          },
        ],
      },
    });

    const select = screen.getByRole("combobox", {
      name: /Sample Rate/i,
    }) as HTMLSelectElement;
    await user.selectOptions(select, "10000000");
    expect(select.value).toBe("10000000");
  });
});
