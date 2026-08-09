import { useEffect } from "react";
import { useAppSelector } from "@n-apt/redux";
import { useResolvedThemeMode } from "@n-apt/ui/Theme";

/** Keeps `html.dark` in sync with app theme while the learn route is mounted (md-signals + canvases). */
export const useLearnSignalsDocumentDarkClass = (): void => {
  const appMode = useAppSelector((state) => state.theme.appMode);
  const resolvedMode = useResolvedThemeMode(appMode);
  const isDark = resolvedMode === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    return () => {
      document.documentElement.classList.remove("dark");
    };
  }, [isDark]);
};

export default useLearnSignalsDocumentDarkClass;
