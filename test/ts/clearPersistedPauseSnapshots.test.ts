import { clearPersistedPauseSnapshots } from "@n-apt/app/infrastructure/storage/clearPersistedPauseSnapshots";

describe("clearPersistedPauseSnapshots", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("clears retained pause data and intent but keeps other session state", () => {
    sessionStorage.setItem("n-apt-fft-iq-snapshot:source-a:rx", "old-iq");
    sessionStorage.setItem("n-apt-fft-waterfall-snapshot:source-a:rx", "old-waterfall");
    sessionStorage.setItem("n-apt-fft-waterfall-dims:source-a:rx", "old-dimensions");
    sessionStorage.setItem("n-apt-fft-waveform-snapshot:source-a:rx", "old-waveform");
    sessionStorage.setItem("napt-visualizer-manual-paused", "true");
    sessionStorage.setItem("n-apt:subscriber-pause-intent", "paused");
    sessionStorage.setItem("n-apt-other-session-state", "preserved");

    clearPersistedPauseSnapshots();

    expect(sessionStorage.getItem("n-apt-fft-iq-snapshot:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("n-apt-fft-waterfall-snapshot:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("n-apt-fft-waterfall-dims:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("n-apt-fft-waveform-snapshot:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("napt-visualizer-manual-paused")).toBeNull();
    expect(sessionStorage.getItem("n-apt:subscriber-pause-intent")).toBeNull();
    expect(sessionStorage.getItem("n-apt-other-session-state")).toBe("preserved");
  });
});
