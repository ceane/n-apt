export type RebuildStatusResponse = {
  rebuilding?: boolean;
  pending?: boolean;
  success?: boolean;
  stage?: string;
  phase?: string;
  progress?: string;
  recentLines?: string[];
  startedAt?: number;
};

export const formatRebuildNotificationMessage = (
  data: RebuildStatusResponse,
): string => {
  if (typeof data.progress === "string" && data.progress.trim().length > 0) {
    return data.progress.trim();
  }
  switch (data.phase) {
    case "waiting":
      return "Waiting for Rust source changes to settle...";
    case "restarting":
      return "Restarting Rust backend...";
    case "building":
    case "rebuilding":
      return "Compiling Rust backend...";
    default:
      return "Rust source files modified. Compiling new binary...";
  }
};

/** Persistent toast only while cargo/restart is actually running. */
export const shouldShowRebuildNotification = (
  data: RebuildStatusResponse,
): boolean => data.rebuilding === true && data.phase !== "waiting";
