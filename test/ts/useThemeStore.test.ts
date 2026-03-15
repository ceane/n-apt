import { renderHook, act } from "@testing-library/react";
import { useThemeStore } from "@n-apt/hooks/useThemeStore";
import { COLORS } from "@n-apt/consts";

describe("useThemeStore", () => {
  beforeEach(() => {
    // Clear the store between tests
    act(() => {
      useThemeStore.getState().resetTheme();
    });
  });

  it("should initialize with default values", () => {
    const { result } = renderHook(() => useThemeStore());
    
    expect(result.current.appMode).toBe("system");
    expect(result.current.accentColor).toBe(COLORS.primary);
    expect(result.current.fftColor).toBe("#00d4ff");
    expect(result.current.waterfallTheme).toBe("classic");
  });

  it("should update app mode", () => {
    const { result } = renderHook(() => useThemeStore());
    
    act(() => {
      result.current.setAppMode("dark");
    });
    expect(result.current.appMode).toBe("dark");

    act(() => {
      result.current.setAppMode("light");
    });
    expect(result.current.appMode).toBe("light");
  });

  it("should update accent color", () => {
    const { result } = renderHook(() => useThemeStore());
    
    const newColor = "#ff0000";
    act(() => {
      result.current.setAccentColor(newColor);
    });
    expect(result.current.accentColor).toBe(newColor);
  });

  it("should update waterfall theme", () => {
    const { result } = renderHook(() => useThemeStore());
    
    act(() => {
      result.current.setWaterfallTheme("plasma");
    });
    expect(result.current.waterfallTheme).toBe("plasma");
  });

  it("should reset to defaults", () => {
    const { result } = renderHook(() => useThemeStore());
    
    act(() => {
      result.current.setAppMode("dark");
      result.current.setAccentColor("#123456");
      result.current.resetTheme();
    });
    
    expect(result.current.appMode).toBe("system");
    expect(result.current.accentColor).toBe(COLORS.primary);
  });
});
