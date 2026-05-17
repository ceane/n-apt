// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { useNAPTAudioDemod } from "../../src/ts/hooks/useNAPTAudioDemod";

describe("useNAPTAudioDemod", () => {
  it("exposes detection state after running the detector", () => {
    const { result } = renderHook(() =>
      useNAPTAudioDemod({ targetSampleRate: 48000, bufferSize: 4096 }),
    );

    const iqData = new Uint8Array(256);
    for (let i = 0; i < iqData.length; i += 2) {
      iqData[i] = 128;
      iqData[i + 1] = 128;
    }
    iqData[120] = 255;
    iqData[121] = 255;
    iqData[122] = 255;
    iqData[123] = 255;

    act(() => {
      result.current.detectSpikes(iqData, 3_200_000, 0);
    });

    expect(result.current.detectionResult).not.toBeNull();
    expect(result.current.detectionResult?.candidates.length).toBeGreaterThanOrEqual(0);
  });
});
