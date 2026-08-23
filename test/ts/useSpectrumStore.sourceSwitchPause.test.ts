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
  resolveClientPauseState,
  resolveStreamingSourceForDisplay,
  resolveSelectedSourceIdForInventory,
  resolveInventorySelectionIntent,
  resolveInitialSourceSelection,
  shouldClearPendingSourceSwitch,
  resolveNextVisualizerPauseState,
  resolvePauseTargetSourceId,
  shouldReplayManualPauseOnSourceActivation,
  shouldCarryManualPauseToSelectedSource,
} from "@n-apt/spectrum/hooks/useSpectrumStore";

describe("source selection and switch lifecycle", () => {
  it("creates an explicit intent when the first source is auto-selected on load", () => {
    expect(
      resolveInitialSourceSelection({
        activeSourceId: "",
        storedSourceId: null,
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
        ] as any,
      }),
    ).toEqual({
      selectedSourceId: "mock-apt",
      selectionIntentSourceId: "mock-apt",
    });
  });

  it("does not hydrate a persisted source that is absent from the current inventory", () => {
    expect(
      resolveInitialSourceSelection({
        activeSourceId: "mock-apt",
        storedSourceId: "rtl-sdr-00000001",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          { id: "mock-tx", kind: "mock_tx", capability: "tx" },
        ] as any,
      }),
    ).toEqual({
      selectedSourceId: "mock-apt",
      selectionIntentSourceId: null,
    });
  });

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

  it("turns a persisted source into a reload switch intent before rendering its placeholder", () => {
    expect(
      resolveInventorySelectionIntent({
        selectedSourceId: "rtl-sdr",
        activeSourceId: "mock-apt",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          {
            id: "rtl-sdr",
            kind: "rtl_sdr",
            capability: "rx",
            status: "loading",
          },
        ] as any,
      }),
    ).toBe("rtl-sdr");
  });

  it("drops a disconnected hardware intent when Mock APT is the active fallback", () => {
    expect(
      resolveInventorySelectionIntent({
        selectedSourceId: "rtl-sdr-00000001",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "rtl-sdr-00000001",
        sources: [
          {
            id: "rtl-sdr-00000001",
            kind: "rtl_sdr",
            capability: "rx",
            status: "disconnected",
          },
          {
            id: "mock-apt",
            kind: "mock_apt",
            capability: "mock",
            status: "receiving",
          },
        ] as any,
      }),
    ).toBeNull();
  });

  it("drops a removed hardware intent when Mock APT is the active fallback", () => {
    expect(
      resolveInventorySelectionIntent({
        selectedSourceId: "rtl-sdr-00000001",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "rtl-sdr-00000001",
        sources: [
          {
            id: "mock-apt",
            kind: "mock_apt",
            capability: "mock",
            status: "receiving",
          },
        ] as any,
      }),
    ).toBeNull();
  });

  it("resolves a disconnected selected source to the active fallback", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "rtl-sdr-00000001",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "rtl-sdr-00000001",
        sources: [
          {
            id: "rtl-sdr-00000001",
            kind: "rtl_sdr",
            capability: "rx",
            status: "disconnected",
          },
          {
            id: "mock-apt",
            kind: "mock_apt",
            capability: "mock",
            status: "receiving",
          },
        ] as any,
      }),
    ).toBe("mock-apt");
  });

  it("selects newly discovered hardware during a loading transition", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
          {
            id: "rtl-sdr",
            kind: "rtl_sdr",
            capability: "rx",
            status: "loading",
          },
        ] as any,
      }),
    ).toBe("rtl-sdr");
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

  it("preserves a cold-start Mock Tx intent before selectedSourceId commits", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "mock-tx",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
        ] as any,
      }),
    ).toBe("mock-tx");
  });

  it("preserves an explicit Mock Tx selection when cold-start inventory has not advertised it yet", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "mock-tx",
        sources: [
          { id: "mock-apt", kind: "mock_apt", capability: "mock" },
        ] as any,
      }),
    ).toBe("mock-tx");
  });

  it("does not snap a pending Mock Tx click back to the still-active Mock APT", () => {
    expect(
      resolveSelectedSourceIdForInventory({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
        pendingSourceSwitchId: "mock-tx",
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

  it("does not drop a pending Mock Tx switch when inventory briefly follows the active Mock APT", () => {
    expect(
      shouldClearPendingSourceSwitch({
        pendingSourceSwitchId: "mock-tx",
        selectedSourceId: "mock-apt",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "mock-tx",
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

  it("keeps a manual pause even when the backend snapshot is still live", () => {
    expect(
      resolveEffectiveSourcePaused({
        backendPaused: false,
        localPaused: undefined,
        manuallyPaused: true,
        autoPaused: false,
      }),
    ).toBe(true);
  });

  it("never lets a live backend snapshot override a client-side pause", () => {
    // A manually-paused source stays paused even while the backend reports it
    // live. The client owns the pause and may cut the stream locally; the
    // backend snapshot must not flip the effective state back to unpaused.
    expect(
      resolveEffectiveSourcePaused({
        backendPaused: false,
        localPaused: true,
        manuallyPaused: true,
        autoPaused: false,
      }),
    ).toBe(true);
    expect(
      resolveEffectiveSourcePaused({
        backendPaused: false,
        localPaused: false,
        manuallyPaused: true,
        autoPaused: false,
      }),
    ).toBe(true);
    // A locally-resumed source is unpaused regardless of a stale paused
    // backend snapshot.
    expect(
      resolveEffectiveSourcePaused({
        backendPaused: true,
        localPaused: false,
        manuallyPaused: false,
        autoPaused: false,
      }),
    ).toBe(false);
  });

  it("drives the button state purely from the client pause latches", () => {
    // The store syncs the button state from resolveClientPauseState. A manual
    // or auto latch (or a local override) pauses the button regardless of the
    // backend; once those latches are cleared, the button unpauses. This is the
    // invariant that prevents the "shows Resume but is playing" deadlock after
    // a restart or a source_info round trip.
    expect(
      resolveClientPauseState({
        localPaused: false,
        manuallyPaused: true,
        autoPaused: false,
      }),
    ).toBe(true);
    expect(
      resolveClientPauseState({
        localPaused: true,
        manuallyPaused: false,
        autoPaused: true,
      }),
    ).toBe(true);
    expect(
      resolveClientPauseState({
        localPaused: false,
        manuallyPaused: false,
        autoPaused: true,
      }),
    ).toBe(true);
    // Resume clears the latches, so the button must read unpaused even if a
    // stale backend snapshot or effective value still reports paused.
    expect(
      resolveClientPauseState({
        localPaused: false,
        manuallyPaused: false,
        autoPaused: false,
      }),
    ).toBe(false);
  });

  it("pauses the source that is actually streaming when selection is still in flight", () => {
    expect(
      resolvePauseTargetSourceId({
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
      }),
    ).toBe("mock-apt");
    expect(
      resolvePauseTargetSourceId({
        requestedSourceId: "mock-tx",
        selectedSourceId: "mock-tx",
        activeSourceId: "mock-apt",
      }),
    ).toBe("mock-tx");
  });

  it("replays a cold-start manual pause when the selected source becomes active", () => {
    expect(
      shouldReplayManualPauseOnSourceActivation({
        activeSourceId: "mock-apt",
        selectedSourceId: "mock-apt",
        manuallyPaused: true,
        backendPaused: false,
        pauseReplaySentForSourceId: null,
      }),
    ).toBe(true);
  });

  it("carries a pause click to the selected source while activation is in flight", () => {
    expect(
      shouldCarryManualPauseToSelectedSource({
        requestedPaused: true,
        selectedSourceId: "rtl-sdr",
        pauseTargetSourceId: "mock-apt",
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

  it("does not dispatch a source switch for a disconnected selected device", () => {
    expect(
      shouldSendSelectSource({
        isConnected: true,
        sourceMode: "live",
        selectedSourceId: "rtl-sdr-00000001",
        activeSourceId: "mock-apt",
        selectionIntentSourceId: "rtl-sdr-00000001",
        selectedSourceStatus: "disconnected",
        availableSourceIds: ["rtl-sdr-00000001", "mock-apt"],
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
