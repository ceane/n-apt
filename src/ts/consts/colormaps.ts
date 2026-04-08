import colormaps from "./colormaps.json";

export type RgbTuple = [number, number, number];
export type ColormapData = RgbTuple[];

export const WATERFALL_COLORMAPS = colormaps as unknown as Record<string, ColormapData>;
