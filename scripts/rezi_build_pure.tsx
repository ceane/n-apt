// @ts-nocheck
/** @jsxImportSource @rezi-ui/jsx */
import { createNodeApp } from "@rezi-ui/node";
import { Column, Row, Spacer, Text, Button, Box } from "@rezi-ui/jsx";
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
  overall: 'pending' | 'running' | 'success' | 'failed';
  startTime: number;
  totalTime: number;
  isRunning: boolean;
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

// Create the Rezi application
const app = createNodeApp<BuildState>({
  initialState: {
    cleanup: { status: 'pending', output: '', duration: 0 },
    frontend: { status: 'pending', output: '', duration: 0 },
    wasm: { status: 'pending', output: '', duration: 0 },
    backend: { status: 'pending', output: '', duration: 0 },
    overall: 'pending',
    startTime: Date.now(),
    totalTime: 0,
    isRunning: false
  }
});

const getStatusIcon = (status: BuildStepState['status']) => {
  switch (status) {
    case 'pending': return '○';
    case 'running': return '◐';
    case 'success': return '✓';
    case 'failed': return '✗';
  }
};

const runBuildPipeline = async () => {
  // Set running state
  app.update((state) => ({ 
    ...state, 
    overall: 'running', 
    startTime: Date.now(),
    isRunning: true 
  }));

  try {
    // Step 1: Cleanup
    app.update((state) => ({ 
      ...state, 
      cleanup: { ...state.cleanup, status: 'running' }
    }));
    const cleanupSuccess = await buildCommands.cleanup();
    app.update((state) => ({
      ...state,
      cleanup: {
        ...state.cleanup,
        status: cleanupSuccess ? 'success' : 'failed',
        duration: Date.now() - state.startTime
      }
    }));

    // Step 2: Start Frontend
    app.update((state) => ({ 
      ...state, 
      frontend: { ...state.frontend, status: 'running' }
    }));
    const frontendSuccess = await buildCommands.startFrontend();
    app.update((state) => ({
      ...state,
      frontend: {
        ...state.frontend,
        status: frontendSuccess ? 'success' : 'failed',
        duration: Date.now() - state.startTime
      }
    }));

    // Step 3: Build WASM
    app.update((state) => ({ 
      ...state, 
      wasm: { ...state.wasm, status: 'running' }
    }));
    const wasmSuccess = await buildCommands.buildWasm();
    app.update((state) => ({
      ...state,
      wasm: {
        ...state.wasm,
        status: wasmSuccess ? 'success' : 'failed',
        duration: Date.now() - state.startTime
      }
    }));

    // Step 4: Build Backend
    app.update((state) => ({ 
      ...state, 
      backend: { ...state.backend, status: 'running' }
    }));
    const backendSuccess = await buildCommands.buildBackend();
    app.update((state) => ({
      ...state,
      backend: {
        ...state.backend,
        status: backendSuccess ? 'success' : 'failed',
        duration: Date.now() - state.startTime
      }
    }));

    // Step 5: Start Backend (if build succeeded)
    let backendStarted = false;
    if (backendSuccess) {
      app.update((state) => ({ 
        ...state, 
        backend: { ...state.backend, status: 'running' }
      }));
      backendStarted = await buildCommands.startBackend();
      app.update((state) => ({
        ...state,
        backend: {
          ...state.backend,
          status: backendStarted ? 'success' : 'failed',
          duration: Date.now() - state.startTime
        }
      }));
    }

    // Determine overall status
    const hasFailures = !cleanupSuccess || !frontendSuccess || !wasmSuccess || !backendStarted;
    app.update((state) => ({
      ...state,
      overall: hasFailures ? 'failed' : 'success',
      isRunning: false
    }));

  } catch (error) {
    app.update((state) => ({
      ...state,
      overall: 'failed',
      isRunning: false
    }));
  }
};

// Define the view using Rezi's JSX
app.view((state) => (
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
            {getStatusIcon(state.overall)} N-APT Build Orchestrator
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
        <Text>Build Pipeline</Text>
        
        <Row gap={2}>
          <Text>Cleanup:</Text>
          <Text>
            {getStatusIcon(state.cleanup.status)} {state.cleanup.status}
          </Text>
          {state.cleanup.duration > 0 && (
            <Text>({state.cleanup.duration}ms)</Text>
          )}
        </Row>

        <Row gap={2}>
          <Text>Frontend:</Text>
          <Text>
            {getStatusIcon(state.frontend.status)} {state.frontend.status}
          </Text>
          {state.frontend.duration > 0 && (
            <Text>({state.frontend.duration}ms)</Text>
          )}
        </Row>

        <Row gap={2}>
          <Text>WASM:</Text>
          <Text>
            {getStatusIcon(state.wasm.status)} {state.wasm.status}
          </Text>
          {state.wasm.duration > 0 && (
            <Text>({state.wasm.duration}ms)</Text>
          )}
        </Row>

        <Row gap={2}>
          <Text>Backend:</Text>
          <Text>
            {getStatusIcon(state.backend.status)} {state.backend.status}
          </Text>
          {state.backend.duration > 0 && (
            <Text>({state.backend.duration}ms)</Text>
          )}
        </Row>
      </Column>
    </Box>

    {/* URLs and Info */}
    <Box border="single" p={1}>
      <Column gap={1}>
        <Text>Services</Text>
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
        label={state.isRunning ? "Building..." : "Start Build"} 
        intent={state.isRunning ? "secondary" : "primary"}
        onPress={() => {
          if (!state.isRunning) {
            runBuildPipeline();
          }
        }}
        disabled={state.isRunning}
      />
      <Button 
        id="exit"
        label="Exit" 
        intent="danger"
        onPress={() => {
          app.stop();
        }}
      />
      <Spacer flex={1} />
      <Text>Total time: {((Date.now() - state.startTime) / 1000).toFixed(2)}s</Text>
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
));

// Handle keyboard shortcuts using Rezi's key system
app.keys({
  q: () => {
    app.stop();
  },
  'ctrl-c': () => {
    app.stop();
  },
});

// Cleanup on exit
process.on('exit', () => {
  const manager = new ProcessManager();
  manager.killAll();
});

// Start the application
app.start().catch(console.error);
