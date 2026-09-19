export const evaluateSequenceStep = (
  lastSequence: number | null,
  sequence: number,
): { accepted: boolean; sequenceGaps: number } => ({
  accepted: !(lastSequence !== null && sequence <= lastSequence),
  sequenceGaps:
    lastSequence !== null && sequence > lastSequence + 1
      ? sequence - lastSequence - 1
      : 0,
});
