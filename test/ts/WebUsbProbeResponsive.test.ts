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
    expect(probeHtml).toContain(".snapshot-controls { width: 100%; min-width: 0; flex: 0 0 auto; margin-top: 10px; }");
    expect(probeHtml).toContain(".snapshot-controls { margin-bottom: 12px; }");
    expect(probeHtml).toContain(".capture-control-row { display: flex; flex-wrap: wrap;");
    expect(probeHtml).toContain(
      ".capture-control-row { margin-top: 20px; margin-bottom: 14px; }",
    );
    expect(probeHtml).toContain(
      ".capture-control-row { flex-wrap: nowrap; }",
    );
    expect(probeHtml).toContain(
      ".capture-control-row > .snapshot-controls, .capture-control-row > .iq-capture-controls { flex: 1 1 0; min-width: 0; }",
    );
    expect(probeHtml).toContain(
      ".snapshot-pill, .iq-capture-pill { width: 100%; min-width: 0; }",
    );
    expect(probeHtml).toContain('<div class="capture-control-row">');
    expect(probeHtml).toContain('<div class="iq-capture-pill" data-state="unavailable">');
    expect(probeHtml).toContain('<svg aria-hidden="true" class="iq-capture-icon"');
    expect(probeHtml).toContain('<select id="iq-capture-format">');
    expect(probeHtml).toContain('<button id="iq-capture-toggle" type="button" disabled>Record</button>');
    expect(probeHtml).toContain('.iq-capture-pill[data-state="unavailable"]');
    expect(probeHtml).toContain(".snapshot-pill { min-width: 0; flex: 1 1 100%; }");
    expect(probeHtml).toContain(
      '.snapshot-pill[data-state="unavailable"] .snapshot-prefix { color: #52647b; }',
    );
    expect(probeHtml).toContain(
      '<div class="signal-options-title" aria-label="Signal Display and Source Options">',
    );
    expect(probeHtml).toContain(
      '<span>Signal Display and Source Options</span>',
    );
    expect(probeHtml).toContain(
      '<div class="napt-channel-nav" aria-label="See N-APT channels">',
    );
    expect(probeHtml).toContain(
      '<span class="napt-channel-title">See N-APT</span>',
    );
    expect(probeHtml).toContain(
      '<div id="napt-channel-buttons" class="napt-channel-buttons"></div>',
    );
    expect(probeHtml).toMatch(
      /class="signal-options-title"[\s\S]*class="controls"[\s\S]*class="napt-channel-nav"[\s\S]*class="snapshot-controls"/,
    );
    expect(probeHtml).toContain(
      '<svg aria-hidden="true" class="signal-options-icon" viewBox="0 0 24 24"',
    );
    expect(probeHtml).toContain(".snapshot-mode, .snapshot-stats-toggle { min-width: 0; overflow: hidden; text-overflow: ellipsis; }");
    expect(probeHtml).toContain(
      '<span class="snapshot-prefix">',
    );
    expect(probeHtml).toContain(
      '<svg aria-hidden="true" class="snapshot-icon" viewBox="0 0 24 24" width="14" height="14"',
    );
    expect(probeHtml).toContain("<span>Take a snapshot</span>");
    expect(probeHtml).toContain(
      '<span id="source-label" class="source-label">',
    );
    expect(probeHtml).toContain(
      '<svg aria-hidden="true" class="source-icon" viewBox="0 0 24 24" width="14" height="14"',
    );
    expect(probeHtml).toContain('<span>Source</span>');
    expect(probeHtml).toContain(
      '.source-label, .snapshot-prefix, .signal-options-title { color: #7188a5; font-family: inherit; letter-spacing: 1px; text-transform: uppercase; }',
    );
    expect(probeHtml).toContain(
      '.napt-channel-nav { display: flex; align-items: center; gap: 10px; order: 2;',
    );
    expect(probeHtml).toContain(
      '.mobile-landscape-panel .napt-channel-nav { order: 2; margin: 0 0 8px; }',
    );
    expect(probeHtml).toContain(
      '.compact-field-ppm { justify-self: start; width: calc(7ch + 24px); min-width: calc(7ch + 24px); }',
    );
    expect(probeHtml).toContain(
      '.controls { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: flex-start; }',
    );
    expect(probeHtml).toContain('.compact-control { min-width: 0; }');
    expect(probeHtml).toContain('.compact-control-fft { width: calc(7ch + 48px); }');
    expect(probeHtml).toContain('.compact-control-gain { width: calc(7ch + 48px); }');
    expect(probeHtml).toContain('.compact-control-ppm { width: calc(7ch + 24px); }');
    expect(probeHtml).toContain(
      '.controls { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin: 18px 0 12px; }',
    );
    expect(probeHtml).toContain('.controls > label:not(.compact-control) { grid-column: span 3; }');
    expect(probeHtml).toContain('.controls > .compact-control { grid-column: span 2; width: 100%; }');
    expect(probeHtml).toContain(
      '.compact-field-gain { justify-self: start; width: calc(7ch + 48px); min-width: calc(7ch + 48px); }',
    );
    expect(probeHtml).toContain(
      '.compact-field-fft { justify-self: start; width: calc(7ch + 48px); min-width: calc(7ch + 48px); }',
    );
    expect(probeHtml).toContain('<label class="compact-control compact-control-fft">FFT size<select id="fft-size" class="compact-field-fft">');
    expect(probeHtml).toContain('<label class="compact-control compact-control-gain">Gain<span class="gain-field"><input id="gain-db" class="compact-field-gain"');
    expect(probeHtml).toContain('<span class="gain-unit" aria-hidden="true">dB</span></span></label>');
    expect(probeHtml).toContain('<label class="compact-control compact-control-ppm">PPM<input id="ppm" class="compact-field-ppm"');
    expect(probeScript).toContain("let snapshotGeolocationUnavailable = false;");
    expect(probeScript).toContain(
      '"Stats: On (no geolocation / denied)"',
    );
    expect(probeScript).toContain(
      "snapshotGeolocationUnavailable = true;",
    );
    expect(probeHtml).toContain('.snapshot-status:empty { display: none; }');
    expect(probeHtml).toContain('.snapshot-status { display: none; }');
    expect(probeHtml).toMatch(/\.source-pill\s*\{[^}]*overflow:\s*visible/);
    expect(probeHtml).toContain("@media (max-width: 420px)");
    expect(probeHtml).toContain(".eyebrow, h1, .card > p:first-of-type { display: none; }");
    expect(probeHtml).toContain(".card { height: 100%; min-height: 0; display: flex;");
    expect(probeHtml).toContain(".controls { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr));");
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
      '.mobile-landscape-panel .controls, .mobile-landscape-panel .snapshot-controls, .mobile-landscape-panel .snapshot-status',
    );
    expect(probeHtml).toContain(
      "@media (orientation: landscape) and (max-width: 960px)",
    );
    expect(probeHtml).toContain(
      ".mobile-landscape-panel .signal-options-title { order: 0; margin: 0 0 8px; }",
    );
    expect(probeHtml).toContain(
      ".eyebrow, h1, .card > p:first-of-type { display: none; }",
    );
    expect(probeHtml).toContain("background: rgba(12, 27, 46, .5);");
    expect(probeHtml).toContain(
      '.card[data-landscape-controls="open"]::after { content: ""; position: absolute; inset: 0; z-index: 9; background: rgba(0, 0, 0, .5); backdrop-filter: blur(2px); pointer-events: none; }',
    );
    expect(probeHtml).toContain("backdrop-filter: blur(2px);");
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
    expect(probeScript).toContain(
      'snapshotPill.dataset.state = available ? "ready" : "unavailable"',
    );
    expect(probeScript).toMatch(
      /const MOBILE_FIRST_VISIT_NOTICE_KEY =\s*"n-apt\.webusb-probe\.mobile-notice-seen"/,
    );
    expect(probeScript).toContain("window.localStorage.getItem");
    expect(probeScript).toContain("window.localStorage.setItem");
    expect(probeScript).toContain("window.alert");
    expect(probeScript).toContain("Android|iPhone|iPad|iPod");
    expect(probeScript).toContain('from "./naptChannels"');
    expect(probeScript).toContain('from "@n-apt/capture/snapshotLocation"');
    expect(probeScript).toContain("reverseGeocodeSnapshotLocation");
    expect(probeScript).toContain("let snapshotLocationLabel");
    expect(probeScript).toContain("locationLabel: snapshotMode === 2 ? snapshotLocationLabel : null");
    expect(probeScript).toContain("parseCanonicalNaptChannels(signalsYaml)");
    expect(probeScript).toContain("naptChannelButtons.replaceChildren");
    expect(probeScript).toContain("centerFrequencyInput.value");
    expect(probeScript).toContain('centerFrequencyInput.addEventListener("keydown"');
    expect(probeScript).toContain("getFrequencyArrowStepHz");
    expect(probeScript).toContain("dispatchDeviceOptionsImmediately");
    expect(probeScript).toContain('new IqCaptureRecorder');
    expect(probeScript).toContain('supportsEncryptedNapt');
    expect(probeHtml).toContain('id="iq-capture-passphrase"');
    expect(probeScript).toContain('iqCapturePassphrase.value');
    expect(probeScript).not.toContain('window.prompt(');
    expect(probeScript).toContain('iqCaptureRecorder?.appendFrame');
    expect(probeScript).toContain('iqCaptureRecorder?.updateOptions');
    expect(probeScript).toContain('recording ? "Stop & Save" : "Record"');
    expect(probeScript).toContain('if (message) setStatus(message, isError);');
  });
});
