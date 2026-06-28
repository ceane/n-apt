import React from "react";
import styled from "styled-components";

export type CanvasPlaceholderState =
  | {
      kind: "idle";
      sourceLabel?: string;
      title: string;
      message?: string;
    }
  | {
      kind: "loading";
      sourceLabel?: string;
      paneLabel: string;
      message?: string;
    }
  | {
      kind: "error";
      sourceLabel?: string;
      reason: string;
      message?: string;
    };

interface CanvasPlaceholderProps {
  state: CanvasPlaceholderState;
}

const PlaceholderOverlay = styled.div<{ $idle?: boolean }>`
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  pointer-events: none;
  background: ${({ $idle }) =>
    $idle
      ? "linear-gradient(180deg, rgba(12, 15, 20, 0.36), rgba(5, 7, 10, 0.54))"
      : "radial-gradient(circle at top, rgba(255, 255, 255, 0.04), transparent 55%), linear-gradient(180deg, rgba(8, 11, 18, 0.86), rgba(3, 5, 10, 0.96))"};
`;

const PlaceholderCard = styled.div`
  width: min(100%, 420px);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(6, 9, 15, 0.9);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.35);
  color: rgba(244, 247, 252, 0.94);
  padding: 16px 18px;
  text-align: center;
  font-family: "JetBrains Mono", monospace;
  backdrop-filter: blur(10px);
`;

const LoadingTitle = styled.div`
  display: inline-flex;
  align-items: baseline;
  gap: 1px;
`;

const Dot = styled.span<{ $delay: string }>`
  display: inline-block;
  animation: loadingDot 1.1s infinite;
  animation-delay: ${({ $delay }) => $delay};

  @keyframes loadingDot {
    0%,
    20% {
      opacity: 0.15;
      transform: translateY(0);
    }
    45% {
      opacity: 1;
      transform: translateY(-1px);
    }
    70%,
    100% {
      opacity: 0.15;
      transform: translateY(0);
    }
  }
`;

const PlaceholderKicker = styled.div<{ $error?: boolean }>`
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 8px;
  color: ${({ $error }) => ($error ? "#ff9a9a" : "#ffd76a")};
`;

const PlaceholderTitle = styled.div<{ $error?: boolean }>`
  font-size: 16px;
  line-height: 1.35;
  font-weight: 700;
  color: ${({ $error }) => ($error ? "#ffd6d6" : "#f3f7ff")};
`;

const PlaceholderBody = styled.div`
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(219, 225, 235, 0.82);
`;

const PlaceholderSource = styled.div`
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(219, 225, 235, 0.9);
`;

export const CanvasPlaceholder: React.FC<CanvasPlaceholderProps> = ({
  state,
}) => {
  const sourceLabel = state.sourceLabel?.trim() || "source";

  if (state.kind === "idle") {
    return (
      <PlaceholderOverlay $idle role="status" aria-live="polite">
        <PlaceholderCard>
          <PlaceholderKicker>Standby</PlaceholderKicker>
          <PlaceholderTitle>{state.title}</PlaceholderTitle>
          <PlaceholderSource>from {sourceLabel}</PlaceholderSource>
          {state.message ? (
            <PlaceholderBody>{state.message}</PlaceholderBody>
          ) : null}
        </PlaceholderCard>
      </PlaceholderOverlay>
    );
  }

  if (state.kind === "loading") {
    return (
      <PlaceholderOverlay role="status" aria-live="polite">
        <PlaceholderCard>
          <PlaceholderTitle>
            <LoadingTitle>
              <span>Loading {state.paneLabel}</span>
              <Dot $delay="0ms">.</Dot>
              <Dot $delay="120ms">.</Dot>
              <Dot $delay="240ms">.</Dot>
            </LoadingTitle>
          </PlaceholderTitle>
          <PlaceholderSource>from {sourceLabel}</PlaceholderSource>
          <PlaceholderBody>
            {state.message || "Waiting for the first frame to arrive."}
          </PlaceholderBody>
        </PlaceholderCard>
      </PlaceholderOverlay>
    );
  }

  return (
    <PlaceholderOverlay role="alert" aria-live="assertive">
      <PlaceholderCard>
        <PlaceholderKicker $error>Error</PlaceholderKicker>
        <PlaceholderTitle $error>
          {state.reason === "Server down" ? "Server Down" : `Error / ${state.reason}`}
        </PlaceholderTitle>
        <PlaceholderBody>
          {state.reason === "Server down"
            ? state.message ||
              "The server was disconnected due to being manually exited or an error."
            : state.message ||
              `Can't playback from ${sourceLabel}. Reason: ${state.reason}`}
        </PlaceholderBody>
      </PlaceholderCard>
    </PlaceholderOverlay>
  );
};

export default CanvasPlaceholder;
