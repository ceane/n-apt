import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(process.cwd(), "scripts/article/sync-channel-frequencies.mjs");

describe("article channel frequency synchronizer", () => {
  it("reads only signals.channels and replaces channel ranges and derived centers", () => {
    const root = mkdtempSync(path.join(tmpdir(), "n-apt-channel-sync-"));
    const article = [
      '<div data-channel-a="2col,2row">',
      "- **Channel A** from `18kHz to 4.39MHz` with a center frequency of `2.204 MHz` and bandwidth of `4.372 MHz`",
      "</div>",
      '<div data-channel-b="2col,2row">',
      "- **Channel B** from `24.72MHz to 29.88MHz` with a center frequency of `27.30 MHz` and bandwidth of `5.16 MHz`",
      "</div>",
      '<div data-channel-c="2col,2row">',
      "- **Channel C** from `4.75MHz to 23MHz` with a center frequency of `13.875 MHz` and bandwidth of `18.25 MHz`",
      "</div>",
      "",
      '<div data-channel-b="2col,2row">',
      "From about `24.72MHz to 29.88MHz` is what I dub as \"Channel B\" of the overall N-APT signals. The center frequency is `27.30 MHz` and bandwidth is `5.16 MHz`. In the raw `u8` I/Q model, that is approximately `10.32 MB/s`.",
      "</div>",
      "",
      '<div class="estimated-data-table" data-channel-a="2col,2row" data-channel-b="2col,2row" data-channel-c="2col,2row">',
      "| Channel | BW (1x, network) | Raw `u8` I/Q MB/s | 5 min | 1 hour |\n|---|---:|---:|---:|---:|\n| A | 4.372 MHz | ~4.372 MB/s | ~1.31 GB | ~15.7 GB |\n| B | 5.16 MHz | ~5.16 MB/s | ~1.55 GB | ~18.6 GB |\n| C | 18.25 MHz | ~18.25 MB/s | ~5.48 GB | ~65.7 GB |",
      "</div>",
    ].join("\n");
    const signals = [
      "signals:",
      "  channels:",
      "    a:",
      '      label: "A"',
      "      freq_range_hz: !frequency_range 18kHz..4.39MHz",
      "    b:",
      '      label: "B"',
      "      freq_range_hz: !frequency_range 24.1MHz..30.37MHz",
      "    c:",
      '      label: "C"',
      "      freq_range_hz: !frequency_range 4.75MHz..23MHz",
      "  mock_apt:",
      "    channels:",
      "      b:",
      "        freq_range_hz: !frequency_range 1MHz..2MHz",
    ].join("\n");

    try {
      writeFileSync(path.join(root, "signals.yaml"), signals);
      writeFileSync(path.join(root, "pages.md"), article);

      execFileSync(process.execPath, [SCRIPT, "--write", "--signals", "signals.yaml", "--article", "pages.md", "--root", root], {
        cwd: root,
        stdio: "pipe",
      });

      const updated = readFileSync(path.join(root, "pages.md"), "utf8");
      expect(updated).toContain("Channel B** from `24.1MHz to 30.37MHz`");
      expect(updated).toContain("center frequency of `27.235 MHz` and bandwidth of `6.27 MHz`");
      expect(updated).toContain("From about `24.1MHz to 30.37MHz`");
      expect(updated).toContain("approximately `12.54 MB/s`");
      expect(updated).toContain("| B | 6.27 MHz | ~6.27 MB/s | ~1.88 GB | ~22.6 GB |");
      expect(updated).not.toContain("24.72MHz to 29.88MHz");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
