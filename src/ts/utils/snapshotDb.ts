export const roundSnapshotDbValue = (value: number) => {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
};
