import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { loadSelectedSourceId } from "@n-apt/spectrum/utils/sourcePersistence";

export interface SourceSelectionState {
  /** User-selected source intent; backend confirmation lives in websocket.activeSourceId. */
  selectedSourceId: string;
  /** Explicit selection intent retained while the backend is still active elsewhere. */
  selectionIntentSourceId: string | null;
  /** Source switch request awaiting backend confirmation or timeout. */
  pendingSourceSwitchId: string | null;
}

const initialStoredSourceId = loadSelectedSourceId();

const initialState: SourceSelectionState = {
  selectedSourceId: initialStoredSourceId ?? "",
  // A restored source must also be an explicit subscriber-local intent. This
  // makes cold reload attach its managed view source instead of only painting
  // the selected card while the presentation controller remains unbound.
  selectionIntentSourceId: initialStoredSourceId,
  pendingSourceSwitchId: null,
};

const sourceSelectionSlice = createSlice({
  name: "sourceSelection",
  initialState,
  reducers: {
    setSelectedSourceId: (state, action: PayloadAction<string>) => {
      state.selectedSourceId = action.payload;
    },
    setSelectionIntentSourceId: (
      state,
      action: PayloadAction<string | null>,
    ) => {
      state.selectionIntentSourceId = action.payload;
    },
    restoreSelectedSource: (state, action: PayloadAction<string>) => {
      state.selectedSourceId = action.payload;
      state.selectionIntentSourceId = action.payload;
      state.pendingSourceSwitchId = null;
    },
    selectSource: (state, action: PayloadAction<string>) => {
      state.selectedSourceId = action.payload;
      state.selectionIntentSourceId = action.payload;
    },
    setPendingSourceSwitchId: (state, action: PayloadAction<string | null>) => {
      state.pendingSourceSwitchId = action.payload;
    },
    clearSelectedSourceId: (state) => {
      state.selectedSourceId = "";
      state.selectionIntentSourceId = null;
      state.pendingSourceSwitchId = null;
    },
  },
});

export const {
  setSelectedSourceId,
  setSelectionIntentSourceId,
  restoreSelectedSource,
  selectSource,
  setPendingSourceSwitchId,
  clearSelectedSourceId,
} = sourceSelectionSlice.actions;

export default sourceSelectionSlice.reducer;
