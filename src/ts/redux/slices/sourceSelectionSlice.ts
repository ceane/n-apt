import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface SourceSelectionState {
  /** User-selected source intent; backend confirmation lives in websocket.activeSourceId. */
  selectedSourceId: string;
  /** Explicit selection intent retained while the backend is still active elsewhere. */
  selectionIntentSourceId: string | null;
  /** Source switch request awaiting backend confirmation or timeout. */
  pendingSourceSwitchId: string | null;
}

const initialState: SourceSelectionState = {
  selectedSourceId: "",
  selectionIntentSourceId: null,
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
  setPendingSourceSwitchId,
  clearSelectedSourceId,
} = sourceSelectionSlice.actions;

export default sourceSelectionSlice.reducer;
