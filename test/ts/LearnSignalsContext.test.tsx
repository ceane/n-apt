import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { ReactNode } from "react";
import {
  LearnSignalsProvider,
  useLearnSignals,
  getLearnSignalsSectionPath,
  getLearnSignalsSectionFromSlug,
} from "@n-apt/learn/context/LearnSignalsContext";

const renderInRouter = (initialPath: string, children: ReactNode) =>
  renderHook(() => useLearnSignals(), {
    wrapper: ({ children: wrapperChildren }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/learn"
            element={
              <LearnSignalsProvider>{wrapperChildren}</LearnSignalsProvider>
            }
          />
          <Route
            path="/learn/:id"
            element={
              <LearnSignalsProvider>{wrapperChildren}</LearnSignalsProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    ),
  });

describe("LearnSignalsProvider deep links", () => {
  it("skips the intro when landing on a specific section sub-route", async () => {
    const { result } = renderInRouter("/learn/iq-captures", null);

    await waitFor(() => {
      expect(result.current.showIntro).toBe(false);
    });
    expect(result.current.activeSection).toBe("I/Q Captures");
  });

  it("shows the intro by default on the hub route", () => {
    const { result } = renderInRouter("/learn", null);

    expect(result.current.showIntro).toBe(true);
    expect(result.current.activeSection).toBe("Radio Waves");
  });

  it("maps every section to a stable path slug", () => {
    expect(getLearnSignalsSectionPath("I/Q Captures")).toBe("iq-captures");
    expect(getLearnSignalsSectionPath("FFT & IFFT")).toBe("fft-ifft");
    expect(getLearnSignalsSectionPath("RMS")).toBe("rms");
    expect(getLearnSignalsSectionPath("Radio Waves")).toBe("radio-waves");
  });

  it("does not expose the duplicate FFT Rx/IFFT Tx deep link", () => {
    expect(getLearnSignalsSectionFromSlug("fft-rx-ifft-tx")).toBeUndefined();
  });
});
