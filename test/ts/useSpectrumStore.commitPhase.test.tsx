import React, { Suspense, useLayoutEffect } from "react";
import { act, render } from "@testing-library/react";
import { store } from "@n-apt/redux/store";
import { MemoryRouter } from "react-router";
import { SpectrumProvider, useSpectrumStore } from "@n-apt/spectrum/hooks/useSpectrumStore";
import { getSourceViewStorageKeyForSource } from "@n-apt/spectrum/utils/sourcePersistence";

let mockState: ReturnType<typeof store.getState>;
const mockDispatch = jest.fn();
jest.mock("@n-apt/redux/store", () => ({
  ...jest.requireActual("@n-apt/redux/store"),
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
  useAppDispatch: () => mockDispatch,
}));

const apt = { id: "mock-apt", stream_key: "apt-stream", kind: "mock_apt", capability: "mock", status: "ready", name: "APT", sdr: { settings: {}, sample_rate_options: [], fft_display: { markers: [] } } };
const tx = { ...apt, id: "mock-tx", stream_key: "tx-stream", kind: "mock_tx", name: "Tx" };
const aptKey = getSourceViewStorageKeyForSource(apt as never);
const txKey = getSourceViewStorageKeyForSource(tx as never);
const aptRange = { min: 100, max: 200 };
const txRange = { min: 300, max: 400 };
const suspended = new Promise<void>(() => {});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockDispatch.mockReset();
  const initial = store.getState();
  mockState = {
    ...initial,
    spectrum: { ...initial.spectrum, frequencyRange: aptRange, vizPanOffset: 12, detectedFrameRate: 60 },
    waterfall: { ...initial.waterfall, sourceMode: "live" },
    sourceSelection: { selectedSourceId: apt.id, selectionIntentSourceId: apt.id, pendingSourceSwitchId: null },
    websocket: { ...initial.websocket, isConnected: false, activeSourceId: apt.id, sources: [apt, tx] as never },
  };
});

afterEach(() => jest.restoreAllMocks());

const select = (id: string) => {
  mockState = { ...mockState, sourceSelection: { ...mockState.sourceSelection, selectedSourceId: id, selectionIntentSourceId: id } };
};

describe("SpectrumProvider commit boundaries", () => {
  it("does not persist an abandoned switch or advance its previous source ID", () => {
    const Probe = ({ suspend }: { suspend: boolean }) => {
      useSpectrumStore();
      if (suspend) throw suspended;
      return null;
    };
    const tree = (suspend: boolean) => <MemoryRouter initialEntries={["/settings"]}><Suspense fallback={null}><SpectrumProvider><Probe suspend={suspend} /></SpectrumProvider></Suspense></MemoryRouter>;
    const view = render(tree(false));
    const writes = jest.spyOn(Storage.prototype, "setItem");
    select(tx.id);
    act(() => React.startTransition(() => view.rerender(tree(true))));
    expect(writes.mock.calls.filter(([key]) => key === aptKey || key === txKey)).toEqual([]);
    select(apt.id);
    view.rerender(tree(false));
    expect(writes.mock.calls.filter(([key]) => key === aptKey)).toEqual([]);
    select(tx.id);
    view.rerender(tree(false));
    expect(writes.mock.calls.filter(([key]) => key === aptKey)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(aptKey)!)).toMatchObject({ vizPanOffset: 12 });
  });

  it("saves the leaving render geometry after child layout and before restoration without overwriting the target", () => {
    const phases: string[] = [];
    const Probe = () => {
      const value = useSpectrumStore();
      useLayoutEffect(() => {
        if (value.selectedSourceId === tx.id) {
          phases.push("child-layout");
          mockState = { ...mockState, spectrum: { ...mockState.spectrum, frequencyRange: txRange, vizPanOffset: 99 } };
        }
      }, [value.selectedSourceId]);
      return null;
    };
    const tree = () => <MemoryRouter initialEntries={["/settings"]}><SpectrumProvider><Probe /></SpectrumProvider></MemoryRouter>;
    const view = render(tree());
    localStorage.setItem(txKey, JSON.stringify({ frequencyRange: txRange, vizZoom: 2 }));
    const setItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === aptKey) phases.push("save");
      setItem.call(this, key, value);
    });
    mockDispatch.mockImplementation((action) => {
      if (action?.payload?.vizZoom === 2) phases.push("restore");
    });
    select(tx.id);
    view.rerender(tree());
    expect(phases).toEqual(["child-layout", "save", "restore"]);
    expect(JSON.parse(localStorage.getItem(aptKey)!)).toMatchObject({ vizPanOffset: 12 });
    expect(JSON.parse(localStorage.getItem(txKey)!)).toEqual({ frequencyRange: txRange, vizZoom: 2 });
  });

  it("hydrates once, retains later live settings, and clears the disconnected fallback", () => {
    sessionStorage.setItem("napt-sdr-settings", JSON.stringify({ sample_rate: 123 }));
    mockState = { ...mockState, websocket: { ...mockState.websocket, isConnected: true, sources: [], activeSourceId: "" }, sourceSelection: { selectedSourceId: "", selectionIntentSourceId: null, pendingSourceSwitchId: null } };
    let settings: unknown;
    const Probe = () => { settings = useSpectrumStore().effectiveSdrSettings; return null; };
    const tree = () => <MemoryRouter initialEntries={["/settings"]}><SpectrumProvider><Probe /></SpectrumProvider></MemoryRouter>;
    const view = render(tree());
    expect(settings).toEqual({ sample_rate: 123 });
    sessionStorage.setItem("napt-sdr-settings", JSON.stringify({ sample_rate: 456 }));
    view.rerender(tree());
    expect(settings).toEqual({ sample_rate: 123 });
    const live = { ...apt, sdr: { ...apt.sdr, settings: { sample_rate: 789 } } };
    mockState = { ...mockState, websocket: { ...mockState.websocket, sources: [live] as never, activeSourceId: apt.id } };
    view.rerender(tree());
    expect(settings).toEqual({ sample_rate: 789 });
    mockState = { ...mockState, websocket: { ...mockState.websocket, sources: [], activeSourceId: "" } };
    view.rerender(tree());
    expect(settings).toEqual({ sample_rate: 789 });
    mockState = { ...mockState, websocket: { ...mockState.websocket, isConnected: false } };
    view.rerender(tree());
    expect(settings).toBeNull();
    mockState = { ...mockState, websocket: { ...mockState.websocket, isConnected: true } };
    view.rerender(tree());
    expect(settings).toBeNull();
  });
});
