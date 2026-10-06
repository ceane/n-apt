import {
  generateSvgWithSymbols,
  extractSvgContent,
} from "@n-apt/capture/hooks/useSnapshot";
import { sanitizeSVG } from "@n-apt/ui/sanitization";

describe("snapshot SVG sanitization", () => {
  const spectrumSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 788" width="1400" height="788">
  <rect x="0" y="0" width="1400" height="788" fill="#05070d"/>
  <path d="M52,748 L1360,748" fill="none" stroke="#00d4ff" stroke-width="2" stroke-linejoin="round"/>
  <text x="52" y="20" dy="0" text-anchor="start" fill="#d8faff" font-family="JetBrains Mono, monospace" font-size="12">0dB</text>
</svg>`;

  test("preserves geometry and trace attributes", () => {
    const out = sanitizeSVG(spectrumSvg);

    expect(out).toContain('viewBox="0 0 1400 788"');
    expect(out).toContain('x="0" y="0" width="1400" height="788"');
    expect(out).toContain('d="M52,748 L1360,748"');
    expect(out).toContain("0dB");
  });

  test("keeps data:image PNG embeds and # anchors but blocks scripts", () => {
    const out = sanitizeSVG(
      `<svg viewBox="0 0 10 10">
  <image href="data:image/png;base64,AAAA" x="0" y="0" width="1" height="1"/>
  <use href="#spectrum-snapshot"/>
  <a href="javascript:alert(1)">x</a>
</svg>`,
    );

    expect(out).toContain('href="data:image/png;base64,AAAA"');
    expect(out).toContain('href="#spectrum-snapshot"');
    expect(out).not.toContain("javascript:");
  });

  test("wraps composed flat content without dropping embedded sections", () => {
    const parts = extractSvgContent(spectrumSvg);
    const composed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 959" width="1400" height="959">
  ${parts}
  <image href="data:image/png;base64,BBBB" x="0" y="788" width="1400" height="171"/>
</svg>`;

    const wrapped = generateSvgWithSymbols(composed);

    expect(wrapped).toContain('viewBox="0 0 1400 959"');
    expect(wrapped).toContain('d="M52,748 L1360,748"');
    expect(wrapped).toContain('href="data:image/png;base64,BBBB"');
  });
});
