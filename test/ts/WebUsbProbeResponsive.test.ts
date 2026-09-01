import fs from "node:fs";
import path from "node:path";

const probeHtml = fs.readFileSync(
  path.resolve(process.cwd(), "src/ts/webusb-probe/index.html"),
  "utf8",
);
const probeScript = fs.readFileSync(
  path.resolve(process.cwd(), "src/ts/webusb/vanillaProbe.ts"),
  "utf8",
);

describe("standalone WebUSB probe mobile layout", () => {
  it("keeps controls, action pills, and the canvas usable on narrow screens", () => {
    expect(probeHtml).toContain('name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"');
    expect(probeHtml).toMatch(
      /\.controls\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*170px\),\s*1fr\)/,
    );
    expect(probeHtml).toMatch(
      /canvas\s*\{[^}]*height:\s*clamp\(220px,\s*56vw,\s*360px\)/,
    );
    expect(probeHtml).toContain("@media (max-width: 680px)");
    expect(probeHtml).toContain(".source-pill { gap: 4px; padding: 5px;");
    expect(probeHtml).toContain(".snapshot-pill { width: 100%; max-width: 100%; display: grid;");
    expect(probeHtml).toContain(
      '<span class="snapshot-prefix">Take a snapshot</span>',
    );
    expect(probeHtml).toContain('.snapshot-status:empty { display: none; }');
    expect(probeHtml).toMatch(/\.source-pill\s*\{[^}]*overflow:\s*visible/);
    expect(probeHtml).toContain("@media (max-width: 420px)");
    expect(probeHtml).toContain(".eyebrow, h1, .card > p:first-of-type { display: none; }");
    expect(probeHtml).toContain(".card { height: 100%; min-height: 0; display: flex;");
    expect(probeHtml).toContain(".controls { grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(probeHtml).toContain(".canvas-frame { flex: 1 1 0; min-height: 0; }");
    expect(probeHtml).toMatch(
      /@media\s*\(max-width:\s*680px\)[\s\S]*?main\s*\{[^}]*height:\s*100svh/,
    );
    expect(probeHtml).toMatch(
      /@media\s*\(max-width:\s*680px\)[\s\S]*?\.eyebrow,\s*h1,\s*\.card > p:first-of-type\s*\{\s*display:\s*none/,
    );
    expect(probeHtml).toContain("--mobile-card-padding: 14px;");
    expect(probeHtml).toMatch(
      /main\s*\{[^}]*padding-left:\s*0;\s*padding-right:\s*0;/,
    );
    expect(probeHtml).toMatch(
      /\.card\s*\{[^}]*border:\s*0;\s*border-radius:\s*0;\s*background:\s*transparent;/,
    );
    expect(probeHtml).toContain(".canvas-frame { margin-left: calc(-1 * var(--mobile-card-padding));");
    expect(probeHtml).toMatch(
      /canvas\s*\{[^}]*border-left:\s*0;\s*border-right:\s*0;\s*border-radius:\s*0;/,
    );
    expect(probeHtml).toContain('id="mobile-landscape-controls-toggle"');
    expect(probeHtml).toContain('class="mobile-landscape-panel"');
    expect(probeHtml).toMatch(
      /class="mobile-landscape-panel"[\s\S]*class="controls"[\s\S]*class="snapshot-controls"[\s\S]*<div id="source-pill"/,
    );
    expect(probeHtml).toContain(
      "@media (orientation: landscape) and (max-width: 960px)",
    );
    expect(probeHtml).toContain(
      ".eyebrow, h1, .card > p:first-of-type { display: none; }",
    );
    expect(probeHtml).toContain("background: rgba(0, 0, 0, .78);");
    expect(probeHtml).toContain("transform: translate(-50%, calc(-50% + 12px));");
    expect(probeHtml).toContain(
      "@media (orientation: portrait) and (max-width: 680px)",
    );
    expect(probeHtml).toContain(
      "padding-top: max(4px, env(safe-area-inset-top));",
    );
    expect(probeHtml).toContain(".mobile-landscape-panel { display: none; }");
    expect(probeHtml).toContain('[data-landscape-controls="open"] .mobile-landscape-panel');
    expect(probeScript).toContain("mobileLandscapeToggle.addEventListener(\"click\"");
    expect(probeScript).toContain("window.matchMedia(");
    expect(probeScript).toContain(
      '"(orientation: landscape) and (max-width: 960px)"',
    );
    expect(probeScript).toContain("canvasFrame.getBoundingClientRect()");
    expect(probeScript).toContain("mobileLandscapePanel.style.setProperty");
    expect(probeScript).toContain(
      "window.addEventListener(\"resize\", refreshMobileLandscapeControls)",
    );
    expect(probeScript).toContain("card.dataset.landscapeControls");
  });
});
