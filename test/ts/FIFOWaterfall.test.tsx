import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider } from "styled-components";
import { THEME_TOKENS } from "@n-apt/consts/theme";
import { FIFOWaterfall } from "../../src/ts/components/FIFOWaterfall";

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

describe("FIFOWaterfall", () => {
  it("shows a loading placeholder while awaiting data", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={null}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          awaitingDeviceData
          placeholderSourceLabel="Live SDR"
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );

    expect(
      screen.getAllByText(
        (_, node) => node?.textContent === "Loading Waterfall...",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("from Live SDR")).toBeInTheDocument();
  });

  it("shows a playback error placeholder with the provided reason", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={null}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          placeholderSourceLabel="Playback file"
          placeholderErrorReason="missing channel metadata"
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );

    expect(
      screen.getByText("Error / missing channel metadata"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Can't playback from Playback file. Reason: missing channel metadata",
      ),
    ).toBeInTheDocument();
  });

  it("shows a server down placeholder when the device disconnects", () => {
    render(
      <ThemeProvider theme={mockTheme}>
        <FIFOWaterfall
          width={320}
          height={180}
          waveform={null}
          frequencyRange={{ min: 0, max: 1 }}
          retuneSmear={0}
          isPaused={false}
          isVisible
          isDeviceConnected={false}
          placeholderSourceLabel="Live SDR"
          performScalarResampling={(data, targetLength) =>
            Array.from({ length: targetLength }, (_, index) => data[index] ?? 0)
          }
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Server Down")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The server was disconnected due to being manually exited or an error.",
      ),
    ).toBeInTheDocument();
  });
});
