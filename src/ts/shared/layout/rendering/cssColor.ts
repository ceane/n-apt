export function readCssColor(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined")
    return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
