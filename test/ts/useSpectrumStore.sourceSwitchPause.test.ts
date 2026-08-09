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
  resolveInventorySelectionIntent,
  shouldClearPendingSourceSwitch,
  resolveNextVisualizerPauseState,
} from "@n-apt/spectrum/hooks/useSpectrumStore";

describe("shouldAutoResumeVisualizerOnSourceSwitch", () => {
  it("does not invert a stale pause flag when the Rx handoff explicitly resumes", () => {
    expect(
      resolveNextVisualizerPauseState({
        currentPaused: false,
        requestedPaused: false,
      }),
    ).toBe(false);
  });

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

  it("marks an auto-selected hardware source as a switch intent when the backend is still on Mock APT", () => {
    expect(
      resolveInventorySelectionIntent({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          {
            id: "hackrf-one",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "tx_rx",
            status: "connected",
          },
        ] as any,
      }),
    ).toBe("hackrf-one");
  });

  it("reasserts the selected hardware source after reconnect fallback", () => {
    expect(
      resolveInventorySelectionIntent({
        selectedSourceId: "hackrf-one",
        activeSourceId: "mock-apt",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          {
            id: "hackrf-one",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "tx_rx",
            status: "connected",
          },
        ] as any,
      }),
    ).toBe("hackrf-one");
  });

  it("preserves a pending Mock Tx selection while source inventory is transiently empty", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        pendingSourceSwitchId: "mock-tx",
        sources: [],
      }),
    ).toBe("mock-tx");
  });

  it("preserves the selected source while inventory is transiently empty", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "hackrf-one",
        activeSourceId: "",
        sources: [],
      }),
    ).toBe("hackrf-one");
  });

  it("auto-selects HackRF after a stale Mock selection disappears from inventory", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "mock-apt",
        sources: [
          {
            id: "hackrf-one",
            name: "HackRF One",
            kind: "hackrf_one",
            capability: "tx_rx",
            status: "connected",
          },
        ] as any,
      }),
    ).toBe("hackrf-one");
  });

  it("preserves an explicit Mock Tx selection before the switch request is dispatched", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "mock-tx",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          { id: "mock-tx", kind: "mock_tx", capability: "tx_rx" },
        ] as any,
      }),
    ).toBe("mock-tx");
  });

  it("follows the server source when another client switches it", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          { id: "mock-tx", kind: "mock_tx", capability: "tx_rx" },
        ] as any,
      }),
    ).toBe("mock-tx");
  });

  it("does not clear a pending source switch just because its inventory entry is temporarily unavailable", () => {
    expect(
      shouldClearPendingSourceSwitch({
        pendingSourceSwitchId: "mock-tx",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
      }),
    ).toBe(false);
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
    expect(
      shouldPauseSourceOnSwitch({
        id: "hackrf-one",
        name: "HackRF One",
        capability: "tx_rx",
        duplex_mode: "Half-Duplex",
        status: "connected",
      } as any),
    ).toBe(true);
    expect(
      shouldPauseSourceOnSwitch({
        id: "hackrf-one",
        name: "HackRF One",
        capability: "tx_rx",
        duplex_mode: "Half-Duplex",
        status: "transmitting",
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

  it("does not auto-resume a half-duplex source that is Tx-bound or in standby", () => {
    expect(
      shouldResumePausedRxSourceOnSelection(
        {
          id: "hackrf-one",
          name: "HackRF One",
          capability: "tx_rx",
          duplex_mode: "half-duplex",
          status: "standby",
          paused: true,
        } as any,
        false,
        "hackrf-one",
      ),
    ).toBe(false);
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
        selectionIntentSourceId: "rtl-sdr-removed",
        availableSourceIds: ["hackrf_one-connected", "mock-apt"],
      }),
    ).toBe(false);
  });

  it("does not reassert a passive tab's stale source selection", () => {
    expect(
      shouldSendSelectSource({
        isConnected: true,
        sourceMode: "live",
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-tx",
        selectionIntentSourceId: null,
        availableSourceIds: ["mock-apt", "mock-tx"],
      }),
    ).toBe(false);
  });

  it("sends a source switch for the tab's explicit selection", () => {
    expect(
      shouldSendSelectSource({
        isConnected: true,
        sourceMode: "live",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "mock-tx",
        availableSourceIds: ["mock-apt", "mock-tx"],
      }),
    ).toBe(true);
  });

  it("reasserts the selected source after a disconnect wipe without intent", () => {
    expect(
      shouldSendSelectSource({
        isConnected: true,
        sourceMode: "live",
        selectedSourceId: "mock-apt",
        activeSourceId: "",
        selectionIntentSourceId: null,
        availableSourceIds: ["mock-apt", "mock-tx"],
      }),
    ).toBe(true);
  });
});
