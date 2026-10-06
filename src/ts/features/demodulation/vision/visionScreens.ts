export interface VisionDisplay {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary: boolean;
}
interface VisionScreenDetails {
  screens: VisionDisplay[];
  currentScreen: VisionDisplay;
}
type WindowWithScreenDetails = Window & {
  getScreenDetails?: () => Promise<VisionScreenDetails>;
};
export interface VisionDisplayOption {
  id: string;
  label: string;
  screen: VisionDisplay | null;
}
export interface VisionDisplayOptions {
  supported: boolean;
  displays: VisionDisplayOption[];
}

const screenKey = (screen: VisionDisplay) =>
  `${screen.left}:${screen.top}:${screen.width}:${screen.height}`;

const currentDisplayFallback = (
  browserWindow: Window,
): VisionDisplayOptions => {
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
};

export async function getVisionDisplayOptions(
  browserWindow: Window,
): Promise<VisionDisplayOptions> {
  const windowWithDetails = browserWindow as WindowWithScreenDetails;
  if (typeof windowWithDetails.getScreenDetails === "function") {
    try {
      const details = await windowWithDetails.getScreenDetails();
      if (details.screens.length > 0) {
        return {
          supported: true,
          displays: details.screens.map((screen, index) => ({
            id: screenKey(screen),
            label: `${screen.label || `Display ${index + 1}`}${screen.isPrimary ? " · Primary" : ""} · ${screen.width}×${screen.height}`,
            screen,
          })),
        };
      }
    } catch {
      // If permission is unavailable, keep the stimulus usable on this display.
    }
  }
  return currentDisplayFallback(browserWindow);
}

/** Call directly from the user's click so browsers retain transient activation. */
export async function requestVisionFullscreen(
  element: HTMLElement,
  selectedScreen: VisionDisplay | null,
  browserWindow: Window,
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
    throw new Error("Fullscreen could not start on the selected display");
  }
}
