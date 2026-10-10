import {
  getVisionDisplayOptions,
  requestVisionFullscreen,
  type VisionDisplay,
} from "@n-apt/demodulation/vision/visionScreens";

describe("vision display selection", () => {
  const main = {
    label: "Studio",
    left: 0,
    top: 0,
    width: 1920,
    height: 1080,
    isPrimary: true,
  };
  const second = {
    label: "External",
    left: 1920,
    top: 0,
    width: 2560,
    height: 1440,
    isPrimary: false,
  };

  test("returns labeled physical displays and distinguishes manual-position fallback", async () => {
    const getScreenDetails = jest
      .fn()
      .mockResolvedValue({ screens: [main, second], currentScreen: main });
    const result = await getVisionDisplayOptions({
      getScreenDetails,
    } as unknown as Window);
    expect(result.supported).toBe(true);
    expect(result.displays.map((display) => display.label)).toEqual([
      "Studio · Primary · 1920×1080",
      "External · 2560×1440",
    ]);
    const fallback = await getVisionDisplayOptions({
      screen: main,
    } as unknown as Window);
    expect(fallback.supported).toBe(false);
    expect(fallback.displays[0].screen).toBeNull();
  });

  test("falls back to the current display when display permission is unavailable", async () => {
    const result = await getVisionDisplayOptions({
      screen: main,
      getScreenDetails: jest.fn().mockRejectedValue(new Error("denied")),
    } as unknown as Window);

    expect(result.supported).toBe(false);
    expect(result.displays).toHaveLength(1);
    expect(result.displays[0]).toMatchObject({
      id: "current-display",
      label: expect.stringContaining("Current display · 1920×1080"),
      screen: null,
    });
  });

  test("requests fullscreen in the selected display as a direct user gesture", async () => {
    const requestFullscreen = jest.fn().mockResolvedValue(undefined);
    const element = { requestFullscreen } as unknown as HTMLElement;
    const getScreenDetails = jest
      .fn()
      .mockResolvedValue({ screens: [main, second] });
    await requestVisionFullscreen(element, second, {
      getScreenDetails,
    } as unknown as Window);
    expect(requestFullscreen).toHaveBeenCalledWith({ screen: second });
  });

  test("never silently falls back to another screen or a windowed view", async () => {
    const requestFullscreen = jest
      .fn()
      .mockRejectedValue(new Error("permission denied"));
    await expect(
      requestVisionFullscreen(
        { requestFullscreen } as unknown as HTMLElement,
        main,
        {
          getScreenDetails: jest.fn().mockResolvedValue({ screens: [main] }),
        } as unknown as Window,
      ),
    ).rejects.toThrow(/fullscreen/i);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  test("requests fullscreen on the current display when no screen target is supported", async () => {
    const requestFullscreen = jest.fn().mockResolvedValue(undefined);
    await requestVisionFullscreen(
      { requestFullscreen } as unknown as HTMLElement,
      null,
      { screen: main } as unknown as Window,
    );

    expect(requestFullscreen).toHaveBeenCalledWith(undefined);
  });
});
