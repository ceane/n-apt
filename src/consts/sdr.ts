// Proper frequency formatting function - no rounding, precise display
export const formatFrequency = (freqMHz: number): string => {
  if (freqMHz < 0.001) {
    // Less than 1 kHz - show in Hz
    const freqHz = freqMHz * 1000000;
    return `${freqHz.toFixed(0)}Hz`;
  } else if (freqMHz < 1) {
    // Less than 1 MHz - show in kHz
    const freqKHz = freqMHz * 1000;
    return `${freqKHz.toFixed(0)}kHz`;
  } else {
    // 1 MHz or more - show in MHz
    return `${freqMHz.toFixed(3)}MHz`;
  }
};
