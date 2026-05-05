/** @jest-environment node */
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

describe('Backend Health Integration', () => {
    let backendProcess: ChildProcess;
    const PORT = 44999;
    const BASE_URL = `http://127.0.0.1:${PORT}`;

    beforeAll(async () => {
        // Start the backend from project root
        const projectRoot = path.resolve(process.cwd());
        const binaryPath = process.env.BACKEND_BINARY_PATH || 
                           path.join(projectRoot, 'target/dev-fast/n-apt-backend');
        
        backendProcess = spawn(binaryPath, [], {
            cwd: projectRoot,
            env: {
                ...process.env,
                WEBSOCKETS_URL: `http://127.0.0.1:${PORT}`,
                UNSAFE_LOCAL_USER_PASSWORD: 'test-password-123',
                RUST_LOG: 'info'
            }
        });

        backendProcess.stdout?.on('data', (data) => {
            process.stdout.write(`[Backend STDOUT] ${data}`);
        });

        backendProcess.stderr?.on('data', (data) => {
            process.stderr.write(`[Backend STDERR] ${data}`);
        });

        // Wait for it to start and respond to status check
        let attempts = 0;
        const maxAttempts = 30;
        while (attempts < maxAttempts) {
            try {
                const response = await fetch(`${BASE_URL}/status`);
                if (response.ok) {
                    console.log(`✅ Backend responded with 200 OK after ${attempts}s`);
                    return; // Success
                }
                console.log(`⏳ Backend status: ${response.status} (attempt ${attempts})`);
            } catch (e) {
                console.log(`⏳ Backend not ready (attempt ${attempts}): ${e.message}`);
            }
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // If we got here, it failed to start. Capture exit code if any.
        const exitCode = backendProcess.exitCode;
        throw new Error(`Backend failed to start in time. Exit code: ${exitCode}`);
    }, 45000); // 45s timeout for compilation/startup

    afterAll(() => {
        if (backendProcess) {
            backendProcess.kill();
        }
    });

    it('should return a healthy status', async () => {
        const response = await fetch(`${BASE_URL}/status`);
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty('device_connected');
        expect(data).toHaveProperty('device_state');
        expect(data).toHaveProperty('device_name');
    });

    it('should have loaded channels from signals.yaml', async () => {
        const response = await fetch(`${BASE_URL}/status`);
        const data = await response.json();
        expect(Array.isArray(data.channels)).toBe(true);
        expect(data.channels.length).toBeGreaterThan(0);
    });

    it('should respond to authentication challenges', async () => {
        const response = await fetch(`${BASE_URL}/auth/challenge`, {
            method: 'POST'
        });
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveProperty('challenge_id');
        expect(data).toHaveProperty('nonce');
    });
});
