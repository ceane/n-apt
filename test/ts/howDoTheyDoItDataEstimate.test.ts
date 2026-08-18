import fs from 'node:fs';
import path from 'node:path';

const article = fs.readFileSync(
  path.resolve(process.cwd(), 'pages/how-do-they-do-it.md'),
  'utf8',
);

describe('How do they do it data estimate', () => {
  it('documents the shared raw IFFT model and frame sizes', () => {
    expect(article).toContain('channel sample rate}\\div24\\text{ Hz}');
    expect(article).toContain('channel sample rate}\\div60\\text{ Hz}');
    expect(article).toContain('| A | 4.372 MHz | 262,144 | 512 KB | 131,072 | 512 KB |');
    expect(article).toContain('| C | 18.25 MHz | 1,048,576 | 2 MB | 524,288 | 2 MB |');
    expect(article).toContain('Minimum raw content: approximately `57.784 MB/s`');
    expect(article).toContain('Write→read maximum: approximately `231.136 MB/s`');
  });

  it('does not retain the superseded fixed FFT estimate', () => {
    expect(article).not.toContain('65,536 FFT');
    expect(article).not.toContain('30 frames/s');
    expect(article).not.toContain('1Hz = 1 bit');
  });
});
