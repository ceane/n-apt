import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface SourceRoutingState {
  bindings: Record<string, string | null>;
  selectionModes: Record<string, "single" | "multi">;
}

export interface SourceBindingPayload {
  group: string;
  role: string;
  sourceId: string | null;
}

export const sourceBindingKey = (group: string, role: string): string =>
  `${group}:${role}`;

const initialState: SourceRoutingState = {
  bindings: {},
  selectionModes: {},
};

const sourceRoutingSlice = createSlice({
  name: "sourceRouting",
  initialState,
  reducers: {
    setSourceBinding: (
      state,
      action: PayloadAction<SourceBindingPayload>,
    ) => {
      state.bindings[sourceBindingKey(action.payload.group, action.payload.role)] =
        action.payload.sourceId;
    },
    setSourceBindings: (
      state,
      action: PayloadAction<{
        group: string;
        bindings: Record<string, string | null>;
      }>,
    ) => {
      for (const [role, sourceId] of Object.entries(action.payload.bindings)) {
        state.bindings[sourceBindingKey(action.payload.group, role)] = sourceId;
      }
    },
    clearSourceBindings: (state, action: PayloadAction<{ group: string }>) => {
      const prefix = `${action.payload.group}:`;
      for (const key of Object.keys(state.bindings)) {
        if (key.startsWith(prefix)) delete state.bindings[key];
      }
    },
    setSourceSelectionMode: (
      state,
      action: PayloadAction<{
        group: string;
        mode: "single" | "multi";
      }>,
    ) => {
      state.selectionModes[action.payload.group] = action.payload.mode;
    },
  },
});

export const {
  setSourceBinding,
  setSourceBindings,
  clearSourceBindings,
  setSourceSelectionMode,
} = sourceRoutingSlice.actions;

export default sourceRoutingSlice.reducer;
