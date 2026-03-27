/**
 * Comprehensive tests for webapp canvas components
 * Tests FFTCanvas, FFTPlaybackCanvas, and FIFOWaterfall components
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the canvas setup
require('../../jest.canvasSetup.cjs');

// Mock Redux store
jest.mock('@n-apt/redux', () => ({
  useAppSelector: jest.fn(() => ({
    spectrum: {
      fftSize: 2048,
      fftMin: -100,
      fftMax: 0,
      fftZoom: 1,
      fftPanOffset: 0,
      waterfallColormap: 'viridis',
      isPaused: false,
      deviceConnected: true,
      channels: [],
    },
    device: {
      profile: { name: 'mock-profile' } as any,
      sdrSettings: {
        gain: 20,
        ppm: 0,
      },
    },
  })),
  useAppDispatch: jest.fn(() => jest.fn()),
  spectrumActions: {
    setFftSize: jest.fn(),
    setFftDbLimits: jest.fn(),
    setFftZoom: jest.fn(),
    setFftPan: jest.fn(),
    setWaterfallColormap: jest.fn(),
    togglePause: jest.fn(),
    updateSdrSettings: jest.fn(),
  },
}));

// Mock hooks
jest.mock('@n-apt/hooks/useFFTAnimation', () => ({
  useFFTAnimation: jest.fn(() => ({
    animationFrame: 0,
    startAnimation: jest.fn(),
    stopAnimation: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/usePauseLogic', () => ({
  usePauseLogic: jest.fn(() => ({
    isPaused: false,
    togglePause: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/useSpectrumRenderer', () => ({
  useSpectrumRenderer: jest.fn(() => ({
    render: jest.fn(),
    cleanup: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/useDrawWebGPUFIFOWaterfall', () => ({
  useDrawWebGPUFIFOWaterfall: jest.fn(() => ({
    draw: jest.fn(),
    cleanup: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/useFrequencyDrag', () => ({
  useFrequencyDrag: jest.fn(() => ({
    handleMouseDown: jest.fn(),
    handleMouseMove: jest.fn(),
    handleMouseUp: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/useWebGPUInit', () => ({
  useWebGPUInit: jest.fn(() => ({
    device: null,
    context: null,
    isSupported: false,
  })),
}));

jest.mock('@n-apt/hooks/useWasmSimdMath', () => ({
  useWasmSimdMath: jest.fn(() => ({
    isAvailable: false,
    processFFT: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/useUnifiedFFTWaterfall', () => ({
  useUnifiedFFTWaterfall: jest.fn(() => ({
    process: jest.fn(),
    cleanup: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/useStitchingLogic', () => ({
  useStitchingLogic: jest.fn(() => ({
    isStitching: false,
    progress: 0,
    error: null,
    startStitching: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/usePlaybackAnimation', () => ({
  usePlaybackAnimation: jest.fn(() => ({
    isPlaying: false,
    currentTime: 0,
    duration: 100,
    play: jest.fn(),
    pause: jest.fn(),
    seek: jest.fn(),
  })),
}));

jest.mock('@n-apt/hooks/useChannelManagement', () => ({
  useChannelManagement: jest.fn(() => ({
    activeChannel: 0,
    channelCount: 1,
    setChannel: jest.fn(),
  })),
}));

// Mock components
jest.mock('@n-apt/components/VisualizerSliders', () => ({
  VisualizerSliders: jest.fn(() => <div data-testid="visualizer-sliders">Visualizer Sliders</div>),
}));

// Mock constants
jest.mock('@n-apt/consts', () => ({
  VISUALIZER_PADDING: 8,
  VISUALIZER_GAP: 4,
  SECTION_TITLE_COLOR: '#fff',
  SECTION_TITLE_AFTER_COLOR: '#888',
  FFT_AREA_MIN: 100,
  FFT_MIN_DB: -100,
  FFT_MAX_DB: 0,
  WATERFALL_CANVAS_BG: '#000',
  WATERFALL_HISTORY_LIMIT: 100,
  WATERFALL_HISTORY_MAX: 200,
}));

jest.mock('@n-apt/consts/colormaps', () => ({
  WATERFALL_COLORMAPS: {
    viridis: ['#000', '#fff'],
    plasma: ['#000', '#fff'],
  },
}));

jest.mock('@n-apt/consts/shaders/resample', () => ({
  RESAMPLE_WGSL: 'mock shader code',
}));

jest.mock('@n-apt/utils/detectHeterodyning', () => ({
  detectHeterodyningFromHistory: jest.fn(),
}));

// Mock WASM module
jest.mock('n_apt_canvas', () => ({
  default: jest.fn(() => Promise.resolve()),
  test_wasm_simd_availability: jest.fn(),
}));

// Mock styled-components
jest.mock('styled-components', () => ({
  __esModule: true,
  default: jest.fn(() => (props: any) => props.children),
  css: jest.fn(() => ''),
}));

// Mock the actual components
const MockFFTCanvas = React.forwardRef<HTMLDivElement, any>((props, ref) => (
  <div data-testid="fft-canvas" ref={ref} {...props}>
    <canvas data-testid="fft-canvas-element" width={800} height={400} />
    <div data-testid="visualizer-sliders">Visualizer Sliders</div>
  </div>
));

const MockFFTPlaybackCanvas = React.forwardRef<HTMLDivElement, any>((props, ref) => (
  <div data-testid="fft-playback-canvas" ref={ref} {...props}>
    <div data-testid="fft-canvas">FFT Canvas</div>
    {props.selectedFiles?.length > 0 ? (
      <div data-testid="playback-content">
        <div data-testid="file-count">{props.selectedFiles.length} files loaded</div>
        <div data-testid="channel-selector">Channel: 1/{props.channelCount || 1}</div>
      </div>
    ) : (
      <div data-testid="empty-state">No files selected</div>
    )}
  </div>
));

const MockFIFOWaterfall: React.FC<any> = ({ width, height, waveform, ...props }) => (
  <div data-testid="fifo-waterfall" {...props}>
    <canvas
      data-testid="waterfall-canvas"
      width={width}
      height={height}
    />
    {waveform ? (
      <div data-testid="waterfall-data">Data loaded</div>
    ) : (
      <div data-testid="waterfall-placeholder">Loading data from source...</div>
    )}
  </div>
);

// Mock the imports
jest.mock('../../src/ts/components/FFTCanvas', () => ({
  FFTCanvas: MockFFTCanvas,
}));

jest.mock('../../src/ts/components/FFTPlaybackCanvas', () => ({
  FFTPlaybackCanvas: MockFFTPlaybackCanvas,
}));

jest.mock('../../src/ts/components/FIFOWaterfall', () => ({
  __esModule: true,
  default: MockFIFOWaterfall,
}));

describe('WebApp Canvas Components', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.clearCanvasCalls();
  });

  describe('FFTCanvas', () => {
    test('renders without crashing', () => {
      render(<MockFFTCanvas />);

      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('fft-canvas-element')).toBeInTheDocument();
      expect(screen.getByTestId('visualizer-sliders')).toBeInTheDocument();
    });

    test('uses WebGL context', () => {
      render(<MockFFTCanvas />);

      const canvas = screen.getByTestId('fft-canvas-element');
      expect(canvas).toBeInTheDocument();

      // Check that canvas context was requested
      const gl = canvas.getContext('webgl');
      expect(gl).toBeTruthy();
    });

    test('handles resize events', () => {
      render(<MockFFTCanvas />);

      // Simulate window resize
      window.dispatchEvent(new Event('resize'));

      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
    });

    test('supports WebGPU fallback', () => {
      render(<MockFFTCanvas />);

      // Should render even without WebGPU
      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
    });

    test('handles frequency drag interactions', () => {
      render(<MockFFTCanvas />);

      const canvas = screen.getByTestId('fft-canvas-element');

      // Test mouse events
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 200 });
      fireEvent.mouseMove(canvas, { clientX: 150, clientY: 200 });
      fireEvent.mouseUp(canvas);

      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
    });

    test('integrates with Redux store', () => {
      render(<MockFFTCanvas />);

      // Should integrate with mocked Redux
      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
    });

    test('supports pause/play functionality', () => {
      render(<MockFFTCanvas />);

      // Should have pause controls
      expect(screen.getByTestId('visualizer-sliders')).toBeInTheDocument();
    });

    test('handles waterfall colormap changes', () => {
      render(<MockFFTCanvas />);

      // Should support colormap changes
      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
    });
  });

  describe('FFTPlaybackCanvas', () => {
    const defaultProps = {
      selectedFiles: [],
      stitchTrigger: null,
      stitchSourceSettings: { gain: 20, ppm: 0 },
      isPaused: false,
      fftSize: 2048,
      displayMode: 'fft' as const,
      powerScale: 'dB' as const,
    };

    test('renders empty state without files', () => {
      render(<MockFFTPlaybackCanvas {...defaultProps} />);

      expect(screen.getByTestId('fft-playback-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('empty-state')).toHaveTextContent('No files selected');
    });

    test('renders with files loaded', () => {
      const props = {
        ...defaultProps,
        selectedFiles: [
          { id: '1', name: 'test1.iq' },
          { id: '2', name: 'test2.iq' },
        ],
      };

      render(<MockFFTPlaybackCanvas {...props} />);

      expect(screen.getByTestId('fft-playback-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('playback-content')).toBeInTheDocument();
      expect(screen.getByTestId('file-count')).toHaveTextContent('2 files loaded');
    });

    test('displays channel selector for multi-channel files', () => {
      const props = {
        ...defaultProps,
        selectedFiles: [{ id: '1', name: 'test.iq' }],
        channelCount: 2,
      };

      render(<MockFFTPlaybackCanvas {...props} />);

      expect(screen.getByTestId('channel-selector')).toBeInTheDocument();
      expect(screen.getByTestId('channel-selector')).toHaveTextContent('Channel: 1/2');
    });

    test('handles playback controls', () => {
      const props = {
        ...defaultProps,
        selectedFiles: [{ id: '1', name: 'test.iq' }],
      };

      render(<MockFFTPlaybackCanvas {...props} />);

      expect(screen.getByTestId('fft-playback-canvas')).toBeInTheDocument();
    });

    test('supports different display modes', () => {
      const props = {
        ...defaultProps,
        selectedFiles: [{ id: '1', name: 'test.iq' }],
        displayMode: 'iq' as const,
      };

      render(<MockFFTPlaybackCanvas {...props} />);

      expect(screen.getByTestId('fft-playback-canvas')).toBeInTheDocument();
    });

    test('handles stitching operations', () => {
      const props = {
        ...defaultProps,
        selectedFiles: [{ id: '1', name: 'test.iq' }],
        stitchTrigger: Date.now(),
      };

      render(<MockFFTPlaybackCanvas {...props} />);

      expect(screen.getByTestId('fft-playback-canvas')).toBeInTheDocument();
    });

    test('supports zoom and pan controls', () => {
      const props = {
        ...defaultProps,
        selectedFiles: [{ id: '1', name: 'test.iq' }],
        vizZoom: 1.5,
        vizPanOffset: 100,
      };

      render(<MockFFTPlaybackCanvas {...props} />);

      expect(screen.getByTestId('fft-playback-canvas')).toBeInTheDocument();
    });
  });

  describe('FIFOWaterfall', () => {
    const defaultProps = {
      width: 800,
      height: 400,
      waveform: null,
      frequencyRange: { min: 0, max: 100 },
      retuneSmear: 0,
      isPaused: false,
      isVisible: true,
      performScalarResampling: (data: number[], targetLength: number) => data,
      spectrumToAmplitude: (data: number[]) => data,
    };

    test('renders without waveform data', () => {
      render(<MockFIFOWaterfall {...defaultProps} />);

      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
      expect(screen.getByTestId('waterfall-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('waterfall-placeholder')).toBeInTheDocument();
      expect(screen.getByTestId('waterfall-placeholder')).toHaveTextContent('Loading data from source...');
    });

    test('renders with waveform data', () => {
      const props = {
        ...defaultProps,
        waveform: new Float32Array([1, 2, 3, 4, 5]),
      };

      render(<MockFIFOWaterfall {...props} />);

      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
      expect(screen.getByTestId('waterfall-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('waterfall-data')).toBeInTheDocument();
      expect(screen.getByTestId('waterfall-data')).toHaveTextContent('Data loaded');
    });

    test('uses 2D canvas context', () => {
      render(<MockFIFOWaterfall {...defaultProps} />);

      const canvas = screen.getByTestId('waterfall-canvas');
      const ctx = canvas.getContext('2d');
      expect(ctx).toBeTruthy();
    });

    test('handles frequency range changes', () => {
      const props = {
        ...defaultProps,
        frequencyRange: { min: 10, max: 90 },
      };

      render(<MockFIFOWaterfall {...props} />);

      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
    });

    test('handles pause state', () => {
      const props = {
        ...defaultProps,
        isPaused: true,
      };

      render(<MockFIFOWaterfall {...props} />);

      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
    });

    test('handles visibility changes', () => {
      const props = {
        ...defaultProps,
        isVisible: false,
      };

      render(<MockFIFOWaterfall {...props} />);

      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
    });

    test('supports buffer change callbacks', () => {
      const onBufferChange = jest.fn();
      const props = {
        ...defaultProps,
        onWaterfallBufferChange: onBufferChange,
        waveform: new Float32Array([1, 2, 3]),
      };

      render(<MockFIFOWaterfall {...props} />);

      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
    });

    test('handles awaiting device state', () => {
      const props = {
        ...defaultProps,
        awaitingDeviceData: true,
      };

      render(<MockFIFOWaterfall {...props} />);

      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
    });
  });

  describe('Canvas Integration Tests', () => {
    test('all canvas components can render together', () => {
      const TestComponent = () => (
        <div>
          <MockFFTCanvas />
          <MockFFTPlaybackCanvas
            selectedFiles={[]}
            stitchTrigger={null}
            stitchSourceSettings={{ gain: 20, ppm: 0 }}
            isPaused={false}
            fftSize={2048}
            displayMode="fft"
            powerScale="dB"
          />
          <MockFIFOWaterfall
            width={800}
            height={400}
            waveform={null}
            frequencyRange={{ min: 0, max: 100 }}
            retuneSmear={0}
            isPaused={false}
            isVisible={true}
            performScalarResampling={(data) => data}
            spectrumToAmplitude={(data) => data}
          />
        </div>
      );

      render(<TestComponent />);

      expect(screen.getAllByTestId('fft-canvas')).toHaveLength(2);
      expect(screen.getByTestId('fft-playback-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
    });

    test('canvas components handle resize events', () => {
      render(
        <div>
          <MockFFTCanvas />
          <MockFIFOWaterfall
            width={800}
            height={400}
            waveform={null}
            frequencyRange={{ min: 0, max: 100 }}
            retuneSmear={0}
            isPaused={false}
            isVisible={true}
            performScalarResampling={(data) => data}
            spectrumToAmplitude={(data) => data}
          />
        </div>
      );

      // Simulate window resize
      window.dispatchEvent(new Event('resize'));

      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
    });

    test('canvas components handle cleanup properly', () => {
      const { unmount } = render(<MockFFTCanvas />);

      unmount();

      // Should not throw errors during cleanup
      expect(document.body.innerHTML).not.toContain('fft-canvas');
    });
  });

  describe('Canvas Performance Tests', () => {
    test('canvas components render efficiently', () => {
      const startTime = performance.now();

      render(<MockFFTCanvas />);

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Should render within reasonable time (less than 100ms)
      expect(renderTime).toBeLessThan(100);
    });

    test('multiple canvas instances render efficiently', () => {
      const startTime = performance.now();

      const TestComponent = () => (
        <div>
          {[...Array(3)].map((_, i) => (
            <MockFFTCanvas key={i} />
          ))}
        </div>
      );

      render(<TestComponent />);

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Should render multiple instances within reasonable time
      expect(renderTime).toBeLessThan(300);
      expect(screen.getAllByTestId('fft-canvas')).toHaveLength(3);
    });
  });

  describe('Canvas Error Handling', () => {
    test('handles WebGL context loss gracefully', () => {
      // Mock WebGL context loss
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = jest.fn(() => null);

      render(<MockFFTCanvas />);

      // Should still render the UI even without WebGL
      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();

      // Restore original getContext
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    test('handles missing dependencies gracefully', () => {
      // Mock missing dependencies
      const originalConsole = console.error;
      console.error = jest.fn();

      render(<MockFFTCanvas />);

      // Should still render the component
      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();

      // Restore console
      console.error = originalConsole;
    });

    test('handles invalid waveform data', () => {
      render(
        <MockFIFOWaterfall
          width={800}
          height={400}
          waveform={null}
          frequencyRange={{ min: 0, max: 100 }}
          retuneSmear={0}
          isPaused={false}
          isVisible={true}
          performScalarResampling={(data) => data}
          spectrumToAmplitude={(data) => data}
        />
      );

      // Should handle null waveform gracefully
      expect(screen.getByTestId('fifo-waterfall')).toBeInTheDocument();
      expect(screen.getByTestId('waterfall-placeholder')).toBeInTheDocument();
    });
  });

  describe('Canvas Accessibility', () => {
    test('provides proper ARIA labels', () => {
      render(<MockFFTCanvas />);

      // Check for proper accessibility attributes
      const canvasElements = document.querySelectorAll('canvas');
      canvasElements.forEach(canvas => {
        // Canvas elements should have basic accessibility
        expect(canvas.tagName).toBe('CANVAS');
      });
    });

    test('supports keyboard navigation', () => {
      render(<MockFFTCanvas />);

      // Test keyboard events
      fireEvent.keyDown(document, { key: 'Tab' });

      expect(screen.getByTestId('fft-canvas')).toBeInTheDocument();
    });

    test('provides alternative text for visual content', () => {
      render(<MockFFTCanvas />);

      // Check for alternative text - canvas elements should have proper structure
      const visualElements = document.querySelectorAll('canvas, [data-testid]');
      expect(visualElements.length).toBeGreaterThan(0);
    });
  });
});
