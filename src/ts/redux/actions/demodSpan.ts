import { createAction } from "@reduxjs/toolkit";
import type { Alignment } from "@n-apt/consts/types";

/** Update the demodulator and its spectrum preview in one store notification. */
export const setConsolidatedDemodSpan = createAction<{
  center: number;
  bandwidth: number;
  start: number;
  span: number;
  alignment: Alignment;
  updatePreview: boolean;
}>("demod/setConsolidatedSpan");
