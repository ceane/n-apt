import dotenv from 'dotenv';
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --no-deprecation`.trim();
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { render } from 'ink';
import { Box, Static, Text, useAnimation, useApp, useInput } from 'ink';
import { spawn, spawnSync } from 'child_process';
import net from 'node:net';
import os from 'node:os';
import chalk from 'chalk';
import notifier from 'node-notifier';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getDeviceAwareRuntimeSummaryState,
  getRuntimeSummaryState,
  isRuntimeRecoverySignal,
  markPendingProcessesAfterFailure,
  type FailingServices
} from './buildStatus';
import {
  createRustHotReloadGate,
  canKeepRustHotReloadWatcherAttached,
  getRustHotReloadProcessLabel,
  getRustHotReloadRuntimeLabel,
  getRustHotReloadStepLabel,
  isProcessSpinnerActive,
  RUST_HOT_RELOAD_MAX_COALESCE_MS,
  RUST_HOT_RELOAD_QUIET_MS,
  runRustHotReloadValidation,
  type RustHotReloadPhase,
} from './rustHotReloadGate';
import { acquireBuildOrchestratorLock } from './buildOrchestratorLock';
import { writeBackendTarget } from './backend-handoff-proxy';
import { removeActiveChild } from './processLifecycle';
import { isRustSourceChange } from './rustWatchFilter';
import { getCompletedStepLabel } from './buildStepLabels';
import { waitForViteReady } from './waitForViteReady';
import {
  isRebuildStatusStale,
  formatCargoBuildHeartbeat,
  mergeRebuildRecentLines,
  RUST_HOT_RELOAD_BUILD_STALE_MS,
  summarizeCargoProgressChunk,
  type RebuildStatusPayload,
  type RebuildStatusStep,
} from './cargoBuildProgress';
import { startDevStatusServer, type DevStatusServerHandle } from './devStatusServer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
const hasInteractiveTty = Boolean(isMainModule && process.stdin.isTTY && process.stdout.isTTY);
const backendProxyPort = 8765;
const backendInitialPort = 8766;
const backendTargetFile = path.resolve('.n-apt-backend-target.json');

const findAvailableTcpPort = async (startingPort: number): Promise<number> => {
  for (let port = startingPort; port <= 65535; port += 1) {
    const available = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => {
        probe.close(() => resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error('No available local TCP port for Rust backend handoff');
};

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });

const getFailingServices = (errorDetails: string[]): FailingServices[] => {
  const failing: FailingServices[] = [];
  const errorText = errorDetails.join(' ').toLowerCase();

  if (errorText.includes('vite') || errorText.includes('dev server') || errorText.includes('frontend')) {
    if (!failing.includes('Vite')) failing.push('Vite');
  }
  if (errorText.includes('rust') || errorText.includes('cargo') || errorText.includes('backend') || errorText.includes('n-apt-backend')) {
    if (!failing.includes('Rust')) failing.push('Rust');
  }
  if (errorText.includes('redis')) {
    if (!failing.includes('Redis')) failing.push('Redis');
  }
  if (errorText.includes('wasm') || errorText.includes('webassembly')) {
    if (!failing.includes('WebAssembly')) failing.push('WebAssembly');
  }

  return failing;
};

const pruneIncrementalCache = (addLog?: (msg: string) => void) => {
  for (const profile of ['dev-fast', 'debug']) {
    const incDir = path.resolve(`target/${profile}/incremental`);
    if (!fs.existsSync(incDir)) continue;
    try {
      const subdirs = fs.readdirSync(incDir)
        .map(name => {
          const fullPath = path.join(incDir, name);
          const stat = fs.statSync(fullPath);
          return { name, fullPath, mtime: stat.mtimeMs };
        })
        .filter(item => {
          try {
            return fs.statSync(item.fullPath).isDirectory();
          } catch {
            return false;
          }
        });

      subdirs.sort((a, b) => b.mtime - a.mtime);

      if (subdirs.length > 5) {
        const toDelete = subdirs.slice(5);
        for (const item of toDelete) {
          fs.rmSync(item.fullPath, { recursive: true, force: true });
        }
        if (addLog) {
          addLog(`Pruned ${toDelete.length} old incremental folders in target/${profile} to free disk space.`);
        }
      }
    } catch (err: any) {
      if (addLog) {
        addLog(`Failed to prune target/${profile}/incremental cache: ${err.message}`);
      }
    }
  }
};

const rustBackendFeatureArgs =
  process.platform === 'darwin' ? '--features mock_apt_metal' : '';
const launchedChildren = new Set<ReturnType<typeof spawn>>();

const trackLaunchedChild = (child: ReturnType<typeof spawn>) => {
  launchedChildren.add(child);
  const forget = () => launchedChildren.delete(child);
  child.once('exit', forget);
  child.once('error', forget);
  return child;
};

const terminateLaunchedChildren = () => {
  void closeDevStatusServer();
  for (const child of Array.from(launchedChildren)) {
    try {
      if (child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
  }
  launchedChildren.clear();
};

const terminateKnownDevProcesses = () => {
  // The singleton lock makes this orchestrator the owner of its children.
  // Do not use broad process-name matching here: during takeover, the old
  // orchestrator can still be shutting down while the new one is starting.
  terminateLaunchedChildren();
};

let devStatusServerPromise: Promise<DevStatusServerHandle | null> | null = null;

const ensureDevStatusServer = (): Promise<DevStatusServerHandle | null> => {
  if (!devStatusServerPromise) {
    devStatusServerPromise = startDevStatusServer();
  }
  return devStatusServerPromise;
};

const closeDevStatusServer = async (): Promise<void> => {
  const handlePromise = devStatusServerPromise;
  devStatusServerPromise = null;
  if (!handlePromise) return;
  const handle = await handlePromise.catch(() => null);
  if (handle) {
    await handle.close();
  }
};

// Types
interface ProcessStatus {
  name: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'error';
  message?: string;
  label?: string;
  pid?: number;
  buildOutput?: string[];
}

interface BuildState {
  processes: ProcessStatus[];
  currentStep: number;
  isBuilding: boolean;
  errorCount: number;
  startTime: number;
  vitePid?: number;
  rustPid?: number;
  redisPid?: number;
  proxyPid?: number;
  rustCandidatePid?: number;
  warningCount: number;
  errorDetails: string[];
  warningDetails: string[];
  activeBuildOutputStep?: number;
}

type BackgroundCommand =
  | string
  | {
      executable: string;
      args: string[];
      label?: string;
      env?: NodeJS.ProcessEnv;
    };

const describeBackgroundCommand = (command: BackgroundCommand) =>
  typeof command === 'string'
    ? command
    : [command.executable, ...command.args].join(' ');

// Simple spinner animation
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const useSpinnerFrame = (isActive: boolean) => {
  const { frame } = useAnimation({
    interval: 100,
    isActive,
  });

  return spinnerFrames[frame % spinnerFrames.length];
};

const SpinnerText = ({ isActive = true }: { isActive?: boolean }) => {
  const spinner = useSpinnerFrame(isActive);

  return <Text color="blue">{spinner}</Text>;
};

const accentColors = {
  vite: '#8B71D9',
  rust: '#E59450',
  redis: '#931E16',
  wasm: '#AFA4FF',
};

const processSuffixes: Record<string, { text: string; color: string }> = {
  'Starting frontend server': { text: ' Vite.', color: accentColors.vite },
  'Starting Redis database server': { text: ' Redis.', color: accentColors.redis },
  'Swapping Redis Database': { text: ' Redis.', color: accentColors.redis },
  'Building WASM SIMD module': { text: ' WASM.', color: accentColors.wasm },
  'Building N-APT Encrypted Modules': { text: ' AES.', color: accentColors.rust },
  'Building and starting Rust backend': { text: ' Rust.', color: accentColors.rust },
};

const encryptedModulesStatus = {
  pending: 'N-APT Encrypted Modules...',
  warning: '⚠ N-APT Encrypted Modules not available',
  success: '✔ N-APT Encrypted Modules Built',
  error: '✗ Build error with N-APT Encrypted Modules',
};

const isWindows = process.platform === 'win32';
const isWsl = process.platform === 'linux' && (
  Boolean(process.env.WSL_DISTRO_NAME) ||
  os.release().toLowerCase().includes('microsoft')
);
const isNativeWindows = isWindows && !isWsl;
const hotReloadRunsCargoCheck = process.env.NAPT_DEV_RUST_HOT_RELOAD_CHECK === '1';
const backgroundStartGraceMs = Number.parseInt(process.env.NAPT_DEV_BACKGROUND_GRACE_MS || '500', 10);
const stepSettleDelayMs = Number.parseInt(process.env.NAPT_DEV_STEP_DELAY_MS || '100', 10);
const viteReadyTimeoutMs = Number.parseInt(process.env.NAPT_VITE_READY_TIMEOUT_MS || '120000', 10);

const safeDelayMs = (value: number, fallback: number) =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

const withEllipsis = (label: string) => (label.endsWith('...') ? label : `${label}...`);

// Napt Logo Component
const NaptLogo = () => (
  <Box flexDirection="column" gap={0}>
    <Text color="white">┌─────┐</Text>
    <Text color="white">│ n a │</Text>
    <Text color="white">│ p t │</Text>
    <Text color="white">└─────┘</Text>
  </Box>
);

// Logo Component
const Logo = () => (
  <Box flexDirection="column" alignItems="flex-start">
    <NaptLogo />
    <Text color="gray">(c) 2026 🇺🇸 Made in the USA</Text>
    <Box marginTop={1} />
  </Box>
);

const staticHeaderItems = [{ id: 'header' }];

const StaticHeader = () => (
  <Box flexDirection="column">
    <Logo />

    <Box flexDirection="column" marginTop={1} alignItems="flex-start">
      <Text color="white" bold>N-APT / 📉 General purpose SDR visualizer and studio tailored for N-APT signals</Text>
      <Text color="white" bold italic>(The NSA's neurotechnology 🧠 via radio waves and telecommunications infrastructure)</Text>
      <Text color="white">Read more at https://github.com/ceane/n-apt</Text>
      <Text color="gray">Press 'q' or ESC to exit</Text>
    </Box>
  </Box>
);

// Process Step Component
const ProcessStep = ({ process, isActive, showOutput, onToggleOutput, hotReloadLabel, showLiveOutput }: {
  process: ProcessStatus;
  isActive: boolean;
  showOutput?: boolean;
  onToggleOutput?: () => void;
  hotReloadLabel?: string;
  showLiveOutput?: boolean;
}) => {
  const isHotReloading = Boolean(hotReloadLabel);
  const spinner = useSpinnerFrame(isHotReloading || isProcessSpinnerActive(process.status));
  const shouldShowOutput = Boolean(
    showLiveOutput
    || isActive
    || (showOutput && process.buildOutput && process.buildOutput.length > 0),
  );

  const getStatusIcon = () => {
    if (isHotReloading) return spinner;
    switch (process.status) {
      case 'pending': return '○';
      case 'running': return spinner;
      case 'success': return '✓';
      case 'warning': return '⚠';
      case 'error': return '✗';
      default: return '○';
    }
  };

  const getStatusText = () => {
    if (hotReloadLabel) return hotReloadLabel;
    switch (process.status) {
      case 'pending': return process.name;
      case 'running': return `${process.name}...`;
      case 'success': return process.name;
      case 'warning': return process.name;
      case 'error': return process.name;
      default: return process.name;
    }
  };

  const getStatusColor = () => {
    if (isHotReloading) return 'blue';
    switch (process.status) {
      case 'pending': return 'gray';
      case 'running': return 'blue';
      case 'success': return 'white';
      case 'warning': return 'yellow';
      case 'error': return 'white';
      default: return 'gray';
    }
  };

  const _processColor = process.name.toLowerCase().includes('rust') ? accentColors.rust
    : process.name.toLowerCase().includes('vite') || process.name.toLowerCase().includes('frontend') ? accentColors.vite
      : process.name.toLowerCase().includes('redis') ? accentColors.redis
        : process.name.toLowerCase().includes('wasm') ? accentColors.wasm
          : undefined;

  const isLongRunning = process.name.toLowerCase().includes('rust');
  const showProcessSuffix = !hotReloadLabel;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color={getStatusColor()}>{getStatusIcon()}</Text>
        </Box>
        <Text color={getStatusColor()}>
          {hotReloadLabel ?? process.label ?? getStatusText()}
        </Text>
        <Text>
          {process.name === 'Swapping Redis Database' && showProcessSuffix ? (
            <Text color={accentColors.redis}> Redis.</Text>
          ) : processSuffixes[process.name] && showProcessSuffix && !hotReloadLabel && !process.label?.startsWith('[HOT-RELOAD]') && !process.label?.startsWith('Restarting Rust') && !process.label?.startsWith('✓ Updated') && (
            <Text color={processSuffixes[process.name].color}>{processSuffixes[process.name].text}</Text>
          )}
          {process.message && process.name !== 'N-APT Encrypted Modules' && (
            <Text
              color={process.message.startsWith('⚠') ? 'yellow' : process.message.startsWith('✗') ? 'red' : process.message.startsWith('✔') ? 'green' : 'gray'}
            >
              {` ${process.message}`}
            </Text>
          )}
        </Text>
        {process.status === 'success' && isLongRunning && process.buildOutput && process.buildOutput.length > 0 && onToggleOutput && (
          <Text color="gray" bold> {showOutput ? '▼' : '▶'} </Text>
        )}
      </Box>
      {shouldShowOutput && process.buildOutput && process.buildOutput.length > 0 && (
        <Box flexDirection="column" marginLeft={4} marginTop={0}>
          {process.buildOutput.slice(-10).map((line, idx) => (
            <Text key={idx} color="gray" dim>{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

// Main Build Orchestrator Component
const BuildOrchestrator = () => {
  const { exit } = useApp();
  const shutdownRequestedRef = useRef(false);
  const hadServicesRef = useRef(false);
  const activeChildrenRef = useRef<Array<ReturnType<typeof spawn>>>([]);
  const buildStartedRef = useRef(false);
  const intentionalRustKillRef = useRef(false);
  const rustPidRef = useRef<number | undefined>(undefined);
  const rustCandidatePidRef = useRef<number | undefined>(undefined);
  const backendPortRef = useRef(backendInitialPort);
  const [rustHotReloadPhase, setRustHotReloadPhase] = useState<RustHotReloadPhase>('idle');
  const [rustHotReloadCount, setRustHotReloadCount] = useState(0);
  const hotReloadActiveRef = useRef(false);
  const hotReloadCancelledRef = useRef(false);
  const rebuildStatusRef = useRef<RebuildStatusPayload>({ rebuilding: false });

  const writeRebuildStatus = useCallback((patch: Partial<RebuildStatusPayload>) => {
    rebuildStatusRef.current = { ...rebuildStatusRef.current, ...patch };
    try {
      fs.writeFileSync('.rebuild_status.json', `${JSON.stringify(rebuildStatusRef.current)}\n`);
    } catch {
      // Best-effort status for the Vite /rebuild-status endpoint.
    }
  }, []);

  const [buildState, setBuildState] = useState<BuildState>({
    processes: [
      { name: 'Cleaning up existing processes', status: 'pending' },
      { name: 'Validating Rust backend code', status: 'pending' },
      { name: 'Validating signals.yaml (via backend config loader)', status: 'pending' },
      { name: 'Starting Redis database server', status: 'pending' },
      { name: 'Swapping Redis Database', status: 'pending' },
      { name: 'Building WASM SIMD module', status: 'pending' },
      { name: 'Building N-APT Encrypted Modules', status: 'pending' },
      { name: 'Building and starting Rust backend', status: 'pending' },
      { name: 'Starting frontend server', status: 'pending' },
    ],
    currentStep: 0,
    isBuilding: false,
    errorCount: 0,
    startTime: 0,
    vitePid: undefined,
    rustPid: undefined,
    redisPid: undefined,
    warningCount: 0,
    errorDetails: [],
    warningDetails: [],
    activeBuildOutputStep: undefined,
  });
  const [liveDeviceState, setLiveDeviceState] = useState<string | null>(null);
  const [completedRuntimeSeconds, setCompletedRuntimeSeconds] = useState<number | null>(null);
  const metalBackendStatusRef = useRef<string | null>(null);

  useEffect(() => {
    writeRebuildStatus({
      rebuilding: buildState.isBuilding,
      steps: buildState.processes.map((proc): RebuildStatusStep => ({
        name: proc.name,
        status: proc.status,
        message: proc.message,
      })),
      currentStep: buildState.currentStep,
      buildStartedAt: buildState.startTime || undefined,
      errorCount: buildState.errorCount,
      warningCount: buildState.warningCount,
    });
  }, [buildState, writeRebuildStatus]);

  const addLog = useCallback((_message: string) => {
    // Placeholder for future log streaming
  }, []);

  const appendErrorDetail = useCallback((message: string) => {
    const trimmed = message?.trim();
    if (!trimmed) return;
    setBuildState(prev => {
      const normalized = trimmed.startsWith('error:') ? trimmed : `error: ${trimmed}`;
      const errorDetails = [...prev.errorDetails, normalized].slice(-6);
      return { ...prev, errorDetails, errorCount: errorDetails.length };
    });
  }, []);

  const appendWarningDetail = useCallback((message: string) => {
    const trimmed = message?.trim();
    if (!trimmed) return;

    // Filter out common non-critical Redis warnings that clutter the dashboard
    const isRedisWarning = trimmed.includes('kern.ipc.somaxconn') || 
                          trimmed.includes('TCP backlog') ||
                          trimmed.includes('does not require authentication') ||
                          trimmed.includes('accept connections from any local client');
    
    if (isRedisWarning) return;

    setBuildState(prev => {
      const warningLines = trimmed
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^warning:/i.test(line));
      const detailsToAdd = warningLines.length > 0 ? warningLines : [trimmed];
      const warningDetails = [...prev.warningDetails, ...detailsToAdd].slice(-6);
      return { ...prev, warningDetails, warningCount: prev.warningCount + detailsToAdd.length };
    });
  }, []);

  const clearErrorDetails = useCallback((filter?: string) => {
    setBuildState(prev => {
      if (prev.errorDetails.length === 0) {
        return prev;
      }

      if (filter) {
        const lowerFilter = filter.toLowerCase();
        const filteredDetails = prev.errorDetails.filter(d => !d.toLowerCase().includes(lowerFilter));
        if (filteredDetails.length === prev.errorDetails.length) return prev;
        return {
          ...prev,
          errorDetails: filteredDetails,
          errorCount: filteredDetails.length
        };
      }

      return {
        ...prev,
        errorDetails: [],
        errorCount: 0
      };
    });
  }, []);

  const _setActiveBuildOutput = useCallback((stepIndex: number | undefined) => {
    setBuildState(prev => ({ ...prev, activeBuildOutputStep: stepIndex }));
  }, []);

  const appendBuildOutput = useCallback((stepIndex: number, line: string) => {
    const lines = line
      .split(/\r?\n/)
      .map(item => item.trim())
      .filter(item => item && !/^warning:/i.test(item));

    if (lines.length === 0) return;

    setBuildState(prev => {
      const processes = [...prev.processes];
      const process = { ...processes[stepIndex] };
      const buildOutput = process.buildOutput ? [...process.buildOutput, ...lines] : lines;
      process.buildOutput = buildOutput.slice(-50);
      processes[stepIndex] = process;
      return { ...prev, processes };
    });
  }, []);

  const updateProcessStatus = useCallback((index: number, status: ProcessStatus['status'], message?: string, label?: string, buildOutput?: string[]) => {
    setBuildState(prev => ({
      ...prev,
      processes: prev.processes.map((proc, i) => {
        if (i !== index) return proc;
        return {
          ...proc,
          status,
          message,
          label,
          ...(buildOutput !== undefined ? { buildOutput } : {}),
        };
      }),
    }));
  }, []);

  const requestShutdown = useCallback(() => {
    if (shutdownRequestedRef.current) {
      return;
    }

    shutdownRequestedRef.current = true;
    hotReloadCancelledRef.current = true;
    setBuildState(prev => ({
      ...prev,
      isBuilding: false,
      processes: prev.processes.map(proc => ({ ...proc, status: proc.status === 'pending' ? 'error' : proc.status })),
    }));

    for (const child of activeChildrenRef.current) {
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGTERM');
        }
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore kill errors during shutdown.
        }
      }
    }

    terminateKnownDevProcesses();

    activeChildrenRef.current = [];
    exit();
  }, [exit]);

  const executeCommand = useCallback((command: string, description: string): Promise<{ success: boolean; output: string }> => {
      return new Promise((resolve) => {
        try {
          addLog(chalk.blue(`Executing: ${command}`));
          const child = trackLaunchedChild(spawn(command, [], {
            shell: true,
            cwd: './',
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
          }));
  
          if (activeChildrenRef.current) {
            activeChildrenRef.current.push(child);
          }
          let stdout = '';
          let stderr = '';
          const MAX_OUTPUT_CHARS = 50000;
  
          child.stdout?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            if (stdout.length < MAX_OUTPUT_CHARS) {
              stdout += chunk.slice(0, MAX_OUTPUT_CHARS - stdout.length);
            } else {
              stdout = stdout.slice(-MAX_OUTPUT_CHARS / 2) + chunk.slice(-MAX_OUTPUT_CHARS / 2);
            }
            addLog(chunk.trim());
          });
  
          child.stderr?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            if (stderr.length < MAX_OUTPUT_CHARS) {
              stderr += chunk.slice(0, MAX_OUTPUT_CHARS - stderr.length);
            } else {
              stderr = stderr.slice(-MAX_OUTPUT_CHARS / 2) + chunk.slice(-MAX_OUTPUT_CHARS / 2);
            }
            addLog(chalk.red(chunk.trim()));
          });

        child.on('close', (code) => {
          activeChildrenRef.current = activeChildrenRef.current ? activeChildrenRef.current.filter((proc) => proc !== child) : [];
          if (shutdownRequestedRef.current) {
            resolve({ success: false, output: stdout });
            return;
          }

          if (code === 0) {
            if (stdout.trim()) {
              addLog(chalk.green(stdout.trim()));
            }
            addLog(chalk.green(`${description} completed successfully`));
            resolve({ success: true, output: stdout });
            return;
          }

          const errorMessage = stderr.trim() || stdout.trim() || `Command exited with code ${code ?? 'unknown'}`;
          addLog(chalk.red(`Error in ${description}: ${errorMessage}`));
          const summary = errorMessage.length > 200 ? `${errorMessage.slice(0, 197)}...` : errorMessage;
          appendErrorDetail(`${description}: ${summary}`);
          resolve({ success: false, output: stdout });
        });

        child.on('error', (error: any) => {
          activeChildrenRef.current = activeChildrenRef.current ? activeChildrenRef.current.filter((proc) => proc !== child) : [];
          addLog(chalk.red(`Error in ${description}: ${error.message}`));
          appendErrorDetail(`${description}: ${error.message}`);
          resolve({ success: false, output: '' });
        });

      } catch (error: any) {
        addLog(chalk.red(`Error in ${description}: ${error.message}`));
        appendErrorDetail(`${description}: ${error.message}`);
        resolve({ success: false, output: '' });
      }
    });
  }, [addLog, appendErrorDetail]);

    const executeForegroundCommand = useCallback((
      command: string,
      description: string,
      stepIndex: number,
      label?: string,
    ): Promise<{ success: boolean; output: string }> => {
      return new Promise((resolve) => {
        try {
          const processLabel = label
            ?? (hotReloadActiveRef.current
              ? '[HOT-RELOAD] Rebuilding Rust backend...'
              : 'Building and starting Rust backend');
          updateProcessStatus(stepIndex, 'running', undefined, processLabel);
          setBuildState(prev => ({ ...prev, activeBuildOutputStep: stepIndex }));
  
          addLog(chalk.blue(`Executing foreground: ${command}`));
          const child = trackLaunchedChild(spawn(command, [], {
            shell: true,
            cwd: './',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              // Keep cargo streaming useful status even when stdout is piped.
              CARGO_TERM_PROGRESS_WHEN: 'always',
              CARGO_TERM_PROGRESS_WIDTH: '80',
              CARGO_TERM_COLOR: 'never',
            },
          }));
  
          if (activeChildrenRef.current) {
            activeChildrenRef.current.push(child);
          }
          let stdout = '';
          let stderr = '';
          const MAX_OUTPUT_CHARS = 50000; // Cap captured output
          let lastCargoProgress = hotReloadActiveRef.current
            ? 'Compiling n-apt-backend crate'
            : processLabel;
          let lastCargoProgressAt = Date.now();
          const cargoHeartbeat = setInterval(() => {
            if (!hotReloadActiveRef.current || !lastCargoProgress.toLowerCase().includes('n-apt-backend')) return;
            const heartbeat = formatCargoBuildHeartbeat(lastCargoProgress, Date.now() - lastCargoProgressAt);
            updateProcessStatus(stepIndex, 'running', heartbeat, processLabel);
            writeRebuildStatus({ rebuilding: true, phase: 'building', progress: heartbeat });
          }, 10_000);

          const ingestChunk = (chunk: string, asError: boolean) => {
            if (!chunk.trim()) return;
            if (asError) {
              addLog(chalk.red(chunk.trim()));
            } else {
              addLog(chunk.trim());
            }
            if (/warning:/i.test(chunk)) {
              appendWarningDetail(chunk);
            }
            appendBuildOutput(stepIndex, chunk.trim());

            const progress = summarizeCargoProgressChunk(chunk);
            if (progress) {
              if (progress.toLowerCase().includes('n-apt-backend')) {
                lastCargoProgress = progress;
                lastCargoProgressAt = Date.now();
              }
              updateProcessStatus(stepIndex, 'running', progress, processLabel);
              if (hotReloadActiveRef.current || rebuildStatusRef.current.rebuilding) {
                writeRebuildStatus({
                  rebuilding: true,
                  phase: 'building',
                  progress,
                  recentLines: mergeRebuildRecentLines(
                    rebuildStatusRef.current.recentLines,
                    chunk,
                  ),
                });
              }
            } else if (hotReloadActiveRef.current || rebuildStatusRef.current.rebuilding) {
              writeRebuildStatus({
                rebuilding: true,
                phase: 'building',
                recentLines: mergeRebuildRecentLines(
                  rebuildStatusRef.current.recentLines,
                  chunk,
                ),
              });
            }
          };
  
          child.stdout?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            // Only keep tail of output to limit memory
            if (stdout.length < MAX_OUTPUT_CHARS) {
              stdout += chunk.slice(0, MAX_OUTPUT_CHARS - stdout.length);
            } else {
              stdout = stdout.slice(-MAX_OUTPUT_CHARS / 2) + chunk.slice(-MAX_OUTPUT_CHARS / 2);
            }
            ingestChunk(chunk, false);
          });
  
          child.stderr?.on('data', (data: Buffer) => {
            const chunk = data.toString();
            // Only keep tail of output to limit memory
            if (stderr.length < MAX_OUTPUT_CHARS) {
              stderr += chunk.slice(0, MAX_OUTPUT_CHARS - stderr.length);
            } else {
              stderr = stderr.slice(-MAX_OUTPUT_CHARS / 2) + chunk.slice(-MAX_OUTPUT_CHARS / 2);
            }
            ingestChunk(chunk, true);
          });

        child.on('close', (code) => {
          clearInterval(cargoHeartbeat);
          activeChildrenRef.current = activeChildrenRef.current ? activeChildrenRef.current.filter((proc) => proc !== child) : [];
          setBuildState(prev => ({ ...prev, activeBuildOutputStep: undefined }));

          if (shutdownRequestedRef.current) {
            resolve({ success: false, output: stdout });
            return;
          }

          if (code === 0) {
            if (stdout.trim()) {
              addLog(chalk.green(stdout.trim()));
            }
            addLog(chalk.green(`${description} completed successfully`));
            resolve({ success: true, output: stdout });
            return;
          }

          const errorMessage = stderr.trim() || stdout.trim() || `Command exited with code ${code ?? 'unknown'}`;
          addLog(chalk.red(`Error in ${description}: ${errorMessage}`));
          // If it's a compilation error, make it obvious
          let summary = errorMessage;
          if (errorMessage.toLowerCase().includes('error: could not compile') || errorMessage.toLowerCase().includes('error[')) {
            summary = 'Rust compilation FAILED. Check the build output above for details.';
          } else if (summary.length > 200) {
            summary = `${summary.slice(0, 197)}...`;
          }
          appendErrorDetail(`${description}: ${summary}`);
          resolve({ success: false, output: stdout });
        });

        child.on('error', (error: any) => {
          clearInterval(cargoHeartbeat);
          activeChildrenRef.current = activeChildrenRef.current ? activeChildrenRef.current.filter((proc) => proc !== child) : [];
          setBuildState(prev => ({ ...prev, activeBuildOutputStep: undefined }));
          addLog(chalk.red(`Error in ${description}: ${error.message}`));
          appendErrorDetail(`${description}: ${error.message}`);
          resolve({ success: false, output: '' });
        });

      } catch (error: any) {
        setBuildState(prev => ({ ...prev, activeBuildOutputStep: undefined }));
        addLog(chalk.red(`Error in ${description}: ${error.message}`));
        appendErrorDetail(`${description}: ${error.message}`);
        resolve({ success: false, output: '' });
      }
    });
  }, [addLog, appendErrorDetail, appendBuildOutput, updateProcessStatus, writeRebuildStatus]);

  const startBackgroundProcess = useCallback((command: BackgroundCommand, description: string, pidKey: 'vitePid' | 'rustPid' | 'redisPid' | 'proxyPid' | 'rustCandidatePid'): Promise<boolean> => {
    const displayCommand = describeBackgroundCommand(command);
    const isRustBackendBinary =
      pidKey === 'rustPid' &&
      typeof command === 'string' &&
      /(^|\/|\\)n-apt-backend(\.exe)?$/.test(command.trim());
    const executable = typeof command === 'string' ? command : command.executable;
    const args = typeof command === 'string' ? [] : command.args;
    const shouldUseShell = typeof command === 'string' && !isRustBackendBinary;
    return new Promise((resolve) => {
      try {
        if (pidKey === 'redisPid') {
          fs.mkdirSync('.redis_data', { recursive: true });
        }
        addLog(chalk.blue(`Starting background: ${displayCommand}`));
        const child = trackLaunchedChild(spawn(executable, args, {
          shell: shouldUseShell,
          stdio: 'pipe',
          detached: true,
          cwd: './', // Run from project root
          env: typeof command === 'string' ? process.env : { ...process.env, ...command.env },
        }));
        let resolved = false;
        let crashReported = false;
        const reportCrash = (reason: string) => {
          if (crashReported || shutdownRequestedRef.current) return;
          crashReported = true;
          addLog(chalk.red(`${description} stopped unexpectedly${reason ? ` (${reason})` : ''}`));
          appendErrorDetail(`${description} stopped unexpectedly${reason ? ` (${reason})` : ''}`);
          setBuildState(prev => ({
            ...prev,
            [pidKey]: undefined,
          }));
        };

        child.stdout?.on('data', (data: any) => {
          const output = data.toString().trim();
          addLog(chalk.blue(`[${description}] ${output}`));
          if (/warning:/i.test(output)) {
            appendWarningDetail(output);
          }
          if (pidKey === 'vitePid' && isRuntimeRecoverySignal(output)) {
            clearErrorDetails('Vite');
          }
        });

        child.stderr?.on('data', (data: any) => {
          const output = data.toString().trim();
          addLog(chalk.red(`[${description} ERROR] ${output}`));
          if (/warning:/i.test(output)) {
            appendWarningDetail(output);
          }
          const isViteRecovery = pidKey === 'vitePid' && isRuntimeRecoverySignal(output);
          if (isViteRecovery) {
            clearErrorDetails('Vite');
          } else if (/error/i.test(output)) {
            const isTransientProxyError = pidKey === 'vitePid' && (
              output.includes('http proxy error') ||
              output.includes('ECONNREFUSED') ||
              output.includes('ECONNRESET') ||
              output.includes('AggregateError')
            );
            if (!isTransientProxyError) {
              appendErrorDetail(output);
            }
          }
        });

        child.on('error', (error: any) => {
          removeActiveChild(activeChildrenRef.current, child);
          addLog(chalk.red(`Failed to start ${description}: ${error.message}`));
          appendErrorDetail(`${description}: ${error.message}`);
          resolved = true;
          resolve(false);
        });

        child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
          removeActiveChild(activeChildrenRef.current, child);
          const statusText =
            signal ? `signal ${signal}` : code !== null ? `exit code ${code}` : 'unknown exit';
          if (!resolved) {
            addLog(chalk.red(`${description} failed to start or died immediately (${statusText})`));
            appendErrorDetail(`${description} failed to start or died immediately (${statusText})`);
            resolved = true;
            resolve(false);
            return;
          }

          if (shutdownRequestedRef.current) {
            return;
          }

          if (pidKey === 'rustPid') {
            if (intentionalRustKillRef.current) {
              intentionalRustKillRef.current = false;
              return;
            }
            addLog(chalk.red(`[Watcher] Rust backend exited unexpectedly (${statusText}). Leaving it stopped.`));
            appendErrorDetail(`Rust backend exited unexpectedly (${statusText})`);
            setBuildState(prev => ({ ...prev, rustPid: undefined }));
            return;
          }

          if (code === 0 && !signal) {
            return;
          }

          reportCrash(statusText);
        });

        child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
          removeActiveChild(activeChildrenRef.current, child);
          if (shutdownRequestedRef.current) {
            return;
          }
          if (pidKey === 'rustPid') {
            return;
          }
          if (code === 0 && !signal) {
            return;
          }
          const statusText =
            signal ? `signal ${signal}` : code !== null ? `exit code ${code}` : 'unknown exit';
          reportCrash(statusText);
        });

        // Give it a moment to start and check if it stayed alive.
        setTimeout(() => {
          void (async () => {
            if (child.pid && child.exitCode === null) {
              addLog(chalk.green(`${description} started (PID: ${child.pid})`));
              if (pidKey === 'rustPid') rustPidRef.current = child.pid;
              if (pidKey === 'rustCandidatePid') rustCandidatePidRef.current = child.pid;
              // Guard against undefined ref
              if (activeChildrenRef.current) {
                activeChildrenRef.current.push(child);
              }

              if (pidKey === 'vitePid') {
                addLog(chalk.blue('Waiting for Vite HTTP readiness (dep optimize can block responses)...'));
                setBuildState(prev => ({
                  ...prev,
                  processes: prev.processes.map((proc) =>
                    proc.name === 'Starting frontend server'
                      ? {
                          ...proc,
                          status: 'running',
                          label: withEllipsis('Waiting for Vite HTTP readiness'),
                        }
                      : proc
                  ),
                }));
                const ready = await waitForViteReady({
                  timeoutMs: safeDelayMs(viteReadyTimeoutMs, 120000),
                  depsMetadataPath: path.resolve('node_modules/.vite/deps/_metadata.json'),
                  isCancelled: () => shutdownRequestedRef.current,
                });
                if (!ready.ok) {
                  addLog(chalk.red(`Vite readiness probe failed: ${ready.reason ?? 'unknown error'}`));
                  appendErrorDetail(`Vite readiness probe failed: ${ready.reason ?? 'unknown error'}`);
                  void ensureDevStatusServer();
                  resolved = true;
                  resolve(false);
                  return;
                }
                addLog(chalk.green(`Vite HTTP-ready after ${ready.elapsedMs}ms`));
              }

              // Record Vite PID only after HTTP readiness so "✓ Running" is not premature.
              setBuildState(prev => ({ ...prev, [pidKey]: child.pid }));
              resolved = true;
              resolve(true);
              return;
            }

            const exitMsg = child.exitCode !== null ? ` (exited with code ${child.exitCode})` : '';
            addLog(chalk.red(`${description} failed to start or died immediately${exitMsg}`));
            appendErrorDetail(`${description} failed to start or died immediately${exitMsg}`);
            resolved = true;
            resolve(false);
          })();
        }, safeDelayMs(backgroundStartGraceMs, 500));

      } catch (error: any) {
        addLog(chalk.red(`Error starting ${description}: ${error.message}`));
        appendErrorDetail(`${description}: ${error.message}`);
        resolved = true;
        resolve(false);
      }
    });
  }, [addLog, appendErrorDetail, appendWarningDetail, clearErrorDetails]);

  const logMetalBackendAvailability = useCallback(async (): Promise<string> => {
    if (process.platform !== 'darwin') {
      return '';
    }

    try {
      const response = await fetch('http://localhost:8765/status');
      if (!response.ok) {
        const message = `Metal preflight: unable to query backend status (${response.status})`;
        metalBackendStatusRef.current = message;
        addLog(chalk.yellow(message));
        return message;
      }

      const data = await response.json() as {
        device?: string;
        device_name?: string;
        device_backend_error?: string | null;
      };
      const backend = typeof data.device === 'string' ? data.device : '';
      const deviceName = typeof data.device_name === 'string' ? data.device_name : '';
      const deviceBackendError =
        typeof data.device_backend_error === 'string'
          ? data.device_backend_error.trim()
          : '';
      const metalActive =
        backend === 'mock_apt_metal' ||
        deviceName.toLowerCase().includes('(metal)');

      const message = metalActive
        ? `Metal preflight: available (${deviceName || 'Mock APT SDR (Metal)'})`
        : deviceBackendError
          ? `Metal preflight: unavailable, using CPU fallback (${deviceName || backend || 'Mock APT SDR'}) — ${deviceBackendError}`
          : `Metal preflight: unavailable, using CPU fallback (${deviceName || backend || 'Mock APT SDR'})`;
      metalBackendStatusRef.current = message;

      if (metalActive) {
        addLog(chalk.green(message));
      } else {
        addLog(chalk.yellow(message));
      }
      return message;
    } catch (error: any) {
      const message = `Metal preflight: unavailable (${error.message})`;
      metalBackendStatusRef.current = message;
      addLog(chalk.yellow(message));
      return message;
    }
  }, [addLog]);

    const executeCompositeRustStep = useCallback(async (stepIndex: number): Promise<boolean> => {
      setBuildState(prev => ({ ...prev, activeBuildOutputStep: stepIndex }));
  
      try {
        // Prune incremental cache to prevent garbage accumulation
        pruneIncrementalCache(addLog);

        // Build in the foreground so compiler output is visible, but start the
        // long-running backend as a detached child. Running `cargo run` here
        // keeps the orchestrator attached to server logs forever and causes the
        // Rust step to appear hung while state churn grows over time.
        addLog(chalk.blue('Building Rust backend binary...'));
        const buildResult = await executeForegroundCommand(
          `cargo build --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs}`.trim(),
          'Building Rust backend',
          stepIndex
        );
  
        if (!buildResult.success) {
          return false;
        }

        const backendPort = await findAvailableTcpPort(backendInitialPort);
        backendPortRef.current = backendPort;
        writeBackendTarget(backendTargetFile, { host: '127.0.0.1', port: backendPort });

        const proxyStartResult = await startBackgroundProcess(
          {
            executable: process.execPath,
            args: [
              '--import',
              'tsx',
              path.resolve('scripts/build/backend-handoff-proxy.ts'),
              '--port',
              String(backendProxyPort),
              '--target-file',
              backendTargetFile,
            ],
          },
          'Backend handoff proxy',
          'proxyPid',
        );
        if (!proxyStartResult) return false;

        addLog(chalk.blue('Starting Rust backend in background...'));
        const startCommand: BackgroundCommand = {
          executable: isNativeWindows
            ? path.resolve('target/dev-fast/n-apt-backend.exe')
            : path.resolve('target/dev-fast/n-apt-backend'),
          args: [],
          env: {
            WEBSOCKETS_URL: `http://127.0.0.1:${backendPort}`,
          },
        };
        const startResult = await startBackgroundProcess(
          startCommand,
          'Rust backend',
          'rustPid'
        );

        if (!startResult) {
          return false;
        }
  
        // Give the backend process a short moment before active readiness polling.
        await new Promise(resolve => setTimeout(resolve, safeDelayMs(backgroundStartGraceMs, 500)));
  
        // Wait for backend readiness
        addLog(chalk.blue(`Waiting for backend to be ready...`));
        const waitCommand = isNativeWindows
          ? 'echo Backend readiness check skipped on Windows'
          : `bash -lc '
set +e
MAX_RETRIES=30
RETRY_DELAY=1
RETRY_COUNT=0

echo "Checking backend health..."
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/status 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Backend ready!"
    exit 0
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  sleep $RETRY_DELAY
done
echo "Backend failed to respond after $MAX_RETRIES retries"
exit 1
'`;
  
        const waitResult = await executeCommand(waitCommand, 'Waiting for backend');
        if (!waitResult.success) {
          return false;
        }

        await logMetalBackendAvailability();

        addLog(chalk.green('Rust backend fully initialized and ready'));
        return true;
  
      } catch (error: any) {
        addLog(chalk.red(`Error in composite Rust step: ${error.message}`));
        appendErrorDetail(`Composite Rust backend setup failed: ${error.message}`);
        return false;
      } finally {
        setBuildState(prev => ({ ...prev, activeBuildOutputStep: undefined }));
      }
    }, [executeForegroundCommand, executeCommand, startBackgroundProcess, appendErrorDetail, logMetalBackendAvailability]);

  const runBuild = useCallback(async () => {
    try {
      writeRebuildStatus({ rebuilding: false, progress: undefined, recentLines: [], phase: undefined });
    } catch {}
    const buildStartTime = Date.now();
    setCompletedRuntimeSeconds(null);
    setBuildState(prev => ({
      ...prev,
      isBuilding: true,
      startTime: buildStartTime,
      errorCount: 0,
      warningCount: 0,
      errorDetails: [],
      warningDetails: [],
    }));
    
    // Check if services were already running before this build
    hadServicesRef.current = !!(buildState.vitePid || buildState.rustPid);

    const localOpenCellIdPath = process.env.LOCAL_OPENCELLID_CSV_DIR || 'data/opencellid';
    const redisPort = process.env.REDIS_PORT || '6379';
    const readRedisTowerCount = (db: string) => {
      const result = spawnSync('bash', ['-lc', `redis-cli -p ${redisPort} -n ${db} --raw keys 'tower:*' | wc -l`], { encoding: 'utf8' });
      if (result.status !== 0) return 0;
      const parsed = Number.parseInt((result.stdout || '').trim(), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const getTowerLoadDescription = () => {
      const homeDir = os.homedir();
      const localOpenCellIdPath = process.env.LOCAL_OPENCELLID_CSV_DIR || 'data/opencellid';
      const downloadsPath = path.join(homeDir, 'Downloads');
      const isForce = process.argv.includes('--force');

      const fastCount = readRedisTowerCount('2');
      const wholeCount = readRedisTowerCount('3');
      const hasPersistentData = fastCount > 0 || wholeCount > 0;

      // If we have persistent data and NOT forcing a reload, we are restoring
      if (hasPersistentData && !isForce) {
        return 'Restoring OpenCellID tower database from disk...';
      }

      const hasLocalFiles = fs.existsSync(localOpenCellIdPath) && 
        fs.readdirSync(localOpenCellIdPath).some(f => f.startsWith('31') && f.endsWith('.csv'));
      
      const hasDownloadFiles = fs.existsSync(downloadsPath) && 
        fs.readdirSync(downloadsPath).some(f => f.startsWith('31') && f.endsWith('.csv'));

      if (hasLocalFiles) {
        return `Loading local OpenCellID data from ${localOpenCellIdPath}...`;
      }

      if (hasDownloadFiles) {
        return `Loading OpenCellID data from Downloads folder...`;
      }

      return hasPersistentData
        ? 'Swapping Redis Database...'
        : 'Downloading OpenCellID data and loading it into Redis...';
    };

    const getTowerCountLabel = (stepLabel: string) => {
      const fastCount = readRedisTowerCount('2');
      const fastStr = fastCount.toLocaleString();

      return {
        message: `(${fastStr} towers in DB / Fast DB)`,
        label: stepLabel
      };
    };

    const steps = [
      {
        index: 0,
        command: isNativeWindows ? 'echo Windows cleanup is skipped; use manual process cleanup if needed.' : `
# Kill by name without matching this cleanup shell itself.
pkill -9 -f '[n]-apt-backend' || true
pkill -9 -f '[r]edis-server' || true

# Small settling delay.
sleep 0.5
`,
        description: 'Cleaning up existing processes',
        isBackground: false,
        pidKey: undefined,
      },
      {
          index: 1,
          command: isNativeWindows
            ? 'echo Config validation not supported on Windows; skipping.'
            : `
  set -euo pipefail
  if [ ! -f ".env.local" ]; then
    echo "Error: .env.local missing. Run npm run setup."
    exit 1
  fi
  if ! grep -q '^UNSAFE_LOCAL_USER_PASSWORD=' ".env.local"; then
    echo "Error: UNSAFE_LOCAL_USER_PASSWORD missing from .env.local. Run npm run setup."
    exit 1
  fi
  echo "[Rust] Running cargo check before config validation..."
  cargo check --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs} 2>&1
  `,
          description: 'Validating Rust backend code',
          isBackground: false,
          pidKey: undefined,
        },
        {
          index: 2,
          command: isNativeWindows
            ? 'echo Config validation not supported on Windows; skipping.'
            : `
  set -euo pipefail
  echo "[Config] Loading signals.yaml through the Rust backend (--validate-config)..."
  if [ -f "./target/dev-fast/n-apt-backend" ] && [ -z "${rustBackendFeatureArgs}" ]; then
    ./target/dev-fast/n-apt-backend --validate-config 2>&1
  else
    echo "[Config] Backend binary unavailable; cargo may compile Rust before config validation."
    cargo run --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs} -- --validate-config 2>&1
  fi
  `,
          description: 'Validating signals.yaml (via backend config loader)',
          isBackground: false,
          pidKey: undefined,
        },
      {
        index: 3,
        command: {
          executable: 'redis-server',
          args: [
            '--port',
            '6379',
            '--dir',
            '.redis_data',
            '--daemonize',
            'no',
            '--appendonly',
            'yes',
            '--save',
            '60',
            '1',
            '--dbfilename',
            'dump.rdb',
          ],
        },
        description: 'Starting Redis database server',
        isBackground: true,
        pidKey: 'redisPid' as const,
      },
      {
        index: 4,
        command: process.env.NAPT_CLI_STARTED === '1'
          ? 'echo CLI startup: skipping optional Redis tower swap.'
          : isNativeWindows ? 'echo Redis tower swap requires bash/redis-cli on non-Windows environments.' : `
set -euo pipefail
REDIS_PORT="${'${'}REDIS_PORT:-6379}"
if ! [[ "$REDIS_PORT" =~ ^[0-9]+$ ]] || [ "$REDIS_PORT" -le 0 ] || [ "$REDIS_PORT" -gt 65535 ]; then
  REDIS_PORT=6379
fi
if [ ! -f "scripts/redis/download_opencellid_cached.cjs" ]; then
  echo "scripts/redis/download_opencellid_cached.cjs missing; skipping tower import"
  exit 0
fi

export LOCAL_OPENCELLID_CSV_DIR="${'${'}LOCAL_OPENCELLID_CSV_DIR:-data/opencellid}"
if [ ! -d "$LOCAL_OPENCELLID_CSV_DIR" ] || [ -z "$(ls "$LOCAL_OPENCELLID_CSV_DIR"/31*.csv 2>/dev/null)" ]; then
  DOWNLOADS_DIR="$HOME/Downloads"
  if [ -d "$DOWNLOADS_DIR" ] && [ ! -z "$(ls "$DOWNLOADS_DIR"/31*.csv 2>/dev/null)" ]; then
    export LOCAL_OPENCELLID_CSV_DIR="$DOWNLOADS_DIR"
  fi
fi

(npm run towers:download:cached) || {
  echo "Tower download failed; skipping tower import"
  exit 0
}

TEMP_FAST=${'$'}(redis-cli -p "$REDIS_PORT" -n 0 dbsize 2>/dev/null || echo 0)
TEMP_FULL=${'$'}(redis-cli -p "$REDIS_PORT" -n 1 dbsize 2>/dev/null || echo 0)
if [ "$TEMP_FAST" -eq 0 ] || [ "$TEMP_FULL" -eq 0 ]; then
  echo "Tower download skipped or produced no data; leaving existing DBs untouched."
  exit 0
fi
redis-cli -p "$REDIS_PORT" swapdb 0 2 >/dev/null
redis-cli -p "$REDIS_PORT" swapdb 1 3 >/dev/null
exit 0
`,
        description: 'Swapping Redis Database...',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 5,
        command: 'npm run build:wasm',
        description: 'Building WASM SIMD module',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 6,
        command: isNativeWindows ? 'echo Encrypted module decrypt step is not supported in this Windows shell path.' : `
set -euo pipefail
if npm run decrypt-modules-if-needed >/dev/null 2>&1; then
  if [ -f "src/encrypted-modules/tmp/rs/simd/fast_math.rs" ]; then
    echo "${encryptedModulesStatus.success}"
    exit 0
  fi
  echo "${encryptedModulesStatus.warning}"
  exit 0
fi
echo "${encryptedModulesStatus.error}"
exit 1
`,
        description: 'N-APT Encrypted Modules',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 7,
        command: undefined,
        description: 'Starting Rust backend',
        isBackground: false,
        pidKey: undefined,
        label: 'Building and starting backend... Rust.',
        isCompositeRustStep: true,
      },
      {
        index: 8,
        command: isNativeWindows ? 'npx vite dev --host' : 'node_modules/.bin/vite dev --host',
        description: 'Starting frontend server',
        isBackground: true,
        pidKey: 'vitePid' as const,
        showOutput: false,
      },
    ];

    for (const step of steps) {
      setBuildState(prev => ({
        ...prev,
        currentStep: step.index,
      }));

      const stepLabelBase = (step.index === 4) ? getTowerLoadDescription() : step.description;
      const stepLabel = step.index === 0 ? stepLabelBase : withEllipsis(stepLabelBase);
      const runningLabel = step.label ?? stepLabel;

      updateProcessStatus(step.index, 'running', undefined, runningLabel);

      if (step.pidKey === 'vitePid') {
        await closeDevStatusServer();
      }

      let success: boolean;
      let commandOutput = '';
      if (step.isCompositeRustStep) {
        // Execute composite Rust build → start → wait sequence
        success = await executeCompositeRustStep(step.index);
      } else if (step.isBackground && step.pidKey) {
        success = await startBackgroundProcess(step.command, step.description, step.pidKey);
      } else if (step.isBackground) {
        success = await startBackgroundProcess(step.command, step.description, 'vitePid');
      } else {
        const _stepIndex = step.index;
        if (typeof step.command !== 'string') {
          appendErrorDetail(`${stepLabel}: foreground steps require a shell command string`);
          success = false;
        } else {
          const result = await executeCommand(step.command, stepLabel);
          success = result.success;
          commandOutput = result.output;
        }
      }

      if (success) {
        if (step.index === 4) {
          const { message } = getTowerCountLabel(stepLabel);
          const label = getCompletedStepLabel(step.description);
          updateProcessStatus(step.index, 'success', message, label);
        } else if (step.index === 7) {
          updateProcessStatus(
            step.index,
            'success',
            metalBackendStatusRef.current ?? undefined,
            getCompletedStepLabel(step.description),
          );
        } else if (step.index === 6 && commandOutput.includes(encryptedModulesStatus.warning)) {
          updateProcessStatus(step.index, 'warning', encryptedModulesStatus.warning, stepLabel);
          appendWarningDetail('N-APT Encrypted Modules not available');
        } else {
          updateProcessStatus(step.index, 'success', undefined, getCompletedStepLabel(step.description));
        }
      } else {
        setBuildState(prev => ({
          ...prev,
          processes: markPendingProcessesAfterFailure(
            prev.processes.map((proc, index) =>
              index === step.index
                ? { ...proc, status: 'error', message: undefined, label: stepLabel }
                : proc
            )
          ),
        }));
        appendErrorDetail(`${step.description} failed`);
        break; // Stop the build if a step fails
      }

      setBuildState(prev => ({
        ...prev,
        currentStep: step.index + 1,
      }));

      // Small delay between steps for visual clarity.
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, safeDelayMs(stepSettleDelayMs, 100));
        if (shutdownRequestedRef.current) {
          clearTimeout(timeout);
          resolve(undefined);
        }
      });

      if (shutdownRequestedRef.current) {
        break;
      }
    }

    setBuildState(prev => ({ ...prev, isBuilding: false }));
  }, [updateProcessStatus, executeCommand, startBackgroundProcess, appendErrorDetail, executeCompositeRustStep, writeRebuildStatus]);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || key.ctrl || input === 'q') {
      addLog(chalk.yellow('Build interrupted by user'));
      requestShutdown();
    }
  });

  useEffect(() => {
    const handleSigint = () => {
      requestShutdown();
    };

    process.once('SIGINT', handleSigint);
    process.once('SIGTERM', handleSigint);

    return () => {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigint);
    };
  }, [requestShutdown]);

  // Auto-start build on mount
  useEffect(() => {
    if (!buildStartedRef.current && !buildState.isBuilding && buildState.currentStep === 0) {
      buildStartedRef.current = true;
      runBuild();
    }
  }, [runBuild, buildState.isBuilding, buildState.currentStep]);

  const hasErrors = buildState.processes.some(p => p.status === 'error');
  const hasCompilationErrors = buildState.errorDetails.length > 0;
  const allComplete = buildState.processes.every(p => p.status === 'success' || p.status === 'error');
  const runtimeSeconds = buildState.startTime > 0
    ? Math.max(0, Math.floor((Date.now() - buildState.startTime) / 1000))
    : 0;
  const runtimeSummary = getRuntimeSummaryState({
    hasErrors,
    hasCompilationErrors,
    vitePid: buildState.vitePid,
    rustPid: buildState.rustPid,
    redisPid: buildState.redisPid,
    failingServices: hasErrors || hasCompilationErrors ? getFailingServices(buildState.errorDetails) : []
  });
  const deviceAwareRuntimeSummary = getDeviceAwareRuntimeSummaryState({
    runtimeSummary,
    deviceState: liveDeviceState,
  });
  const statusLabel = deviceAwareRuntimeSummary.label;
  const displayStatusLabel = getRustHotReloadRuntimeLabel(
    rustHotReloadCount,
    statusLabel,
  );
  const statusColor = deviceAwareRuntimeSummary.color;
  const vitePidText = buildState.vitePid ?? '—';
  const rustPidText = buildState.rustPid ?? '—';
  const redisPidText = buildState.redisPid ?? '—';

  useEffect(() => {
    if (!allComplete || completedRuntimeSeconds !== null) {
      return;
    }

    setCompletedRuntimeSeconds(runtimeSeconds);
  }, [
    allComplete,
    completedRuntimeSeconds,
    runtimeSeconds,
  ]);

  // Note: If Do Not Disturb is enabled or Terminal lacks notification permissions,
  // the system notification won't fire. Open http://localhost:5173 manually in that case.
  const checkDeviceStatus = useCallback(async (): Promise<{
    deviceState: string | null;
    message: string;
  }> => {
    try {
      const response = await fetch('http://localhost:8765/status');
      const data = await response.json();
      return {
        deviceState: typeof data.device_state === 'string' ? data.device_state : null,
        message:
          data.device_state === 'loading'
            ? 'RTL-SDR Connecting'
            : data.device_connected
              ? 'RTL-SDR Connected'
              : 'RTL-SDR Disconnected, Mock APT Running',
      };
    } catch {
      return {
        deviceState: null,
        message: 'Backend not responding',
      };
    }
  }, []);

  useEffect(() => {
    const canPollDeviceState =
      allComplete && buildState.vitePid && buildState.rustPid && buildState.redisPid;

    if (!canPollDeviceState) {
      setLiveDeviceState(null);
      return;
    }

    let cancelled = false;
    const pollDeviceStatus = async () => {
      const result = await checkDeviceStatus();
      if (cancelled) return;
      setLiveDeviceState(result.deviceState);
    };

    void pollDeviceStatus();
    const interval = setInterval(() => {
      void pollDeviceStatus();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [allComplete, buildState.vitePid, buildState.rustPid, buildState.redisPid, checkDeviceStatus]);

  useEffect(() => {
    if (liveDeviceState !== 'connected') {
      return;
    }

    clearErrorDetails('device disconnected');
    clearErrorDetails('disconnected but running');
  }, [liveDeviceState, clearErrorDetails]);

  useEffect(() => {
    const canNotify = buildState.vitePid && buildState.rustPid && buildState.redisPid;
    
    if (allComplete && canNotify) {
      checkDeviceStatus().then(({ message: deviceStatus }) => {
        const msg = !hadServicesRef.current 
          ? `✓ Finished building and running at http://localhost:5173`
          : `✓ ${deviceStatus}`;
        notifier.notify({
          title: 'N-APT  🧠',
          message: msg,
          icon: path.join(__dirname, 'public/icon-5112.png'),
          open: 'http://localhost:5173',
        });
      });
    }
  }, [allComplete, buildState.vitePid, buildState.rustPid, buildState.redisPid, checkDeviceStatus]);

  // Keep hot-reload callbacks in refs so the watcher effect does not tear down
  // every time a status update re-creates a useCallback identity.
  const updateProcessStatusRef = useRef(updateProcessStatus);
  const executeForegroundCommandRef = useRef(executeForegroundCommand);
  const startBackgroundProcessRef = useRef(startBackgroundProcess);
  const addLogRef = useRef(addLog);
  const writeRebuildStatusRef = useRef(writeRebuildStatus);
  updateProcessStatusRef.current = updateProcessStatus;
  executeForegroundCommandRef.current = executeForegroundCommand;
  startBackgroundProcessRef.current = startBackgroundProcess;
  addLogRef.current = addLog;
  writeRebuildStatusRef.current = writeRebuildStatus;

  // Watcher for Rust source files (Hot Reloading).
  // Intentionally depends on vite/redis PIDs only — rustPid updates mid-handoff
  // must not tear down this effect or cancel an in-flight swap.
  useEffect(() => {
    // The Rust process is marked `running` during a reload, so `allComplete`
    // temporarily becomes false. The watcher must remain attached through
    // that transition or its cleanup cancels the in-flight rebuild.
    const canWatch = canKeepRustHotReloadWatcherAttached(
      buildState.vitePid,
      buildState.redisPid,
      rustPidRef.current,
    );
    if (!canWatch) return;
    hotReloadCancelledRef.current = false;

    let watcher: fs.FSWatcher | null = null;
    let rebuildTimeout: NodeJS.Timeout | null = null;
    let isRebuilding = false;
    let pendingRebuild = false;
    let waitStartedAt: number | null = null;
    const hotReloadGate = createRustHotReloadGate(
      RUST_HOT_RELOAD_QUIET_MS,
      RUST_HOT_RELOAD_MAX_COALESCE_MS,
    );

    const srcRsPath = path.resolve('src/rs');

    const clearWaitingUi = (message?: string) => {
      waitStartedAt = null;
      hotReloadActiveRef.current = false;
      setRustHotReloadPhase((phase) => (phase === 'waiting' ? 'idle' : phase));
      updateProcessStatusRef.current(7, 'success', message, undefined);
      writeRebuildStatusRef.current({
        rebuilding: false,
        pending: false,
        phase: undefined,
        progress: undefined,
        startedAt: undefined,
        recentLines: [],
      });
    };

    const updateCountdownStatus = () => {
      const files = hotReloadGate.getChangedFiles();
      const fileList = files.length > 2 ? `${files.length} files` : files.join(', ');
      const remainingMs = hotReloadGate.getRemainingMs() ?? RUST_HOT_RELOAD_QUIET_MS;
      const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setRustHotReloadPhase('waiting');
      hotReloadActiveRef.current = true;
      if (waitStartedAt == null) {
        waitStartedAt = Date.now();
      }
      const waitMessage = seconds <= 0
        ? `Changed: ${fileList}. Starting rebuild...`
        : `Changed: ${fileList}. Rebuilding in ${seconds}s...`;
      updateProcessStatusRef.current(
        7,
        'warning',
        waitMessage,
        '[HOT-RELOAD] Waiting for Rust changes to settle...',
      );
      // pending/waiting must NOT set rebuilding:true — that caused stuck toasts
      // when the settle timer died and left status frozen for hours.
      writeRebuildStatusRef.current({
        rebuilding: false,
        pending: true,
        phase: 'waiting',
        progress: waitMessage,
        startedAt: waitStartedAt,
      });
    };

    const scheduleRebuild = () => {
      if (isRebuilding) {
        pendingRebuild = true;
        return;
      }

      if (rebuildTimeout) {
        clearInterval(rebuildTimeout);
        rebuildTimeout = null;
      }

      updateCountdownStatus();

      rebuildTimeout = setInterval(() => {
        if (
          waitStartedAt != null
          && isRebuildStatusStale({
            pending: true,
            phase: 'waiting',
            startedAt: waitStartedAt,
          })
        ) {
          addLogRef.current(chalk.yellow('[Watcher] Settle wait went stale; forcing rebuild.'));
          clearInterval(rebuildTimeout!);
          rebuildTimeout = null;
          void triggerRebuild();
          return;
        }
        if (hotReloadGate.shouldAttemptValidation()) {
          clearInterval(rebuildTimeout!);
          rebuildTimeout = null;
          void triggerRebuild();
          return;
        }
        updateCountdownStatus();
      }, 250);
    };

    const restartRustBackend = async () => {
      if (hotReloadCancelledRef.current || shutdownRequestedRef.current) {
        addLogRef.current(chalk.yellow('[Watcher] Rust hot reload cancelled; skipping restart.'));
        return false;
      }

      const oldPid = rustPidRef.current ?? buildState.rustPid;
      const oldPort = backendPortRef.current;
      const newPort = await findAvailableTcpPort(oldPort + 1);
      const candidateCommand: BackgroundCommand = {
        executable: isNativeWindows
          ? path.resolve('target/dev-fast/n-apt-backend.exe')
          : path.resolve('target/dev-fast/n-apt-backend'),
        args: [],
        env: {
          WEBSOCKETS_URL: `http://127.0.0.1:${newPort}`,
        },
      };

      addLogRef.current(chalk.green(`[Watcher] Starting replacement Rust backend on ${newPort}...`));
      const candidateStarted = await startBackgroundProcessRef.current(
        candidateCommand,
        'Replacement Rust backend',
        'rustCandidatePid',
      );
      const candidatePid = rustCandidatePidRef.current;
      if (!candidateStarted || !candidatePid) return false;

      const waitForBackendReady = async (timeoutMs = 15000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          try {
            const response = await fetch(`http://127.0.0.1:${newPort}/status`, {
              method: 'GET',
              cache: 'no-store',
            });
            if (response.ok) return true;
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return false;
      };

      if (!(await waitForBackendReady())) {
        addLogRef.current(chalk.yellow('[Watcher] Replacement Rust backend did not become ready; keeping the old backend.'));
        try {
          process.kill(-candidatePid, 'SIGTERM');
        } catch {
          try { process.kill(candidatePid, 'SIGTERM'); } catch {}
        }
        return false;
      }

      if (shutdownRequestedRef.current) return false;

      writeBackendTarget(backendTargetFile, { host: '127.0.0.1', port: newPort });
      backendPortRef.current = newPort;
      rustPidRef.current = candidatePid;
      rustCandidatePidRef.current = undefined;
      // Update PID display without putting rustPid in the watcher effect deps.
      setBuildState(prev => ({
        ...prev,
        rustPid: candidatePid,
        rustCandidatePid: undefined,
      }));
      addLogRef.current(chalk.green('[Watcher] Replacement Rust backend is ready; switched proxy target.'));

      // Proxy closes existing websockets on target change; give clients a beat
      // to land on the replacement before shutting down the old process.
      await new Promise((resolve) => setTimeout(resolve, 250));

      if (shutdownRequestedRef.current) return false;

      if (oldPid) {
        try {
          intentionalRustKillRef.current = true;
          process.kill(-oldPid, 'SIGTERM');
        } catch {
          try { process.kill(oldPid, 'SIGTERM'); } catch {}
        }

        const deadline = Date.now() + 5000;
        let exited = false;
        while (Date.now() < deadline) {
          try {
            process.kill(oldPid, 0);
          } catch {
            exited = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!exited) {
          addLogRef.current(chalk.yellow('[Watcher] Old Rust backend did not exit gracefully; forcing shutdown.'));
          try { process.kill(-oldPid, 'SIGKILL'); } catch {}
          try { process.kill(oldPid, 'SIGKILL'); } catch {}
        }
      }

      try {
        const response = await fetch(`http://127.0.0.1:${newPort}/status`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) {
          addLogRef.current(chalk.yellow('[Watcher] Replacement backend lost readiness after cutover.'));
          return false;
        }
      } catch {
        addLogRef.current(chalk.yellow('[Watcher] Replacement backend unreachable after cutover.'));
        return false;
      }

      return true;
    };

    const triggerRebuild = async () => {
      if (hotReloadCancelledRef.current || shutdownRequestedRef.current) {
        if (rebuildTimeout) {
          clearInterval(rebuildTimeout);
          rebuildTimeout = null;
        }
        pendingRebuild = false;
        clearWaitingUi('Hot reload cancelled');
        return;
      }

      if (isRebuilding) {
        pendingRebuild = true;
        return;
      }
      isRebuilding = true;
      pendingRebuild = false;
      waitStartedAt = null;
      hotReloadGate.clear();
      const buildStartedAt = Date.now();

      writeRebuildStatusRef.current({
        rebuilding: true,
        pending: false,
        success: undefined,
        stage: undefined,
        phase: 'building',
        progress: 'Starting cargo build...',
        recentLines: [],
        startedAt: buildStartedAt,
      });

      addLogRef.current(chalk.yellow('\n[Watcher] Rust source changes settled. Validating backend...'));
      hotReloadActiveRef.current = true;
      setRustHotReloadPhase('rebuilding');
      updateProcessStatusRef.current(
        7,
        'running',
        'Starting cargo build...',
        '[HOT-RELOAD] Rebuilding Rust backend...',
      );

      pruneIncrementalCache((message) => addLogRef.current(message));

      const checkCommand = `cargo check --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs}`.trim();
      const buildCommand = `cargo build --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs}`.trim();
      let buildTimedOut = false;
      const buildWatchdog = setInterval(() => {
        if (
          isRebuildStatusStale({
            rebuilding: true,
            phase: 'building',
            startedAt: buildStartedAt,
          })
        ) {
          buildTimedOut = true;
          addLogRef.current(
            chalk.red(
              `[Watcher] Rust hot reload exceeded ${Math.round(RUST_HOT_RELOAD_BUILD_STALE_MS / 60000)}m; aborting without killing a healthy backend.`,
            ),
          );
        }
      }, 5000);

      const validationResult = await runRustHotReloadValidation({
        cargoCheck: () => hotReloadRunsCargoCheck
          ? executeForegroundCommandRef.current(
            checkCommand,
            'Checking Rust backend',
            7,
            '[HOT-RELOAD] Checking Rust backend...',
          )
          : Promise.resolve({
            success: true,
            output: 'Skipping separate cargo check; cargo build will validate Rust backend compilation.',
          }),
        cargoBuild: async () => {
          const binPath = isNativeWindows ? 'target\\dev-fast\\n-apt-backend.exe' : 'target/dev-fast/n-apt-backend';
          try {
            if (fs.existsSync(binPath)) {
              fs.renameSync(binPath, `${binPath}.old`);
            }
          } catch (err: any) {
            addLogRef.current(chalk.yellow(`[Watcher] Could not rename old binary: ${err.message}`));
          }
          return executeForegroundCommandRef.current(
            buildCommand,
            'Building Rust backend',
            7,
            '[HOT-RELOAD] Rebuilding Rust backend...',
          );
        },
        restart: restartRustBackend,
        log: (message) => addLogRef.current(message),
        updateStatus: (status, message, label) => {
          if (status === 'running') {
            const hotReloadLabel = getRustHotReloadProcessLabel(status, message ?? label)
              ?? label
              ?? '[HOT-RELOAD] Rebuilding Rust backend...';
            const nextPhase = hotReloadLabel.startsWith('Restarting') ? 'restarting' : 'rebuilding';
            setRustHotReloadPhase(nextPhase);
            updateProcessStatusRef.current(7, 'running', message, hotReloadLabel);
            writeRebuildStatusRef.current({
              rebuilding: true,
              pending: false,
              phase: nextPhase,
              progress: message ?? hotReloadLabel,
              startedAt: buildStartedAt,
            });
            return;
          }

          if (status === 'success') {
            setRustHotReloadCount((count) => count + 1);
            setRustHotReloadPhase('ready');
            hotReloadActiveRef.current = false;
            updateProcessStatusRef.current(7, 'success', message, label ?? '[HOT-RELOAD] Rust backend reloaded');
            return;
          }

          if (status === 'warning') {
            setRustHotReloadPhase('degraded');
            hotReloadActiveRef.current = false;
            updateProcessStatusRef.current(7, 'warning', message, label ?? '[HOT-RELOAD] Rust backend running (old)');
            return;
          }

          setRustHotReloadPhase('idle');
          hotReloadActiveRef.current = false;
          updateProcessStatusRef.current(7, status, message, label);
        },
        isCancelled: () => shutdownRequestedRef.current || buildTimedOut,
      });

      clearInterval(buildWatchdog);

      if (buildTimedOut) {
        writeRebuildStatusRef.current({
          rebuilding: false,
          pending: false,
          success: false,
          stage: 'build_stale',
          phase: 'degraded',
          progress: 'Hot reload timed out — left the previous backend running',
          startedAt: undefined,
        });
        setRustHotReloadPhase('degraded');
        hotReloadActiveRef.current = false;
        updateProcessStatusRef.current(
          7,
          'warning',
          'Hot reload timed out — left the previous backend running',
          '[HOT-RELOAD] Rust backend running (old)',
        );
      } else {
        writeRebuildStatusRef.current({
          rebuilding: false,
          pending: false,
          success: validationResult.stage === 'restarted',
          stage: validationResult.stage,
          phase: validationResult.stage === 'restarted' ? 'ready' : 'degraded',
          progress: validationResult.stage === 'restarted'
            ? 'Rust backend reloaded'
            : `Reload finished: ${validationResult.stage}`,
          startedAt: undefined,
        });
      }

      if (!buildTimedOut && validationResult.stage === 'restarted') {
        notifier.notify({
          title: 'N-APT',
          message: '✓ Rust backend reloaded successfully',
          icon: path.join(__dirname, 'public/icon-5112.png'),
        });
      }

      isRebuilding = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        scheduleRebuild();
      }
    };

    try {
      watcher = fs.watch(srcRsPath, { recursive: true }, (_eventType, filename) => {
        if (!isRustSourceChange(srcRsPath, filename)) return;
        hotReloadGate.recordChange(filename.toString());
        scheduleRebuild();
      });
      addLogRef.current(chalk.blue('[Watcher] Watching Rust source files for changes...'));
    } catch (err: any) {
      addLogRef.current(chalk.red(`[Watcher] Failed to start filesystem watcher: ${err.message}`));
    }

    return () => {
      hotReloadCancelledRef.current = true;
      if (watcher) watcher.close();
      if (rebuildTimeout) clearInterval(rebuildTimeout);
      // Never leave the app toast / UI stuck in "Rebuilding in 5s..." after teardown.
      if (!isRebuilding) {
        clearWaitingUi();
      } else {
        writeRebuildStatusRef.current({
          rebuilding: false,
          pending: false,
          phase: undefined,
          progress: undefined,
          startedAt: undefined,
        });
      }
    };
  }, [buildState.vitePid, buildState.redisPid]);

  useEffect(() => {
    const shouldStayAttached =
      allComplete && buildState.vitePid && buildState.rustPid && buildState.redisPid;
    if (!shouldStayAttached) return;

    const keepAlive = setInterval(() => {}, 60_000);
    return () => clearInterval(keepAlive);
  }, [allComplete, buildState.vitePid, buildState.rustPid, buildState.redisPid]);

  const [expandedOutputStep, setExpandedOutputStep] = useState<number | null>(null);

  const toggleOutput = useCallback((index: number) => {
    setExpandedOutputStep(prev => prev === index ? null : index);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Static items={staticHeaderItems}>
        {item => (
          <StaticHeader key={item.id} />
        )}
      </Static>

      <Box flexDirection="column" marginTop={1} gap={0}>
        {buildState.processes.map((process, index) => (
          <ProcessStep
            key={index}
            process={process}
            isActive={index === buildState.currentStep && buildState.isBuilding}
            showOutput={expandedOutputStep === index}
            onToggleOutput={() => toggleOutput(index)}
            showLiveOutput={
              buildState.activeBuildOutputStep === index
              || (index === 7
                && (rustHotReloadPhase === 'waiting'
                  || rustHotReloadPhase === 'rebuilding'
                  || rustHotReloadPhase === 'restarting'))
            }
            hotReloadLabel={index === 7
              && (rustHotReloadPhase === 'waiting'
                || rustHotReloadPhase === 'rebuilding'
                || rustHotReloadPhase === 'restarting')
              ? getRustHotReloadStepLabel(rustHotReloadPhase)
              : undefined}
          />
        ))}
      </Box>

      {buildState.isBuilding && (
        <Box marginTop={1} flexDirection="row">
          <SpinnerText />
          <Text color="blue"> Building in progress...</Text>
        </Box>
      )}

      {allComplete && (buildState.errorDetails.length > 0 || buildState.warningDetails.length > 0) && (
        <Box flexDirection="column" marginTop={1}>
          {buildState.errorDetails.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="red" bold>✗ Errors</Text>
              {buildState.errorDetails.map((detail, idx) => (
                <Text key={`error-${idx}`} color="red">
                  {'  '}{detail}
                </Text>
              ))}
            </Box>
          )}
          {buildState.warningDetails.length > 0 && (
            <Box flexDirection="column">
              <Text color="yellow" bold>⚠ Warnings</Text>
              {buildState.warningDetails.map((detail, idx) => (
                <Text key={`warning-${idx}`} color="yellow">
                  {'  '}{detail}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {allComplete && (
        <Box flexDirection="column" marginTop={1}>
          <Box borderStyle="round" borderColor="gray" padding={1}>
            <Box flexDirection="row" alignItems="flex-start">
              <Box marginRight={2} flexShrink={0}>
                <NaptLogo />
              </Box>
              <Box flexDirection="column" flexGrow={1}>
                <Text color={statusColor} bold>{displayStatusLabel}</Text>
                <Text>
                  <Text color={accentColors.vite}>{vitePidText}</Text>{' '}
                  <Text color="white">Vite PID</Text> ::{' '}
                  <Text color={accentColors.rust}>{rustPidText}</Text>{' '}
                  <Text color="white">Rust server PID</Text> ::{' '}
                  <Text color={accentColors.redis}>{redisPidText}</Text>{' '}
                  <Text color="white">Redis PID</Text>
                </Text>

                <Box marginTop={1} flexDirection="column" gap={0}>
                  <Text>
                    <Text color="white" bold>N-APT </Text>🧠{' '}
                    <Text color={accentColors.vite}>http://localhost:5173</Text>{' '}
                    <Text color="gray">(Site / Vite Server)</Text>
                  </Text>
                  <Text color="gray">cmd + click to open in default browser</Text>
                  <Text> </Text>
                  <Text>
                    <Text color={accentColors.rust}>ws://localhost:8765</Text>{' '}
                    <Text color="gray">(Rust WebSockets backend)</Text>
                  </Text>
                  <Text>
                    <Text color={accentColors.wasm}>packages/n_apt_canvas </Text>{' '}
                    <Text color="gray">(WebGPU wasm_simd build)</Text>
                  </Text>
                  <Text>
                    <Text color={accentColors.redis}>redis://localhost:6379</Text>{' '}
                    <Text color="gray">(Redis service)</Text>
                  </Text>
                </Box>

                <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
                  <Text>
                    <Text color="red">✗ {buildState.errorCount} errors</Text>{'   '}
                    <Text color="yellow">▲ {buildState.warningCount} warnings</Text>
                  </Text>
                  <Text color="gray">running in {completedRuntimeSeconds ?? runtimeSeconds}s</Text>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const getFailedComponentName = (stepIndex: number): string => {
  switch (stepIndex) {
    case 1:
    case 7:
      return 'Rust';
    case 2:
      return 'signals.yaml';
    case 3:
    case 4:
      return 'Redis';
    case 5:
      return 'WASM';
    case 6:
      return 'N-APT Encrypted Modules';
    case 8:
      return 'Typescript';
    default:
      return 'Unknown Step';
  }
};

async function runNonTtyBuild() {
  const activeChildren: Array<ReturnType<typeof spawn>> = [];
  const errorDetails: string[] = [];
  const appendErrorDetail = (msg: string) => {
    errorDetails.push(msg);
  };
  const cleanup = () => {
    for (const child of activeChildren) {
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGTERM');
        }
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {}
      }
    }
    terminateKnownDevProcesses();
  };

  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  const executeCommandNonTty = (command: string, description: string): Promise<{ success: boolean; output: string }> => {
    return new Promise((resolve) => {
      try {
        const child = trackLaunchedChild(spawn(command, [], {
          shell: true,
          cwd: './',
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        }));
        activeChildren.push(child);
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (data) => { stdout += data.toString(); });
        child.stderr?.on('data', (data) => { stderr += data.toString(); });
        child.on('close', (code) => {
          removeActiveChild(activeChildren, child);
          if (code === 0) {
            resolve({ success: true, output: stdout });
          } else {
            const errMsg = stderr.trim() || stdout.trim() || `Exit code ${code}`;
            appendErrorDetail(`${description}: ${errMsg}`);
            resolve({ success: false, output: stdout });
          }
        });
        child.on('error', (err) => {
          removeActiveChild(activeChildren, child);
          appendErrorDetail(`${description}: ${err.message}`);
          resolve({ success: false, output: '' });
        });
      } catch (err: any) {
        appendErrorDetail(`${description}: ${err.message}`);
        resolve({ success: false, output: '' });
      }
    });
  };

  const startBackgroundProcessNonTty = (command: BackgroundCommand, description: string): Promise<boolean> => {
    const isRustBackendBinary =
      typeof command === 'string' &&
      /(^|\/|\\)n-apt-backend(\.exe)?$/.test(command.trim());
    const executable = typeof command === 'string' ? command : command.executable;
    const args = typeof command === 'string' ? [] : command.args;
    const shouldUseShell = typeof command === 'string' && !isRustBackendBinary;
    const isViteFrontend = description.toLowerCase().includes('frontend');
    return new Promise((resolve) => {
      try {
        if (description.toLowerCase().includes('redis')) {
          fs.mkdirSync('.redis_data', { recursive: true });
        }
        const child = trackLaunchedChild(spawn(executable, args, {
          shell: shouldUseShell,
          stdio: 'pipe',
          detached: true,
          cwd: './',
        }));
        activeChildren.push(child);
        child.on('error', (err) => {
          removeActiveChild(activeChildren, child);
          appendErrorDetail(`${description}: ${err.message}`);
          resolve(false);
        });
        child.once('exit', () => removeActiveChild(activeChildren, child));
        child.once('close', () => removeActiveChild(activeChildren, child));
        setTimeout(() => {
          void (async () => {
            if (!(child.pid && child.exitCode === null)) {
              resolve(false);
              return;
            }

            if (!isViteFrontend) {
              resolve(true);
              return;
            }

            console.log('[Build] Waiting for Vite HTTP readiness...');
            const ready = await waitForViteReady({
              timeoutMs: safeDelayMs(viteReadyTimeoutMs, 120000),
              depsMetadataPath: path.resolve('node_modules/.vite/deps/_metadata.json'),
            });
            if (!ready.ok) {
              appendErrorDetail(`Vite readiness probe failed: ${ready.reason ?? 'unknown error'}`);
              console.error(`[Build] Vite readiness probe failed: ${ready.reason ?? 'unknown error'}`);
              void ensureDevStatusServer();
              resolve(false);
              return;
            }
            console.log(`[Build] Vite HTTP-ready after ${ready.elapsedMs}ms`);
            resolve(true);
          })();
        }, safeDelayMs(backgroundStartGraceMs, 500));
      } catch (err: any) {
        appendErrorDetail(`${description}: ${err.message}`);
        resolve(false);
      }
    });
  };

  // Notify build started
  notifier.notify({
    title: 'N-APT',
    message: 'Staring build...',
    icon: path.join(__dirname, 'public/icon-5112.png'),
  });

  console.log('N-APT / Staring build...');

  const steps = [
    {
      index: 0,
      description: 'Cleaning up existing processes',
      run: () => executeCommandNonTty(
        isNativeWindows ? 'echo Windows cleanup is skipped' : `
          pkill -9 -f '[n]-apt-backend' || true
          pkill -9 -f '[r]edis-server' || true
          sleep 0.5
        `,
        'Cleaning up existing processes'
      )
    },
    {
      index: 1,
      description: 'Validating Rust backend code',
      run: () => {
        pruneIncrementalCache();
        return executeCommandNonTty(
          isNativeWindows
            ? 'echo Config validation skipped'
            : `echo "[Rust] Running cargo check before config validation..." && cargo check --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs} 2>&1`,
          'Validating Rust backend code'
        );
      }
    },
    {
      index: 2,
      description: 'Validating signals.yaml (via backend config loader)',
      run: () => executeCommandNonTty(
        isNativeWindows ? 'echo Validation skipped' : `
          echo "[Config] Loading signals.yaml through the Rust backend (--validate-config)..."
          if [ -f "./target/dev-fast/n-apt-backend" ] && [ -z "${rustBackendFeatureArgs}" ]; then
            ./target/dev-fast/n-apt-backend --validate-config 2>&1
          else
            echo "[Config] Backend binary unavailable; cargo may compile Rust before config validation."
            cargo run --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs} -- --validate-config 2>&1
          fi
        `,
        'Validating signals.yaml (via backend config loader)'
      )
    },
    {
      index: 3,
      description: 'Starting Redis database server',
      run: () => startBackgroundProcessNonTty(
        {
          executable: 'redis-server',
          args: [
            '--port',
            '6379',
            '--dir',
            '.redis_data',
            '--daemonize',
            'no',
            '--appendonly',
            'yes',
            '--save',
            '60',
            '1',
            '--dbfilename',
            'dump.rdb',
          ],
        },
        'Starting Redis database server'
      )
    },
    {
      index: 4,
      description: 'Swapping Redis Database',
      run: () => executeCommandNonTty(
        process.env.NAPT_CLI_STARTED === '1' || isNativeWindows
          ? 'echo CLI startup: skipping optional Redis tower swap.'
          : `npm run towers:download:cached`,
        'Swapping Redis Database'
      )
    },
    {
      index: 5,
      description: 'Building WASM SIMD module',
      run: () => executeCommandNonTty('npm run build:wasm', 'Building WASM SIMD module')
    },
    {
      index: 6,
      description: 'Building N-APT Encrypted Modules',
      run: () => executeCommandNonTty(
        isNativeWindows ? 'echo Encrypted modules skipped' : `
          if npm run decrypt-modules-if-needed >/dev/null 2>&1; then
            if [ -f "src/encrypted-modules/tmp/rs/simd/fast_math.rs" ]; then
              exit 0
            fi
            exit 0
          fi
          exit 1
        `,
        'Building N-APT Encrypted Modules'
      )
    },
    {
      index: 7,
      description: 'Building and starting Rust backend',
      run: async () => {
        notifier.notify({
          title: 'N-APT',
          message: 'Almost done building...',
          icon: path.join(__dirname, 'public/icon-5112.png'),
        });
        console.log('N-APT, Almost done building...');
        
        pruneIncrementalCache();

        const buildRes = await executeCommandNonTty(
          `cargo build --profile dev-fast --bin n-apt-backend ${rustBackendFeatureArgs}`.trim(),
          'Building Rust backend'
        );
        if (!buildRes.success) return { success: false, output: buildRes.output };

        const startCommand = isNativeWindows ? 'target\\dev-fast\\n-apt-backend.exe' : './target/dev-fast/n-apt-backend';
        const startRes = await startBackgroundProcessNonTty(startCommand, 'Rust backend');
        if (!startRes) return { success: false, output: '' };

        await new Promise((r) => setTimeout(r, safeDelayMs(backgroundStartGraceMs, 500)));

        const waitCommand = isNativeWindows ? 'echo skipped' : `bash -lc '
          MAX_RETRIES=30
          RETRY_DELAY=1
          RETRY_COUNT=0
          while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/status 2>/dev/null || echo "000")
            if [ "$HTTP_CODE" = "200" ]; then
              exit 0
            fi
            RETRY_COUNT=$((RETRY_COUNT + 1))
            sleep $RETRY_DELAY
          done
          exit 1
        '`;
        return executeCommandNonTty(waitCommand, 'Waiting for backend');
      }
    },
    {
      index: 8,
      description: 'Starting frontend server',
      run: async () => {
        await closeDevStatusServer();
        return startBackgroundProcessNonTty(
          isNativeWindows ? 'npx vite dev --host' : 'node_modules/.bin/vite dev --host',
          'Starting frontend server'
        );
      }
    }
  ];

  let failedComponents: string[] = [];

  const nonTtyStatusSteps: RebuildStatusStep[] = [];
  let nonTtyStartedAt = 0;
  const writeNonTtyStatus = (patch: Partial<RebuildStatusPayload>) => {
    try {
      fs.writeFileSync('.rebuild_status.json', `${JSON.stringify({
        rebuilding: true,
        buildStartedAt: nonTtyStartedAt || Date.now(),
        errorCount: errorDetails.length,
        warningCount: 0,
        recentLines: [] as string[],
        ...patch,
      })}\n`);
    } catch {
      // Best-effort status for the pre-Vite loading page.
    }
  };

  for (const step of steps) {
    console.log(`[Build] ${step.description}...`);
    if (!nonTtyStartedAt) {
      nonTtyStartedAt = Date.now();
      writeNonTtyStatus({
        currentStep: 0,
        steps: steps.map(s => ({ name: s.description, status: 'pending' as const })),
      });
    }
    while (nonTtyStatusSteps.length < steps.length) {
      nonTtyStatusSteps.push({ name: steps[nonTtyStatusSteps.length].description, status: 'pending' });
    }
    nonTtyStatusSteps[step.index] = { name: step.description, status: 'running' };
    writeNonTtyStatus({
      currentStep: step.index,
      steps: nonTtyStatusSteps.map(s => ({ ...s })),
    });
    const res = await step.run();
    nonTtyStatusSteps[step.index] = {
      name: step.description,
      status: res && (typeof res !== 'object' || res.success) ? 'success' : 'error',
    };
    writeNonTtyStatus({
      currentStep: step.index,
      steps: nonTtyStatusSteps.map(s => ({ ...s })),
    });
    if (!res || (typeof res === 'object' && !res.success)) {
      const component = getFailedComponentName(step.index);
      failedComponents.push(component);
      console.error(`[Build] Error: ${step.description} failed.`);
      
      const errorMsg = failedComponents.length === 1
        ? `Failed to build, error with ${failedComponents[0]}`
        : `Failed to build, errors with ${failedComponents.slice(0, -1).join(', ')} and ${failedComponents[failedComponents.length - 1]}`;
      
      notifier.notify({
        title: 'N-APT',
        message: errorMsg,
        icon: path.join(__dirname, 'public/icon-5112.png'),
      });
      process.exit(1);
    }
  }

  notifier.notify({
    title: 'N-APT  🧠',
    message: '✓ Finished building and running at http://localhost:5173',
    icon: path.join(__dirname, 'public/icon-5112.png'),
    open: 'http://localhost:5173',
  });
  console.log('✓ Finished building and running at http://localhost:5173');
  await new Promise(() => {});
}

// Main execution
if (isMainModule) {
  const orchestratorLockPath = path.resolve('.n-apt-build-orchestrator.lock');
  const releaseOrchestratorLock = acquireBuildOrchestratorLock(orchestratorLockPath);
  process.once('exit', releaseOrchestratorLock);

  void ensureDevStatusServer();

  if (!hasInteractiveTty) {
    runNonTtyBuild().catch((err) => {
      console.error('Non-TTY Build Error:', err);
      process.exit(1);
    });
  } else {

  const keepAlive = setInterval(() => {}, 60_000);
  let shutdownHandled = false;

  const cleanup = () => {
    clearInterval(keepAlive);
    releaseOrchestratorLock();
  };

  const handleProcessSignal = (exitCode: number) => {
    if (shutdownHandled) return;
    shutdownHandled = true;
    terminateKnownDevProcesses();
    cleanup();
    process.exit(exitCode);
  };

  // Ensure we stop background timers and children on process exit or crash.
  process.on('exit', cleanup);
  process.once('SIGINT', () => handleProcessSignal(130));
  process.once('SIGTERM', () => handleProcessSignal(143));

  process.on('uncaughtException', (err) => {
    terminateKnownDevProcesses();
    cleanup();
    console.error('Uncaught Exception:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    terminateKnownDevProcesses();
    cleanup();
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
  });

  render(<BuildOrchestrator />, {
    // The active step can grow/shrink as compiler output arrives. Ink's
    // incremental renderer can leave the previous row behind in that case,
    // making the Rust step and progress indicator appear twice.
    incrementalRendering: false,
    maxFps: 10,
  });
  }
}

export default BuildOrchestrator;
