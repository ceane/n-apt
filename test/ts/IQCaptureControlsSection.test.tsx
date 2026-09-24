import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IQCaptureControlsSection } from "@n-apt/capture/sidebar/IQCaptureControlsSection";
import { TestWrapper } from "./testUtils";

// Mock useAuthentication
jest.mock("@n-apt/app/hooks/useAuthentication", () => ({
  useAuthentication: () => ({
    isAuthenticated: true,
    sessionToken: "mock-token",
  }),
}));

jest.mock("@n-apt/maps/public/useGeolocation", () => ({
  useGeolocation: () => ({
    isSupported: true,
    requestPermission: jest.fn().mockResolvedValue(true),
    error: null,
    isLoading: false,
  }),
}));

const defaultProps = {
  activeCaptureAreas: [],
  availableCaptureAreas: [{ label: "Area A", min: 10, max: 20 }],
  captureDurationS: 5,
  captureDurationMode: "timed" as const,
  captureFileType: ".napt" as const,
  acquisitionMode: "stepwise" as const,
  captureEncrypted: true,
  capturePlayback: false,
  captureGeolocation: false,
  captureRange: {
    min: 10,
    max: 20,
    segments: [{ label: "Area A", min: 10, max: 20 }],
  },
  maxSampleRate: 3200000,
  captureStatus: null,
  isConnected: true,
  deviceState: "connected" as const,
  onActiveCaptureAreasChange: jest.fn(),
  onCaptureDurationSChange: jest.fn(),
  onCaptureFileTypeChange: jest.fn(),
  onAcquisitionModeChange: jest.fn(),
  onCaptureEncryptedChange: jest.fn(),
  onCapturePlaybackChange: jest.fn(),
  onCaptureGeolocationChange: jest.fn(),
  onCapture: jest.fn(),
  onStopCapture: jest.fn(),
  onClearStatus: jest.fn(),
};

describe("IQCaptureControlsSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    delete (window as Window & { showDirectoryPicker?: unknown })
      .showDirectoryPicker;
  });

  it("should render correctly when open", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("Area A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByText("Capture")).toBeInTheDocument();
  });

  it("persists and restores the capture section open state for this tab session", () => {
    const { unmount } = render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    const sectionToggle = screen.getByRole("button", {
      name: /Take an I\/Q Capture/,
    });
    expect(sectionToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(sectionToggle);
    expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
    expect(window.sessionStorage.getItem("napt.sidebar.iq-capture.open.v1")).toBe("open");
    unmount();

    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    expect(
      screen.getByRole("button", { name: /Take an I\/Q Capture/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the overall capture span inside selected range dividers, not beside Ranges", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[{ label: "Area A", min: 10, max: 4_390_010 }]}
          captureRange={{
            min: 10,
            max: 4_390_010,
            segments: [{ label: "Area A", min: 10, max: 4_390_010 }],
          }}
          activeCaptureAreas={["Area A"]}
        />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("4.39MHz")).toBeInTheDocument();
    expect(screen.queryByLabelText("Hardware sample rate")).not.toBeInTheDocument();
  });

  it("estimates timed raw IQ data from the selected capture span", () => {
    const { rerender } = render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.queryByText(/Estimated data:/)).not.toBeInTheDocument();

    expect(defaultProps.onActiveCaptureAreasChange).not.toHaveBeenCalled();

    rerender(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          activeCaptureAreas={["Area A"]}
          captureRange={{
            min: 0,
            max: 3_200_000,
            segments: [{ label: "Area A", min: 0, max: 3_200_000 }],
          }}
        />
      </TestWrapper>,
    );

    expect(screen.getByText("Estimated data: 30.52 MB")).toBeInTheDocument();
  });

  it("shows each selected channel's own span in its divider", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[
            { label: "Area A", min: 10, max: 4_390_010 },
            { label: "Area B", min: 24_100_000, max: 30_370_000 },
          ]}
          captureRange={{
            min: 10,
            max: 30_370_000,
            segments: [
              { label: "Area A", min: 10, max: 4_390_010 },
              { label: "Area B", min: 24_100_000, max: 30_370_000 },
            ],
          }}
          activeCaptureAreas={["Area A", "Area B"]}
        />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("4.39MHz")).toBeInTheDocument();
    expect(screen.getByText("6.27MHz")).toBeInTheDocument();
    expect(screen.queryAllByText("30.37MHz")).toHaveLength(1);
  });

  it("offers capture formats in .napt, .iq, .wav order", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const [fileTypeSelect] = screen.getAllByRole("combobox");
    const options = Array.from(fileTypeSelect.querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(options).toEqual([".napt", ".iq", ".wav"]);
  });

  it("should handle area selection", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const checkbox = screen.getByLabelText("Area A");
    fireEvent.click(checkbox);
    expect(defaultProps.onActiveCaptureAreasChange).toHaveBeenCalledWith([
      "Area A",
    ]);
  });

  it("should hide stepwise and interleaved modes when the hardware sample rate covers the selected channel span", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[{ label: "Area A", min: 10, max: 20 }]}
          captureRange={{
            min: 10,
            max: 20,
            segments: [{ label: "Area A", min: 10, max: 20 }],
          }}
          activeCaptureAreas={["Area A"]}
          maxSampleRate={20_000}
          acquisitionMode="stepwise"
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const acquisitionSelect = screen.getByDisplayValue("Whole Sample");
    expect(acquisitionSelect).toBeDisabled();
    expect(
      screen.queryByRole("option", { name: "Stepwise" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Interleaved (TDMS)" }),
    ).not.toBeInTheDocument();
  });

  it("should force Whole Sample and hide sweep modes for an onscreen range", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[
            { label: "Onscreen", min: 0, max: 100 },
            { label: "Area A", min: 20_000, max: 40_000 },
          ]}
          captureRange={{
            min: 0,
            max: 40_000,
            segments: [
              { label: "Onscreen", min: 0, max: 100 },
              { label: "Area A", min: 20_000, max: 40_000 },
            ],
          }}
          activeCaptureAreas={["Onscreen", "Area A"]}
          maxSampleRate={100}
          acquisitionMode="interleaved"
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByDisplayValue("Whole Sample")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Stepwise" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Interleaved (TDMS)" })).not.toBeInTheDocument();
  });

  it("should offer Whole Sample for a named range within the hardware rate", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          availableCaptureAreas={[{ label: "Area A", min: 0, max: 100 }]}
          captureRange={{
            min: 0,
            max: 100,
            segments: [{ label: "Area A", min: 0, max: 100 }],
          }}
          activeCaptureAreas={["Area A"]}
          maxSampleRate={200}
          acquisitionMode="stepwise"
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByRole("option", { name: "Whole Sample" })).toBeInTheDocument();
  });

  it("does not offer encrypted .napt captures for mock sources", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          isMockSource
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.queryByRole("option", { name: /^\.napt/ })).toBeDisabled();
    expect(screen.getByRole("option", { name: ".iq" })).toBeEnabled();
    expect(screen.getByRole("option", { name: ".wav" })).toBeEnabled();
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
    expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
  });

  it("disables encryption for WAV even when stale encrypted state is true", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} captureFileType=".wav" captureEncrypted />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const encryptionToggle = screen.getAllByRole("checkbox")[0];
    expect(encryptionToggle).toBeDisabled();
    expect(encryptionToggle).not.toBeChecked();
  });

  it("keeps geolocation available for every capture format", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          captureFileType=".iq"
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("Geolocation")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")[1]).toBeEnabled();
  });

  it("should handle duration change", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const input = screen.getByDisplayValue("5");
    fireEvent.change(input, { target: { value: "10" } });
    expect(defaultProps.onCaptureDurationSChange).toHaveBeenCalledWith(10);
  });

  it("should disable capture button when not connected", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} isConnected={false} />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const button = screen.getByText("Capture");
    expect(button).toBeDisabled();
  });

  it("should keep Stop enabled during an active capture and call the stop handler", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{ status: "started", jobId: "job-1" }}
        />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    const stopButton = screen.getByText("Stop");
    expect(stopButton).toBeEnabled();

    fireEvent.click(stopButton);
    expect(defaultProps.onStopCapture).toHaveBeenCalled();
    expect(defaultProps.onCapture).not.toHaveBeenCalled();
  });

  it("should show 'Capturing...' status", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{ status: "started", jobId: "job-1" }}
        />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("Capturing now...")).toBeInTheDocument();
  });

  it("should show success status and download link", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection
          {...defaultProps}
          captureStatus={{
            status: "done",
            jobId: "job-1",
            downloadUrl: "/api/download?id=job-1",
            filename: "test.napt",
          }}
        />
      </TestWrapper>,
    );

    // Open the collapsible section
    fireEvent.click(screen.getByText("Take an I/Q Capture"));

    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("test.napt")).toBeInTheDocument();
  });

  it("defaults capture downloads to Local Downloads and shows destination choices", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));
    fireEvent.click(screen.getByRole("button", { name: /Download to/ }));

    const destinationMenu = screen.getByRole("menu", {
      name: "Capture destination",
    });
    expect(destinationMenu).toBeInTheDocument();
    expect(getComputedStyle(destinationMenu).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(getComputedStyle(destinationMenu).zIndex).toBe("10000");
    expect(screen.getByRole("menuitem", { name: /Local Downloads/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Choose local folder/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Aspect mounted drive/ })).toBeDisabled();
  });

  it("places destination selection before capture when there are no downloads", () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));
    const destination = screen.getByRole("button", {
      name: /Download to.*~\/Downloads/,
    });
    const capture = screen.getByRole("button", { name: "Capture" });

    expect(
      destination.compareDocumentPosition(capture) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(destination).toHaveStyle({ width: "100%" });
    expect(capture).toHaveStyle({ width: "100%" });
    const destinationRow = destination.parentElement?.parentElement;
    const geolocationRow = screen.getByText("Geolocation").closest("div")
      ?.parentElement;
    expect(destinationRow).not.toBeNull();
    expect(geolocationRow).not.toBeNull();
    expect(getComputedStyle(destination).backgroundColor).toBe(
      getComputedStyle(geolocationRow!).backgroundColor,
    );
    expect(getComputedStyle(destinationRow!).marginTop).toBe("0px");
  });

  it("remembers a browser-selected local folder as the destination", async () => {
    const directories = [
      { name: "Recordings", getFileHandle: jest.fn() },
      { name: "Field Captures", getFileHandle: jest.fn() },
    ];
    const showDirectoryPicker = jest.fn()
      .mockResolvedValueOnce(directories[0])
      .mockResolvedValueOnce(directories[1]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: showDirectoryPicker,
    });
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));
    const destinationButton = screen.getByRole("button", { name: /Download to/ });
    const chooseFolder = () => {
      fireEvent.click(destinationButton);
      expect(screen.getByRole("menuitem", { name: /Choose local folder/ })).toBeEnabled();
      fireEvent.click(screen.getByRole("menuitem", { name: /Choose local folder/ }));
    };
    chooseFolder();
    await waitFor(() => expect(showDirectoryPicker).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(window.localStorage.getItem("napt.capture-destination.v1")).toBe("folder"),
    );
    await screen.findByRole("button", { name: /Download to.*Local folder/ });
    chooseFolder();
    await screen.findByRole("button", { name: /Download to.*Local folder/ });
    expect(window.localStorage.getItem("napt.capture-destination.v1")).toBe("folder");
  });

  it("falls back to browser Downloads when folder picking is unsupported", async () => {
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));
    fireEvent.click(screen.getByRole("button", { name: /Download to/ }));
    expect(
      screen.getByRole("menuitem", { name: /Choose local folder/ }),
    ).toBeDisabled();

    expect(
      await screen.findByRole("button", {
        name: /Download to.*~\/Downloads/,
      }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("napt.capture-destination.v1")).toBeNull();
  });

  it("falls back to Downloads if a remembered folder handle is unavailable", async () => {
    window.localStorage.setItem("napt.capture-destination.v1", "folder");
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));
    await screen.findByRole("button", { name: /Download to.*~\/Downloads/ });
    expect(window.localStorage.getItem("napt.capture-destination.v1")).toBe("local");
  });

  it("saves a completed capture to Aspect when the mount is configured", async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input).includes("/api/capture/destinations")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            destinations: [
              { id: "local", available: true },
              { id: "aspect", available: true },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ files: ["capture.napt"] }),
      } as Response);
    });
    window.localStorage.setItem(
      "napt.iq-capture-downloads.v1",
      JSON.stringify([
        {
          jobId: "job-1",
          downloadUrl: "/api/capture/download?jobId=job-1",
          filename: "capture.napt",
          timestamp: Date.now(),
        },
      ]),
    );
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));
    fireEvent.click(screen.getByRole("button", { name: /Download to/ }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Aspect mounted drive/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Aspect mounted drive/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save to Aspect" }));

    expect(await screen.findByText("Saved capture.napt to Aspect.")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/capture/save/aspect"),
      { method: "POST" },
    );
    global.fetch = previousFetch;
  });

  it("reports Aspect save failures without losing the capture download", async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes("/api/capture/destinations")
          ? {
              ok: true,
              json: async () => ({
                destinations: [{ id: "aspect", available: true }],
              }),
            }
          : {
              ok: false,
              status: 503,
              json: async () => ({ error: "Aspect mount folder is unavailable" }),
            },
      ) as unknown as Response,
    );
    window.localStorage.setItem(
      "napt.iq-capture-downloads.v1",
      JSON.stringify([
        {
          jobId: "job-1",
          downloadUrl: "/api/capture/download?jobId=job-1",
          filename: "capture.napt",
          timestamp: Date.now(),
        },
      ]),
    );
    render(
      <TestWrapper>
        <IQCaptureControlsSection {...defaultProps} />
      </TestWrapper>,
    );
    fireEvent.click(screen.getByText("Take an I/Q Capture"));
    fireEvent.click(screen.getByRole("button", { name: /Download to/ }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Aspect mounted drive/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Aspect mounted drive/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save to Aspect" }));

    expect(await screen.findByText("Aspect mount folder is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "capture.napt" })).toBeInTheDocument();
    global.fetch = previousFetch;
  });
});
