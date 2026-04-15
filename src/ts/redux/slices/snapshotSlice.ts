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
};

const initialState: SnapshotProgressState = {
  stage: "idle",
  message: null,
  current: null,
  total: null,
};

const snapshotSlice = createSlice({
  name: "snapshot",
  initialState,
  reducers: {
    setSnapshotProgress: (
      _state,
      action: PayloadAction<SnapshotProgressState>,
    ) => action.payload,
    clearSnapshotProgress: () => initialState,
  },
});

export const { setSnapshotProgress, clearSnapshotProgress } =
  snapshotSlice.actions;

export default snapshotSlice.reducer;
