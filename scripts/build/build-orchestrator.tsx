#!/usr/bin/env node

import React, { useEffect, useState, useCallback } from 'react';
import { render } from 'ink';
import { Box, Text, useApp, useInput } from 'ink';
import { execSync, spawn } from 'child_process';
import chalk from 'chalk';

// Types
interface ProcessStatus {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
  pid?: number;
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
  'Starting Redis server...': { text: ' Redis.', color: accentColors.redis },
  'Building WASM SIMD module...': { text: ' Rust → WebAssembly.', color: accentColors.wasm },
  'Starting Rust backend...': { text: ' Rust.', color: accentColors.rust },
};

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
const ProcessStep = ({ process, isActive, spinnerFrame }: { process: ProcessStatus; isActive: boolean; spinnerFrame: number }) => {
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

  return (
    <Box flexDirection="row" marginBottom={0}>
      <Text>
        <Text color={getStatusColor()}>
          {getStatusIcon()} {getStatusText()}
        </Text>
        {processSuffixes[process.name] && (
          <Text color={processSuffixes[process.name].color}>{processSuffixes[process.name].text}</Text>
        )}
      </Text>
      {isActive && process.status === 'running' && (
        <Text color="blue"> {spinnerFrames[spinnerFrame % spinnerFrames.length]}</Text>
      )}
    </Box>
  );
};

// Main Build Orchestrator Component
const BuildOrchestrator = () => {
  const { exit } = useApp();
  const [buildState, setBuildState] = useState<BuildState>({
    processes: [
      { name: 'Cleaning up existing processes...', status: 'pending' },
      { name: 'Starting frontend server...', status: 'pending' },
      { name: 'Starting Redis server...', status: 'pending' },
      { name: 'Loading fast select towers (for UI)...', status: 'pending' },
      { name: 'Building WASM SIMD module...', status: 'pending' },
      { name: 'Starting Rust backend...', status: 'pending' },
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
  });

  const addLog = useCallback((message: string) => {
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

  const updateProcessStatus = useCallback((index: number, status: ProcessStatus['status']) => {
    setBuildState(prev => ({
      ...prev,
      processes: prev.processes.map((proc, i) =>
        i === index ? { ...proc, status } : proc
      ),
    }));
  }, []);

  const executeCommand = useCallback((command: string, description: string): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        addLog(chalk.blue(`Executing: ${command}`));
        const result = execSync(command, {
          encoding: 'utf8',
          stdio: 'pipe',
          cwd: './' // Run from project root
        });

        if (result.trim()) {
          addLog(chalk.green(result.trim()));
        }
        addLog(chalk.green(`${description} completed successfully`));
        resolve(true);
      } catch (error: any) {
        addLog(chalk.red(`Error in ${description}: ${error.message}`));
        appendErrorDetail(`${description}: ${error.message}`);
        if (error.stdout) {
          addLog(chalk.yellow(`stdout: ${error.stdout}`));
          appendWarningDetail(error.stdout);
        }
        if (error.stderr) {
          addLog(chalk.red(`stderr: ${error.stderr}`));
          appendErrorDetail(error.stderr);
        }
        resolve(false);
      }
    });
  }, [addLog, appendErrorDetail, appendWarningDetail]);

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
        });

        child.stderr?.on('data', (data: any) => {
          const output = data.toString().trim();
          addLog(chalk.red(`[${description} ERROR] ${output}`));
          if (/warning:/i.test(output)) {
            appendWarningDetail(output);
          }
          if (/error/i.test(output)) {
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
  }, [addLog, appendErrorDetail, appendWarningDetail]);

  const runBuild = useCallback(async () => {
    setBuildState(prev => ({ ...prev, isBuilding: true }));

    const steps = [
      {
        index: 0,
        command: `bash -lc "
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
        command: 'node_modules/.bin/vite dev --host',
        description: 'Starting frontend server',
        isBackground: true,
        pidKey: 'vitePid' as const,
      },
      {
        index: 2,
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
        description: 'Starting Redis server',
        isBackground: true,
        pidKey: 'redisPid' as const,
      },
      {
        index: 3,
        command: `bash -lc "
set -euo pipefail
REDIS_PORT=\"\${REDIS_PORT:-6379}\"
if [ -z \"$REDIS_PORT\" ] || [ \"$REDIS_PORT\" = '0' ]; then
  REDIS_PORT=6379
fi
if ! command -v redis-cli >/dev/null 2>&1; then
  echo 'redis-cli not available'
  exit 1
fi
if ! redis-cli -p $REDIS_PORT ping >/dev/null 2>&1; then
  echo 'Redis must be running before loading towers'
  exit 1
fi
FAST_COUNT=$(redis-cli -p $REDIS_PORT -n 2 dbsize 2>/dev/null || echo 0)
FULL_COUNT=$(redis-cli -p $REDIS_PORT -n 3 dbsize 2>/dev/null || echo 0)
if [ "$FAST_COUNT" -gt 0 ] && [ "$FULL_COUNT" -gt 0 ]; then
  exit 0
fi
if [ ! -f 'scripts/redis/download_opencellid_cached.cjs' ]; then
  echo 'scripts/redis/download_opencellid_cached.cjs missing; skipping tower import'
  exit 0
fi
if npm run towers:download:cached; then
  TEMP_FAST=$(redis-cli -p $REDIS_PORT -n 0 dbsize 2>/dev/null || echo 0)
  TEMP_FULL=$(redis-cli -p $REDIS_PORT -n 1 dbsize 2>/dev/null || echo 0)
  if [ "$TEMP_FAST" -eq 0 ] || [ "$TEMP_FULL" -eq 0 ]; then
    echo 'Tower download skipped or produced no data; leaving existing DBs untouched.'
    exit 0
  fi
  redis-cli -p $REDIS_PORT swapdb 0 2 >/dev/null
  redis-cli -p $REDIS_PORT swapdb 1 3 >/dev/null
  exit 0
fi
echo 'Failed to load tower data'
exit 1
"`,
        description: 'Loading fast select towers',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 4,
        command: 'npm run build:wasm',
        description: 'Building WASM SIMD module',
        isBackground: false,
        pidKey: undefined,
      },
      {
        index: 5,
        command: 'cargo run --bin n-apt-backend',
        description: 'Starting Rust backend',
        isBackground: true,
        pidKey: 'rustPid' as const,
      },
    ];

    for (const step of steps) {
      updateProcessStatus(step.index, 'running');

      let success: boolean;
      if (step.isBackground && step.pidKey) {
        success = await startBackgroundProcess(step.command, step.description, step.pidKey);
      } else if (step.isBackground) {
        success = await startBackgroundProcess(step.command, step.description, 'vitePid');
      } else {
        success = await executeCommand(step.command, step.description);
      }

      if (success) {
        updateProcessStatus(step.index, 'success');
      } else {
        updateProcessStatus(step.index, 'error');
        appendErrorDetail(`${step.description} failed`);
      }

      // Small delay between steps for visual clarity
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setBuildState(prev => ({ ...prev, isBuilding: false }));
  }, [updateProcessStatus, executeCommand, startBackgroundProcess, appendErrorDetail]);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape || key.ctrl || input === 'q') {
      addLog(chalk.yellow('Build interrupted by user'));
      exit();
    }
  });

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
  const allComplete = buildState.processes.every(p => p.status === 'success' || p.status === 'error');
  const runtimeSeconds = Math.floor((Date.now() - buildState.startTime) / 1000);
  const statusLabel = hasErrors ? '✗ Stopped' : '✓ Running';
  const statusColor = hasErrors ? 'red' : 'green';
  const vitePidText = buildState.vitePid ?? '—';
  const rustPidText = buildState.rustPid ?? '—';
  const redisPidText = buildState.redisPid ?? '—';

  return (
    <Box flexDirection="column" padding={1}>
      <Logo />

      <Box flexDirection="column" marginTop={1} alignItems="flex-start">
        <Text color="white" bold>N-APT Build Orchestrator - Ink Version</Text>
        <Text color="gray">Press 'q' or ESC to exit</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} gap={0}>
        {buildState.processes.map((process, index) => (
          <ProcessStep
            key={index}
            process={process}
            isActive={index === buildState.currentStep && buildState.isBuilding}
            spinnerFrame={buildState.spinnerFrame}
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
                    <Text color="gray">(site)</Text>
                  </Text>
                  <Text color="gray">cmd + click to open in default browser</Text>
                  <Text> </Text>
                  <Text>
                    <Text color={accentColors.rust}>http://localhost:8765</Text>{' '}
                    <Text color="gray">(websockets backend)</Text>
                  </Text>
                  <Text color={accentColors.wasm}>packages/n_apt_canvas (WebGPU wasm_simd build)</Text>
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
