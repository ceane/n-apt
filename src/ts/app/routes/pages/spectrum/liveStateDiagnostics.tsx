import React, { useEffect, useState } from "react";

export const shouldRenderLiveStateDiagnostics = false;

export type LiveStateDiagnosticsSourceTransport = {
  sourceId: string | null;
  phase: string;
  error: string | null;
};

export type LiveStateDiagnosticsFrameReadiness = {
  sourceId: string;
  streamEpoch: number | null;
  sequence: number;
} | null;

export type LiveStateDiagnosticsFrame = {
  sourceId: string | null;
  streamEpoch: number | null;
  sequence: number | null;
  frameStatus: string | null;
  iqLength: number | null;
} | null;

export type LiveStateDiagnosticsInput = {
  redux: {
    connectionStatus: string;
    isConnected: boolean;
    activeSourceId: string | null;
    activeSourceStatus: string | null;
    activeSourceMode: string | null;
    availableSourceIds: string[];
    isPaused: boolean;
    selectedSourceId: string | null;
    selectedSourceStatus: string | null;
    sourceTransportByMode: {
      rx: LiveStateDiagnosticsSourceTransport;
      tx: LiveStateDiagnosticsSourceTransport;
    };
    sourceFrameReadinessByMode: {
      rx: LiveStateDiagnosticsFrameReadiness;
      tx: LiveStateDiagnosticsFrameReadiness;
    };
  };
  renderer: {
    lifecyclePhase: string;
    placeholderKind: string | null;
    hasRenderableCurrentFrame: boolean;
    hasPlayedAtLeastOnce: boolean;
    expectedSourceId: string | null;
    expectedStreamEpoch: number | null;
    routeAcceptsLatestFrame: boolean | null;
    latestFrame: LiveStateDiagnosticsFrame;
  };
  managedStream: {
    rx: Record<string, unknown>;
    tx: Record<string, unknown>;
  };
};

export const buildLiveStateDiagnosticsSnapshot = (
  input: LiveStateDiagnosticsInput,
): LiveStateDiagnosticsInput => ({
  redux: {
    ...input.redux,
    sourceTransportByMode: {
      rx: { ...input.redux.sourceTransportByMode.rx },
      tx: { ...input.redux.sourceTransportByMode.tx },
    },
    sourceFrameReadinessByMode: {
      rx: input.redux.sourceFrameReadinessByMode.rx
        ? { ...input.redux.sourceFrameReadinessByMode.rx }
        : null,
      tx: input.redux.sourceFrameReadinessByMode.tx
        ? { ...input.redux.sourceFrameReadinessByMode.tx }
        : null,
    },
  },
  renderer: {
    ...input.renderer,
    latestFrame: input.renderer.latestFrame
      ? { ...input.renderer.latestFrame }
      : null,
  },
  managedStream: {
    rx: { ...input.managedStream.rx },
    tx: { ...input.managedStream.tx },
  },
});

export type LiveStateDiagnosticsProps = {
  input: LiveStateDiagnosticsInput;
  readRuntimeState: () => Pick<
    LiveStateDiagnosticsInput,
    "managedStream"
  > & {
    renderer: Pick<
      LiveStateDiagnosticsInput["renderer"],
      "latestFrame" | "routeAcceptsLatestFrame"
    >;
  };
};

/**
 * Development-only state boundary for diagnosing source/renderer stalls.
 * Redux intentionally does not contain high-rate IQ, so the snapshot also
 * samples the mutable frame ref and managed subscription runtime.
 */
export const LiveStateDiagnostics: React.FC<LiveStateDiagnosticsProps> = ({
  input,
  readRuntimeState,
}) => {
  const [runtimeState, setRuntimeState] = useState(readRuntimeState);

  useEffect(() => {
    const update = () => setRuntimeState(readRuntimeState());
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [readRuntimeState]);

  const snapshot = buildLiveStateDiagnosticsSnapshot({
    ...input,
    renderer: { ...input.renderer, ...runtimeState.renderer },
    managedStream: runtimeState.managedStream,
  });

  return (
    <details
      open
      data-testid="live-state-diagnostics"
      style={{
        margin: "0 0 12px",
        border: "1px solid rgba(15, 23, 42, 0.24)",
        borderRadius: 8,
        background: "rgba(15, 23, 42, 0.94)",
        color: "#dbeafe",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
      }}
    >
      <summary style={{ cursor: "pointer", padding: "8px 10px" }}>
        Live Redux / renderer state
      </summary>
      <pre
        style={{
          margin: 0,
          padding: "0 10px 10px",
          overflow: "auto",
          maxHeight: 360,
          whiteSpace: "pre-wrap",
        }}
      >
        {JSON.stringify(snapshot, null, 2)}
      </pre>
    </details>
  );
};
