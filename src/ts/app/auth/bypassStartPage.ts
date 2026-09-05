const BYPASS_START_PAGE_STORAGE_KEY = "n-apt-bypass-start-page";

export const getBypassStartPage = (): boolean => {
  try {
    return localStorage.getItem(BYPASS_START_PAGE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export const setBypassStartPage = (enabled: boolean): void => {
  try {
    localStorage.setItem(
      BYPASS_START_PAGE_STORAGE_KEY,
      enabled ? "true" : "false",
    );
  } catch {
    // localStorage unavailable
  }
};

export const getPostAuthLandingPath = (): string =>
  getBypassStartPage() ? "/" : "/get-started";
