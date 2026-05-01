import { 
  formatFrequency,
  formatFrequencyHighRes,
  type FormatFrequencyOptions
} from '@n-apt/utils/frequency';

describe('Frequency Utilities', () => {
  describe('formatFrequency', () => {
    test('should format frequencies in kHz', () => {
      expect(formatFrequency(500000)).toBe('500.0kHz');
      expect(formatFrequency(1000)).toBe('1.0kHz');
    });

    test('should format sub-MHz metadata frequencies without awkward decimal MHz values', () => {
      expect(formatFrequency(18000, { trimTrailingZeros: true })).toBe('18kHz');
    });

    test('should format frequencies in MHz', () => {
      expect(formatFrequency(1500000)).toBe('1.5MHz');
      expect(formatFrequency(100000000)).toBe('100.0MHz');
    });

    test('should format frequencies in GHz', () => {
      expect(formatFrequency(1500000000)).toBe('1.5GHz');
      expect(formatFrequency(1000000000)).toBe('1.0GHz');
    });

    test('should handle zero frequency', () => {
      expect(formatFrequency(0)).toBe('0Hz');
    });

    test('should handle negative frequencies', () => {
      expect(formatFrequency(-1500000)).toBe('-1.5MHz');
      expect(formatFrequency(-1500000000)).toBe('-1.5GHz');
    });

    test('should respect precision options', () => {
      const options: FormatFrequencyOptions = {
        precisionMHz: 1,
        precisionGHz: 2,
        precisionKHz: 1
      };
      
      expect(formatFrequency(1567000, options)).toBe('1.6MHz');
      expect(formatFrequency(1567000000, options)).toBe('1.57GHz');
      expect(formatFrequency(567000, options)).toBe('567.0kHz');
    });

    test('should format with 3 decimal precision when requested (center frequency style)', () => {
      const options: FormatFrequencyOptions = {
        precisionMHz: 3,
        precisionKHz: 3
      };
      expect(formatFrequency(137500000, options)).toBe('137.500MHz');
      expect(formatFrequency(137500100, options)).toBe('137.500MHz'); // Rounds to 137.500
      expect(formatFrequency(500000, options)).toBe('500.000kHz');
    });

    test('should hide units when requested', () => {
      expect(formatFrequency(1500000, false)).toBe('1.5');
      expect(formatFrequency(1500000000, { showUnits: false })).toBe('1.5');
    });

    test('should trim trailing zeros when requested', () => {
      const options: FormatFrequencyOptions = {
        trimTrailingZeros: true
      };
      
      expect(formatFrequency(1500000, options)).toBe('1.5MHz');
      expect(formatFrequency(100000000, options)).toBe('100MHz');
      expect(formatFrequency(1333000, options)).toBe('1.3MHz'); // Default precisionMHz is now 1
    });

    test('should handle non-finite values gracefully', () => {
      expect(formatFrequency(NaN)).toBe('---Hz');
      expect(formatFrequency(undefined as any)).toBe('---Hz');
      expect(formatFrequency(null as any)).toBe('---Hz');
      expect(formatFrequency(Infinity)).toBe('---Hz');
    });
  });

  describe('formatFrequencyHighRes', () => {
    test('should format GHz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(1500123456.789)).toBe('1.500.123.457GHz');
      expect(formatFrequencyHighRes(1000000000)).toBe('1.000.000.000GHz');
    });

    test('should format MHz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(100123456)).toBe('100.123.456MHz');
      expect(formatFrequencyHighRes(1000000)).toBe('1.000.000MHz');
    });

    test('should format kHz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(123456)).toBe('123.456kHz');
      expect(formatFrequencyHighRes(1000)).toBe('1.000kHz');
    });

    test('should format Hz frequencies with high resolution', () => {
      expect(formatFrequencyHighRes(123)).toBe('123Hz');
      expect(formatFrequencyHighRes(1)).toBe('1Hz');
    });

    test('should handle negative frequencies', () => {
      expect(formatFrequencyHighRes(-1123456)).toBe('-1.123.456MHz');
      expect(formatFrequencyHighRes(-1500123456.789)).toBe('-1.500.123.457GHz');
    });

    test('should handle zero frequency', () => {
      expect(formatFrequencyHighRes(0)).toBe('0Hz');
    });

    test('should handle non-finite values gracefully', () => {
      expect(formatFrequencyHighRes(NaN)).toBe('---Hz');
      expect(formatFrequencyHighRes(undefined as any)).toBe('---Hz');
      expect(formatFrequencyHighRes(null as any)).toBe('---Hz');
      expect(formatFrequencyHighRes(Infinity)).toBe('---Hz');
    });
  });
});
