import { 
  formatFrequency,
  formatFrequencyHighRes,
  type FormatFrequencyOptions
} from '../../src/ts/utils/frequency';

describe('Frequency Utilities', () => {
  describe('formatFrequency', () => {
    test('should format frequencies in kHz', () => {
      expect(formatFrequency(0.5)).toBe('500 kHz');
      expect(formatFrequency(0.001)).toBe('1 kHz');
    });

    test('should format frequencies in MHz', () => {
      expect(formatFrequency(1.5)).toBe('1.500 MHz');
      expect(formatFrequency(100)).toBe('100.000 MHz');
    });

    test('should format frequencies in GHz', () => {
      expect(formatFrequency(1500)).toBe('1.500 GHz');
      expect(formatFrequency(1000)).toBe('1.000 GHz');
    });

    test('should handle zero frequency', () => {
      expect(formatFrequency(0)).toBe('0 kHz');
    });

    test('should handle negative frequencies', () => {
      expect(formatFrequency(-1.5)).toBe('-1.500 MHz');
      expect(formatFrequency(-1500)).toBe('-1.500 GHz');
    });

    test('should respect precision options', () => {
      const options: FormatFrequencyOptions = {
        precisionMHz: 1,
        precisionGHz: 2,
        precisionKHz: 1
      };
      
      expect(formatFrequency(1.567, options)).toBe('1.6 MHz');
      expect(formatFrequency(1567, options)).toBe('1.57 GHz');
      expect(formatFrequency(0.567, options)).toBe('567.0 kHz');
    });

    test('should hide units when requested', () => {
      expect(formatFrequency(1.5, false)).toBe('1.500');
      expect(formatFrequency(1500, { showUnits: false })).toBe('1.500');
    });

    test('should trim trailing zeros when requested', () => {
      const options: FormatFrequencyOptions = {
        trimTrailingZeros: true
      };
      
      expect(formatFrequency(1.5, options)).toBe('1.5 MHz');
      expect(formatFrequency(100, options)).toBe('100 MHz');
      expect(formatFrequency(1.333, options)).toBe('1.333 MHz');
    });
  });

  describe('formatFrequencyHighRes', () => {
    test('should format GHz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(1500.123456789)).toBe('1.500.123.457 GHz');
      expect(formatFrequencyHighRes(1000)).toBe('1.000.000.000 GHz');
    });

    test('should format MHz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(100.123456)).toBe('100.123.456 MHz');
      expect(formatFrequencyHighRes(1)).toBe('1.000.000 MHz');
    });

    test('should format kHz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(0.123456)).toBe('123.456 kHz');
      expect(formatFrequencyHighRes(0.001)).toBe('1.000 kHz');
    });

    test('should format Hz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(0.000123)).toBe('123 Hz');
      expect(formatFrequencyHighRes(0.000001)).toBe('1 Hz');
    });

    test('should handle negative frequencies', () => {
      expect(formatFrequencyHighRes(-1.123456)).toBe('-1.123.456 MHz');
      expect(formatFrequencyHighRes(-1500.123456789)).toBe('-1.500.123.457 GHz');
    });

    test('should handle zero frequency', () => {
      expect(formatFrequencyHighRes(0)).toBe('0 Hz');
    });
  });
});
