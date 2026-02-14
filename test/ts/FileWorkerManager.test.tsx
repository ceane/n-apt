import { FileWorkerManager } from "@n-apt/workers/fileWorkerManager"

// Mock Worker
const mockWorker = {
  postMessage: jest.fn(),
  onmessage: jest.fn(),
  onerror: jest.fn(),
  terminate: jest.fn(),
}

// Mock Worker constructor
global.Worker = jest.fn(() => mockWorker) as any

describe("FileWorkerManager", () => {
  let manager: FileWorkerManager

  beforeEach(() => {
    jest.clearAllMocks()
    manager = new FileWorkerManager()
  })

  afterEach(() => {
    manager.terminate()
  })

  it("should initialize worker", () => {
    expect(mockWorker.constructor).toHaveBeenCalledWith(
      expect.stringContaining("fileWorker.js"),
      { type: "module" }
    )
  })

  it("should load file", async () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    const onProgress = jest.fn()
    
    const result = await manager.loadFile(mockFile, onProgress)
    
    expect(result).toBeDefined()
    expect(result.name).toBe("test.c64")
    expect(result.data).toBeInstanceOf(ArrayBuffer)
  })

  it("should handle file loading progress", async () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    const onProgress = jest.fn()
    
    // Simulate progress messages
    setTimeout(() => {
      const progressEvent = new MessageEvent("message", {
        data: { type: "progress", progress: 0.5 }
      })
      mockWorker.onmessage.mock.calls[0][0].target.dispatchEvent(progressEvent)
    }, 100)
    
    await manager.loadFile(mockFile, onProgress)
    
    expect(onProgress).toHaveBeenCalledWith({ progress: 0.5 })
  })

  it("should handle file loading errors", async () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    
    // Simulate worker error
    setTimeout(() => {
      const errorEvent = new MessageEvent("error", {
        message: "File loading failed"
      })
      mockWorker.onerror.mock.calls[0][0].target.dispatchEvent(errorEvent)
    }, 100)
    
    await expect(manager.loadFile(mockFile)).rejects.toThrow("File loading failed")
  })

  it("should build frames", async () => {
    const fileDataCache = new Map([["test.c64", new Uint8Array(1024)]])
    const freqMap = new Map([["test.c64", 1.6]])
    
    const result = await manager.buildFrame(0, fileDataCache, freqMap)
    
    expect(result).toBeDefined()
    expect(result.waveform).toBeInstanceOf(Float32Array)
    expect(result.range).toBeDefined()
  })

  it("should handle frame building errors", async () => {
    const fileDataCache = new Map([["test.c64", new Uint8Array(1024)]])
    const freqMap = new Map([["test.c64", 1.6]])
    
    // Simulate worker error
    setTimeout(() => {
      const errorEvent = new MessageEvent("message", {
        data: { type: "error", error: "Frame building failed" }
      })
      mockWorker.onmessage.mock.calls[0][0].target.dispatchEvent(errorEvent)
    }, 100)
    
    await expect(manager.buildFrame(0, fileDataCache, freqMap)).rejects.toThrow("Frame building failed")
  })

  it("should handle worker timeout", async () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    
    // Don't respond to worker message to trigger timeout
    mockWorker.onmessage.mockImplementation(() => {})
    
    await expect(manager.loadFile(mockFile)).rejects.toThrow("Worker request timed out")
  })

  it("should handle multiple concurrent requests", async () => {
    const mockFile1 = new File(["data1"], "test1.c64")
    const mockFile2 = new File(["data2"], "test2.c64")
    
    const promise1 = manager.loadFile(mockFile1)
    const promise2 = manager.loadFile(mockFile2)
    
    const [result1, result2] = await Promise.all([promise1, promise2])
    
    expect(result1.name).toBe("test1.c64")
    expect(result2.name).toBe("test2.c64")
  })

  it("should terminate worker properly", () => {
    manager.terminate()
    expect(mockWorker.terminate).toHaveBeenCalled()
  })

  it("should handle multiple termination calls", () => {
    manager.terminate()
    manager.terminate() // Should not throw
    manager.terminate() // Should not throw
  })

  it("should handle worker recreation after termination", async () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    
    // Terminate worker
    manager.terminate()
    
    // Should create new worker for next request
    const result = await manager.loadFile(mockFile)
    
    expect(result).toBeDefined()
    expect(mockWorker.constructor).toHaveBeenCalledTimes(2)
  })

  it("should handle worker message routing", async () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    const onProgress = jest.fn()
    
    // Simulate multiple message types
    setTimeout(() => {
      // Progress message
      const progressEvent = new MessageEvent("message", {
        data: { type: "progress", progress: 0.25 }
      })
      mockWorker.onmessage.mock.calls[0][0].target.dispatchEvent(progressEvent)
      
      // Complete message
      const completeEvent = new MessageEvent("message", {
        data: { type: "complete", result: { name: "test.c64", data: new ArrayBuffer(8) } }
      })
      mockWorker.onmessage.mock.calls[0][0].target.dispatchEvent(completeEvent)
    }, 100)
    
    const result = await manager.loadFile(mockFile, onProgress)
    
    expect(onProgress).toHaveBeenCalledWith({ progress: 0.25 })
    expect(result.name).toBe("test.c64")
  })

  it("should handle transferable objects", async () => {
    const largeData = new ArrayBuffer(1024 * 1024) // 1MB
    const mockFile = new File([largeData], "large.c64", { type: "application/octet-stream" })
    
    const result = await manager.loadFile(mockFile)
    
    expect(result.data).toBeInstanceOf(ArrayBuffer)
    expect(result.data.byteLength).toBe(1024 * 1024)
  })

  it("should handle worker initialization errors", () => {
    // Mock worker constructor to throw
    global.Worker = jest.fn().mockImplementation(() => {
      throw new Error("Worker initialization failed")
    })
    
    expect(() => new FileWorkerManager()).toThrow("Worker initialization failed")
    
    // Restore original Worker
    global.Worker = jest.fn(() => mockWorker) as any
  })

  it("should clean up pending requests on termination", () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    const promise = manager.loadFile(mockFile)
    
    // Terminate before completion
    manager.terminate()
    
    // Promise should be rejected
    expect(promise).rejects.toThrow("Worker terminated")
  })

  it("should handle worker message parsing errors", async () => {
    const mockFile = new File(["test data"], "test.c64", { type: "application/octet-stream" })
    
    // Send invalid JSON
    setTimeout(() => {
      const errorEvent = new MessageEvent("message", {
        data: "invalid json"
      })
      mockWorker.onmessage.mock.calls[0][0].target.dispatchEvent(errorEvent)
    }, 100)
    
    // Should handle gracefully (not throw)
    await manager.loadFile(mockFile)
  })

  it("should maintain request queue", async () => {
    const mockFile1 = new File(["data1"], "test1.c64")
    const mockFile2 = new File(["data2"], "test2.c64")
    
    // Start multiple requests
    const promise1 = manager.loadFile(mockFile1)
    const promise2 = manager.loadFile(mockFile2)
    
    // Complete first request
    setTimeout(() => {
      const completeEvent = new MessageEvent("message", {
        data: { type: "complete", result: { name: "test1.c64", data: new ArrayBuffer(8) } }
      })
      mockWorker.onmessage.mock.calls[0][0].target.dispatchEvent(completeEvent)
    }, 100)
    
    const result1 = await promise1
    expect(result1.name).toBe("test1.c64")
    
    // Second request should still be pending
    expect(promise2).toBeInstanceOf(Promise)
    
    // Complete second request
    setTimeout(() => {
      const completeEvent = new MessageEvent("message", {
        data: { type: "complete", result: { name: "test2.c64", data: new ArrayBuffer(8) } }
      })
      mockWorker.onmessage.mock.calls[0][0].target.dispatchEvent(completeEvent)
    }, 200)
    
    const result2 = await promise2
    expect(result2.name).toBe("test2.c64")
  })
})
