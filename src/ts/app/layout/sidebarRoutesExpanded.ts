export const SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY =
  "n-apt-sidebar-routes-expanded";

export const readSidebarRoutesExpanded = (defaultValue = true): boolean => {
  if (typeof window === "undefined") {
    return defaultValue;
  }

  const saved = window.localStorage.getItem(
    SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY,
  );
  if (saved === null) {
    return defaultValue;
  }

  return saved === "true";
};

export const writeSidebarRoutesExpanded = (expanded: boolean): void => {
  try {
    window.localStorage.setItem(
      SIDEBAR_ROUTES_EXPANDED_STORAGE_KEY,
      String(expanded),
    );
  } catch {
    // Ignore quota / privacy mode failures.
  }
};
