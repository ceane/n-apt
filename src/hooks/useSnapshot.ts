import { useCallback } from "react";

type SnapshotOptions = {
  whole: boolean;
  showWaterfall: boolean;
  showStats: boolean;
  getSpectrumCanvas: () => HTMLCanvasElement | null;
  getWaterfallCanvas: () => HTMLCanvasElement | null;
  getSnapshotGridPreference?: () => boolean;
  format?: "png" | "svg";
};

export function useSnapshot(
  frequencyRange: { min: number; max: number } | null,
  isConnected: boolean,
) {
  const handleSnapshot = useCallback(
    async (options: SnapshotOptions) => {
      if (!options.getSpectrumCanvas) return;
      const spectrumCanvas = options.getSpectrumCanvas();
      const waterfallCanvas = options.getWaterfallCanvas?.();
      if (!spectrumCanvas) return;

      const width = spectrumCanvas.width;
      const height =
        options.showWaterfall && waterfallCanvas
          ? spectrumCanvas.height + waterfallCanvas.height
          : spectrumCanvas.height;

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = width;
      tempCanvas.height = height;
      const ctx = tempCanvas.getContext("2d");
      if (!ctx) return;

      // Draw spectrum
      ctx.drawImage(spectrumCanvas, 0, 0);

      // Optionally draw waterfall
      if (options.showWaterfall && waterfallCanvas) {
        ctx.drawImage(waterfallCanvas, 0, spectrumCanvas.height);
      }

      // Optionally overlay stats text
      if (options.showStats) {
        ctx.fillStyle = "#ccc";
        ctx.font = "12px monospace";
        ctx.fillText(
          `Freq: ${frequencyRange?.min ?? "-"} - ${frequencyRange?.max ?? "-"} MHz`,
          8,
          16,
        );
        ctx.fillText(`Connected: ${isConnected}`, 8, 32);
        if (options.getSnapshotGridPreference) {
          ctx.fillText(`Grid: ${options.getSnapshotGridPreference() ? "on" : "off"}`, 8, 48);
        }
      }

      if (options.format === "svg") {
        const dataUrl = tempCanvas.toDataURL("image/png");
        const svgContent = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
            <image href="${dataUrl}" width="${width}" height="${height}"/>
          </svg>
        `;
        const blob = new Blob([svgContent], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `spectrum-snapshot-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.svg`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      // Default PNG
      const dataUrl = tempCanvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `spectrum-snapshot-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`;
      link.href = dataUrl;
      link.click();
    },
    [frequencyRange, isConnected],
  );

  return { handleSnapshot };
}
