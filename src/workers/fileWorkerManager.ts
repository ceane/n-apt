/**
 * Simple File Worker Manager
 */

class FileWorkerManager {
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
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds

  constructor() {
    this.initializeWorker();
  }

  private initializeWorker() {
    try {
      this.worker = new Worker(new URL("./fileWorker.ts", import.meta.url), { type: "module" });

      this.worker.onmessage = (event) => {
        const { type, id, data, error } = event.data;
        const request = this.pendingRequests.get(id);

        if (!request) {
          console.warn(`Received response for unknown request: ${id}`);
          return;
        }

        // Clear timeout
        if (request.timeout) {
          clearTimeout(request.timeout);
        }

        if (type === "progress" && request.onProgress) {
          // Progress messages don't resolve the promise
          request.onProgress(data);
        } else if (type === "result") {
          request.resolve(data);
          this.pendingRequests.delete(id);
        } else if (type === "error") {
          request.reject(new Error(error));
          this.pendingRequests.delete(id);
        }
      };

      this.worker.onerror = (error) => {
        console.error("File Worker error:", error);
      };
    } catch (error) {
      console.error("Failed to initialize File Worker:", error);
    }
  }

  private generateRequestId(): string {
    return `req_${++this.requestId}_${Date.now()}`;
  }

  private sendMessage(type: string, data: any, onProgress?: (progress: any) => void): Promise<any> {
    if (!this.worker) {
      return Promise.reject(new Error("File Worker not initialized"));
    }

    const id = this.generateRequestId();

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const request = this.pendingRequests.get(id);
        if (request) {
          this.pendingRequests.delete(id);
          reject(new Error(`Worker request ${id} timed out after ${this.REQUEST_TIMEOUT}ms`));
        }
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        onProgress,
        timeout: timeoutId as any,
      });

      // Handle transferable objects
      let transferables: Transferable[] = [];
      if (type === "loadFile" && data.fileData instanceof ArrayBuffer) {
        transferables.push(data.fileData);
      }

      try {
        if (this.worker) {
          this.worker.postMessage({ type, id, data }, transferables);
        }
      } catch (error) {
        // Clear timeout and clean up on postMessage error
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async loadFile(file: File): Promise<any> {
    const fileData = await file.arrayBuffer();
    return this.sendMessage("loadFile", { fileData, fileName: file.name });
  }

  async stitchFiles(
    files: Array<{ name: string; file: File }>,
    settings: { gain: number; ppm: number },
    onProgress?: (progress: any) => void,
  ): Promise<any> {
    const filesData = [];

    for (const fileObj of files) {
      const fileData = await fileObj.file.arrayBuffer();
      filesData.push({
        fileName: fileObj.name,
        fileData: fileData,
      });
    }

    return this.sendMessage("stitchFiles", { files: filesData, settings }, onProgress);
  }

  async buildFrame(
    frame: number,
    fileDataCache: [string, number[]][],
    freqMap: [string, number][],
  ): Promise<any> {
    return this.sendMessage("buildFrame", { frame, fileDataCache, freqMap });
  }

  async getFrame(frameIndex: number, precomputedFrames: any[]): Promise<any> {
    return this.sendMessage("getFrame", { frameIndex, precomputedFrames });
  }

  terminate(): void {
    // Clear all pending requests and timeouts
    for (const [, request] of this.pendingRequests) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      request.reject(new Error("Worker terminated"));
    }
    this.pendingRequests.clear();

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Singleton instance
export const fileWorkerManager = new FileWorkerManager();
