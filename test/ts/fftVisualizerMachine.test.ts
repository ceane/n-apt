import {
  createFFTVisualizerMachine,
  type FFTVisualizerSnapshot,
} from "@n-apt/utils/fftVisualizerMachine";

describe("createFFTVisualizerMachine", () => {
  const createSnapshot = (): FFTVisualizerSnapshot => ({
    waveform: new Float32Array([1, 2, 3]),
    waterfallTextureSnapshot: new Uint8Array([10, 20, 30, 40]),
    waterfallTextureMeta: {
      width: 2,
      height: 2,
      writeRow: 1,
    },
    waterfallBuffer: new Uint8ClampedArray([9, 8, 7, 6]),
    waterfallDims: {
      width: 1,
      height: 1,
    },
  });

  it("persists cloned visualizer state for route restoration", () => {
    const machine = createFFTVisualizerMachine();
    const snapshot = createSnapshot();

    machine.persist("live", snapshot);

    snapshot.waveform![0] = 99;
    snapshot.waterfallTextureSnapshot![0] = 88;
    snapshot.waterfallBuffer![0] = 77;

    const restored = machine.restore("live");

    expect(restored).not.toBeNull();
    expect(restored?.waveform).toEqual(new Float32Array([1, 2, 3]));
    expect(restored?.waterfallTextureSnapshot).toEqual(
      new Uint8Array([10, 20, 30, 40]),
    );
    expect(restored?.waterfallTextureMeta).toEqual({
      width: 2,
      height: 2,
      writeRow: 1,
    });
    expect(restored?.waterfallBuffer).toEqual(
      new Uint8ClampedArray([9, 8, 7, 6]),
    );
    expect(restored?.waterfallDims).toEqual({
      width: 1,
      height: 1,
    });
    expect(machine.getState("live").status).toBe("ready");
  });

  it("clears persisted state", () => {
    const machine = createFFTVisualizerMachine();

    machine.persist("live", createSnapshot());
    machine.clear("live");

    expect(machine.restore("live")).toBeNull();
    expect(machine.getState("live")).toEqual({
      status: "empty",
      snapshot: null,
    });
  });

  it("keeps live and playback snapshots isolated by session key", () => {
    const machine = createFFTVisualizerMachine();
    const liveSnapshot = createSnapshot();
    const playbackSnapshot = {
      ...createSnapshot(),
      waveform: new Float32Array([7, 8, 9]),
    };

    machine.persist("live", liveSnapshot);
    machine.persist("playback:file-a:1", playbackSnapshot);

    expect(machine.restore("live")?.waveform).toEqual(
      new Float32Array([1, 2, 3]),
    );
    expect(machine.restore("playback:file-a:1")?.waveform).toEqual(
      new Float32Array([7, 8, 9]),
    );
  });

  it("returns cloned snapshots from restore so callers cannot mutate stored state", () => {
    const machine = createFFTVisualizerMachine();

    machine.persist("live", createSnapshot());

    const restored = machine.restore("live");
    restored?.waveform?.set([99, 98, 97]);
    restored?.waterfallTextureSnapshot?.set([1, 1, 1, 1]);
    restored?.waterfallBuffer?.set([5, 5, 5, 5]);

    expect(machine.restore("live")?.waveform).toEqual(
      new Float32Array([1, 2, 3]),
    );
    expect(machine.restore("live")?.waterfallTextureSnapshot).toEqual(
      new Uint8Array([10, 20, 30, 40]),
    );
    expect(machine.restore("live")?.waterfallBuffer).toEqual(
      new Uint8ClampedArray([9, 8, 7, 6]),
    );
  });

  it("returns cloned snapshots from getState as well", () => {
    const machine = createFFTVisualizerMachine();

    machine.persist("live", createSnapshot());

    const state = machine.getState("live");
    state.snapshot?.waveform?.set([42, 42, 42]);

    expect(machine.getState("live").snapshot?.waveform).toEqual(
      new Float32Array([1, 2, 3]),
    );
  });

  it("deletes only the targeted session when persisted with a null snapshot", () => {
    const machine = createFFTVisualizerMachine();

    machine.persist("live", createSnapshot());
    machine.persist("playback:file-a:1", {
      ...createSnapshot(),
      waveform: new Float32Array([7, 8, 9]),
    });

    machine.persist("live", null);

    expect(machine.restore("live")).toBeNull();
    expect(machine.restore("playback:file-a:1")?.waveform).toEqual(
      new Float32Array([7, 8, 9]),
    );
  });

  it("seeds the default session when created with an initial snapshot", () => {
    const machine = createFFTVisualizerMachine(createSnapshot());

    expect(machine.getState("default")).toEqual({
      status: "ready",
      snapshot: createSnapshot(),
    });
  });
});
