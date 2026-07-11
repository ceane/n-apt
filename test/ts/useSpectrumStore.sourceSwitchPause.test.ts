import {
  shouldAutoResumeVisualizerOnSourceSwitch,
  shouldAutoPauseVisualizerOnRouteLeave,
  shouldAutoResumeVisualizerOnTxSelection,
  shouldSyncVisualizerPauseToBackend,
  shouldPauseSourceOnSwitch,
  shouldResumePausedRxSourceOnSelection,
  shouldAutoResumeVisualizerOnDeviceRecovery,
  shouldSendSelectSource,
  isHalfDuplexSourceInfo,
  isLiveVisualizerPathname,
  resolveEffectiveSourcePaused,
  resolveStreamingSourceForDisplay,
  resolveSelectedSourceIdForInventory,
} from "@n-apt/hooks/useSpectrumStore";

describe("shouldAutoResumeVisualizerOnSourceSwitch", () => {
  it("keeps the confirmed streaming source's metadata during a pending selection", () => {
    const hackrf = {
      id: "hackrf-one",
      name: "HackRF One",
      kind: "hackrf_one",
      status: "streaming",
    } as any;
    const rtl = {
      id: "rtl-sdr-v4",
      name: "RTL-SDR v4",
      kind: "rtl_sdr",
      status: "loading",
    } as any;

    expect(
      resolveStreamingSourceForDisplay({
        selectedSourceId: rtl.id,
        activeSourceId: hackrf.id,
        sources: [hackrf, rtl],
      }),
    ).toBe(hackrf);
  });

  it("moves selection off mock as soon as real hardware is available", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-apt",
        activeSourceId: "rtl-1",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          { id: "rtl-1", kind: "rtl-sdr", capability: "rx" },
        ] as any,
      }),
    ).toBe("rtl-1");
  });
  it("resumes when the selected source is RX and the pause came from a source switch", () => {
    expect(
      shouldAutoResumeVisualizerOnSourceSwitch(
        {
          id: "rx-source",
          name: "Mock APT SDR",
          capability: "mock",
          status: "connected",
        } as any,
        true,
      ),
    ).toBe(true);
  });

  it("does not resume for a tx-capable source that is only connected", () => {
    expect(
      shouldAutoResumeVisualizerOnSourceSwitch(
        {
          id: "tx-source",
          name: "Mock Tx SDR",
          capability: "tx_rx",
          status: "connected",
        } as any,
        true,
      ),
    ).toBe(false);
  });

  it("does not resume when the pause was not source-switch driven", () => {
    expect(
      shouldAutoResumeVisualizerOnSourceSwitch(
        {
          id: "rx-source",
          name: "Mock APT SDR",
          capability: "mock",
          status: "connected",
        } as any,
        false,
      ),
    ).toBe(false);
  });

  it("does not auto-pause a tx-capable source when leaving the route", () => {
    expect(
      shouldAutoPauseVisualizerOnRouteLeave({
        id: "tx-source",
        name: "Mock Tx SDR",
        capability: "tx_rx",
        status: "connected",
      } as any),
    ).toBe(false);
  });

  it("auto-pauses a streaming rx source when leaving the route", () => {
    expect(
      shouldAutoPauseVisualizerOnRouteLeave({
        id: "rx-source",
        name: "Mock APT SDR",
        capability: "mock",
        status: "streaming",
      } as any),
    ).toBe(true);
  });

  it("does not resume a tx-capable source when selected while paused", () => {
    expect(
      shouldAutoResumeVisualizerOnTxSelection(
        {
          id: "tx-source",
          name: "Mock Tx SDR",
          capability: "tx_rx",
          status: "connected",
        } as any,
        true,
      ),
    ).toBe(false);
  });

  it("syncs backend pause only for non-tx-capable sources", () => {
    expect(
      shouldSyncVisualizerPauseToBackend({
        id: "rx-source",
        name: "Mock APT SDR",
        capability: "mock",
        status: "streaming",
      } as any),
    ).toBe(true);
    expect(
      shouldSyncVisualizerPauseToBackend({
        id: "tx-source",
        name: "Mock Tx SDR",
        capability: "tx_rx",
        status: "connected",
      } as any),
    ).toBe(false);
  });

  it("identifies pause-worthy sources by capability instead of transient status", () => {
    expect(
      shouldPauseSourceOnSwitch({
        id: "rx-source",
        name: "Mock APT SDR",
        capability: "mock",
        status: "connected",
      } as any),
    ).toBe(true);
    expect(
      shouldPauseSourceOnSwitch({
        id: "tx-source",
        name: "Mock Tx SDR",
        capability: "tx_rx",
        status: "connected",
      } as any),
    ).toBe(false);
  });

  it("treats half-duplex sources as manual pause targets even when they can transmit", () => {
    expect(
      isHalfDuplexSourceInfo({
        id: "hackrf-one",
        name: "HackRF One",
        capability: "tx_rx",
        duplex_mode: "Half-Duplex",
        status: "connected",
      } as any),
    ).toBe(true);
    expect(
      isHalfDuplexSourceInfo({
        id: "mock-tx",
        name: "Mock Tx SDR",
        capability: "tx_rx",
        duplex_mode: "Simplex",
        status: "connected",
      } as any),
    ).toBe(false);
  });

  it("treats demodulate as leaving the live visualizer", () => {
    expect(isLiveVisualizerPathname("/")).toBe(true);
    expect(isLiveVisualizerPathname("/visualizer")).toBe(true);
    expect(isLiveVisualizerPathname("/demodulate")).toBe(false);
    expect(isLiveVisualizerPathname("/draw-signal")).toBe(false);
  });

  it("uses local pause overrides before stale backend snapshots", () => {
    expect(
      resolveEffectiveSourcePaused({
        backendPaused: false,
        localPaused: true,
        manuallyPaused: false,
        autoPaused: false,
      }),
    ).toBe(true);
    expect(
      resolveEffectiveSourcePaused({
        backendPaused: undefined,
        localPaused: undefined,
        manuallyPaused: false,
        autoPaused: true,
      }),
    ).toBe(true);
  });

  it("resumes a backend-paused rx source when it is selected without a manual pause", () => {
    expect(
      shouldResumePausedRxSourceOnSelection(
        {
          id: "rx-source",
          name: "Mock APT SDR",
          capability: "mock",
          status: "connected",
          paused: true,
        } as any,
        false,
      ),
    ).toBe(true);
    expect(
      shouldResumePausedRxSourceOnSelection(
        {
          id: "rx-source",
          name: "Mock APT SDR",
          capability: "mock",
          status: "connected",
          paused: true,
        } as any,
        true,
      ),
    ).toBe(false);
  });

  it("resumes a backend-paused half-duplex HackRF receiver when selected", () => {
    expect(
      shouldResumePausedRxSourceOnSelection(
        {
          id: "hackrf-one",
          name: "HackRF One",
          capability: "tx_rx",
          duplex_mode: "half-duplex",
          status: "connected",
          paused: true,
        } as any,
        false,
      ),
    ).toBe(true);
  });

  it("resumes a recovered HackRF source when the outage was temporary and the user did not pause it", () => {
    expect(
      shouldAutoResumeVisualizerOnDeviceRecovery(
        {
          id: "hackrf-one",
          name: "HackRF One",
          capability: "tx_rx",
          status: "connected",
        } as any,
        false,
        "connected",
        "loading",
      ),
    ).toBe(true);
  });

  it("does not resume a recovered source that the user manually paused", () => {
    expect(
      shouldAutoResumeVisualizerOnDeviceRecovery(
        {
          id: "hackrf-one",
          name: "HackRF One",
          capability: "tx_rx",
          status: "connected",
        } as any,
        true,
        "connected",
        "loading",
      ),
    ).toBe(false);
  });

  it("does not send a stale missing source id after hotplug inventory changes", () => {
    expect(
      shouldSendSelectSource({
        isConnected: true,
        sourceMode: "live",
        selectedSourceId: "rtl-sdr-removed",
        activeSourceId: "hackrf_one-connected",
        availableSourceIds: ["hackrf_one-connected", "mock-apt"],
      }),
    ).toBe(false);
  });
});
