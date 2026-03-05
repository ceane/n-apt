/** @jsxImportSource @rezi-ui/jsx */
import { createNodeApp } from "@rezi-ui/node";
import { Column, Row, Spacer, Text, Button, Box } from "@rezi-ui/jsx";
import { useState, useEffect } from "@rezi-ui/node";
import { spawn, ChildProcess } from "child_process";

// Build step state interface
interface BuildStepState {
  status: 'pending' | 'running' | 'success' | 'failed';
  output: string;
  duration: number;
  pid?: number;
  error?: string;
}

// Main build state interface
interface BuildState {
  cleanup: BuildStepState;
  frontend: BuildStepState;
  wasm: BuildStepState;
  backend: BuildStepState;
  overall: 'pending' | 'running' | 'completed' | 'failed';
  startTime: number;
  totalTime: number;
}

// Process management utilities
class ProcessManager {
  private processes: Map<string, ChildProcess> = new Map();

  async runCommand(command: string, args: string[], logFile: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
      });

      let output = '';
      child.stdout?.on('data', (data) => {
        output += data.toString();
      });
      child.stderr?.on('data', (data) => {
        output += data.toString();
      });

      child.on('close', (code: number | null) => {
        if (logFile) {
          require('fs').writeFileSync(logFile, output);
        }
        resolve(code === 0);
      });

      child.on('error', () => {
        if (logFile) {
          require('fs').writeFileSync(logFile, output);
        }
        resolve(false);
      });

      this.processes.set(command, child);
    });
  }

  async runBackgroundCommand(command: string, args: string[], logFile: string): Promise<number | null> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        detached: true
      });

      child.unref();

      // Redirect output to log file
      if (logFile) {
        const logStream = require('fs').createWriteStream(logFile);
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);
      }

      child.on('spawn', () => {
        resolve(child.pid || null);
      });

      child.on('error', () => {
        resolve(null);
      });
    });
  }

  killAll() {
    this.processes.forEach((process) => {
      try {
        process.kill();
      } catch (error) {
        // Process already terminated
      }
    });
    this.processes.clear();
  }
}

// Build commands
const buildCommands = {
  cleanup: async (): Promise<boolean> => {
    const { spawn } = require('child_process');
    return new Promise((resolve) => {
      const child = spawn('./scripts/kill_blockers.sh', { shell: true, stdio: 'ignore' });
      child.on('close', (code: number | null) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  },

  startFrontend: async (): Promise<boolean> => {
    const manager = new ProcessManager();
    // Clear Vite cache
    spawn('rm', ['-rf', 'node_modules/.vite', 'node_modules/.cache/vite'], { stdio: 'ignore' });
    
    const pid = await manager.runBackgroundCommand(
      'node_modules/.bin/vite',
      ['dev', '--host'],
      '/tmp/vite_output.log'
    );
    
    return pid !== null;
  },

  buildWasm: async (): Promise<boolean> => {
    const manager = new ProcessManager();
    return await manager.runCommand(
      'wasm-pack',
      ['build', '--target', 'web', '--out-dir', 'packages/n_apt_canvas', '--dev'],
      '/tmp/wasm_build.log'
    );
  },

  buildBackend: async (): Promise<boolean> => {
    const manager = new ProcessManager();
    return await manager.runCommand(
      'cargo',
      ['build', '--profile', 'dev-fast', '--bin', 'n-apt-backend'],
      '/tmp/cargo_build.log'
    );
  },

  startBackend: async (): Promise<boolean> => {
    const manager = new ProcessManager();
    const pid = await manager.runBackgroundCommand(
      './target/dev-fast/n-apt-backend',
      [],
      '/tmp/rust_output.log'
    );
    
    return pid !== null;
  }
};

// Main application component
const BuildOrchestrator = () => {
  const [buildState, setBuildState] = useState<BuildState>({
    cleanup: { status: 'pending', output: '', duration: 0 },
    frontend: { status: 'pending', output: '', duration: 0 },
    wasm: { status: 'pending', output: '', duration: 0 },
    backend: { status: 'pending', output: '', duration: 0 },
    overall: 'pending',
    startTime: Date.now(),
    totalTime: 0
  });

  const [isRunning, setIsRunning] = useState(false);

  // Update total time
  useEffect(() => {
    if (buildState.overall === 'running') {
      const interval = setInterval(() => {
        setBuildState((prev: BuildState) => ({
          ...prev,
          totalTime: Date.now() - prev.startTime
        }));
      }, 100);
      return () => clearInterval(interval);
    }
  }, [buildState.overall]);

  const runBuildPipeline = async () => {
    setIsRunning(true);
    setBuildState((prev: BuildState) => ({ ...prev, overall: 'running', startTime: Date.now() }));

    try {
      // Step 1: Cleanup
      setBuildState((prev: BuildState) => ({ 
        ...prev, 
        cleanup: { ...prev.cleanup, status: 'running' }
      }));
      const cleanupSuccess = await buildCommands.cleanup();
      setBuildState((prev: BuildState) => ({
        ...prev,
        cleanup: {
          ...prev.cleanup,
          status: cleanupSuccess ? 'success' : 'failed',
          duration: Date.now() - prev.startTime
        }
      }));

      // Step 2: Start Frontend
      setBuildState((prev: BuildState) => ({ 
        ...prev, 
        frontend: { ...prev.frontend, status: 'running' }
      }));
      const frontendSuccess = await buildCommands.startFrontend();
      setBuildState((prev: BuildState) => ({
        ...prev,
        frontend: {
          ...prev.frontend,
          status: frontendSuccess ? 'success' : 'failed',
          duration: Date.now() - prev.startTime
        }
      }));

      // Step 3: Build WASM
      setBuildState((prev: BuildState) => ({ 
        ...prev, 
        wasm: { ...prev.wasm, status: 'running' }
      }));
      const wasmSuccess = await buildCommands.buildWasm();
      setBuildState((prev: BuildState) => ({
        ...prev,
        wasm: {
          ...prev.wasm,
          status: wasmSuccess ? 'success' : 'failed',
          duration: Date.now() - prev.startTime
        }
      }));

      // Step 4: Build Backend
      setBuildState((prev: BuildState) => ({ 
        ...prev, 
        backend: { ...prev.backend, status: 'running' }
      }));
      const backendSuccess = await buildCommands.buildBackend();
      setBuildState((prev: BuildState) => ({
        ...prev,
        backend: {
          ...prev.backend,
          status: backendSuccess ? 'success' : 'failed',
          duration: Date.now() - prev.startTime
        }
      }));

      // Step 5: Start Backend (if build succeeded)
      let backendStarted = false;
      if (backendSuccess) {
        setBuildState((prev: BuildState) => ({ 
          ...prev, 
          backend: { ...prev.backend, status: 'running' }
        }));
        backendStarted = await buildCommands.startBackend();
        setBuildState((prev: BuildState) => ({
          ...prev,
          backend: {
            ...prev.backend,
            status: backendStarted ? 'success' : 'failed',
            duration: Date.now() - prev.startTime
          }
        }));
      }

      // Determine overall status
      const hasFailures = !cleanupSuccess || !frontendSuccess || !wasmSuccess || !backendStarted;
      setBuildState((prev: BuildState) => ({
        ...prev,
        overall: hasFailures ? 'failed' : 'completed'
      }));

    } catch (error) {
      setBuildState((prev: BuildState) => ({
        ...prev,
        overall: 'failed'
      }));
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: BuildStepState['status']) => {
    switch (status) {
      case 'pending': return '○';
      case 'running': return '◐';
      case 'success': return '✓';
      case 'failed': return '✗';
    }
  };

  return (
    <Column p={2} gap={1}>
      {/* Header */}
      <Box border="single" p={1}>
        <Column gap={1}>
          <Row items="center" gap={1}>
            <Text>┌─────┐</Text>
          </Row>
          <Row items="center" gap={1}>
            <Text>│ n a │</Text>
            <Spacer flex={1} />
            <Text>
              {getStatusIcon(buildState.overall)} N-APT Build Orchestrator
            </Text>
          </Row>
          <Row items="center" gap={1}>
            <Text>│ p t │</Text>
            <Spacer flex={1} />
            <Text>(c) 2026 🇺🇸 Made in the USA</Text>
          </Row>
          <Row items="center" gap={1}>
            <Text>└─────┘</Text>
          </Row>
        </Column>
      </Box>

      {/* Build Steps */}
      <Box border="single" p={1}>
        <Column gap={1}>
          <Text bold={true}>Build Pipeline</Text>
          
          <Row gap={2}>
            <Text>Cleanup:</Text>
            <Text>
              {getStatusIcon(buildState.cleanup.status)} {buildState.cleanup.status}
            </Text>
            {buildState.cleanup.duration > 0 && (
              <Text>({buildState.cleanup.duration}ms)</Text>
            )}
          </Row>

          <Row gap={2}>
            <Text>Frontend:</Text>
            <Text>
              {getStatusIcon(buildState.frontend.status)} {buildState.frontend.status}
            </Text>
            {buildState.frontend.duration > 0 && (
              <Text>({buildState.frontend.duration}ms)</Text>
            )}
          </Row>

          <Row gap={2}>
            <Text>WASM:</Text>
            <Text>
              {getStatusIcon(buildState.wasm.status)} {buildState.wasm.status}
            </Text>
            {buildState.wasm.duration > 0 && (
              <Text>({buildState.wasm.duration}ms)</Text>
            )}
          </Row>

          <Row gap={2}>
            <Text>Backend:</Text>
            <Text>
              {getStatusIcon(buildState.backend.status)} {buildState.backend.status}
            </Text>
            {buildState.backend.duration > 0 && (
              <Text>({buildState.backend.duration}ms)</Text>
            )}
          </Row>
        </Column>
      </Box>

      {/* URLs and Info */}
      <Box border="single" p={1}>
        <Column gap={1}>
          <Text bold={true}>Services</Text>
          <Text>🧠 http://localhost:5173</Text>
          <Text>           cmd + click to open in default browser</Text>
          <Text>http://localhost:8765</Text>
          <Text>           (websockets backend)</Text>
          <Text>packages/n_apt_canvas (WebGPU wasm_simd build)</Text>
          <Text>/tmp/rust_output.log (Rust logs)</Text>
        </Column>
      </Box>

      {/* Controls */}
      <Row gap={1}>
        <Button 
          id="start-build"
          label={isRunning ? "Building..." : "Start Build"} 
          intent={isRunning ? "secondary" : "primary"}
          onPress={runBuildPipeline}
          disabled={isRunning}
        />
        <Button 
          id="exit"
          label="Exit" 
          intent="danger"
          onPress={() => app.stop()}
        />
        <Spacer flex={1} />
        <Text>Total time: {(buildState.totalTime / 1000).toFixed(2)}s</Text>
      </Row>

      {/* Status Bar */}
      <Box border="single" p={1}>
        <Row items="center" gap={2}>
          <Text>✗ 0 errors</Text>
          <Text>▲ 0 warnings</Text>
          <Spacer flex={1} />
          <Text>Press Ctrl+C to stop all services</Text>
        </Row>
      </Box>
    </Column>
  );
};

// Create and start the Rezi application
const app = createNodeApp<{}>({
  initialState: {},
});

app.view(() => <BuildOrchestrator />);

// Handle keyboard shortcuts
app.keys({
  q: () => app.stop(),
  'ctrl-c': () => app.stop(),
});

// Cleanup on exit
process.on('exit', () => {
  const manager = new ProcessManager();
  manager.killAll();
});

// Start the application
app.start().catch(console.error);
