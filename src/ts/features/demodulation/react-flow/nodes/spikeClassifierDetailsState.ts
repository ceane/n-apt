/** Session-scoped so the classifier panel keeps its state across a hot reload
 * or a page reload (both remount the node) and starts collapsed in a fresh
 * session. Kept out of the node module so it can be tested on its own. */
export const SPIKE_CLASSIFIER_DETAILS_SESSION_KEY =
  "n-apt:demod-spike-node:classifier-open:v1";

export const readStoredClassifierOpen = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.sessionStorage.getItem(SPIKE_CLASSIFIER_DETAILS_SESSION_KEY) ===
      "open"
    );
  } catch {
    // Session storage can be unavailable in private or restricted contexts.
    return false;
  }
};

export const writeStoredClassifierOpen = (open: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SPIKE_CLASSIFIER_DETAILS_SESSION_KEY,
      open ? "open" : "closed",
    );
  } catch {
    // Session storage can be unavailable in private or restricted contexts.
  }
};
