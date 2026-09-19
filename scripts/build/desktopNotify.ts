import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type DesktopNotificationOptions = {
  title: string;
  message: string;
  icon?: string;
  open?: string;
};

const OSASCRIPT_BINARY = '/usr/bin/osascript';

export function toAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveOnPath(binary: string): string | null {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, binary);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function spawnDetached(
  binary: string,
  args: string[],
  onFailure?: () => void
): void {
  let child: ChildProcess;
  try {
    child = spawn(binary, args, { stdio: 'ignore', detached: true });
  } catch {
    onFailure?.();
    return;
  }
  child.on('error', () => onFailure?.());
  child.unref();
}

function notifyWithOsascript({
  title,
  message
}: DesktopNotificationOptions): void {
  const script = `display notification ${toAppleScriptString(message)} with title ${toAppleScriptString(title)}`;
  spawnDetached(OSASCRIPT_BINARY, ['-e', script]);
}

// terminal-notifier stays the richest backend (app icon, sound, click-to-open)
// but node-notifier vendored an x86_64-only copy of it, which stops launching
// once Rosetta is gone. Prefer a native build from PATH, and otherwise defer to
// the banner macOS ships with.
let terminalNotifierBroken = false;

function notifyWithTerminalNotifier(
  binary: string,
  options: DesktopNotificationOptions
): void {
  const { title, message, icon, open } = options;
  const args = ['-title', title, '-message', message];
  if (icon) args.push('-appIcon', icon);
  if (open) args.push('-open', open);

  spawnDetached(binary, args, () => {
    terminalNotifierBroken = true;
    notifyWithOsascript(options);
  });
}

function notifyWithNotifySend(
  binary: string,
  { title, message, icon }: DesktopNotificationOptions
): void {
  const args: string[] = [];
  if (icon) args.push('-i', icon);
  args.push(title, message);
  spawnDetached(binary, args);
}

export function notify(options: DesktopNotificationOptions): void {
  if (process.platform === 'darwin') {
    const terminalNotifier = terminalNotifierBroken
      ? null
      : resolveOnPath('terminal-notifier');
    if (terminalNotifier) {
      notifyWithTerminalNotifier(terminalNotifier, options);
      return;
    }
    notifyWithOsascript(options);
    return;
  }

  if (process.platform === 'linux') {
    const notifySend = resolveOnPath('notify-send');
    if (notifySend) notifyWithNotifySend(notifySend, options);
  }
}
