#!/usr/bin/env node

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { render } from 'ink';
import { Box, Text, useApp, useInput } from 'ink';
import { spawn, spawnSync } from 'child_process';
import os from 'node:os';
import chalk from 'chalk';
import notifier from 'node-notifier';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRuntimeSummaryState,
  isRuntimeRecoverySignal,
  type FailingServices
} from './buildStatus';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types
interface ProcessStatus {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
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
  spinnerFrame: number;
  vitePid?: number;
  rustPid?: number;
  redisPid?: number;
  warningCount: number;
  errorDetails: string[];
  warningDetails: string[];
  activeBuildOutputStep?: number;
}

// Simple spinner animation
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const accentColors = {
  vite: '#8B71D9',
  rust: '#E59450',
  redis: '#931E16',
  wasm: '#AFA4FF',
};

const processSuffixes: Record<string, { text: string; color: string }> = {
  'Starting frontend server...': { text: ' Vite.', color: accentColors.vite },
  'Starting Redis database server...': { text: ' Redis.', color: accentColors.redis },
  'Swapping Redis Database...': { text: ' Redis.', color: accentColors.redis },
  'Building WASM SIMD module...': { text: ' Rust → WebAssembly.', color: accentColors.wasm },
  'N-APT Encrypted Modules...': { text: ' Rust.', color: accentColors.rust },
  'Building and starting Rust backend': { text: ' Rust.', color: accentColors.rust },
  'Starting frontend server': { text: ' Vite.', color: accentColors.vite },
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

// Process Step Component
const ProcessStep = ({ process, isActive, spinnerFrame, showOutput, onToggleOutput }: {
  process: ProcessStatus;
  isActive: boolean;
  spinnerFrame: number;
  showOutput?: boolean;
  onToggleOutput?: () => void;
}) => {
  const getStatusIcon = () => {
    switch (process.status) {
      case 'pending': return chalk.gray('○');
      case 'running': return chalk.blue(spinnerFrames[spinnerFrame % spinnerFrames.length]);
      case 'success': return chalk.green('✓');
      case 'error': return chalk.red('✗');
      default: return '○';
    }
  };

  const getStatusText = () => {
    switch (process.status) {
      case 'pending': return process.name;
      case 'running': return `${process.name}...`;
      case 'success': return process.name;
      case 'error': return process.name;
      default: return process.name;
    }
  };

  const getStatusColor = () => {
    switch (process.status) {
      case 'pending': return 'gray';
      case 'running': return 'blue';
      case 'success': return 'white';
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

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box flexDirection="row">
        <Text>
          <Text color={getStatusColor()}>
            {getStatusIcon()} {process.label ?? getStatusText()}
          </Text>
          {process.name === 'Swapping Redis Database...' ? (
            <Text color={accentColors.redis}> Redis.</Text>
          ) : processSuffixes[process.name] && (
            <Text color={processSuffixes[process.name].color}>{processSuffixes[process.name].text}</Text>
          )}
          {process.message && process.name !== 'N-APT Encrypted Modules...' && (
            <Text
              color={process.message.startsWith('⚠') ? 'yellow' : process.message.startsWith('✗') ? 'red' : process.message.startsWith('✔') ? 'green' : 'gray'}
            >
              {` ${process.message}`}
            </Text>
          )}
        </Text>
        {isActive && process.status === 'running' && (
          <Text color="blue"> {spinnerFrames[spinnerFrame % spinnerFrames.length]}</Text>
        )}
        {process.status === 'success' && isLongRunning && process.buildOutput && process.buildOutput.length > 0 && onToggleOutput && (
          <Text color="gray" bold> {showOutput ? '▼' : '▶'} </Text>
        )}
      </Box>
      {isActive && process.buildOutput && process.buildOutput.length > 0 && (
        <Box flexDirection="column" marginLeft={4} marginTop={0}>
          {process.buildOutput.slice(-10).map((line, idx) => (
            <Text key={idx} color="gray" dim>{line}</Text>
          ))}
        </Box>
      )}
      {!isActive && showOutput && process.buildOutput && process.buildOutput.length > 0 && (
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
  const activeChildrenRef = useRef<Array<ReturnType<typeof spawn>>>([]);
  const [buildState, setBuildState] = useState<BuildState>({
    processes: [
      { name: 'Cleaning up existing processes', status: 'pending' },
      { name: 'Starting Redis database server...', status: 'pending' },
      { name: 'Swapping Redis Database...', status: 'pending' },
      { name: 'Building WASM SIMD module...', status: 'pending' },
      { name: 'N-APT Encrypted Modules...', status: 'pending' },
      { name: 'Building and starting Rust backend', status: 'pending' },
      { name: 'Starting frontend server', status: 'pending' },
    ],
    currentStep: 0,
    isBuilding: false,
    errorCount: 0,
    startTime: Date.now(),
    spinnerFrame: 0,
    vitePid: undefined,
    rustPid: undefined,
    redisPid: undefined,
    warningCount: 0,
    errorDetails: [],
    warningDetails: [],
    activeBuildOutputStep: undefined,
  });

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
    setBuildState(prev => {
      const warningDetails = [...prev.warningDetails, trimmed].slice(-6);
      return { ...prev, warningDetails, warningCount: warningDetails.length };
    });
  }, []);

  const clearErrorDetails = useCallback(() => {
    setBuildState(prev => {
      if (prev.errorDetails.length === 0) {
        return prev;
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
    setBuildState(prev => {
      const processes = [...prev.processes];
      const process = { ...processes[stepIndex] };
      const buildOutput = process.buildOutput ? [...process.buildOutput, line] : [line];
      process.buildOutput = buildOutput.slice(-50);
      processes[stepIndex] = process;
      return { ...prev, processes };
    });
  }, []);

  const updateProcessStatus = useCallback((index: number, status: ProcessStatus['status'], message?: string, label?: string, buildOutput?: string[]) => {
    setBuildState(prev => ({
      ...prev,
      processes: prev.processes.map((proc, i) =>
        i === index ? { ...proc, status, message, label, buildOutput } : proc
      ),
    }));
  }, []);

  const requestShutdown = useCallback(() => {
    if (shutdownRequestedRef.current) {
      return;
    }

    shutdownRequestedRef.current = true;
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

    activeChildrenRef.current = [];
    exit();
  }, [exit]);

  const executeCommand = useCallback((command: string, description: string): Promise<{ success: boolean; output: string }> => {
    return new Promise((resolve) => {
      try {
        addLog(chalk.blue(`Executing: ${command}`));
        const child = spawn(command, [], {
          shell: true,
          cwd: './',
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });

        activeChildrenRef.current.push(child);
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          addLog(chunk.trim());
        });

        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          addLog(chalk.red(chunk.trim()));
        });

        child.on('close', (code) => {
          activeChildrenRef.current = activeChildrenRef.current.filter((proc) => proc !== child);
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
          appendErrorDetail(`${description}: ${errorMessage}`);
          resolve({ success: false, output: stdout });
        });

        child.on('error', (error: any) => {
          activeChildrenRef.current = activeChildrenRef.current.filter((proc) => proc !== child);
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

  const executeForegroundCommand = useCallback((command: string, description: string, stepIndex: number): Promise<{ success: boolean; output: string }> => {
    return new Promise((resolve) => {
      try {
        updateProcessStatus(stepIndex, 'running', undefined, 'Building backend... Rust.');
        setBuildState(prev => ({ ...prev, activeBuildOutputStep: stepIndex }));

        addLog(chalk.blue(`Executing foreground: ${command}`));
        const child = spawn(command, [], {
          shell: true,
          cwd: './',
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        activeChildrenRef.current.push(child);
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          appendBuildOutput(stepIndex, chunk.trim());
          addLog(chunk.trim());
        });

        child.stderr?.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          appendBuildOutput(stepIndex, chunk.trim());
          addLog(chalk.red(chunk.trim()));
        });

        child.on('close', (code) => {
          activeChildrenRef.current = activeChildrenRef.current.filter((proc) => proc !== child);
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
          appendErrorDetail(`${description}: ${errorMessage}`);
          resolve({ success: false, output: stdout });
        });

        child.on('error', (error: any) => {
          activeChildrenRef.current = activeChildrenRef.current.filter((proc) => proc !== child);
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
  }, [addLog, appendErrorDetail, appendBuildOutput, updateProcessStatus]);

  const startBackgroundProcess = useCallback((command: string, description: string, pidKey: 'vitePid' | 'rustPid' | 'redisPid'): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        addLog(chalk.blue(`Starting background: ${command}`));
        const child = spawn(command, [], {
          shell: true,
          stdio: 'pipe',
          detached: true,
          cwd: './' // Run from project root
        });

        child.stdout?.on('data', (data: any) => {
          const output = data.toString().trim();
          addLog(chalk.blue(`[${description}] ${output}`));
          if (/warning:/i.test(output)) {
            appendWarningDetail(output);
          }
          if (pidKey === 'vitePid' && isRuntimeRecoverySignal(output)) {
            clearErrorDetails();
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
            clearErrorDetails();
          } else if (/error/i.test(output)) {
            appendErrorDetail(output);
          }
        });

        child.on('error', (error: any) => {
          addLog(chalk.red(`Failed to start ${description}: ${error.message}`));
          appendErrorDetail(`${description}: ${error.message}`);
          resolve(false);
        });

        // Give it a moment to start
        setTimeout(() => {
          if (child.pid) {
            addLog(chalk.green(`${description} started (PID: ${child.pid})`));
            // Store the PID
            setBuildState(prev => ({ ...prev, [pidKey]: child.pid }));
            activeChildrenRef.current.push(child);
            child.unref(); // Allow parent to exit
            resolve(true);
          } else {
            addLog(chalk.red(`${description} failed to start`));
            appendErrorDetail(`${description} failed to start`);
            resolve(false);
          }
        }, 2000);

      } catch (error: any) {
        addLog(chalk.red(`Error starting ${description}: ${error.message}`));
        appendErrorDetail(`${description}: ${error.message}`);
        resolve(false);
      }
    });
  }, [addLog, appendErrorDetail, appendWarningDetail, clearErrorDetails]);

  const executeCompositeRustStep = useCallback(async (stepIndex: number): Promise<boolean> => {
    setBuildState(prev => ({ ...prev, activeBuildOutputStep: stepIndex }));

    try {
      // Step 1: Build
      addLog(chalk.blue(`Building Rust backend...`));
      const buildResult = await executeForegroundCommand(
        'cargo build --bin n-apt-backend --profile dev-fast',
        'Building Rust backend',
        stepIndex
      );

      if (!buildResult.success) {
        return false;
      }

      // Step 2: Start backend in background using startBackgroundProcess
      addLog(chalk.blue(`Starting Rust backend...`));
      const startResult = await startBackgroundProcess(
        isNativeWindows ? 'echo Windows' : 'cargo run --bin n-apt-backend --profile dev-fast',
        'Rust backend',
        'rustPid'
      );
      if (!startResult) {
        return false;
      }

      // Give the backend a moment to start listening
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 3: Wait for backend readiness
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

      const waitResult = await executeForegroundCommand(waitCommand, 'Waiting for backend', stepIndex);
      if (!waitResult.success) {
        return false;
      }

      addLog(chalk.green('Rust backend fully initialized and ready'));
      return true;

    } catch (error: any) {
      addLog(chalk.red(`Error in composite Rust step: ${error.message}`));
      appendErrorDetail(`Composite Rust backend setup failed: ${error.message}`);
      return false;
    } finally {
      setBuildState(prev => ({ ...prev, activeBuildOutputStep: undefined }));
    }
  }, [executeForegroundCommand, startBackgroundProcess, addLog, appendErrorDetail]);

  const runBuild = useCallback(async () => {
    setBuildState(prev => ({ ...prev, isBuilding: true }));

    const localOpenCellIdPath = process.env.LOCAL_OPENCELLID_CSV_DIR || 'data/opencellid';
    const redisPort = process.env.REDIS_PORT || '6379';
    const readRedisTowerCount = (db: string) => {
      const result = spawnSync('bash', ['-lc', `redis-cli -p ${redisPort} -n ${db} --raw keys 'tower:*' | wc -l`], { encoding: 'utf8' });
      if (result.status !== 0) return 0;
      const parsed = Number.parseInt((result.stdout || '').trim(), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const getTowerLoadDescription = () => {
      if (process.env.LOCAL_OPENCELLID_CSV_DIR) {
        return `Loading local OpenCellID data into Redis from ${localOpenCellIdPath}...`;
      }

      return (readRedisTowerCount('2') > 0 || readRedisTowerCount('3') > 0)
        ? 'Swapping Redis Database...'
        : 'Downloading OpenCellID data and loading it into Redis...';
    };

    const getTowerCountLabel = (stepLabel: string) => {
      if (stepLabel.startsWith('Swapping Redis Database')) {
        return { count: readRedisTowerCount('2'), source: 'Fast DB' };
      }

      if (stepLabel.startsWith('Loading local OpenCellID data into Redis')) {
        return { count: readRedisTowerCount('2'), source: 'Fast DB' };
      }

      return { count: readRedisTowerCount('3'), source: 'Whole DB' };
    };

    const steps = [
      {
        index: 0,
        command: isNativeWindows ? 'echo Windows cleanup is skipped; use manual process cleanup if needed.' : `bash -lc "
set -euo pipefail
pkill -f 'n-apt-backend' 2>/dev/null || true
pkill -f 'target/debug/n-apt-backend' 2>/dev/null || true
pkill -f 'target/release/n-apt-backend' 2>/dev/null || true
pkill -f 'target/dev-fast/n-apt-backend' 2>/dev/null || true
pkill -f 'vite' 2>/dev/null || true
pkill -f 'node_modules/.bin/vite' 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
lsof -ti:8765 | xargs kill -9 2>/dev/null || true
sleep 1
"`,
        description: 'Cleaning up existing processes',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 1,
        command: `bash -lc "
set -euo pipefail
REDIS_PORT=6379
DATA_DIR='.redis_data'
mkdir -p "$DATA_DIR"
if command -v redis-server >/dev/null 2>&1 && command -v redis-cli >/dev/null 2>&1; then
  if lsof -ti:$REDIS_PORT >/dev/null 2>&1; then
    exit 0
  fi
  redis-server --port $REDIS_PORT --dir "$DATA_DIR" --daemonize yes --appendonly yes
  sleep 2
  if ! lsof -ti:$REDIS_PORT >/dev/null 2>&1; then
    echo 'Failed to start redis-server'
    exit 1
  fi
else
  echo 'redis-server and redis-cli are required on PATH'
  exit 1
fi
"`,
        description: 'Starting Redis database server',
        isBackground: true,
        pidKey: 'redisPid' as const,
      },
      {
        index: 2,
        command: isNativeWindows ? 'echo Redis tower swap requires bash/redis-cli on non-Windows environments.' : `bash -lc '
set -euo pipefail
REDIS_PORT="${'${'}REDIS_PORT:-6379}"
if ! [[ "$REDIS_PORT" =~ ^[0-9]+$ ]] || [ "$REDIS_PORT" -le 0 ] || [ "$REDIS_PORT" -gt 65535 ]; then
  REDIS_PORT=6379
fi
if [ ! -f "scripts/redis/download_opencellid_cached.cjs" ]; then
  echo "scripts/redis/download_opencellid_cached.cjs missing; skipping tower import"
  exit 0
fi

# Add timeout to prevent hanging (30 seconds instead of 5 minutes)
timeout 30 npm run towers:download:cached || {
  echo "Tower download timed out or failed; skipping tower import"
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
'`,
        description: 'Swapping Redis Database...',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 3,
        command: 'npm run build:wasm -- --force',
        description: 'Building WASM SIMD module',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 4,
        command: isNativeWindows ? 'echo Encrypted module decrypt step is not supported in this Windows shell path.' : `bash -lc '
set -euo pipefail
if npm run decrypt-modules >/dev/null 2>&1; then
  if [ -f "src/encrypted-modules/tmp/rs/simd/fast_math.rs" ]; then
    echo "${encryptedModulesStatus.success}"
    exit 0
  fi
  echo "${encryptedModulesStatus.warning}"
  exit 0
fi
echo "${encryptedModulesStatus.error}"
exit 1
'`,
        description: 'N-APT Encrypted Modules',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 5,
        command: undefined, // Will execute composite command in handler
        description: 'Starting Rust backend',
        isBackground: false,
        pidKey: undefined,
        label: 'Building and starting backend... Rust.',
        isCompositeRustStep: true,
      },
      {
        index: 6,
        command: isNativeWindows ? 'npx vite dev --host --force' : `bash -lc '
set -euo pipefail
# Don't clear Vite cache - it causes significant startup latency
# rm -rf node_modules/.vite
exec node_modules/.bin/vite dev --host --force
'`,
        description: 'Starting frontend server',
        isBackground: true,
        pidKey: 'vitePid' as const,
        showOutput: false,
      },
    ];

    for (const step of steps) {
      updateProcessStatus(step.index, 'running');

      let success: boolean;
      const stepLabelBase = step.index === 2 ? getTowerLoadDescription() : step.description;
      const stepLabel = step.index === 0 ? stepLabelBase : withEllipsis(stepLabelBase);
      const runningLabel = step.label ?? stepLabel;
      updateProcessStatus(step.index, 'running', undefined, runningLabel);

      if (step.isCompositeRustStep) {
        // Execute composite Rust build → start → wait sequence
        success = await executeCompositeRustStep(step.index);
      } else if (step.isBackground && step.pidKey) {
        success = await startBackgroundProcess(step.command, step.description, step.pidKey);
      } else if (step.isBackground) {
        success = await startBackgroundProcess(step.command, step.description, 'vitePid');
      } else {
        const _stepIndex = step.index;
        const result = await executeCommand(step.command, stepLabel);
        success = result.success;
      }

      if (success) {
        if (step.index === 2) {
          const { count, source } = getTowerCountLabel(stepLabel);
          updateProcessStatus(step.index, 'success', `(${count} towers in DB / ${source})`, stepLabel);
        } else if (step.index === 5) {
          updateProcessStatus(step.index, 'success', undefined, 'Rust backend running');
        } else {
          updateProcessStatus(step.index, 'success', undefined, stepLabel);
        }
      } else {
        updateProcessStatus(step.index, 'error', undefined, stepLabel);
        appendErrorDetail(`${step.description} failed`);
      }

      // Small delay between steps for visual clarity
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 500);
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
  }, [updateProcessStatus, executeCommand, startBackgroundProcess, appendErrorDetail, executeCompositeRustStep]);

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
    if (!buildState.isBuilding && buildState.currentStep === 0) {
      runBuild();
    }
  }, []);

  // Spinner animation
  useEffect(() => {
    if (buildState.isBuilding) {
      const interval = setInterval(() => {
        setBuildState(prev => ({
          ...prev,
          spinnerFrame: (prev.spinnerFrame + 1) % spinnerFrames.length
        }));
      }, 100);
      return () => clearInterval(interval);
    }
  }, [buildState.isBuilding]);

  const hasErrors = buildState.processes.some(p => p.status === 'error');
  const hasCompilationErrors = buildState.errorDetails.length > 0;
  const allComplete = buildState.processes.every(p => p.status === 'success' || p.status === 'error');
  const runtimeSeconds = Math.floor((Date.now() - buildState.startTime) / 1000);
  const runtimeSummary = getRuntimeSummaryState({
    hasErrors,
    hasCompilationErrors,
    vitePid: buildState.vitePid,
    rustPid: buildState.rustPid,
    redisPid: buildState.redisPid,
    failingServices: hasErrors || hasCompilationErrors ? getFailingServices(buildState.errorDetails) : []
  });
  const statusLabel = runtimeSummary.label;
  const statusColor = runtimeSummary.color;
  const vitePidText = buildState.vitePid ?? '—';
  const rustPidText = buildState.rustPid ?? '—';
  const redisPidText = buildState.redisPid ?? '—';

  // Send notification on successful build completion
  useEffect(() => {
    if (allComplete && !hasErrors && !hasCompilationErrors && buildState.vitePid && buildState.rustPid && buildState.redisPid) {
      notifier.notify({
        title: 'N-APT  🧠',
        message: '✓ Finished building and running at http://localhost:5173',
        icon: path.join(__dirname, 'public/icon-5112.png'),
        open: 'http://localhost:5173',
      });
    }
  }, [allComplete, hasErrors, hasCompilationErrors, buildState.vitePid, buildState.rustPid, buildState.redisPid]);

  const [expandedOutputStep, setExpandedOutputStep] = useState<number | null>(null);

  const toggleOutput = useCallback((index: number) => {
    setExpandedOutputStep(prev => prev === index ? null : index);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Logo />

      <Box flexDirection="column" marginTop={1} alignItems="flex-start">
        <Text color="white" bold>N-APT / SDR Visualizer and studio for 🧠 N-APT signals (the NSA's neurotechnology via radio waves)</Text>
        <Text color="white">N-APT works as low frequency radio waves (really huge but intersects at person's body, heterodyned and APT-like) that writes to both alter and read then streams (write/read on repeat) a person's brain and nervous system.</Text>
        <Text color="white">Read more at https://github.com/ceane/n-apt</Text>
        <Text color="gray">Press 'q' or ESC to exit</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} gap={0}>
        {buildState.processes.map((process, index) => (
          <ProcessStep
            key={index}
            process={process}
            isActive={index === buildState.currentStep && buildState.isBuilding}
            spinnerFrame={buildState.spinnerFrame}
            showOutput={expandedOutputStep === index}
            onToggleOutput={() => toggleOutput(index)}
          />
        ))}
      </Box>

      {buildState.isBuilding && (
        <Box marginTop={1}>
          <Text color="blue">
            {spinnerFrames[buildState.spinnerFrame % spinnerFrames.length]} Building in progress...
          </Text>
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
                <Text color={statusColor} bold>{statusLabel}</Text>
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
                  <Text color="gray">running in {runtimeSeconds}s</Text>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  render(<BuildOrchestrator />);
}

export default BuildOrchestrator;
