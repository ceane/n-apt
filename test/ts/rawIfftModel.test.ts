import {
  getRawIfftModel,
  BYTES_PER_IQ_SAMPLE,
} from '@n-apt/math/signalData';
import {
  formatDataRate,
  formatDataTotal,
  formatFileSize,
} from '@n-apt/math/formatters';

describe('raw IFFT model', () => {
  it('rounds channel FFT sizes up and calculates packed frame bytes', () => {
    expect(getRawIfftModel(4.372e6, 24, BYTES_PER_IQ_SAMPLE.u8)).toEqual({
      fftSize: 262144,
      frameBytes: 524288,
      framesPerSecond: 4.372e6 / 262144,
      rateBytesPerSecond: 4.372e6 * 2,
    });
  });

  it('uses u16 I/Q precision for the maximum model', () => {
    expect(getRawIfftModel(18.25e6, 60, BYTES_PER_IQ_SAMPLE.u16)).toEqual({
      fftSize: 524288,
      frameBytes: 2097152,
      framesPerSecond: 18.25e6 / 524288,
      rateBytesPerSecond: 18.25e6 * 4,
    });
  });

  it.each([
    [524288, '512.00 KB'],
    [2097152, '2.00 MB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it('defines u8 and u16 complex samples as shared byte widths', () => {
    expect(BYTES_PER_IQ_SAMPLE).toEqual({ u8: 2, u16: 4 });
  });

  it('formats shared data rates and totals consistently', () => {
    expect(formatDataRate(4_000_000)).toBe('4.00 MB/s');
    expect(formatDataTotal(5 * 1024 ** 3)).toBe('5.00 GB');
  });
});
