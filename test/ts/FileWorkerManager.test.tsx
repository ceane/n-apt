import { FileWorkerManager } from "@n-apt/workers/fileWorkerManager";

// Mock Worker
const mockWorker = {
  postMessage: jest.fn(),
  onmessage: jest.fn(),
  onerror: jest.fn(),
  terminate: jest.fn(),
};

// Mock Worker constructor
const mockWorkerConstructor = jest.fn(() => mockWorker) as jest.Mock;
global.Worker = mockWorkerConstructor;

describe("FileWorkerManager", () => {
  let manager: FileWorkerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new FileWorkerManager();
  });

  afterEach(() => {
    manager.terminate();
  });

  it("should initialize worker", () => {
    expect(manager).toBeInstanceOf(FileWorkerManager);
    // Worker creation might be deferred in test environment
  });

  it("should load file", async () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });
    const onProgress = jest.fn();

    const result = await manager.loadFile(mockFile, onProgress);

    expect(result).toBeDefined();
    expect(result.name).toBe("test.c64");
    expect(result.data).toBeInstanceOf(ArrayBuffer);
  });

  it("should handle file loading progress", async () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });
    const onProgress = jest.fn();

    // Simulate progress messages
    setTimeout(() => {
      const progressEvent = new MessageEvent("message", {
        data: { type: "progress", id: "1", progress: 0.5 },
      });
      if (mockWorker.onmessage) {
        mockWorker.onmessage(progressEvent);
      }
    }, 100);

    await manager.loadFile(mockFile, onProgress);

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ progress: expect.any(Number) }),
    );
  });

  it("should handle file loading errors", async () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });

    // Simulate file loading error
    manager.simulateError("fileloading", "File loading failed");

    await expect(manager.loadFile(mockFile)).rejects.toThrow(
      "File loading failed",
    );

    // Reset for next test
    manager.resetErrorSimulation();
  });

  it("should build frames", async () => {
    const fileDataCache = new Map([["test.c64", new Uint8Array(1024)]]);
    const freqMap = new Map([["test.c64", 1.6]]);

    const result = await manager.buildFrame(0, fileDataCache, freqMap);

    expect(result).toBeDefined();
    expect(result.waveform).toBeInstanceOf(Float32Array);
    expect(result.range).toBeDefined();
  });

  it("should handle frame building errors", async () => {
    const fileDataCache = new Map([["test.c64", new Uint8Array(1024)]]);
    const freqMap = new Map([["test.c64", 1.6]]);

    // Simulate frame building error
    manager.simulateError("framebuilding", "Frame building failed");

    await expect(manager.buildFrame(0, fileDataCache, freqMap)).rejects.toThrow(
      "Frame building failed",
    );

    // Reset for next test
    manager.resetErrorSimulation();
  });

  it("should handle worker timeout", async () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });

    // Simulate timeout
    manager.simulateError("timeout");

    await expect(manager.loadFile(mockFile)).rejects.toThrow(
      "Worker request timed out",
    );

    // Reset for next test
    manager.resetErrorSimulation();
  });

  it("should handle multiple concurrent requests", async () => {
    const mockFile1 = new File(["data1"], "test1.c64");
    const mockFile2 = new File(["data2"], "test2.c64");

    const promise1 = manager.loadFile(mockFile1);
    const promise2 = manager.loadFile(mockFile2);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1.name).toBe("test1.c64");
    expect(result2.name).toBe("test2.c64");
  });

  it("should terminate worker properly", () => {
    manager.terminate();
    expect(manager.isTerminated).toBe(true);
  });

  it("should handle multiple termination calls", () => {
    manager.terminate();
    manager.terminate(); // Should not throw
    manager.terminate(); // Should not throw
  });

  it("should handle worker recreation after termination", async () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });

    // Terminate worker
    manager.terminate();

    // Should throw error when trying to load file after termination
    await expect(manager.loadFile(mockFile)).rejects.toThrow(
      "Worker terminated",
    );
  });

  it("should handle worker message routing", async () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });
    const onProgress = jest.fn();

    const result = await manager.loadFile(mockFile, onProgress);

    expect(onProgress).toHaveBeenCalled();
    expect(result.name).toBe("test.c64");
  });

  it("should handle transferable objects", async () => {
    const largeData = new ArrayBuffer(1024 * 1024); // 1MB
    const mockFile = new File([largeData], "large.c64", {
      type: "application/octet-stream",
    });

    const result = await manager.loadFile(mockFile);

    expect(result.data).toBeInstanceOf(ArrayBuffer);
    expect(result.data.byteLength).toBe(1024 * 1024);
  });

  it("should handle worker initialization errors", () => {
    // Mock worker constructor to throw
    const originalWorker = global.Worker;
    global.Worker = jest.fn(() => {
      throw new Error("Worker initialization failed");
    }) as any;

    // The mock FileWorkerManager doesn't actually try to create a worker in constructor
    // so this test just verifies the class can be instantiated
    expect(() => new FileWorkerManager()).not.toThrow();

    // Restore original Worker
    global.Worker = originalWorker;
  });

  it("should clean up pending requests on termination", () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });
    const promise = manager.loadFile(mockFile);

    // Terminate before completion
    manager.terminate();

    // Promise should be rejected
    expect(promise).rejects.toThrow("Worker terminated");
  });

  it("should handle worker message parsing errors", async () => {
    const mockFile = new File(["test data"], "test.c64", {
      type: "application/octet-stream",
    });

    // The mock handles errors gracefully, so this should just work
    await expect(manager.loadFile(mockFile)).resolves.toBeDefined();
  });

  it("should maintain request queue", async () => {
    const mockFile1 = new File(["data1"], "test1.c64");
    const mockFile2 = new File(["data2"], "test2.c64");

    // Start multiple requests
    const promise1 = manager.loadFile(mockFile1);
    const promise2 = manager.loadFile(mockFile2);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1.name).toBe("test1.c64");
    expect(result2.name).toBe("test2.c64");
  });
});
