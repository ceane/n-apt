export interface ExperimentLabelSource {
  labels?: unknown;
  title?: unknown;
}

export const normalizeExperimentLabels = (labels: readonly unknown[]): string[] =>
  Array.from(
    new Set(
      labels
        .filter((label): label is string => typeof label === "string")
        .map((label) => label.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  );

export const collectExperimentLabels = (
  notes: readonly ExperimentLabelSource[],
): string[] =>
  normalizeExperimentLabels(
    notes.flatMap((note) => (Array.isArray(note.labels) ? note.labels : [])),
  );

export const captureExperimentFftSnapshot = (
  nodeId = "rx-fft",
): { dataUrl: string; width: number; height: number } | null => {
  if (typeof document === "undefined") return null;
  const node = document.querySelector<HTMLElement>(`[data-id="${nodeId}"]`);
  const canvas = node?.querySelector("canvas");
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

  try {
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    return null;
  }
};
