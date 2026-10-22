import { clearPersistedPauseSnapshots } from "@n-apt/app/infrastructure/storage/clearPersistedPauseSnapshots";

describe("clearPersistedPauseSnapshots", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("removes old pause IQ and visualization snapshots but keeps other session state", () => {
    sessionStorage.setItem("n-apt-fft-iq-snapshot:source-a:rx", "old-iq");
    sessionStorage.setItem("n-apt-fft-waterfall-snapshot:source-a:rx", "old-waterfall");
    sessionStorage.setItem("n-apt-fft-waterfall-dims:source-a:rx", "old-dimensions");
    sessionStorage.setItem("n-apt-fft-waveform-snapshot:source-a:rx", "old-waveform");
    sessionStorage.setItem("n-apt-subscriber-pause-intent", "paused");

    clearPersistedPauseSnapshots();

    expect(sessionStorage.getItem("n-apt-fft-iq-snapshot:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("n-apt-fft-waterfall-snapshot:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("n-apt-fft-waterfall-dims:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("n-apt-fft-waveform-snapshot:source-a:rx")).toBeNull();
    expect(sessionStorage.getItem("n-apt-subscriber-pause-intent")).toBe("paused");
  });
});
