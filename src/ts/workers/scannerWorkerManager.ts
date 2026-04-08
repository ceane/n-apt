/**
 * Scanner Worker Manager - Now redirects heavy lifting to the backend
 */
class ScannerWorkerManager {
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
  private readonly REQUEST_TIMEOUT = 60000;

  // This will be set by DemodContext or SpectrumStore once WS is ready
  private _sendWSCommand: ((msg: any) => void) | null = null;

  setWSCommandSender(sender: (msg: any) => void) {
    this._sendWSCommand = sender;
  }

  /**
   * Called by the WS message handler when a scan result/progress arrives
   */
  handleWSResponse(message: any) {
    const { type, jobId, regions, progress, currentFreq, regionsLength } = message;
    const request = this.pendingRequests.get(jobId);

    if (!request) return;

    if (type === "scan_progress" && request.onProgress) {
      request.onProgress({ progress, currentFreq, regionsLength });
    } else if (type === "scan_result") {
      if (request.timeout) clearTimeout(request.timeout);
      request.resolve(regions);
      this.pendingRequests.delete(jobId);
    } else if (type === "demod_result") {
        if (request.timeout) clearTimeout(request.timeout);
        // data here would be the demod result
        request.resolve(message);
        this.pendingRequests.delete(jobId);
    }
  }

  private generateRequestId(): string {
    return `scan_${++this.requestId}_${Date.now()}`;
  }

  async scan(_iqSamples: Uint8Array, frequencyRange: { min: number; max: number }, options: any, onProgress?: (p: any) => void): Promise<any> {
    if (!this._sendWSCommand) {
        return Promise.reject(new Error("Backend connection not ready for scanning"));
    }

    const jobId = this.generateRequestId();

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const request = this.pendingRequests.get(jobId);
        if (request) {
          this.pendingRequests.delete(jobId);
          reject(new Error(`Scan request ${jobId} timed out`));
        }
      }, this.REQUEST_TIMEOUT);

      this.pendingRequests.set(jobId, {
        resolve,
        reject,
        onProgress,
        timeout: timeoutId as any,
      });

      this._sendWSCommand!({
        type: "scan",
        job_id: jobId,
        min_freq: frequencyRange.min,
        max_freq: frequencyRange.max,
        options // Pass through options for backend heuristic tuning
      });
    });
  }

  async demodulate(_iqSamples: Uint8Array, region: any, _sampleRate: number): Promise<any> {
    if (!this._sendWSCommand) {
        return Promise.reject(new Error("Backend connection not ready for demodulation"));
    }

    const jobId = `demod_${Date.now()}`;

    return new Promise((resolve, reject) => {
        this.pendingRequests.set(jobId, { resolve, reject });
        this._sendWSCommand!({
            type: "demodulate",
            job_id: jobId,
            region
        });
    });
  }

  terminate(): void {
    this.pendingRequests.clear();
  }
}

export const scannerWorkerManager = new ScannerWorkerManager();
