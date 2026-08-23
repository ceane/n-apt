import type { CanvasPlaceholderState } from "@n-apt/ui/CanvasPlaceholder";
import type { LiveSourcePresentationPolicy } from "@n-apt/spectrum/hooks/liveSourceLifecycle";
import {
  hasRenderableFramePayload,
  type RenderableLiveFrame,
} from "@n-apt/app/infrastructure/visualization/liveSourcePresentation";
import {
  shouldAcceptWebGpuStreamFrame,
  shouldPreservePresentationDuringFrameGap,
} from "@n-apt/app/infrastructure/visualization/webgpuStreamReset";

export type BlockingPlaceholderKind = 0 | 1 | 2 | 3 | 4;

export type FramePresentationDecision = {
  isCurrentSourceFrame: boolean;
  hasStalePresentedSource: boolean;
  hasCurrentSourceFrame: boolean;
  hasRenderableFrame: boolean;
  preservesMatchingStandbyPresentation: boolean;
  shouldBlockForSourceHandoff: boolean;
  showLoadingPlaceholder: boolean;
  showErrorPlaceholder: boolean;
  currentExplicitPlaceholderState: CanvasPlaceholderState | null;
  hasExplicitPlaceholder: boolean;
  preservePresentationDuringGap: boolean;
  isExplicitStandbyPlaceholder: boolean;
  explicitPlaceholderBlocksFrame: boolean;
  hasBlockingVisualPlaceholder: boolean;
  blockingPlaceholderKind: BlockingPlaceholderKind;
};

export const selectFrameForPresentation = <T,>({
  incomingFrame,
  isPaused,
  isStandby,
  pauseSnapshotEnabled,
  cachedFrame,
}: {
  incomingFrame: T | null;
  isPaused: boolean;
  isStandby: boolean;
  pauseSnapshotEnabled: boolean;
  cachedFrame: T | null;
}): T | null =>
  incomingFrame ??
  ((isPaused || isStandby) && pauseSnapshotEnabled ? cachedFrame : null);

export const resolveFramePresentation = ({
  currentFrame,
  expectedSourceId,
  frameSourceIdFallback,
  lastPresentedSourceId,
  lastRenderableFrame,
  isStandby,
  presentationPolicy,
  awaitingDeviceData,
  isLoadingPlaceholder,
  isDeviceConnected,
  placeholderErrorReason,
  explicitPlaceholderState,
  hasPresentedSpectrumFrame,
}: {
  currentFrame: RenderableLiveFrame | null;
  expectedSourceId: string | null;
  frameSourceIdFallback?: string | null;
  lastPresentedSourceId: string | null;
  lastRenderableFrame: RenderableLiveFrame | null;
  isStandby: boolean;
  presentationPolicy?: LiveSourcePresentationPolicy;
  awaitingDeviceData: boolean | string;
  isLoadingPlaceholder: boolean;
  isDeviceConnected: boolean;
  placeholderErrorReason: string | null;
  explicitPlaceholderState: CanvasPlaceholderState | null;
  hasPresentedSpectrumFrame: boolean;
}): FramePresentationDecision => {
  const isCurrentSourceFrame = shouldAcceptWebGpuStreamFrame({
    expectedSourceId,
    frameSourceId: currentFrame?.source_id,
    fallbackFrameSourceId: frameSourceIdFallback,
  });
  const hasStalePresentedSource =
    expectedSourceId != null &&
    lastPresentedSourceId != null &&
    lastPresentedSourceId !== expectedSourceId;
  const hasCurrentSourceFrame = !!currentFrame && isCurrentSourceFrame;
  const hasRenderableFrame =
    hasCurrentSourceFrame && hasRenderableFramePayload(currentFrame);
  const preservesMatchingStandbyPresentation =
    (presentationPolicy?.preserveMatchingPresentation ??
      (isStandby &&
        expectedSourceId != null &&
        lastPresentedSourceId === expectedSourceId)) &&
    currentFrame === lastRenderableFrame;
  const shouldBlockForSourceHandoff =
    !!awaitingDeviceData && !hasCurrentSourceFrame;
  const showLoadingPlaceholder =
    (isLoadingPlaceholder || shouldBlockForSourceHandoff) &&
    !hasRenderableFrame;
  const showErrorPlaceholder =
    !!placeholderErrorReason || (!isDeviceConnected && !hasRenderableFrame);
  const currentExplicitPlaceholderState = explicitPlaceholderState;
  const hasExplicitPlaceholder = !!currentExplicitPlaceholderState;
  const hasBlockingExplicitPlaceholder =
    !!currentExplicitPlaceholderState &&
    currentExplicitPlaceholderState.kind !== "top-bar" &&
    currentExplicitPlaceholderState.kind !== "overlay-only";
  const hasBlockingVisualPlaceholder =
    isLoadingPlaceholder ||
    !!awaitingDeviceData ||
    showErrorPlaceholder ||
    hasBlockingExplicitPlaceholder;
  const preservePresentationDuringGap =
    shouldPreservePresentationDuringFrameGap({
      hasPresentedFrame: hasPresentedSpectrumFrame,
      hasCurrentFrame: !!currentFrame,
      isDeviceConnected,
      // Standby top-bar must not force a black gap under STANDBY chrome.
      hasExplicitPlaceholder: hasBlockingExplicitPlaceholder,
      hasPlaceholderError: !!placeholderErrorReason,
    });
  const isExplicitStandbyPlaceholder =
    currentExplicitPlaceholderState?.kind === "idle";
  const explicitPlaceholderBlocksFrame = !!(
    hasBlockingExplicitPlaceholder &&
    !isExplicitStandbyPlaceholder &&
    !hasCurrentSourceFrame
  );
  const blockingPlaceholderKind: BlockingPlaceholderKind =
    isExplicitStandbyPlaceholder
      ? 1
      : showErrorPlaceholder
        ? 2
        : showLoadingPlaceholder
          ? 3
          : explicitPlaceholderBlocksFrame
            ? 4
            : 0;

  return {
    isCurrentSourceFrame,
    hasStalePresentedSource,
    hasCurrentSourceFrame,
    hasRenderableFrame,
    preservesMatchingStandbyPresentation,
    shouldBlockForSourceHandoff,
    showLoadingPlaceholder,
    showErrorPlaceholder,
    currentExplicitPlaceholderState,
    hasExplicitPlaceholder,
    preservePresentationDuringGap,
    isExplicitStandbyPlaceholder,
    explicitPlaceholderBlocksFrame,
    hasBlockingVisualPlaceholder,
    blockingPlaceholderKind,
  };
};
