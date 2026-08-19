import {
  selectConnectionSnapshot,
  selectSdrControls,
  selectSourceInventory,
  selectSpectrumControls,
} from "@n-apt/redux/selectors/spectrumSelectors";
import { selectDrawSignalState } from "@n-apt/redux/selectors/performanceSelectors";
import {
  selectAnalysisViewState,
  selectSourceMode,
  selectSourceTransportSnapshot,
} from "@n-apt/redux/selectors/performanceSelectors";
import { store } from "@n-apt/redux/store";

describe("spectrum selector migration boundary", () => {
  test("selects only low-frequency spectrum controls", () => {
    const state = store.getState();
    expect(selectSpectrumControls(state)).toMatchObject({
      fftSize: state.spectrum.fftSize,
      fftWindow: state.spectrum.fftWindow,
      fftFrameRate: state.spectrum.fftFrameRate,
      vizZoom: state.spectrum.vizZoom,
      powerScale: state.spectrum.powerScale,
    });
  });

  test("keeps the spectrum control result stable for unrelated slice fields", () => {
    const state = store.getState();
    const first = selectSpectrumControls(state);
    const unrelatedUpdate = {
      ...state,
      spectrum: {
        ...state.spectrum,
        fftAvgEnabled: !state.spectrum.fftAvgEnabled,
      },
    };

    expect(selectSpectrumControls(unrelatedUpdate)).toBe(first);
  });

  test("recomputes when a selected control changes", () => {
    const state = store.getState();
    const first = selectSpectrumControls(state);
    const controlUpdate = {
      ...state,
      spectrum: {
        ...state.spectrum,
        fftSize: state.spectrum.fftSize + 1,
      },
    };

    expect(selectSpectrumControls(controlUpdate)).not.toBe(first);
    expect(selectSpectrumControls(controlUpdate).fftSize).toBe(
      state.spectrum.fftSize + 1,
    );
  });

  test("exposes narrow SDR, connection, and source boundaries", () => {
    const state = store.getState();

    expect(selectSdrControls(state)).toEqual({
      gain: state.spectrum.gain,
      ppm: state.spectrum.ppm,
      tunerAGC: state.spectrum.tunerAGC,
      rtlAGC: state.spectrum.rtlAGC,
      sampleRateHz: state.spectrum.sampleRateHz,
    });
    expect(selectConnectionSnapshot(state)).toEqual({
      isConnected: state.websocket.isConnected,
      connectionStatus: state.websocket.connectionStatus,
      reconnectAttempts: state.websocket.reconnectAttempts,
      error: state.websocket.error,
    });
    expect(selectSourceInventory(state)).toBe(state.websocket.sources);
  });

  test("selects draw-signal inputs from the waterfall slice", () => {
    const state = store.getState();

    expect(selectDrawSignalState(state)).toEqual({
      drawParams: state.waterfall.drawParams,
      activeClumpIndex: state.waterfall.activeClumpIndex,
      globalNoiseFloor: state.waterfall.globalNoiseFloor,
    });
  });

  test("selects analysis view inputs from Redux", () => {
    const state = store.getState();

    expect(selectAnalysisViewState(state)).toEqual({
      activeSignalArea: state.spectrum.activeSignalArea,
      frequencyRange: state.spectrum.frequencyRange,
      lastKnownRanges: state.spectrum.lastKnownRanges,
      vizZoom: state.spectrum.vizZoom,
      vizPanOffset: state.spectrum.vizPanOffset,
    });
  });

  test("selects source mode from the waterfall slice", () => {
    const state = store.getState();
    expect(selectSourceMode(state)).toBe(state.waterfall.sourceMode);
  });

  test("selects the transport lifecycle snapshot from WebSocket state", () => {
    const state = store.getState();

    expect(selectSourceTransportSnapshot(state)).toEqual({
      sourceStatuses: state.websocket.sourceStatuses,
      sourceTransport: state.websocket.sourceTransport,
      sourceTransportByMode: state.websocket.sourceTransportByMode,
      sourceFrameReadiness: state.websocket.sourceFrameReadiness,
      sourceFrameReadinessByMode: state.websocket.sourceFrameReadinessByMode,
    });
  });
});
