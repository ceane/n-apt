import fs from "node:fs";
import http from "node:http";
import { THEME_TOKENS } from "@n-apt/consts/theme";

export interface DevStatusServerOptions {
  port?: number;
  statusPath?: string;
}

export interface DevStatusServerHandle {
  port: number;
  close(): Promise<void>;
}

const STATUS_MARKER = '<meta name="n-apt-dev-status" content="prelude"/>';

const statusPalette = (mode: "dark" | "light") => {
  const c = THEME_TOKENS.colors[mode];
  return {
    background: c.background,
    surface: c.surface,
    border: mode === "dark" ? c.canvasBorder : c.border,
    textPrimary: c.textPrimary,
    textSecondary: c.textSecondary,
    textMuted: c.textMuted,
    primary: c.primary,
    running: c.warning,
    success: c.success,
    error: c.danger,
  };
};

const PAGE_PALETTES_JSON = JSON.stringify({
  dark: statusPalette("dark"),
  light: statusPalette("light"),
});

const STATUS_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
${STATUS_MARKER}
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>N-APT — building…</title>
<script id="napt-palettes" type="application/json">${PAGE_PALETTES_JSON}</script>
<style>
  :root, :root[data-theme="dark"] {
    --napt-bg: ${statusPalette("dark").background};
    --napt-surface: ${statusPalette("dark").surface};
    --napt-border: ${statusPalette("dark").border};
    --napt-text: ${statusPalette("dark").textPrimary};
    --napt-text-secondary: ${statusPalette("dark").textSecondary};
    --napt-muted: ${statusPalette("dark").textMuted};
    --napt-primary: ${statusPalette("dark").primary};
    --napt-running: ${statusPalette("dark").running};
    --napt-success: ${statusPalette("dark").success};
    --napt-error: ${statusPalette("dark").error};
    color-scheme: dark;
  }
  :root[data-theme="light"] {
    --napt-bg: ${statusPalette("light").background};
    --napt-surface: ${statusPalette("light").surface};
    --napt-border: ${statusPalette("light").border};
    --napt-text: ${statusPalette("light").textPrimary};
    --napt-text-secondary: ${statusPalette("light").textSecondary};
    --napt-muted: ${statusPalette("light").textMuted};
    --napt-primary: ${statusPalette("light").primary};
    --napt-running: ${statusPalette("light").running};
    --napt-success: ${statusPalette("light").success};
    --napt-error: ${statusPalette("light").error};
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--napt-bg); color: var(--napt-text);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 14px; line-height: 1.5;
  }
  .panel { width: min(680px, 92vw); padding: 32px 36px; background: var(--napt-surface);
           border: 1px solid var(--napt-border); border-radius: 10px; }
  .logo {
    display: block; width: 44px; height: 44px; object-fit: contain;
    margin-bottom: 14px;
    mix-blend-mode: darken;
  }
  :root[data-theme="dark"] .logo { filter: invert(1); mix-blend-mode: screen; }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
       color: var(--napt-primary); margin: 0 0 4px; }
  .sub { color: var(--napt-muted); margin-bottom: 22px; }
  .elapsed { color: var(--napt-success); }
  ol { list-style: none; margin: 0; padding: 0; }
  li { display: flex; gap: 10px; padding: 3px 0; align-items: baseline; }
  li .icon { width: 1.2em; flex: none; text-align: center; }
  li.pending { color: var(--napt-muted); }
  li.running { color: var(--napt-running); }
  li.success { color: var(--napt-success); }
  li.warning { color: var(--napt-running); }
  li.error { color: var(--napt-error); }
  .logs {
    margin-top: 20px; border-top: 1px solid var(--napt-border); padding-top: 12px;
    max-height: 220px; overflow-y: auto;
  }
  .logs div { white-space: pre-wrap; word-break: break-word; color: var(--napt-muted); font-size: 12px; }
  .errors { margin-top: 14px; }
  .errors div { color: var(--napt-error); font-size: 12px; white-space: pre-wrap; }
  .spinner { display: inline-block; animation: blink 1s steps(4) infinite; }
  @keyframes blink { 50% { opacity: 0.25; } }
</style>
</head>
<body>
<div class="panel">
  <img class="logo" src="/__dev_logo" alt="N-APT"/>
  <h1>N-APT <span class="spinner">▋</span></h1>
  <div class="sub">Preparing development environment — <span class="elapsed" id="elapsed">0s</span></div>
  <ol id="steps"></ol>
  <div class="errors" id="errors"></div>
  <div class="logs" id="logs"></div>
</div>
<script>
(() => {
  const PALETTES = JSON.parse(document.getElementById('napt-palettes').textContent);

  const resolveMode = () => {
    try {
      const raw = localStorage.getItem('napt-theme-storage');
      if (raw) {
        const appMode = (JSON.parse(raw) || {}).appMode;
        if (appMode === 'dark' || appMode === 'light') return appMode;
      }
    } catch {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light' : 'dark';
  };

  const applyTheme = () => {
    document.documentElement.dataset.theme = resolveMode();
  };
  applyTheme();

  const ICONS = { pending: '○', running: '◐', success: '✓', warning: '▲', error: '✗' };
  const stepsEl = document.getElementById('steps');
  const logsEl = document.getElementById('logs');
  const errorsEl = document.getElementById('errors');
  const elapsedEl = document.getElementById('elapsed');
  let startedAt = null;

  const fmtElapsed = () => {
    if (!startedAt) return;
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    elapsedEl.textContent = s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's';
  };
  setInterval(fmtElapsed, 1000);

  const render = (data) => {
    if (Array.isArray(data.steps)) {
      stepsEl.innerHTML = '';
      for (const step of data.steps) {
        const li = document.createElement('li');
        li.className = step.status || 'pending';
        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = ICONS[step.status] || '○';
        const label = document.createElement('span');
        label.textContent = step.name + (step.message ? ' — ' + step.message : '');
        li.append(icon, label);
        stepsEl.append(li);
      }
    }
    if (typeof data.buildStartedAt === 'number') {
      startedAt = data.buildStartedAt;
      fmtElapsed();
    }
    const lines = Array.isArray(data.recentLines) ? data.recentLines : [];
    logsEl.innerHTML = '';
    for (const line of lines.slice(-12)) {
      const div = document.createElement('div');
      div.textContent = line;
      logsEl.append(div);
    }
    const errCount = typeof data.errorCount === 'number' ? data.errorCount : 0;
    const warnCount = typeof data.warningCount === 'number' ? data.warningCount : 0;
    errorsEl.innerHTML = '';
    if (errCount > 0 || warnCount > 0) {
      const div = document.createElement('div');
      div.textContent = [errCount ? errCount + ' error(s)' : '', warnCount ? warnCount + ' warning(s)' : '']
        .filter(Boolean).join(', ');
      errorsEl.append(div);
    }
  };

  let handoffDetected = false;

  const probeApp = async () => {
    try {
      const res = await fetch('/', { cache: 'no-store' });
      const body = await res.text();
      if (!body.includes('${STATUS_MARKER}')) {
        location.reload();
        return;
      }
    } catch {}
    setTimeout(probeApp, 400);
  };

  const pollStatus = async () => {
    try {
      const res = await fetch('/__build_status', { cache: 'no-store' });
      render(await res.json());
    } catch {
      probeApp();
      return;
    }
    setTimeout(pollStatus, 700);
  };

  pollStatus();
})();
</script>
</body>
</html>`;

const LOGO_SVG_PATH = "public/images/icon.svg";

const sendHtml = (res: http.ServerResponse): void => {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(STATUS_PAGE_HTML);
};

const sendLogo = (res: http.ServerResponse): void => {
  try {
    const svg = fs.readFileSync(LOGO_SVG_PATH);
    res.writeHead(200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    });
    res.end(svg);
  } catch {
    res.writeHead(404);
    res.end();
  }
};

export function startDevStatusServer(
  options: DevStatusServerOptions = {},
): Promise<DevStatusServerHandle | null> {
  const port = options.port ?? 5173;
  const statusPath = options.statusPath ?? ".rebuild_status.json";

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url?.split("?")[0] ?? "/";
      if (url === "/__build_status") {
        try {
          const raw = fs.readFileSync(statusPath, "utf8");
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(raw);
        } catch {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end("{}");
        }
        return;
      }
      if (url === "/__dev_logo") {
        sendLogo(res);
        return;
      }
      sendHtml(res);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.warn(
          `[dev-status] Port ${port} already in use — skipping pre-Vite status page.`,
        );
      } else {
        console.warn(`[dev-status] Server error: ${error.message}`);
      }
      resolve(null);
    });

    server.listen(port, "127.0.0.1", () => {
      console.log(
        `[dev-status] Build progress available at http://localhost:${port}`,
      );
      resolve({
        port,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
            server.closeIdleConnections?.();
            setTimeout(resolveClose, 1500).unref();
          }),
      });
    });
  });
}
