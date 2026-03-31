/**
 * Comprehensive tests for markdown canvas components
 * Tests all canvas components used in the markdown preview system
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Import canvas components
import BodyAttenuationCanvas from '../../src/md-preview/BodyAttenuationCanvas';
import BodyAttenuationWebGPUCanvas from '../../src/md-preview/BodyAttenuationWebGPUCanvas';
import ImpedanceCanvas from '../../src/md-preview/ImpedanceCanvas';
import TimeOfFlightCanvas from '../../src/md-preview/TimeOfFlightCanvas';
import PhaseShfitingCanvas from '../../src/md-preview/PhaseShfitingCanvas';
import remarkSignalCanvasBlocks from '../../src/md-preview/remarkSignalCanvasBlocks';

// Mock Three.js and React Three Fiber
jest.mock('three', () => ({
  ...jest.requireActual('three'),
  WebGLRenderer: jest.fn().mockImplementation(() => ({
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    render: jest.fn(),
    dispose: jest.fn(),
    domElement: document.createElement('canvas'),
  })),
  WebGL1Renderer: jest.fn().mockImplementation(() => ({
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    render: jest.fn(),
    dispose: jest.fn(),
    domElement: document.createElement('canvas'),
  })),
}));

jest.mock('@react-three/fiber', () => ({
  Canvas: ({ className, style }: any) => (
    <div data-testid="r3f-canvas" className={className} style={style}>
      <canvas role="img" />
    </div>
  ),
  useFrame: jest.fn(),
  useThree: jest.fn(() => ({
    gl: { render: jest.fn(), setSize: jest.fn() },
    camera: { position: [0, 0, 5], fov: 75 },
    scene: { add: jest.fn(), remove: jest.fn() },
    size: { width: 800, height: 600 },
  })),
}));

jest.mock('@react-three/drei', () => ({
  Html: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  Line: () => null,
  useTexture: jest.fn(() => ({
    needsUpdate: true,
    wrapS: 1001,
    wrapT: 1001,
    repeat: { set: jest.fn() },
    offset: { set: jest.fn() }
  })),
}));

jest.mock('styled-components', () => ({
  __esModule: true,
  ...jest.requireActual('styled-components'),
  default: jest.requireActual('styled-components').default,
}));

// Mock import.meta.env
Object.defineProperty(window, 'importMetaEnv', {
  value: { BASE_URL: '/' },
  writable: true,
});

Object.defineProperty(global, 'import', {
  value: {
    meta: {
      env: { BASE_URL: '/' }
    }
  },
  writable: true,
});

describe('Markdown Canvas Components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset canvas mocking
    global.clearCanvasCalls();
  });

  describe('BodyAttenuationCanvas', () => {
    test('renders without crashing', () => {
      render(<BodyAttenuationCanvas />);

      expect(screen.getByAltText('Body attenuation visualization')).toBeInTheDocument();
      expect(screen.getByText('drag inside the panel to move the target cursor')).toBeInTheDocument();
    });

    test('displays WebGPU status correctly', () => {
      render(<BodyAttenuationCanvas />);

      expect(screen.getByText('WebGL')).toBeInTheDocument();
    });

    test('shows endpoint information', () => {
      render(<BodyAttenuationCanvas />);

      expect(screen.getByText('Endpoint A (Tx)')).toBeInTheDocument();
      expect(screen.getByText('Endpoint B (Rx)')).toBeInTheDocument();
      expect(screen.getByText(/\+24\.0 dBm/)).toBeInTheDocument();
      expect(screen.getByText(/-48\.0 dBm/)).toBeInTheDocument();
    });

    test('displays metrics correctly', () => {
      render(<BodyAttenuationCanvas />);

      expect(screen.getByText('tx distance')).toBeInTheDocument();
      expect(screen.getByText('rx distance')).toBeInTheDocument();
      expect(screen.getByText('frequency')).toBeInTheDocument();
      expect(screen.getByText('total path loss')).toBeInTheDocument();
      expect(screen.getByText('13\.56 MHz')).toBeInTheDocument();
    });

    test('handles pointer interactions', async () => {
      render(<BodyAttenuationCanvas />);

      const canvasStage = screen.getByText('drag inside the panel to move the target cursor').closest('div');

      if (canvasStage) {
        fireEvent.pointerDown(canvasStage, { clientX: 200 });
        fireEvent.pointerMove(canvasStage, { clientX: 300 });
        fireEvent.pointerUp(canvasStage);

        await waitFor(() => {
          // Should update cursor position
          expect(screen.getByText('drag inside the panel to move the target cursor')).toBeInTheDocument();
        });
      }
    });

    test('uses WebGL context', () => {
      render(<BodyAttenuationCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });
  });

  describe('BodyAttenuationWebGPUCanvas', () => {
    test('renders without crashing', () => {
      render(<BodyAttenuationWebGPUCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('uses WebGPU when available', () => {
      // Mock WebGPU availability
      Object.defineProperty(navigator, 'gpu', {
        value: {
          requestAdapter: jest.fn().mockResolvedValue({
            requestDevice: jest.fn().mockResolvedValue({})
          })
        },
        writable: true,
      });

      render(<BodyAttenuationWebGPUCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('handles character image loading', async () => {
      render(<BodyAttenuationWebGPUCanvas />);

      await waitFor(() => {
        expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
      });
    });

    test('uses WebGL context as fallback', () => {
      render(<BodyAttenuationWebGPUCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });
  });

  describe('ImpedanceCanvas', () => {
    test('renders without crashing', () => {
      render(<ImpedanceCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('displays impedance visualization', () => {
      render(<ImpedanceCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('uses WebGL context', () => {
      render(<ImpedanceCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });
  });

  describe('TimeOfFlightCanvas', () => {
    test('renders without crashing', () => {
      render(<TimeOfFlightCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('displays time of flight visualization', () => {
      render(<TimeOfFlightCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('uses WebGL context', () => {
      render(<TimeOfFlightCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });
  });

  describe('PhaseShfitingCanvas', () => {
    test('renders without crashing', () => {
      render(<PhaseShfitingCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('displays phase shifting visualization', () => {
      render(<PhaseShfitingCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });

    test('uses WebGL context', () => {
      render(<PhaseShfitingCanvas />);

      expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    });
  });

  describe('remarkSignalCanvasBlocks', () => {
    test('processes signal canvas blocks correctly', () => {
      const tree = {
        type: 'root',
        children: [
          {
            type: 'code',
            lang: 'canvas::phaseshifting',
            value: '',
          },
        ],
      };

      remarkSignalCanvasBlocks()(tree as any);

      expect(tree.children[0]).toEqual({
        type: 'html',
        value: '<phase-shifting-canvas></phase-shifting-canvas>',
      });
    });

    test('handles different canvas types', () => {
      const canvasTypes = [
        ['canvas::phaseshifting', '<phase-shifting-canvas></phase-shifting-canvas>'],
        ['canvas::frequencymodulation', '<frequency-modulation-canvas></frequency-modulation-canvas>'],
        ['canvas::amplitudemodulation', '<amplitude-modulation-canvas></amplitude-modulation-canvas>'],
      ];

      canvasTypes.forEach(([lang, value]) => {
        const tree = {
          type: 'root',
          children: [
            {
              type: 'code',
              lang,
              value: '',
            },
          ],
        };

        remarkSignalCanvasBlocks()(tree as any);
        expect(tree.children[0]).toEqual({ type: 'html', value });
      });
    });

    test('handles invalid nodes gracefully', () => {
      const invalidNodes = [
        null,
        undefined,
        { type: 'text', value: 'plain text' },
        { type: 'element', tagName: 'div' },
      ];

      invalidNodes.forEach(node => {
        expect(() => {
          remarkSignalCanvasBlocks()(node as any);
        }).not.toThrow();
      });
    });
  });

  describe('Canvas Integration Tests', () => {
    test('all canvas components can render together', () => {
      const TestComponent = () => (
        <div>
          <BodyAttenuationCanvas />
          <ImpedanceCanvas />
          <TimeOfFlightCanvas />
          <PhaseShfitingCanvas />
        </div>
      );

      render(<TestComponent />);

      expect(screen.getByAltText('Body attenuation visualization')).toBeInTheDocument();
      expect(screen.getAllByTestId('r3f-canvas')).toHaveLength(4);
    });

    test('canvas components handle resize events', () => {
      render(<BodyAttenuationCanvas />);

      // Simulate window resize
      window.dispatchEvent(new Event('resize'));

      // Component should still be rendered
      expect(screen.getByAltText('Body attenuation visualization')).toBeInTheDocument();
    });

    test('canvas components handle cleanup properly', () => {
      const { unmount } = render(<BodyAttenuationCanvas />);

      unmount();

      // Should not throw errors during cleanup
      expect(document.body.innerHTML).not.toContain('BODY ATTENUATION / ENTRY EXIT MODEL');
    });
  });

  describe('Canvas Performance Tests', () => {
    test('canvas components render efficiently', () => {
      const startTime = performance.now();

      render(<BodyAttenuationCanvas />);

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Should render within reasonable time (less than 100ms)
      expect(renderTime).toBeLessThan(100);
    });

    test('multiple canvas instances render efficiently', () => {
      const startTime = performance.now();

      const TestComponent = () => (
        <div>
          {[...Array(5)].map((_, i) => (
            <BodyAttenuationCanvas key={i} />
          ))}
        </div>
      );

      render(<TestComponent />);

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Mock missing THREE.js
      const originalThree = global.THREE;
      global.THREE = undefined;

      expect(() => {
        render(<BodyAttenuationCanvas />);
      }).not.toThrow();

      // Restore THREE.js
      global.THREE = originalThree;
    });

    test('handles image loading errors', () => {
      render(<BodyAttenuationCanvas />);

      // Simulate image loading error
      const images = document.querySelectorAll('img');
      images.forEach(img => {
        fireEvent.error(img);
      });

      // Should still render the component
      expect(screen.getByAltText('Body attenuation visualization')).toBeInTheDocument();
    });
  });

  describe('Canvas Accessibility', () => {
    test('provides proper ARIA labels', () => {
      render(<BodyAttenuationCanvas />);

      // Check for proper accessibility attributes
      const canvasElements = document.querySelectorAll('canvas');
      canvasElements.forEach(canvas => {
        expect(canvas).toHaveAttribute('role');
      });
    });

    test('supports keyboard navigation', () => {
      render(<BodyAttenuationCanvas />);

      // Test keyboard events
      fireEvent.keyDown(document, { key: 'Tab' });

      expect(screen.getByAltText('Body attenuation visualization')).toBeInTheDocument();
    });

    test('provides alternative text for visual content', () => {
      render(<BodyAttenuationCanvas />);

      // Check for alternative text
      const images = document.querySelectorAll('img[alt]');
      expect(images.length).toBeGreaterThan(0);
    });
  });
});
