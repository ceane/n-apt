const EMPTY_ARRAY: unknown[] = [];

export const selectArrayOrEmpty = <T>(
  value: T[] | null | undefined,
): T[] => value ?? (EMPTY_ARRAY as T[]);
