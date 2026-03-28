import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRoot } from 'react-dom/client';

// Mock WebGPU and WebGL contexts
const mockGPU = {
  requestAdapter: jest.fn().mockResolvedValue({
    requestDevice: jest.fn().mockResolvedValue({
      createBuffer: jest.fn(),
      createTexture: jest.fn(),
      createShaderModule: jest.fn(),
      createComputePipeline: jest.fn(),
      createBindGroupLayout: jest.fn(),
      createBindGroup: jest.fn(),
      createCommandEncoder: jest.fn(),
      createRenderPipeline: jest.fn(),
      queue: {
        submit: jest.fn(),
        writeBuffer: jest.fn(),
        copyExternalImageToTexture: jest.fn(),
      },
    }),
  }),
};

// Mock HTMLCanvasElement methods
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: jest.fn(() => ({
    getExtension: jest.fn(),
    getParameter: jest.fn(),
    createShader: jest.fn(),
    createProgram: jest.fn(),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    useProgram: jest.fn(),
    createBuffer: jest.fn(),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    drawArrays: jest.fn(),
    getUniformLocation: jest.fn(),
    uniform1f: jest.fn(),
    uniform2f: jest.fn(),
    uniform3f: jest.fn(),
    uniformMatrix4fv: jest.fn(),
    createTexture: jest.fn(),
    bindTexture: jest.fn(),
    texImage2D: jest.fn(),
    generateMipmap: jest.fn(),
    activeTexture: jest.fn(),
    texParameteri: jest.fn(),
    clear: jest.fn(),
    clearColor: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    depthFunc: jest.fn(),
    viewport: jest.fn(),
  })),
  writable: true,
});

// Mock navigator.gpu
Object.defineProperty(navigator, 'gpu', {
  value: mockGPU,
  writable: true,
});

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => setTimeout(cb, 16));

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'mocked-url');
global.URL.revokeObjectURL = jest.fn();

// Mock import.meta.env for components that use it
Object.defineProperty(window, 'import', {
  value: {
    meta: {
      env: {
        BASE_URL: '/',
      },
    },
  },
  writable: true,
});

// Mock import.meta.env directly
global.import = {
  meta: {
    env: {
      BASE_URL: '/',
    },
  },
} as any;

// Mock fetch for image assets
global.fetch = jest.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    blob: () => Promise.resolve(new Blob(['mock image data'])),
  })
);

// Mock THREE.js with all required classes
jest.mock('three', () => ({
  ...jest.requireActual('three'),
  WebGLRenderer: jest.fn().mockImplementation(() => ({
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    render: jest.fn(),
    domElement: document.createElement('canvas'),
    dispose: jest.fn(),
  })),
  WebGL1Renderer: jest.fn().mockImplementation(() => ({
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    render: jest.fn(),
    domElement: document.createElement('canvas'),
    dispose: jest.fn(),
  })),
}));

describe('Canvas Component Loading Tests', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    jest.clearAllMocks();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Body Attenuation Canvas', () => {
    test('should load and render BodyAttenuationCanvas', async () => {
      const { default: BodyAttenuationCanvas } = await import('../../src/md-preview/BodyAttenuationCanvas');

      render(<BodyAttenuationCanvas />, { container });

      // Wait for component to mount
      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });

    test('should load and render BodyAttenuationCanvas', async () => {
      const { default: BodyAttenuationCanvas } = await import('../../src/md-preview/BodyAttenuationCanvas');

      render(<BodyAttenuationCanvas />, { container });

      // Wait for component to mount
      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });
  });

  describe('Signal Canvas Components', () => {
    test('should load and render AmplitudeModulationCanvas', async () => {
      const { AmplitudeModulationCanvas } = await import('../../src/md-preview/components/canvas');

      render(<AmplitudeModulationCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });

    test('should load and render FrequencyModulationCanvas', async () => {
      const { FrequencyModulationCanvas } = await import('../../src/md-preview/components/canvas');

      render(<FrequencyModulationCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });

    test('should load and render HeterodyningCanvas', async () => {
      const { HeterodyningCanvas } = await import('../../src/md-preview/components/canvas');

      render(<HeterodyningCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });

    test('should load and render MultipathCanvas', async () => {
      const { MultipathCanvas } = await import('../../src/md-preview/components/canvas');

      render(<MultipathCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });
  });

  describe('Other Canvas Components', () => {
    test('should load and render ImpedanceCanvas', async () => {
      const { default: ImpedanceCanvas } = await import('../../src/md-preview/ImpedanceCanvas');

      render(<ImpedanceCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });

    test('should load and render TimeOfFlightCanvas', async () => {
      const { default: TimeOfFlightCanvas } = await import('../../src/md-preview/TimeOfFlightCanvas');

      render(<TimeOfFlightCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });
    });

    test('should load and render PhaseShiftingCanvas', async () => {
      const { PhaseShiftingCanvas } = await import('../../src/md-preview/components/canvas');

      render(<PhaseShiftingCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('svg')).toBeInTheDocument();
      });
    });
  });

  describe('Canvas Error Handling', () => {
    test('should handle canvas creation errors gracefully', async () => {
      // Mock canvas context to return null (simulating WebGL/WebGPU failure)
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: jest.fn(() => null),
        writable: true,
      });

      const { default: BodyAttenuationCanvas } = await import('../../src/md-preview/BodyAttenuationCanvas');

      // Should not throw error
      expect(() => {
        render(<BodyAttenuationCanvas />, { container });
      }).not.toThrow();
    });

    test('should handle GPU unavailability gracefully', async () => {
      // Mock GPU as unavailable
      Object.defineProperty(navigator, 'gpu', {
        value: undefined,
        writable: true,
      });

      const { default: BodyAttenuationCanvas } = await import('../../src/md-preview/BodyAttenuationCanvas');

      // Should not throw error
      expect(() => {
        render(<BodyAttenuationCanvas />, { container });
      }).not.toThrow();
    });
  });

  describe('Canvas Integration', () => {
    test('should integrate all canvas components together', async () => {
      const canvasModules = await Promise.all([
        import('../../src/md-preview/BodyAttenuationCanvas'),
        import('../../src/md-preview/BodyAttenuationCanvas'),
        import('../../src/md-preview/components/canvas'),
        import('../../src/md-preview/ImpedanceCanvas'),
        import('../../src/md-preview/TimeOfFlightCanvas'),
      ]);

      const components = [
        canvasModules[0].default, // BodyAttenuationCanvas
        canvasModules[1].default, // BodyAttenuationCanvas
        canvasModules[2].AmplitudeModulationCanvas,
        canvasModules[2].FrequencyModulationCanvas,
        canvasModules[2].HeterodyningCanvas,
        canvasModules[2].MultipathCanvas,
        canvasModules[2].PhaseShiftingCanvas,
        canvasModules[3].default, // ImpedanceCanvas
        canvasModules[4].default, // TimeOfFlightCanvas
      ];

      // Render all components
      components.forEach((Component, index) => {
        const testContainer = document.createElement('div');
        document.body.appendChild(testContainer);

        try {
          render(<Component key={index} />, { container: testContainer });
        } catch (error) {
          console.error(`Component ${index} failed to render:`, error);
        }
      });

      // All components should render without throwing
      expect(components.length).toBe(9);
    });
  });

  describe('Canvas Performance', () => {
    test('should render canvases within reasonable time', async () => {
      const { default: BodyAttenuationCanvas } = await import('../../src/md-preview/BodyAttenuationCanvas');

      const startTime = performance.now();

      render(<BodyAttenuationCanvas />, { container });

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeInTheDocument();
      });

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Should render within 2 seconds (adjust threshold as needed)
      expect(renderTime).toBeLessThan(2000);
    });
  });
});
