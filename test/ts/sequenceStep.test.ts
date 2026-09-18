import { evaluateSequenceStep } from "@n-apt/math/sequenceStep";

describe("evaluateSequenceStep", () => {
  it.each([
    [null, 0, true, 0],
    [null, 100, true, 0],
    [0, 0, false, 0],
    [10, 10, false, 0],
    [10, 9, false, 0],
    [10, 11, true, 0],
    [10, 14, true, 3],
    [0, 2, true, 1],
  ])("evaluates cursor %s followed by %s", (lastSequence, sequence, accepted, sequenceGaps) => {
    expect(evaluateSequenceStep(lastSequence, sequence)).toEqual({
      accepted,
      sequenceGaps,
    });
  });

  it("has no cursor ownership or retained result state", () => {
    const first = evaluateSequenceStep(10, 14);
    first.sequenceGaps = 100;
    expect(evaluateSequenceStep(10, 14)).toEqual({ accepted: true, sequenceGaps: 3 });
    expect(evaluateSequenceStep(null, 14)).toEqual({ accepted: true, sequenceGaps: 0 });
    expect(evaluateSequenceStep(14, 14)).toEqual({ accepted: false, sequenceGaps: 0 });
  });
});
