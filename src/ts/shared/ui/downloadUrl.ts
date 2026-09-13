const CAPTURE_DOWNLOAD_PATH = "/api/capture/download";
const REFERENCE_CAPTURE_DOWNLOAD_PATH =
  /^\/api\/iq-captures\/[A-Za-z0-9._-]+\/download$/;

/** Builds a same-origin URL for the server's capture-download endpoint only. */
export function buildSafeDownloadUrl(
  rawUrl: string | null | undefined,
  sessionToken?: string | null,
): string | undefined {
  if (!rawUrl || typeof window === "undefined") return undefined;

  try {
    const url = new URL(rawUrl, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !(
        url.pathname === CAPTURE_DOWNLOAD_PATH ||
        REFERENCE_CAPTURE_DOWNLOAD_PATH.test(url.pathname)
      )
    ) {
      return undefined;
    }

    if (sessionToken) url.searchParams.set("token", sessionToken);
    return url.toString();
  } catch {
    return undefined;
  }
}

export function safeDownloadFilename(
  filename: string | null | undefined,
  fallback = "capture.napt",
): string {
  const basename = (filename || "").split(/[\\/]/).pop() || "";
  const cleaned = basename.replace(/[\u0000-\u001F\u007F"']/g, "").trim();
  return cleaned.slice(0, 128) || fallback;
}
