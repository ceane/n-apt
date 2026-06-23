import {
  shouldAutoResumeVisualizerOnSourceSwitch,
  shouldAutoPauseVisualizerOnRouteLeave,
  shouldAutoResumeVisualizerOnTxSelection,
  shouldSyncVisualizerPauseToBackend,
  shouldPauseSourceOnSwitch,
  shouldResumePausedRxSourceOnSelection,
  isLiveVisualizerPathname,
  resolveEffectiveSourcePaused,
} from "@n-apt/hooks/useSpectrumStore";

describe("shouldAutoResumeVisualizerOnSourceSwitch", () => {
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
});
