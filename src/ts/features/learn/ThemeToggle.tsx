// @ts-nocheck
import { Moon, Sun } from "lucide-react";
import { useAppSelector, useAppDispatch, setAppMode } from "@n-apt/redux";

export function ThemeToggle() {
  const appMode = useAppSelector((s) => s.theme.appMode);
  const dispatch = useAppDispatch();

  const isDark = appMode === "dark" || (appMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const toggleTheme = () => {
    const nextMode = isDark ? "light" : "dark";
    dispatch(setAppMode(nextMode));
    document.documentElement.classList.toggle("dark", nextMode === "dark");
  };

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg bg-accent hover:bg-muted transition-colors flex items-center justify-center"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-foreground" />
      ) : (
        <Moon className="w-4 h-4 text-foreground" />
      )}
    </button>
  );
}
