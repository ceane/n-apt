export interface VisionDisplay {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary: boolean;
}

export interface VisionDisplayOption {
  id: string;
  label: string;
  screen: VisionDisplay | null;
}

export interface VisionDisplayOptions {
  supported: boolean;
  displays: VisionDisplayOption[];
}

export async function getVisionDisplayOptions(
  browserWindow: Window,
): Promise<VisionDisplayOptions> {
  const screen = browserWindow.screen;
  return {
    supported: false,
    displays: [
      {
        id: "current-display",
        label: `Current display · ${screen.width}×${screen.height} (move the app window here before starting)`,
        screen: null,
      },
    ],
  };
}

export async function requestVisionFullscreen(
  element: HTMLElement,
  selectedScreen: VisionDisplay | null,
  _browserWindow: Window,
): Promise<void> {
  if (typeof element.requestFullscreen !== "function") {
    throw new Error("Fullscreen presentation is unavailable in this browser");
  }
  try {
    const request = element.requestFullscreen as unknown as (
      options?: FullscreenOptions & { screen?: VisionDisplay },
    ) => Promise<void>;
    await request.call(
      element,
      selectedScreen ? { screen: selectedScreen } : undefined,
    );
  } catch {
    throw new Error("Fullscreen could not start on the selected screen");
  }
}

export const requestStimulusFullscreen = requestVisionFullscreen;
