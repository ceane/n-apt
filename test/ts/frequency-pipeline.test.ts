import { isValidFrequency } from '../../src/ts/validation/guards';
import { parseFrequency } from '../../src/ts/utils/frequency';

/**
 * End-to-end Integration Test Mock
 * Validates the full frequency pipeline:
 * signals.yaml (!frequency 137.5MHz) -> 
 * Backend (137,500,000) -> 
 * WebSocket -> 
 * Frontend Validation (isValidFrequency) ->
 * Store
 */
describe('Frequency Pipeline Integration', () => {
  it('should validate a typical high-frequency satellite range (137.5 MHz)', () => {
    // 1. Simulate signals.yaml -> Backend parsing
    const rawHz = 137_500_000; 
    
    // 2. Validate using guards (simulating WebSocket middleware check)
    expect(isValidFrequency(rawHz)).toBe(true);
  });

  it('should validate ultra-high frequency ranges (30 GHz)', () => {
    // 30 GHz = 30,000,000,000 Hz
    const uhfHz = 30_000_000_000;
    expect(isValidFrequency(uhfHz)).toBe(true);
  });

  it('should invalidate frequencies above the 30 GHz limit', () => {
    const tooHighHz = 31_000_000_000;
    expect(isValidFrequency(tooHighHz)).toBe(false);
  });

  it('should handle string parsing with units accurately', () => {
    // Simulate user input or filename parsing
    expect(parseFrequency('137.5MHz')).toBe(137_500_000);
    expect(parseFrequency('2.4GHz')).toBe(2_400_000_000);
    expect(parseFrequency('440Hz')).toBe(440);
    expect(parseFrequency('18kHz')).toBe(18_000);
    
    // Test numeric separators
    expect(parseFrequency('137_500_000')).toBe(137_500_000);
    expect(parseFrequency('137_500_000Hz')).toBe(137_500_000);
  });

  it('should handle legacy defaults correctly', () => {
    // Default unit should be Hz now, but some parts might still use MHz as fallback
    expect(parseFrequency('137.5', 'MHz')).toBe(137_500_000);
    expect(parseFrequency('440', 'Hz')).toBe(440);
  });
});
