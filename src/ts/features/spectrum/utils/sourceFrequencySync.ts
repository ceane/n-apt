export type FrequencyRange = {
  min: number;
  max: number;
};

type SourceFrequencyRangeSyncInput = {
  connected: boolean;
  selectedSourceId: string;
  activeSourceId: string | null;
  previousActiveSourceId: string | null;
  activeSourceIsMockTx: boolean;
  frequencyRange: FrequencyRange | null;
  lastSentFrequencyRange: FrequencyRange | null;
  isRestoringSourceView: boolean;
};

type SourceFrequencyRangeSyncPlan = {
  clearLastSentFrequencyRange: boolean;
  nextActiveSourceId: string | null;
  rangeToSend: FrequencyRange | null;
};

const areEqualRanges = (
  left: FrequencyRange | null,
  right: FrequencyRange | null,
): boolean => left?.min === right?.min && left?.max === right?.max;

export const resolveSourceFrequencyRangeSync = ({
  connected,
  selectedSourceId,
  activeSourceId,
  previousActiveSourceId,
  activeSourceIsMockTx,
  frequencyRange,
  lastSentFrequencyRange,
  isRestoringSourceView,
}: SourceFrequencyRangeSyncInput): SourceFrequencyRangeSyncPlan => {
  const activeSourceChanged = activeSourceId !== previousActiveSourceId;
  const clearLastSentFrequencyRange = activeSourceChanged;
  const sourceIsReady =
    activeSourceId !== null && selectedSourceId === activeSourceId;

  if (
    !connected ||
    !sourceIsReady ||
    activeSourceIsMockTx ||
    isRestoringSourceView ||
    !frequencyRange
  ) {
    return {
      clearLastSentFrequencyRange,
      nextActiveSourceId: activeSourceId,
      rangeToSend: null,
    };
  }

  return {
    clearLastSentFrequencyRange,
    nextActiveSourceId: activeSourceId,
    rangeToSend:
      activeSourceChanged ||
      !areEqualRanges(lastSentFrequencyRange, frequencyRange)
        ? frequencyRange
        : null,
  };
};
