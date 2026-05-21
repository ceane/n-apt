export const WATERFALL_ONSCREEN_COLOR_MAX = 0.58;
export const WATERFALL_OVER_RANGE_MIN_DB = 6;
export const WATERFALL_OVER_RANGE_MAX_DB = 24;
export const WATERFALL_OVER_RANGE_RATIO = 0.25;

export const getWaterfallOverRangeHeadroomDb = (
  minDb: number,
  maxDb: number,
) => {
  const span = Math.max(maxDb - minDb, 0.001);
  return Math.min(
    WATERFALL_OVER_RANGE_MAX_DB,
    Math.max(WATERFALL_OVER_RANGE_MIN_DB, span * WATERFALL_OVER_RANGE_RATIO),
  );
};

export const normalizeWaterfallDbForColor = (
  db: number,
  minDb: number,
  maxDb: number,
) => {
  const span = Math.max(maxDb - minDb, 0.001);
  const onscreen = Math.max(0, Math.min(1, (db - minDb) / span));

  if (db <= maxDb) {
    return onscreen * WATERFALL_ONSCREEN_COLOR_MAX;
  }

  const overrange = Math.max(
    0,
    Math.min(1, (db - maxDb) / getWaterfallOverRangeHeadroomDb(minDb, maxDb)),
  );

  return (
    WATERFALL_ONSCREEN_COLOR_MAX +
    (1 - WATERFALL_ONSCREEN_COLOR_MAX) * overrange
  );
};
