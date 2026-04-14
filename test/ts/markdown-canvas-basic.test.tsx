/**
 * Basic tests for markdown canvas components
 * Tests fundamental functionality without complex mocking
 */

import React from 'react';
import '@testing-library/jest-dom';

// Mock the canvas setup
require('../../jest.canvasSetup.cjs');

describe('Markdown Canvas Components - Basic Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.clearCanvasCalls();
  });

  test('canvas mocking setup is working', () => {
    // Test that our canvas mocking is working
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    expect(gl).toBeTruthy();
    expect(typeof gl?.clearColor).toBe('function');
  });

  test('WebGPU mocking is available', () => {
    // Test that WebGPU mocking is working
    expect(typeof navigator.gpu?.requestAdapter).toBe('function');
  });

  test('canvas context requests are tracked', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext('webgl');
    canvas.getContext('2d');

    // Check that canvas context calls were logged
    expect(global.__CANVAS_CALLS__).toHaveLength(2);
    expect(global.__CANVAS_CALLS__.filter(c => c.name === 'getContext' && c.args[0] === 'webgl')).toHaveLength(1);
    expect(global.__CANVAS_CALLS__.filter(c => c.name === 'getContext' && c.args[0] === '2d')).toHaveLength(1);
    expect(global.countWebGLCalls()).toBe(0); // WebGL calls are tracked separately
  });

  test('WebGL calls are tracked', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      gl.clearColor(1, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    expect(global.countWebGLCalls('clearColor')).toBe(1);
    expect(global.countWebGLCalls('clear')).toBe(1);
  });

  test('WebGPU calls are tracked', async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const _buffer = device.createBuffer({ size: 512, usage: 4 });

    // Check that WebGPU calls were tracked
    expect(global.countWebGPUCalls('requestAdapter')).toBe(1);
    expect(global.countWebGPUCalls('requestDevice')).toBe(1);
    expect(global.countWebGPUCalls('createBuffer')).toBe(1);
  });

  test('canvas helper functions work', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      gl.clearColor(0.5, 0.5, 0.5, 1.0);
    }

    // Test expectWebGLCall
    expect(() => global.expectWebGLCall('clearColor')).not.toThrow();
    expect(() => global.expectWebGLCall('clearColor', [0.5, 0.5, 0.5, 1.0])).not.toThrow();

    // Test that it throws for non-existent calls
    expect(() => global.expectWebGLCall('nonExistentCall')).toThrow();
  });

  test('WebGPU helper functions work', async () => {
    const _adapter = await navigator.gpu?.requestAdapter();

    // Test expectWebGPUCall
    expect(() => global.expectWebGPUCall('requestAdapter')).not.toThrow();

    // Test that it throws for non-existent calls
    expect(() => global.expectWebGPUCall('nonExistentCall')).toThrow();
  });

  test('canvas context helper works', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext('webgl2');

    expect(() => global.expectCanvasContext('webgl2')).not.toThrow();
    expect(() => global.expectCanvasContext('2d')).toThrow();
  });

  test('call clearing works between tests', () => {
    // First test
    const canvas1 = document.createElement('canvas');
    canvas1.getContext('webgl');
    expect(global.__CANVAS_CALLS__).toHaveLength(1);

    // Clear calls
    global.clearCanvasCalls();
    expect(global.__CANVAS_CALLS__).toHaveLength(0);

    // Second test
    const canvas2 = document.createElement('canvas');
    canvas2.getContext('webgl');
    expect(global.__CANVAS_CALLS__).toHaveLength(1);
  });

  test('WebGL extensions are mocked', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      const ext = gl.getExtension('OES_texture_float');
      expect(ext).toBeTruthy();
      expect(ext?.FLOAT).toBe(5126);
    }
  });

  test('WebGL parameters are mocked', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      const vendor = gl.getParameter(gl.VENDOR);
      // The mock returns a number, not a string
      expect(typeof vendor).toBe('number');
    }
  });

  test('WebGL shader operations work', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      const shader = gl.createShader(gl.VERTEX_SHADER);
      expect(shader).toBeTruthy();

      gl.shaderSource(shader, 'void main() { gl_Position = vec4(0.0); }');
      gl.compileShader(shader);

      const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
      expect(compiled).toBe(true);
    }
  });

  test('WebGL program operations work', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      const program = gl.createProgram();
      expect(program).toBeTruthy();

      const vertexShader = gl.createShader(gl.VERTEX_SHADER);
      const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
      expect(linked).toBe(true);
    }
  });

  test('WebGL buffer operations work', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      const buffer = gl.createBuffer();
      expect(buffer).toBeTruthy();

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 2, 3]), gl.STATIC_DRAW);

      expect(countWebGLCalls('createBuffer')).toBe(1);
      expect(countWebGLCalls('bindBuffer')).toBe(1);
      expect(countWebGLCalls('bufferData')).toBe(1);
    }
  });

  test('WebGL texture operations work', () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    if (gl) {
      const texture = gl.createTexture();
      expect(texture).toBeTruthy();

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      expect(countWebGLCalls('createTexture')).toBe(1);
      expect(countWebGLCalls('bindTexture')).toBe(1);
      expect(countWebGLCalls('texParameteri')).toBe(1);
    }
  });

  test('WebGPU buffer operations work', async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const buffer = device.createBuffer({ size: 1024, usage: 6 }); // VERTEX + UNIFORM
    expect(buffer).toBeTruthy();
    expect(buffer.size).toBe(1024);
    expect(buffer.usage).toBe(6);

    device.queue.writeBuffer(buffer, 0, new Uint8Array(64));

    expect(countWebGPUCalls('createBuffer')).toBe(1);
    expect(countWebGPUCalls('writeBuffer')).toBe(1);
  });

  test('WebGPU texture operations work', async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const texture = device.createTexture({
      size: { width: 256, height: 256 },
      format: 'rgba8unorm',
      usage: 1
    });

    expect(texture).toBeTruthy();
    expect(texture.width).toBe(256);
    expect(texture.height).toBe(256);
    expect(texture.format).toBe('rgba8unorm');

    expect(countWebGPUCalls('createTexture')).toBe(1);
  });

  test('WebGPU command encoder operations work', async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const encoder = device.createCommandEncoder();
    expect(encoder).toBeTruthy();

    const commandBuffer = encoder.finish();
    expect(commandBuffer).toBeTruthy();

    expect(countWebGPUCalls('createCommandEncoder')).toBe(1);
    expect(countWebGPUCalls('finish')).toBe(1);
  });

  test('GPU constants are available', () => {
    expect(typeof GPUBufferUsage).toBe('object');
    expect(typeof GPUTextureUsage).toBe('object');

    expect(GPUBufferUsage.VERTEX).toBe(2);
    expect(GPUBufferUsage.UNIFORM).toBe(4);
    expect(GPUTextureUsage.RENDER_ATTACHMENT).toBe(16);
  });

  test('canvas toDataURL works', () => {
    const canvas = document.createElement('canvas');
    const dataURL = canvas.toDataURL();

    // The mock returns a data URL with "00" as the base64 content
    expect(dataURL).toBe('data:image/png;base64,00');
  });

  test('canvas getBoundingClientRect works', () => {
    const canvas = document.createElement('canvas');
    const rect = canvas.getBoundingClientRect();

    expect(rect.width).toBe(800);
    expect(rect.height).toBe(600);
  });
});
