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

  const probeApp = async () => {
    try {
      const res = await fetch('/', { cache: 'no-store' });
      const body = await res.text();
      if (!body.includes('<meta name="n-apt-dev-status" content="prelude"/>')) {
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
