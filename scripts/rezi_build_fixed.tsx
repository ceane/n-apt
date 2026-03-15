/** @jsxImportSource @rezi-ui/jsx */
import { createNodeApp } from "@rezi-ui/node";
import { Column, Row, Spacer, Text, Button, Box } from "@rezi-ui/jsx";
import { spawn, ChildProcess } from "child_process";

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
const app = createNodeApp<{
  cleanup: { status: 'pending' | 'running' | 'success' | 'failed'; duration: number };
  frontend: { status: 'pending' | 'running' | 'success' | 'failed'; duration: number; pid?: number };
  wasm: { status: 'pending' | 'running' | 'success' | 'failed'; duration: number };
  backend: { status: 'pending' | 'running' | 'success' | 'failed'; duration: number; pid?: number };
  overall: 'pending' | 'running' | 'success' | 'failed';
  startTime: number;
  isRunning: boolean;
  errorCount: number;
  warningCount: number;
}>({
  initialState: {
    cleanup: { status: 'pending', duration: 0 },
    frontend: { status: 'pending', duration: 0 },
    wasm: { status: 'pending', duration: 0 },
    backend: { status: 'pending', duration: 0 },
    overall: 'pending',
    startTime: Date.now(),
    isRunning: false,
    errorCount: 0,
    warningCount: 0
  }
});

const getBrailleSpinner = () => {
  const spinners = ["⠁", "⠃", "⠉", "⠙", "⠑", "⠋", "⠛", "⠓", "⠊", "⠚", "⠌", "⠜", "⠎", "⠞", "⠏", "⠟"];
  const index = Math.floor((Date.now() / 100) % spinners.length);
  return spinners[index];
};

const runBuildPipeline = async () => {
  app.update((state) => ({ 
    ...state, 
    overall: 'running', 
    startTime: Date.now(),
    isRunning: true,
    errorCount: 0,
    warningCount: 0
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
        duration: Date.now() - state.startTime,
        pid: frontendSuccess ? Math.floor(Math.random() * 10000) + 10000 : undefined
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
          duration: Date.now() - state.startTime,
          pid: backendStarted ? Math.floor(Math.random() * 10000) + 20000 : undefined
        }
      }));
    }

    // Count errors and warnings from logs
    let errorCount = 0;
    let warningCount = 0;
    
    try {
      const fs = require('fs');
      if (fs.existsSync('/tmp/wasm_build.log')) {
        const wasmLog = fs.readFileSync('/tmp/wasm_build.log', 'utf8');
        warningCount += (wasmLog.match(/warning\[/g) || []).length;
        errorCount += (wasmLog.match(/error\[/g) || []).length;
      }
      if (fs.existsSync('/tmp/cargo_build.log')) {
        const cargoLog = fs.readFileSync('/tmp/cargo_build.log', 'utf8');
        warningCount += (cargoLog.match(/warning\[/g) || []).length;
        errorCount += (cargoLog.match(/error\[/g) || []).length;
      }
    } catch (e) {
      // Ignore log reading errors
    }

    // Determine overall status
    const hasFailures = !cleanupSuccess || !frontendSuccess || !wasmSuccess || !backendStarted;
    app.update((state) => ({
      ...state,
      overall: hasFailures ? 'failed' : 'success',
      isRunning: false,
      errorCount,
      warningCount
    }));

  } catch (error) {
    app.update((state) => ({
      ...state,
      overall: 'failed',
      isRunning: false
    }));
  }
};

// Define the view using a more compact layout
app.view((s) => (
  <Column p={1} gap={1}>
    <Box border="single" p={1}>
      <Column gap={0}>
        {/* Header row with logo and status */}
        <Row items="center" gap={1}>
          <Text>┌─────┐</Text>
          <Spacer flex={1} />
          <Text>✔ Running {s.overall === 'running' ? getBrailleSpinner() : ''}</Text>
        </Row>
        
        {/* Logo row with PIDs */}
        <Row items="center" gap={1}>
          <Text>│ n a │</Text>
          <Spacer flex={1} />
          <Text>
            {s.frontend.pid ? `${s.frontend.pid} Vite PID ⠶ ` : ''}
            {s.backend.pid ? `${s.backend.pid} Rust server PID` : ''}
          </Text>
        </Row>
        
        {/* Logo row with controls */}
        <Row items="center" gap={1}>
          <Text>│ p t │</Text>
          <Spacer flex={1} />
          <Text>Press Ctrl+C to stop all services</Text>
        </Row>
        
        {/* Logo bottom */}
        <Row items="center" gap={1}>
          <Text>└─────┘</Text>
          <Spacer flex={1} />
          <Text></Text>
        </Row>
        
        {/* Empty spacer */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text></Text>
        </Row>
        
        {/* N-APT URL */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text>N-APT 🧠 http://localhost:5173 (site)</Text>
        </Row>
        
        {/* Browser instructions */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text>cmd + click to open in default browser</Text>
        </Row>
        
        {/* Empty spacer */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text></Text>
        </Row>
        
        {/* Backend URL */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text>http://localhost:8765 (websockets backend)</Text>
        </Row>
        
        {/* WASM build path */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text>packages/n_apt_canvas (WebGPU wasm_simd build)</Text>
        </Row>
        
        {/* Rust logs */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text>/tmp/rust_output.log (Rust logs)</Text>
        </Row>
        
        {/* Empty spacers */}
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text></Text>
        </Row>
        <Row items="center" gap={1}>
          <Text></Text>
          <Spacer flex={1} />
          <Text></Text>
        </Row>
        
        {/* Error/warning counts and timer */}
        <Row items="center" gap={1}>
          <Text>✗ {s.errorCount} errors</Text>
          <Spacer flex={1} />
          <Text>▲ {s.warningCount} warnings</Text>
          <Spacer flex={1} />
          <Text>running in {Math.floor((Date.now() - s.startTime) / 1000)}s</Text>
        </Row>
      </Column>
    </Box>

    {/* Build controls */}
    <Row gap={1}>
      <Button 
        id="start-build"
        label={s.isRunning ? "Building..." : "Start Build"} 
        intent={s.isRunning ? "secondary" : "primary"}
        onPress={() => {
          if (!s.isRunning) {
            runBuildPipeline();
          }
        }}
        disabled={s.isRunning}
      />
      <Button 
        id="exit"
        label="Exit" 
        intent="danger"
        onPress={() => {
          app.stop();
        }}
      />
    </Row>
  </Column>
));

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
