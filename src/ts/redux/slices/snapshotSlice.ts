import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type SnapshotProgressStage =
  | "idle"
  | "started"
  | "collecting"
  | "encoding"
  | "done"
  | "error";

export type SnapshotProgressState = {
  stage: SnapshotProgressStage;
  message: string | null;
  current: number | null;
  total: number | null;
  pulseToken: number;
};

const initialState: SnapshotProgressState = {
  stage: "idle",
  message: null,
  current: null,
  total: null,
  pulseToken: 0,
};

const snapshotSlice = createSlice({
  name: "snapshot",
  initialState,
  reducers: {
    setSnapshotProgress: (
      state,
      action: PayloadAction<Partial<SnapshotProgressState>>,
    ) => ({
      ...state,
      ...action.payload,
    }),
    clearSnapshotProgress: () => initialState,
    bumpSnapshotSectionPulse: (state) => ({
      ...state,
      pulseToken: state.pulseToken + 1,
    }),
  },
});

export const {
  setSnapshotProgress,
  clearSnapshotProgress,
  bumpSnapshotSectionPulse,
} = snapshotSlice.actions;

export default snapshotSlice.reducer;
