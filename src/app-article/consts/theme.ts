export const theme = {
  colors: {
    // Backgrounds
    background: "#ffffff",
    surface: "#E0E0E2",
    surfaceLight: "rgba(255, 255, 255, 0.8)",
    surfaceMedium: "rgba(255, 255, 255, 0.6)",
    
    // Gradients & Accents
    primary: "#8b5cf6", // Purple/Violet
    secondary: "#3b82f6", // Blue
    tertiary: "#f59e0b", // Orange/Amber
    accent: "#c770ff",   // Bright Purple
    accentSecondary: "#6cf4ff", // Cyan
    accentTertiary: "#ffb86f",  // Peach
    
    // Signal Specific
    waveA: "#8b5cf6",
    waveB: "#10b981", 
    sideband: "#f59e0b",
    
    // UI elements
    text: "#111827",
    textPrimary: "rgba(42, 42, 42, 0.9)",
    textSecondary: "rgba(42, 42, 42, 0.8)",
    textTertiary: "rgba(42, 42, 42, 0.6)",
    textMuted: "rgba(92, 92, 92, 0.7)",
    textLight: "rgba(92, 92, 92, 0.6)",
    
    surfaceGrid: "#FFFFFF",
    particle: "#7f73bf",
    gridBase: "#f4f6fb",
    gridBorder: "rgba(17, 24, 39, 0.08)",
    muted: "rgba(107, 114, 128, 0.5)",
    axis: "#9CA3AF",
    border: "rgba(42, 42, 42, 0.3)",
    borderSecondary: "rgba(42, 42, 42, 0.2)",
    dot: "rgba(42, 42, 42, 0.5)",
    shadow: "rgba(0, 0, 0, 0.3)",
    glow: "rgba(107, 90, 205, 0.08)"
  },
  fonts: {
    mono: '"JetBrains Mono", "DM Mono", monospace',
    serif: '"Cambria Math", "Georgia", "Times New Roman", serif',
    sans: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
  },
  fontSizes: {
    tiny: "clamp(0.45rem, 0.8vw, 0.62rem)",
    small: "clamp(0.55rem, 1vw, 0.78rem)",
    normal: "clamp(0.72rem, 1.2vw, 1rem)",
    labels: "clamp(0.85rem, 1.1vw, 1.45rem)",
    bigLabels: "clamp(1.2rem, 4vw, 2.7rem)",
    canvasTitle: "clamp(0.9rem, 1.5vw, 1.35rem)"
  },
  spacing: {
    padding: "min(4vw, 24px)",
    gap: "clamp(8px, 1.2vw, 16px)",
    containerMargin: "2rem 0"
  },
  layout: {
    aspectRatio: "16 / 9",
    mobileAspectRatio: "4 / 3",
    borderRadius: "18px",
    gridSize: "0.06"
  }
};
