/**
 * The current processed file frame shared by file playback and React Flow
 * nodes. Keep this separate from the live transport queue: live demodulation
 * drains and source switching clears that queue by design.
 */
export const filePlaybackDataRef: { current: any | null } = {
  current: null,
};
