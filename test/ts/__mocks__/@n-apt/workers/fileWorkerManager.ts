export class FileWorkerManager {
  REQUEST_TIMEOUT = 10000;
  pendingRequests: Map<string, any> = new Map();
  worker: any = null;
  isTerminated = false;
  shouldSimulateError = false;
  simulatedErrorMessage = "";

  constructor() {
    // Mock implementation
  }

  async loadFile(
    file: File,
    onProgress?: (progress: any) => void,
  ): Promise<any> {
    if (this.isTerminated) {
      throw new Error("Worker terminated");
    }

    // Check for timeout immediately
    if (this.REQUEST_TIMEOUT === 1) {
      throw new Error("Worker request timed out");
    }

    // Check for simulated error
    if (this.shouldSimulateError) {
      throw new Error(this.simulatedErrorMessage || "Simulated error");
    }

    return new Promise((resolve, reject) => {
      // Simulate file validation
      if (!file) {
        reject(new Error("Invalid file"));
        return;
      }

      if (file.size === 0) {
        reject(new Error("Empty file"));
        return;
      }

      if (file.size > 100 * 1024 * 1024) {
        // 100MB limit
        reject(new Error("File too large"));
        return;
      }

      // Simulate progress updates
      if (onProgress) {
        const progressInterval = setInterval(() => {
          onProgress({ progress: Math.random() * 0.8 });
        }, 50);

        setTimeout(() => {
          clearInterval(progressInterval);
          onProgress({ progress: 1.0 });
        }, 200);
      }

      // Simulate file loading
      setTimeout(() => {
        if (this.isTerminated) {
          reject(new Error("Worker terminated"));
          return;
        }

        // Simulate different file types
        if (file.name.endsWith(".c64")) {
          resolve({
            name: file.name,
            data: new ArrayBuffer(file.size),
            type: "c64",
            sampleRate: 32000,
            frequency: 1.6,
          });
        } else {
          resolve({
            name: file.name,
            data: new ArrayBuffer(file.size),
            type: "unknown",
          });
        }
      }, 300);
    });
  }

  async buildFrame(
    frame: number,
    fileDataCache: Map<string, Uint8Array>,
    freqMap: Map<string, number>,
  ): Promise<any> {
    if (this.isTerminated) {
      throw new Error("Worker terminated");
    }

    // Check for simulated error
    if (this.shouldSimulateError) {
      throw new Error(this.simulatedErrorMessage || "Simulated error");
    }

    return new Promise((resolve, reject) => {
      // Simulate frame building validation
      if (frame < 0) {
        reject(new Error("Invalid frame number"));
        return;
      }

      if (!fileDataCache || fileDataCache.size === 0) {
        reject(new Error("No file data available"));
        return;
      }

      // Simulate processing time
      setTimeout(
        () => {
          if (this.isTerminated) {
            reject(new Error("Worker terminated"));
            return;
          }

          // Generate mock waveform data
          const waveform = new Float32Array(32768);
          for (let i = 0; i < waveform.length; i++) {
            waveform[i] = -60 + Math.sin(i * 0.01) * 20 + Math.random() * 5;
          }

          resolve({
            frame,
            waveform,
            range: { min: 0, max: 3.2 },
            timestamp: Date.now(),
            sampleRate: 32000,
            fftSize: 32768,
          });
        },
        50 + Math.random() * 100,
      ); // Variable processing time
    });
  }

  terminate() {
    this.isTerminated = true;
    this.worker = null;

    // Reject all pending requests
    this.pendingRequests.forEach((request, id) => {
      if (request.reject) {
        request.reject(new Error("Worker terminated"));
      }
    });
    this.pendingRequests.clear();
  }

  // Mock method for testing error scenarios
  simulateError(
    errorType: "timeout" | "crash" | "memory" | "fileloading" | "framebuilding",
    message?: string,
  ) {
    switch (errorType) {
      case "timeout":
        // Set very short timeout and reject all pending requests
        this.REQUEST_TIMEOUT = 1;
        this.pendingRequests.forEach((request, id) => {
          if (request.reject) {
            request.reject(new Error("Worker request timed out"));
          }
        });
        this.pendingRequests.clear();
        break;
      case "crash":
        this.terminate();
        break;
      case "memory":
        // Simulate memory error
        this.pendingRequests.forEach((request, id) => {
          if (request.reject) {
            request.reject(new Error("Out of memory"));
          }
        });
        this.pendingRequests.clear();
        break;
      case "fileloading":
      case "framebuilding":
        // Set error flag for next operation
        this.shouldSimulateError = true;
        this.simulatedErrorMessage = message || `${errorType} failed`;
        break;
    }
  }

  // Mock method for testing concurrent requests
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  // Reset error simulation
  resetErrorSimulation() {
    this.shouldSimulateError = false;
    this.simulatedErrorMessage = "";
    this.REQUEST_TIMEOUT = 10000;
  }
}
