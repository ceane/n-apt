import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReactNode } from "react";
import {
  LearnSignalsProvider,
  useLearnSignals,
  getLearnSignalsSectionPath,
} from "@n-apt/contexts/LearnSignalsContext";

const renderInRouter = (initialPath: string, children: ReactNode) =>
  renderHook(() => useLearnSignals(), {
    wrapper: ({ children: wrapperChildren }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/learn-signals"
            element={
              <LearnSignalsProvider>{wrapperChildren}</LearnSignalsProvider>
            }
          />
          <Route
            path="/learn-signals/:sectionSlug"
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
    const { result } = renderInRouter("/learn-signals/iq-captures", null);

    await waitFor(() => {
      expect(result.current.showIntro).toBe(false);
    });
    expect(result.current.activeSection).toBe("I/Q Captures");
  });

  it("shows the intro by default on the hub route", () => {
    const { result } = renderInRouter("/learn-signals", null);

    expect(result.current.showIntro).toBe(true);
    expect(result.current.activeSection).toBe("Radio Waves");
  });

  it("maps every section to a stable path slug", () => {
    expect(getLearnSignalsSectionPath("I/Q Captures")).toBe("iq-captures");
    expect(getLearnSignalsSectionPath("FFT & IFFT")).toBe("fft-ifft");
    expect(getLearnSignalsSectionPath("Radio Waves")).toBe("radio-waves");
    expect(getLearnSignalsSectionPath("FFT (Rx) and IFFT (Tx)")).toBe(
      "fft-rx-ifft-tx",
    );
  });
});
