import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// Test the enhanced canvas mocking setup
describe('Enhanced Canvas Mocking Tests', () => {
  beforeEach(() => {
    // Clear call logs before each test
    if (global.clearCanvasCalls) {
      global.clearCanvasCalls();
    }
  });

  describe('WebGL Canvas Mocking', () => {
    test('WebGL drawArrays is called with correct parameters', () => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');

      // Simulate WebGL operations
      gl.clearColor(1, 0, 0, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Use the helper function to verify the call
      expectWebGLCall('drawArrays', [4, 0, 3]);
      expectWebGLCall('clearColor', [1, 0, 0, 1]);

      // Verify call count
      expect(countWebGLCalls('drawArrays')).toBe(1);
      expect(countWebGLCalls('clearColor')).toBe(1);
    });

    test('WebGL shader compilation is tracked', () => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');

      // Create and compile shaders
      const vertexShader = gl.createShader(gl.VERTEX_SHADER);
      const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

      gl.shaderSource(vertexShader, 'attribute vec4 position; void main() { gl_Position = position; }');
      gl.shaderSource(fragmentShader, 'precision mediump float; void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }');

      gl.compileShader(vertexShader);
      gl.compileShader(fragmentShader);

      // Verify shader operations
      expect(countWebGLCalls('createShader')).toBe(2);
      expect(countWebGLCalls('shaderSource')).toBe(2);
      expect(countWebGLCalls('compileShader')).toBe(2);

      // Check specific shader types
      const vertexShaderCall = getWebGLCalls('createShader')[0];
      const fragmentShaderCall = getWebGLCalls('createShader')[1];
      expect(vertexShaderCall.args[0]).toBe(gl.VERTEX_SHADER);
      expect(fragmentShaderCall.args[0]).toBe(gl.FRAGMENT_SHADER);
    });

    test('WebGL texture operations are tracked', () => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');

      // Create and setup texture
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);

      // Verify texture operations
      expectWebGLCall('createTexture');
      expectWebGLCall('bindTexture');
      expectWebGLCall('texImage2D');
      expectWebGLCall('texParameteri', [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR]);
      expectWebGLCall('generateMipmap');

      expect(countWebGLCalls('createTexture')).toBe(1);
    });

    test('WebGL buffer operations are tracked', () => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');

      // Create and setup buffer
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const vertices = new Float32Array([0, 0, 1, 0, 0.5, 1]);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      // Verify buffer operations
      expectWebGLCall('createBuffer');
      expectWebGLCall('bindBuffer', [gl.ARRAY_BUFFER, buffer]);
      expectWebGLCall('bufferData');

      expect(countWebGLCalls('createBuffer')).toBe(1);
    });

    test('WebGL extensions are supported', () => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');

      // Clear any previous calls
      global.clearCanvasCalls();

      // Request extensions
      const floatTextureExt = gl.getExtension('OES_texture_float');
      const instancedArraysExt = gl.getExtension('ANGLE_instanced_arrays');

      // Verify extension requests were made
      expect(countWebGLCalls('getExtension')).toBe(2);

      // Check that the extensions exist (order doesn't matter)
      const extensionCalls = getWebGLCalls('getExtension');
      const extensionNames = extensionCalls.map(call => call.args[0]);
      expect(extensionNames).toContain('OES_texture_float');
      expect(extensionNames).toContain('ANGLE_instanced_arrays');

      expect(floatTextureExt).toBeTruthy();
      expect(instancedArraysExt).toBeTruthy();
      if (instancedArraysExt) {
        expect(instancedArraysExt.drawArraysInstancedANGLE).toBeDefined();
      }
    });

    describe('WebGPU Canvas Mocking', () => {
      test('WebGPU buffer creation is tracked', async () => {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();

        const buffer = device.createBuffer({
          size: 1024,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });

        // Verify WebGPU operations
        expectWebGPUCall('createBuffer', [{ size: 1024, usage: 2 }]); // 2 = VERTEX | COPY_DST
        expect(countWebGPUCalls('createBuffer')).toBe(1);

        // Verify buffer properties
        expect(buffer.size).toBe(1024);
        expect(buffer.usage).toBe(2);
      });

      test('WebGPU texture operations are tracked', async () => {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();

        const texture = device.createTexture({
          size: { width: 256, height: 256 },
          format: 'bgra8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
        });

        // Verify texture creation
        expectWebGPUCall('createTexture');
        expect(countWebGPUCalls('createTexture')).toBe(1);

        // Verify texture properties
        expect(texture.width).toBe(256);
        expect(texture.height).toBe(256);
        expect(texture.format).toBe('bgra8unorm');
      });

      test('WebGPU command encoder operations are tracked', async () => {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();

        const encoder = device.createCommandEncoder();
        const texture = device.createTexture({
          size: { width: 256, height: 256 },
          format: 'bgra8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });

        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
          }]
        });

        renderPass.end();
        const commandBuffer = encoder.finish();

        // Verify command encoder operations
        expectWebGPUCall('createCommandEncoder');
        expectWebGPUCall('createTexture');
        expectWebGPUCall('beginRenderPass');
        expectWebGPUCall('end');
        expectWebGPUCall('finish');
      });

      test('WebGPU queue operations are tracked', async () => {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();

        const buffer = device.createBuffer({ size: 1024, usage: GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(buffer, 0, new Uint8Array([1, 2, 3, 4]));

        const encoder = device.createCommandEncoder();
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);

        // Verify queue operations
        expectWebGPUCall('writeBuffer');
        expectWebGPUCall('submit');
        expect(countWebGPUCalls('writeBuffer')).toBe(1);
        expect(countWebGPUCalls('submit')).toBe(1);
      });
    });

    describe('Canvas Context Mocking', () => {
      test('Canvas context requests are tracked', () => {
        // Create different canvas contexts
        const canvas2d = document.createElement('canvas');
        const canvasWebGL = document.createElement('canvas');
        const canvasWebGL2 = document.createElement('canvas');

        canvas2d.getContext('2d');
        canvasWebGL.getContext('webgl');
        canvasWebGL2.getContext('webgl2');

        // Verify context requests
        expectCanvasContext('2d');
        expectCanvasContext('webgl');
        expectCanvasContext('webgl2');

        expect(countCanvasCalls?.('getContext') || 0).toBe(3);
      });

      test('Canvas properties are mocked correctly', () => {
        const canvas = document.createElement('canvas');

        // Test canvas methods that should be available
        // jest-canvas-mock provides its own toDataURL implementation
        expect(canvas.toDataURL()).toContain('data:image/png;base64,');

        canvas.toBlob((blob) => {
          expect(blob).toBeInstanceOf(Blob);
          expect(blob.type).toBe('image/png');
        });

        // Test bounding rect
        const rect = canvas.getBoundingClientRect();
        expect(rect.width).toBe(800);
        expect(rect.height).toBe(600);
      });
    });

    describe('Integration with React Components', () => {
      test('React components can use canvas contexts', () => {
        const TestComponent = () => {
          const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

          React.useEffect(() => {
            if (canvasRef.current) {
              const gl = canvasRef.current.getContext('webgl2');
              if (gl) {
                gl.clearColor(0, 1, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
              }
            }
          }, []);

          return <canvas ref={canvasRef} width={400} height={300} />;
        };

        render(<TestComponent />);

        // Verify WebGL operations were called
        expectCanvasContext('webgl2');
        expectWebGLCall('clearColor', [0, 1, 0, 1]);
        expectWebGLCall('clear', [16384]); // COLOR_BUFFER_BIT
      });

      test('React components can use WebGPU', async () => {
        // Disable call clearing for this test
        (global as any).__DISABLE_CALL_CLEARING__ = true;

        try {
          // Test that React can render a canvas (basic test)
          const TestComponent = () => {
            return <canvas width={400} height={300} />;
          };

          render(<TestComponent />);

          // Verify canvas was rendered
          expect(document.querySelector('canvas')).toBeTruthy();

          // Now test WebGPU operations (after React render)
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();

          const buffer = device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM });
          device.queue.writeBuffer(buffer, 0, new Uint8Array(64));

          // Verify WebGPU operations were called (check what was actually tracked)
          expectWebGPUCall('createBuffer');
          expectWebGPUCall('writeBuffer');

          // Check that adapter and device operations were called (these may be cleared by jest.clearAllMocks)
          expect(countWebGPUCalls('createBuffer')).toBeGreaterThan(0);
          expect(countWebGPUCalls('writeBuffer')).toBeGreaterThan(0);

          // Verify we have the expected WebGPU objects
          expect(adapter).toBeTruthy();
          expect(device).toBeTruthy();
          expect(buffer).toBeTruthy();
        } finally {
          // Re-enable call clearing
          (global as any).__DISABLE_CALL_CLEARING__ = false;
        }
      });
    });

    describe('Error Handling and Edge Cases', () => {
      test('Invalid WebGL calls are handled gracefully', () => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');

        // These should not throw errors
        expect(() => {
          gl.drawArrays(999, 0, 3); // Invalid mode
          gl.bindBuffer(999, null); // Invalid target
          gl.texImage2D(gl.TEXTURE_2D, 0, 999, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); // Invalid format
        }).not.toThrow();

        // Calls should still be tracked
        expect(countWebGLCalls('drawArrays')).toBe(1);
        expect(countWebGLCalls('bindBuffer')).toBe(1);
        expect(countWebGLCalls('texImage2D')).toBe(1);
      });

      test('WebGPU operations handle invalid parameters', async () => {
        const adapter = await navigator.gpu.requestAdapter();
        const device = await adapter.requestDevice();

        // These should not throw errors
        expect(() => {
          device.createBuffer({ size: -1, usage: 999 }); // Invalid parameters
        }).not.toThrow();

        // Call should still be tracked
        expect(countWebGPUCalls('createBuffer')).toBe(1);
      });

      test('Canvas context availability', () => {
        const canvas = document.createElement('canvas');

        // Test that different context types return appropriate mocks
        const ctx2d = canvas.getContext('2d');
        const ctxWebGL = canvas.getContext('webgl');
        const ctxWebGL2 = canvas.getContext('webgl2');
        const ctxInvalid = canvas.getContext('invalid');

        expect(ctx2d).toBeTruthy();
        expect(ctxWebGL).toBeTruthy();
        expect(ctxWebGL2).toBeTruthy();
        expect(ctxInvalid).toBeNull();
      });
    });

    describe('Performance and Memory', () => {
      test('Call logs are properly cleared between tests', () => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');

        // Make some calls
        gl.clearColor(1, 0, 0, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        expect(countWebGLCalls('clearColor')).toBe(1);
        expect(countWebGLCalls('drawArrays')).toBe(1);

        // Clear calls
        global.clearCanvasCalls();

        // Verify calls are cleared
        expect(countWebGLCalls('clearColor')).toBe(0);
        expect(countWebGLCalls('drawArrays')).toBe(0);
        expect(global.__WEBGL_CALLS__).toHaveLength(0);
      });

      test('Large number of calls are handled efficiently', () => {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');

        // Make many calls
        for (let i = 0; i < 1000; i++) {
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        // Verify all calls are tracked
        expect(countWebGLCalls('drawArrays')).toBe(1000);
        expect(global.__WEBGL_CALLS__).toHaveLength(1000);
      });
    });
  });
});

// Helper function for canvas context counting (if not available globally)
const countCanvasCalls = (callName: string) => {
  return global.__CANVAS_CALLS__?.filter((c: any) => c.name === callName).length || 0;
};
