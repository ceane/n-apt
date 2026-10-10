export const resolveStorePreloadedState = <T>(
  coldStartState: T,
  hotReloadState: T | null | undefined,
): T => hotReloadState ?? coldStartState;
