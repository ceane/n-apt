import { createFFTVisualizerMachine, FFTVisualizerSnapshot } from "../../src/ts/utils/fftVisualizerMachine";

describe("fftVisualizerMachine", () => {
  const createMockSnapshot = (): FFTVisualizerSnapshot => ({
    waveform: new Float32Array([1.0, 2.0, 3.0]),
    waterfallTextureSnapshot: new Uint8Array([10, 20, 30]),
    waterfallTextureMeta: { width: 100, height: 100, writeRow: 50 },
    waterfallBuffer: new Uint8ClampedArray([255, 0, 0, 255]),
    waterfallDims: { width: 100, height: 100 },
  });

  test("initializes with empty state", () => {
    const machine = createFFTVisualizerMachine();
    const state = machine.getState("session-1");
    expect(state.status).toBe("empty");
    expect(state.snapshot).toBeNull();
  });

  test("initializes with optional initial snapshot", () => {
    const mock = createMockSnapshot();
    const machine = createFFTVisualizerMachine(mock);
    const state = machine.getState("default");
    expect(state.status).toBe("ready");
    expect(state.snapshot?.waveform).toEqual(mock.waveform);
  });

  test("persists and restores snapshots across sessions", () => {
    const machine = createFFTVisualizerMachine();
    const mock1 = createMockSnapshot();
    const mock2 = { ...createMockSnapshot(), waveform: new Float32Array([9, 8, 7]) };

    machine.persist("s1", mock1);
    machine.persist("s2", mock2);

    expect(machine.restore("s1")?.waveform).toEqual(mock1.waveform);
    expect(machine.restore("s2")?.waveform).toEqual(mock2.waveform);
    
    const state1 = machine.getState("s1");
    expect(state1.status).toBe("ready");
  });

  test("clones snapshots to prevent external mutation", () => {
    const machine = createFFTVisualizerMachine();
    const mock = createMockSnapshot();

    machine.persist("session", mock);
    
    // Mutate the original
    if (mock.waveform) mock.waveform[0] = 999;
    
    const restored = machine.restore("session");
    expect(restored?.waveform?.[0]).toBe(1.0); // Should still be original value
    
    // Mutate the restored one
    if (restored?.waveform) restored.waveform[1] = 888;
    
    const stateAfterRestoredMutation = machine.getState("session");
    expect(stateAfterRestoredMutation.snapshot?.waveform?.[1]).toBe(2.0); // Internal state should be protected
  });

  test("clear removes the session state", () => {
    const machine = createFFTVisualizerMachine();
    machine.persist("s1", createMockSnapshot());
    machine.clear("s1");
    
    expect(machine.restore("s1")).toBeNull();
    expect(machine.getState("s1").status).toBe("empty");
  });

  test("persist with null clears the session", () => {
    const machine = createFFTVisualizerMachine();
    machine.persist("s1", createMockSnapshot());
    machine.persist("s1", null);
    
    expect(machine.getState("s1").status).toBe("empty");
  });
});
