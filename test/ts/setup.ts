import "@testing-library/jest-dom";
import "resize-observer-polyfill";
import React from "react";

// Polyfill for TextEncoder/TextDecoder for Jest environment
const { TextEncoder, TextDecoder } = require("util");

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// WebCrypto polyfill for Node/Jest environment
const crypto = require("node:crypto");
if (!global.crypto) {
  Object.defineProperty(global, "crypto", {
    value: crypto.webcrypto,
  });
}
if (!global.crypto.subtle && crypto.webcrypto) {
  Object.defineProperty(global.crypto, "subtle", {
    value: crypto.webcrypto.subtle,
  });
}

jest.mock("three/webgpu", () => ({
  WebGPURenderer: jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    setClearColor: jest.fn(),
    setSize: jest.fn(),
    render: jest.fn(),
    dispose: jest.fn(),
    domElement: document.createElement("canvas"),
  })),
}));

jest.mock("@react-three/fiber", () => ({
  Canvas: ({ className, style }: any) =>
    React.createElement(
      "div",
      { "data-testid": "r3f-canvas", className, style },
      React.createElement("canvas", { role: "img" }),
    ),
  useFrame: jest.fn(),
  useThree: jest.fn(() => ({
    gl: {
      render: jest.fn(),
      setSize: jest.fn(),
      domElement: document.createElement("canvas"),
    },
    camera: {
      position: { set: jest.fn() },
      lookAt: jest.fn(),
      updateProjectionMatrix: jest.fn(),
      type: "OrthographicCamera",
      zoom: 1,
    },
    scene: { add: jest.fn(), remove: jest.fn() },
    size: { width: 800, height: 600 },
    viewport: { width: 10, height: 6 },
  })),
}));

jest.mock("@react-three/drei", () => ({
  Html: ({ children }: any) => React.createElement("div", null, children),
  Text: ({ children }: any) => React.createElement("span", null, children),
  Line: () => null,
  useTexture: jest.fn(() => ({
    colorSpace: "",
    anisotropy: 0,
    wrapS: 0,
    wrapT: 0,
    minFilter: 0,
    magFilter: 0,
    generateMipmaps: false,
    needsUpdate: false,
    repeat: { set: jest.fn() },
    offset: { set: jest.fn() },
  })),
}));

jest.mock("@react-three/flex", () => ({
  Flex: ({ children }: any) => React.createElement("div", null, children),
  Box: ({ children }: any) => React.createElement("div", null, children),
}), { virtual: true });

jest.mock("@react-three/postprocessing", () => ({
  EffectComposer: ({ children }: any) => children ?? null,
  Bloom: () => null,
}), { virtual: true });

jest.mock("@chenglou/pretext", () => ({
  prepareWithSegments: jest.fn((text: string) => ({ text })),
  layout: jest.fn(() => ({ height: 20, lineCount: 1 })),
  layoutWithLines: jest.fn(() => ({
    height: 20,
    lines: [{ text: "mock line", width: 80 }],
  })),
  layoutNextLine: jest.fn(() => ({
    text: "mock line",
    end: { segmentIndex: 0, graphemeIndex: 0 },
  })),
}), { virtual: true });

jest.mock("leva", () => ({
  LevaPanel: () => null,
  useControls: jest.fn(() => ({})),
  useCreateStore: jest.fn(() => ({})),
}));

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
      VITE_UNSAFE_LOCAL_USER_PASSWORD: "test-password",
      VITE_COREML_SERVER_URL: "http://localhost:9999",
      VITE_BACKEND_BASE_URL: "http://localhost:8765",
      BASE_URL: "/",
    },
  },
} as any;

// Global base URL for asset helpers
(global as any).__APP_BASE_URL__ = "/";
(global as any).__DEV__ = true;

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

// Mock IntersectionObserver for testing (e.g. CanvasHarness lazy loading)
global.IntersectionObserver = class IntersectionObserver {
  constructor(callback: any) {
    this.callback = callback;
  }
  callback: any;
  observe(target: Element) {
    // Synchronously trigger intersection to mount components immediately in tests
    this.callback([{ target, isIntersecting: true }]);
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
  set(_value) {
    /* do nothing */
  },
});

Object.defineProperty(HTMLCanvasElement.prototype, "height", {
  get() {
    return 600;
  },
  set(_value) {
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
const MockWebSocket = jest.fn().mockImplementation(() => ({
  readyState: 0, // MockWebSocket.CONNECTING
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

(MockWebSocket as any).CONNECTING = 0;
(MockWebSocket as any).OPEN = 1;
(MockWebSocket as any).CLOSING = 2;
(MockWebSocket as any).CLOSED = 3;

global.WebSocket = MockWebSocket as any;

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

  readAsArrayBuffer(_blob: Blob) {
    // Mock implementation
    setTimeout(() => {
      this.readyState = FileReader.DONE;
      this.result = new ArrayBuffer(8);
      this.onload?.({ target: this });
    }, 0);
  }

  readAsText(_blob: Blob) {
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
jest.mock("n_apt_canvas", () => {
  const mockModule: any = {
    RenderingProcessor: class {
      process = jest.fn();
      destroy = jest.fn();
    },
    test_wasm_simd_availability: jest.fn(() => false),
  };
  mockModule.default = jest.fn(() => Promise.resolve());
  return mockModule;
}, { virtual: true });
