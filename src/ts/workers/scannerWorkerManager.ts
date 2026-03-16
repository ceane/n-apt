/**
 * Scanner Worker Manager
 */
class ScannerWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      onProgress?: (progress: any) => void;
      timeout?: number;
    }
  >();
  private requestId = 0;
  private readonly REQUEST_TIMEOUT = 60000; // 60 seconds for slow scans

  constructor() {
    this.initializeWorker();
  }

  private initializeWorker() {
    try {
      this.worker = new Worker(new URL("./scannerWorker.ts", import.meta.url), {
        type: "module",
      });

      this.worker.onmessage = (event) => {
        const { type, id, data, error } = event.data;
        const request = this.pendingRequests.get(id);

        if (!request) {
          if (type !== 'progress') console.warn(`Received response for unknown request: ${id}`);
          return;
        }

        if (type === "progress" && request.onProgress) {
          request.onProgress(data);
        } else if (type === "result") {
          if (request.timeout) clearTimeout(request.timeout);
          request.resolve(data);
          this.pendingRequests.delete(id);
        } else if (type === "error") {
          if (request.timeout) clearTimeout(request.timeout);
          request.reject(new Error(error));
          this.pendingRequests.delete(id);
        }
      };

      this.worker.onerror = (error) => {
        console.error("Scanner Worker error:", error);
      };
    } catch (error) {
      console.error("Failed to initialize Scanner Worker:", error);
    }
  }

  private generateRequestId(): string {
    return `scan_${++this.requestId}_${Date.now()}`;
  }

  private sendMessage(
    type: string,
    data: any,
    onProgress?: (progress: any) => void,
    transferables: Transferable[] = []
  ): Promise<any> {
    if (!this.worker) {
      this.initializeWorker();
      if (!this.worker) return Promise.reject(new Error("Scanner Worker not initialized"));
    }

    const id = this.generateRequestId();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const request = this.pendingRequests.get(id);
        if (request) {
          this.pendingRequests.delete(id);
          reject(new Error(`Worker request ${id} timed out`));
        }
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        onProgress,
        timeout: timeoutId as any,
      });

      try {
        this.worker!.postMessage({ type, id, data }, transferables);
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async scan(iqSamples: Uint8Array, frequencyRange: { min: number; max: number }, options: any, onProgress?: (p: any) => void): Promise<any> {
    // We don't transfer iqSamples because the main thread still needs it for visualization etc.
    // However, cloning/copying large buffers can be expensive. 
    // If the browser still freezes during postMessage (due to serialization), we might need to use SharedArrayBuffer (if origin-isolated).
    return this.sendMessage("scan", { iqSamples, frequencyRange, options }, onProgress);
  }

  async demodulate(iqSamples: Uint8Array, region: any, sampleRate: number): Promise<any> {
    return this.sendMessage("demodulate", { iqSamples, region, sampleRate });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}

export const scannerWorkerManager = new ScannerWorkerManager();
