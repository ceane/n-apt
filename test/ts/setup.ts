import "@testing-library/jest-dom";
import "resize-observer-polyfill";

// Polyfill for TextEncoder/TextDecoder for Jest environment
const { TextEncoder, TextDecoder } = require("util");

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock Worker for fileWorkerManager tests
global.Worker = jest.fn().mockImplementation(() => ({
  postMessage: jest.fn(),
  onmessage: null,
  onerror: null,
  terminate: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
  readyState: 1, // WebSocket.OPEN equivalent
}));

// Mock import.meta for Vite environment
(global as any).import = {
  meta: {
    url: "mock://worker/fileWorker.js",
    env: {
      VITE_GOOGLE_MAPS_API_KEY: "mock-api-key",
    },
  },
} as any;

// Mock ResizeObserver for testing
global.ResizeObserver = class ResizeObserver {
  constructor(callback: any) {
    this.callback = callback;
  }
  callback: any;
  observe() {
    // Mock implementation
  }
  unobserve() {
    // Mock implementation
  }
  disconnect() {
    // Mock implementation
  }
};

// Mock ImageData for canvas testing
global.ImageData = class ImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;

  constructor(
    dataOrWidth: Uint8ClampedArray | number,
    widthOrHeight: number,
    maybeHeight?: number,
  ) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      const width = widthOrHeight;
      const height = maybeHeight ?? 0;
      this.width = width;
      this.height = height;
      this.data = dataOrWidth;
      return;
    }

    const width = dataOrWidth;
    const height = widthOrHeight;
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
} as any;

// Mock canvas for FFT/waterfall testing
HTMLCanvasElement.prototype.getContext = jest.fn(
  () =>
    ({
      fillRect: jest.fn(),
      clearRect: jest.fn(),
      getImageData: jest.fn(() => new ImageData(800, 600)),
      putImageData: jest.fn(),
      createImageData: jest.fn((width, height) => new ImageData(width, height)),
      setTransform: jest.fn(),
      drawImage: jest.fn(),
      save: jest.fn(),
      fillText: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      stroke: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      rotate: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      measureText: jest.fn(() => ({ width: 0 })),
      transform: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn(),
    }) as any,
);

// Mock canvas size properties
Object.defineProperty(HTMLCanvasElement.prototype, "width", {
  get() {
    return 800;
  },
  set(value) {
    /* do nothing */
  },
});

Object.defineProperty(HTMLCanvasElement.prototype, "height", {
  get() {
    return 600;
  },
  set(value) {
    /* do nothing */
  },
});

// Mock getBoundingClientRect
Element.prototype.getBoundingClientRect = jest.fn(() => ({
  width: 800,
  height: 600,
  top: 0,
  left: 0,
  bottom: 600,
  right: 800,
  x: 0,
  y: 0,
  toJSON: jest.fn(),
}));

// Mock WebSocket
global.WebSocket = jest.fn().mockImplementation(() => ({
  readyState: WebSocket.CONNECTING,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  close: jest.fn(),
  send: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  dispatchEvent: jest.fn(),
  onopen: null,
  onclose: null,
  onmessage: null,
  onerror: null,
}));

// JSDOM provides Event and MessageEvent, only polyfill if missing
if (typeof (global as any).MessageEvent === "undefined") {
  (global as any).MessageEvent = class MessageEvent extends Event {
    constructor(type: string, options?: any) {
      super(type, options);
      this.data = options?.data;
    }
    data: any;
  };
}

// Mock FileReader
global.FileReader = class FileReader {
  static EMPTY = 0;
  static LOADING = 1;
  static DONE = 2;

  constructor() {
    this.readyState = FileReader.EMPTY;
  }

  readyState: number;
  result: any;
  error: any;
  onabort: any;
  onerror: any;
  onload: any;
  onloadstart: any;
  onprogress: any;

  readAsArrayBuffer(blob: Blob) {
    // Mock implementation
    setTimeout(() => {
      this.readyState = FileReader.DONE;
      this.result = new ArrayBuffer(8);
      this.onload?.({ target: this });
    }, 0);
  }

  readAsText(blob: Blob) {
    // Mock implementation
    setTimeout(() => {
      this.readyState = FileReader.DONE;
      this.result = "mock text";
      this.onload?.({ target: this });
    }, 0);
  }

  abort() {
    this.readyState = FileReader.DONE;
    this.onabort?.({ target: this });
  }
} as any;

// Mock performance.clearMeasures
if (typeof performance !== "undefined" && !performance.clearMeasures) {
  performance.clearMeasures = jest.fn();
}
if (typeof performance !== "undefined" && !performance.clearMarks) {
  performance.clearMarks = jest.fn();
}

// Mock WASM modules
jest.mock("n_apt_canvas", () => ({
  __esModule: true,
  default: jest.fn(() => Promise.resolve()),
  RenderingProcessor: class {
    process = jest.fn();
    destroy = jest.fn();
  },
  test_wasm_simd_availability: jest.fn(() => false),
}), { virtual: true });
