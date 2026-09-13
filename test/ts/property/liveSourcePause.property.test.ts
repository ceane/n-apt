import fc from "fast-check";
import { resolveLiveSourcePauseButtonState } from "@n-apt/spectrum/public/liveSourceLifecycle";
import spectrumReducer, {
  setFrequencyRange,
  setVisualizerPaused,
} from "@n-apt/redux/slices/spectrumSlice";

describe("live source pause button fuzz", () => {
  it("never offers Pause Rx for a paused source", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        (isRxMode, isStreaming) => {
          const state = resolveLiveSourcePauseButtonState({
            isRxMode,
            isStreaming,
            paused: true,
          });
          expect(state.paused).toBe(true);
          expect(state.label).toBe("Resume Rx");
        },
      ),
    );
  });

  it("offers Pause Rx only for an active, unpaused RX source", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (isRxMode, isStreaming, paused) => {
          const state = resolveLiveSourcePauseButtonState({
            isRxMode,
            isStreaming,
            paused,
          });
          expect(state.label === "Pause Rx").toBe(
            isRxMode && isStreaming && !paused,
          );
        },
      ),
    );
  });

  it("never changes the universal frequency range across arbitrary pause transitions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30_000_000_000 }),
        fc.integer({ min: 1, max: 20_000_000 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 100 }),
        (min, span, pauseTransitions) => {
          const range = { min, max: min + span };
          let state = spectrumReducer(undefined, { type: "@@init" });
          state = spectrumReducer(state, setFrequencyRange(range));

          for (const paused of pauseTransitions) {
            state = spectrumReducer(state, setVisualizerPaused(paused));
            expect(state.frequencyRange).toEqual(range);
          }
        },
      ),
    );
  });
});
