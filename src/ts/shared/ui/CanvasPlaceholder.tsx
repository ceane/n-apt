import React, { useEffect, useState } from "react";
import styled, { keyframes, css } from "styled-components";
import { ReactReduxContext } from "react-redux";
import { markPageLoadAnimationComplete } from "@n-apt/redux/slices/themeSlice";

const standbyBarSlamIntro = keyframes`
  0% {
    transform: scale(2.5);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: scale(1);
  }
`;

export type CanvasPlaceholderState =
  | {
    kind: "idle" | "top-bar" | "overlay-only";
    sourceLabel?: string;
    kicker?: string;
    title: string;
    message?: string;
  }
  | {
    kind: "loading";
    sourceLabel?: string;
    paneLabel: string;
    title?: string;
    message?: string;
  }
  | {
    kind: "disconnected";
    sourceLabel?: string;
    message?: string;
  }
  | {
    kind: "error";
    sourceLabel?: string;
    reason: string;
    title?: string;
    message?: string;
  };

interface CanvasPlaceholderProps {
  state: CanvasPlaceholderState;
}

const PlaceholderOverlay = styled.div<{ $idle?: boolean; $topBar?: boolean }>`
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  pointer-events: none;
  background: ${({ $idle, $topBar }) =>
    $topBar
      ? "transparent"
      : $idle
      ? "linear-gradient(180deg, rgba(12, 15, 20, 0.36), rgba(5, 7, 10, 0.54))"
      : "radial-gradient(circle at top, rgba(255, 255, 255, 0.04), transparent 55%), linear-gradient(180deg, rgba(8, 11, 18, 0.86), rgba(3, 5, 10, 0.96))"};
`;

const PlaceholderCard = styled.div<{ $animateSlam?: boolean }>`
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
  transform-origin: center center;

  ${({ $animateSlam }) =>
    $animateSlam &&
    css`
      animation: ${standbyBarSlamIntro} 0.25s ease-in-out 1 forwards;
    `}
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
  const reduxContext = React.useContext(ReactReduxContext);
  const store = (reduxContext as any)?.store;
  const dispatch = store?.dispatch;
  const shouldPageLoadAnimationRun = store
    ? (store.getState()?.theme?.shouldPageLoadAnimationRun ?? true)
    : true;

  const sourceLabel = state.sourceLabel?.trim() || "source";
  const isStandbyKind = state.kind === "idle" || state.kind === "top-bar";

  const [shouldAnimateSlam] = useState(
    () => isStandbyKind && shouldPageLoadAnimationRun,
  );

  useEffect(() => {
    if (isStandbyKind && shouldPageLoadAnimationRun && dispatch) {
      const timer = setTimeout(() => {
        dispatch(markPageLoadAnimationComplete());
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isStandbyKind, shouldPageLoadAnimationRun, dispatch]);

  if (state.kind === "overlay-only") {
    return <PlaceholderOverlay $idle role="status" aria-live="polite" />;
  }

  if (state.kind === "idle" || state.kind === "top-bar") {
    const isTopBar = state.kind === "top-bar";
    return (
      <PlaceholderOverlay
        $idle
        $topBar={isTopBar}
        role="status"
        aria-live="polite"
        style={
          isTopBar
            ? {
              alignItems: "flex-start",
              paddingTop: "12px",
            }
            : undefined
        }
      >
        <PlaceholderCard
          $animateSlam={shouldAnimateSlam}
          style={
            isTopBar
              ? {
                width: "auto",
                maxWidth: "100%",
                minWidth: "220px",
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: "24px",
                justifyContent: "space-between",
                textAlign: "left",
                background: "rgba(6, 9, 15, 0.75)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
              }
              : undefined
          }
        >
          <div
            style={
              isTopBar
                ? { display: "flex", alignItems: "baseline", gap: "12px" }
                : undefined
            }
          >
            <PlaceholderKicker
              style={isTopBar ? { marginBottom: 0 } : undefined}
            >
              {state.kicker || "Standby"}
            </PlaceholderKicker>
            <PlaceholderTitle
              style={isTopBar ? { fontSize: "14px" } : undefined}
            >
              {state.title}
            </PlaceholderTitle>
          </div>
          {isTopBar && (
            <PlaceholderSource style={{ marginTop: 0, fontSize: "12px" }}>
              from {sourceLabel}
            </PlaceholderSource>
          )}
          {state.message && !isTopBar ? (
            <PlaceholderBody>{state.message}</PlaceholderBody>
          ) : null}
          {!isTopBar && (
            <PlaceholderSource>from {sourceLabel}</PlaceholderSource>
          )}
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
              <span>{state.title || `Loading ${state.paneLabel}`}</span>
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

  if (state.kind === "disconnected") {
    return (
      <PlaceholderOverlay role="status" aria-live="polite">
        <PlaceholderCard>
          <PlaceholderKicker $error>Disconnected</PlaceholderKicker>
          <PlaceholderTitle $error>Device Disconnected</PlaceholderTitle>
          <PlaceholderSource>from {sourceLabel}</PlaceholderSource>
          <PlaceholderBody>
            {state.message ||
              "The device disconnected. The backend is retrying the connection."}
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
          {state.kind === "error" && state.title
            ? state.title
            : state.kind === "error" && state.reason === "Server down"
              ? "Server Down"
              : state.kind === "error"
                ? `Error / ${state.reason}`
                : "Error"}
        </PlaceholderTitle>
        <PlaceholderBody>
          {state.kind === "error" && state.reason === "Server down"
            ? state.message ||
            "The server was disconnected due to being manually exited or an error."
            : state.message ||
            (state.kind === "error"
              ? `Can't playback from ${sourceLabel}. Reason: ${state.reason}`
              : "An error occurred")}
        </PlaceholderBody>
      </PlaceholderCard>
    </PlaceholderOverlay>
  );
};

export default CanvasPlaceholder;
