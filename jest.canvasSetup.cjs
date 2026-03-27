/**
 * jest.canvasSetup.cjs - Comprehensive Canvas Mocking Setup
 * 
 * This file provides enhanced mocking capabilities for canvas operations in Jest tests,
 * supporting both WebGL and WebGPU contexts with detailed call tracking and helper functions.
 * 
 * Features:
 * - WebGL/WebGL2 context mocking with comprehensive API coverage
 * - WebGPU context mocking with resource creation and management
 * - Call logging for all canvas operations
 * - Helper functions for test assertions
 * - Integration with jest-canvas-mock for 2D contexts
 * 
 * @author Enhanced Canvas Mocking System
 * @since 2026
 */

// Import jest-canvas-mock for basic canvas functionality
require('jest-canvas-mock');

/**
 * Global arrays to store call logs for different canvas contexts.
 * These arrays track all method calls made to canvas contexts for test verification.
 * 
 * @global
 * @type {Array<{name: string, args: Array<any>}>}
 */
// ---- CALL LOG STORAGE ----
global.__WEBGL_CALLS__ = [];
global.__WEBGPU_CALLS__ = [];
global.__CANVAS_CALLS__ = [];

/**
 * Helper function to log method calls with their arguments.
 * 
 * @param {Array<{name: string, args: Array<any>}>} store - The call log array to store the call in
 * @param {string} name - The name of the method being called
 * @param {ArrayLike<any>} args - The arguments passed to the method
 */
// ---- HELPER TO LOG CALLS ----
function logCall(store, name, args) {
  store.push({ name, args: Array.from(args) });
}

/**
 * Clears all canvas call logs for test isolation.
 * This function should be called between tests to ensure test independence.
 * 
 * @global
 * @function clearCanvasCalls
 */
// ---- CLEAR CALL LOGS FOR TEST ISOLATION ----
global.clearCanvasCalls = () => {
  global.__WEBGL_CALLS__ = [];
  global.__WEBGPU_CALLS__ = [];
  global.__CANVAS_CALLS__ = [];
};

/**
 * Enhanced HTMLCanvasElement.prototype.getContext mock with comprehensive WebGL/WebGL2 support.
 * This mock extends the original getContext method to provide detailed logging and enhanced
 * functionality for both 2D and 3D contexts.
 * 
 * @param {string} type - The context type ('2d', 'webgl', 'webgl2')
 * @param {...any} contextArgs - Additional arguments for context creation
 * @returns {CanvasRenderingContext2D|WebGLRenderingContext|WebGL2RenderingContext|null} The context object
 */
// ---- ENHANCED HTMLCanvasElement MOCK ----
const originalGetContext = HTMLCanvasElement.prototype.getContext;

function wrapCanvas2DContext(ctx) {
  if (!ctx || ctx.__canvasLoggingWrapped) {
    return ctx;
  }

  const methodsToLog = [
    'setTransform',
    'clearRect',
    'fillRect',
    'strokeRect',
    'drawImage',
    'putImageData',
    'fillText',
    'strokeText',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'fill',
    'arc',
    'closePath',
  ];

  methodsToLog.forEach((name) => {
    if (typeof ctx[name] !== 'function') {
      return;
    }

    const originalMethod = ctx[name].bind(ctx);
    ctx[name] = (...args) => {
      logCall(global.__CANVAS_CALLS__, name, args);
      return originalMethod(...args);
    };
  });

  Object.defineProperty(ctx, '__canvasLoggingWrapped', {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false,
  });

  return ctx;
}

HTMLCanvasElement.prototype.getContext = function (type, ...contextArgs) {
  // Log canvas context creation
  logCall(global.__CANVAS_CALLS__, 'getContext', [type, ...contextArgs]);
  
  // Use jest-canvas-mock for 2D context
  if (type === '2d') {
    return wrapCanvas2DContext(originalGetContext.call(this, type, ...contextArgs));
  }

  if (type === 'webgpu') {
    return {
      canvas: this,
      configure: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'configure', args);
      }),
      getCurrentTexture: jest.fn(() => {
        logCall(global.__WEBGPU_CALLS__, 'getCurrentTexture', []);
        return {
          createView: jest.fn((...args) => {
            logCall(global.__WEBGPU_CALLS__, 'createView', args);
            return {};
          }),
          destroy: jest.fn(() => {
            logCall(global.__WEBGPU_CALLS__, 'destroyTexture', []);
          }),
        };
      }),
      unconfigure: jest.fn(() => {
        logCall(global.__WEBGPU_CALLS__, 'unconfigure', []);
      }),
    };
  }
  
  // Enhanced WebGL/WebGL2 mock
  if (type === 'webgl' || type === 'webgl2') {
    /**
     * Comprehensive WebGL context mock with state tracking and call logging.
     * This mock provides a complete WebGL API implementation for testing purposes,
     * including shader/program management, buffer/texture operations, and drawing methods.
     * 
     * @type {WebGLRenderingContext|WebGL2RenderingContext}
     */
    const gl = {
      // WebGL Constants
      /** @type {number} */ VERTEX_SHADER: 35633,
      /** @type {number} */ FRAGMENT_SHADER: 35632,
      /** @type {number} */ ARRAY_BUFFER: 34962,
      /** @type {number} */ ELEMENT_ARRAY_BUFFER: 34963,
      /** @type {number} */ STATIC_DRAW: 35044,
      /** @type {number} */ DYNAMIC_DRAW: 35048,
      /** @type {number} */ TRIANGLES: 4,
      /** @type {number} */ TRIANGLE_STRIP: 5,
      /** @type {number} */ TRIANGLE_FAN: 6,
      /** @type {number} */ COLOR_BUFFER_BIT: 16384,
      /** @type {number} */ DEPTH_BUFFER_BIT: 256,
      /** @type {number} */ DEPTH_TEST: 2929,
      /** @type {number} */ CULL_FACE: 2884,
      /** @type {number} */ BLEND: 3042,
      /** @type {number} */ SRC_ALPHA: 770,
      /** @type {number} */ ONE_MINUS_SRC_ALPHA: 771,
      /** @type {number} */ TEXTURE_2D: 3553,
      /** @type {number} */ RGBA: 6408,
      /** @type {number} */ UNSIGNED_BYTE: 5121,
      /** @type {number} */ CLAMP_TO_EDGE: 33071,
      /** @type {number} */ LINEAR: 9729,
      /** @type {number} */ NEAREST: 9728,
      /** @type {number} */ LINEAR_MIPMAP_LINEAR: 9987,
      
      // State tracking for WebGL resources
      /** @type {Map<string, any>} */ _parameters: new Map(),
      /** @type {Map<string, {data: any, usage: number}>} */ _buffers: new Map(),
      /** @type {Map<string, {image: any, params: Object}>} */ _textures: new Map(),
      /** @type {Map<string, {type: number, compiled: boolean, source?: string}>} */ _shaders: new Map(),
      /** @type {Map<string, {linked: boolean, attachedShaders: string[]}>} */ _programs: new Map(),
      /** @type {Map<string, {name: string, program: string}>} */ _uniformLocations: new Map(),
      
      // Current state tracking
      /** @type {string|null} */ _currentProgram: null,
      /** @type {{target: number, buffer: string}|null} */ _currentBuffer: null,
      /** @type {{target: number, texture: string}|null} */ _currentTexture: null,
      /** @type {number[]|null} */ _clearColor: null,
      /** @type {number[]|null} */ _viewport: null,
      
      /**
       * Mock WebGL getExtension method with support for common extensions.
       * 
       * @param {string} name - The extension name
       * @returns {Object|null} Mock extension object or null if not supported
       */
      getExtension: jest.fn((name) => {
        logCall(global.__WEBGL_CALLS__, 'getExtension', [name]);
        // Mock common extensions
        const extensions = {
          'OES_texture_float': { FLOAT: 5126 },
          'OES_texture_half_float': { HALF_FLOAT_OES: 36193 },
          'WEBGL_depth_texture': { UNSIGNED_INT_24_8_WEBGL: 34042 },
          'OES_element_index_uint': { UNSIGNED_INT: 5125 },
          'ANGLE_instanced_arrays': {
            VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: 35070,
            drawArraysInstancedANGLE: jest.fn(),
            drawElementsInstancedANGLE: jest.fn(),
            vertexAttribDivisorANGLE: jest.fn(),
          },
        };
        return extensions[name] || null;
      }),
      
      /**
       * Mock WebGL getParameter method for common WebGL parameters.
       * 
       * @param {number} pname - The parameter name
       * @returns {any} The parameter value or null if not supported
       */
      getParameter: jest.fn((pname) => {
        logCall(global.__WEBGL_CALLS__, 'getParameter', [pname]);
        const params = {
          [gl.VERSION]: 'WebGL 2.0',
          [gl.VENDOR]: 'Mock Vendor',
          [gl.RENDERER]: 'Mock Renderer',
          [gl.SHADING_LANGUAGE_VERSION]: 'WebGL GLSL ES 3.00',
          [gl.MAX_TEXTURE_SIZE]: 4096,
          [gl.MAX_VIEWPORT_DIMS]: [4096, 4096],
          [gl.MAX_TEXTURE_IMAGE_UNITS]: 16,
          [gl.MAX_VERTEX_ATTRIBS]: 16,
        };
        return params[pname] || null;
      }),
      
      // Shader lifecycle methods
      /**
       * Mock WebGL createShader method.
       * 
       * @param {number} type - The shader type (VERTEX_SHADER or FRAGMENT_SHADER)
       * @returns {string} Mock shader ID
       */
      createShader: jest.fn((type) => {
        logCall(global.__WEBGL_CALLS__, 'createShader', [type]);
        const shaderId = `shader_${Object.keys(gl._shaders).length}`;
        gl._shaders[shaderId] = { type, compiled: false };
        return shaderId;
      }),
      
      /**
       * Mock WebGL shaderSource method.
       * 
       * @param {string} shader - The shader ID
       * @param {string} source - The GLSL source code
       */
      shaderSource: jest.fn((shader, source) => {
        logCall(global.__WEBGL_CALLS__, 'shaderSource', [shader, source]);
        if (gl._shaders[shader]) {
          gl._shaders[shader].source = source;
        }
      }),
      
      /**
       * Mock WebGL compileShader method.
       * 
       * @param {string} shader - The shader ID
       */
      compileShader: jest.fn((shader) => {
        logCall(global.__WEBGL_CALLS__, 'compileShader', [shader]);
        if (gl._shaders[shader]) {
          gl._shaders[shader].compiled = true;
        }
      }),
      
      /**
       * Mock WebGL getShaderParameter method.
       * 
       * @param {string} shader - The shader ID
       * @param {number} pname - The parameter name (e.g., COMPILE_STATUS)
       * @returns {any} The parameter value
       */
      getShaderParameter: jest.fn((shader, pname) => {
        logCall(global.__WEBGL_CALLS__, 'getShaderParameter', [shader, pname]);
        if (gl._shaders[shader]) {
          return pname === gl.COMPILE_STATUS ? true : null;
        }
        return null;
      }),
      
      /**
       * Mock WebGL getShaderInfoLog method.
       * 
       * @param {string} shader - The shader ID
       * @returns {string} Empty string (no compilation errors in mock)
       */
      getShaderInfoLog: jest.fn((shader) => {
        logCall(global.__WEBGL_CALLS__, 'getShaderInfoLog', [shader]);
        return '';
      }),
      
      // Program lifecycle methods
      /**
       * Mock WebGL createProgram method.
       * 
       * @returns {string} Mock program ID
       */
      createProgram: jest.fn(() => {
        logCall(global.__WEBGL_CALLS__, 'createProgram', []);
        const programId = `program_${Object.keys(gl._programs).length}`;
        gl._programs[programId] = { linked: false, attachedShaders: [] };
        return programId;
      }),
      
      /**
       * Mock WebGL attachShader method.
       * 
       * @param {string} program - The program ID
       * @param {string} shader - The shader ID
       */
      attachShader: jest.fn((program, shader) => {
        logCall(global.__WEBGL_CALLS__, 'attachShader', [program, shader]);
        if (gl._programs[program]) {
          gl._programs[program].attachedShaders.push(shader);
        }
      }),
      
      /**
       * Mock WebGL linkProgram method.
       * 
       * @param {string} program - The program ID
       */
      linkProgram: jest.fn((program) => {
        logCall(global.__WEBGL_CALLS__, 'linkProgram', [program]);
        if (gl._programs[program]) {
          gl._programs[program].linked = true;
        }
      }),
      
      /**
       * Mock WebGL getProgramParameter method.
       * 
       * @param {string} program - The program ID
       * @param {number} pname - The parameter name (e.g., LINK_STATUS)
       * @returns {any} The parameter value
       */
      getProgramParameter: jest.fn((program, pname) => {
        logCall(global.__WEBGL_CALLS__, 'getProgramParameter', [program, pname]);
        if (gl._programs[program]) {
          return pname === gl.LINK_STATUS ? true : null;
        }
        return null;
      }),
      
      /**
       * Mock WebGL getProgramInfoLog method.
       * 
       * @param {string} program - The program ID
       * @returns {string} Empty string (no linking errors in mock)
       */
      getProgramInfoLog: jest.fn((program) => {
        logCall(global.__WEBGL_CALLS__, 'getProgramInfoLog', [program]);
        return '';
      }),
      
      /**
       * Mock WebGL useProgram method.
       * 
       * @param {string} program - The program ID
       */
      useProgram: jest.fn((program) => {
        logCall(global.__WEBGL_CALLS__, 'useProgram', [program]);
        gl._currentProgram = program;
      }),
      
      // Uniform management methods
      /**
       * Mock WebGL getUniformLocation method.
       * 
       * @param {string} program - The program ID
       * @param {string} name - The uniform name
       * @returns {string} Mock uniform location ID
       */
      getUniformLocation: jest.fn((program, name) => {
        logCall(global.__WEBGL_CALLS__, 'getUniformLocation', [program, name]);
        const locationId = `uniform_${program}_${name}`;
        gl._uniformLocations[locationId] = { name, program };
        return locationId;
      }),
      
      /**
       * Mock WebGL uniform1f method.
       * 
       * @param {string} location - The uniform location ID
       * @param {number} x - The uniform value
       */
      uniform1f: jest.fn((location, x) => {
        logCall(global.__WEBGL_CALLS__, 'uniform1f', [location, x]);
      }),
      
      /**
       * Mock WebGL uniform2f method.
       * 
       * @param {string} location - The uniform location ID
       * @param {number} x - The first uniform value
       * @param {number} y - The second uniform value
       */
      uniform2f: jest.fn((location, x, y) => {
        logCall(global.__WEBGL_CALLS__, 'uniform2f', [location, x, y]);
      }),
      
      /**
       * Mock WebGL uniform3f method.
       * 
       * @param {string} location - The uniform location ID
       * @param {number} x - The first uniform value
       * @param {number} y - The second uniform value
       * @param {number} z - The third uniform value
       */
      uniform3f: jest.fn((location, x, y, z) => {
        logCall(global.__WEBGL_CALLS__, 'uniform3f', [location, x, y, z]);
      }),
      
      /**
       * Mock WebGL uniform4f method.
       * 
       * @param {string} location - The uniform location ID
       * @param {number} x - The first uniform value
       * @param {number} y - The second uniform value
       * @param {number} z - The third uniform value
       * @param {number} w - The fourth uniform value
       */
      uniform4f: jest.fn((location, x, y, z, w) => {
        logCall(global.__WEBGL_CALLS__, 'uniform4f', [location, x, y, z, w]);
      }),
      
      /**
       * Mock WebGL uniformMatrix4fv method.
       * 
       * @param {string} location - The uniform location ID
       * @param {boolean} transpose - Whether to transpose the matrix
       * @param {Float32Array} data - The matrix data
       */
      uniformMatrix4fv: jest.fn((location, transpose, data) => {
        logCall(global.__WEBGL_CALLS__, 'uniformMatrix4fv', [location, transpose, data]);
      }),
      
      // Vertex attribute methods
      /**
       * Mock WebGL enableVertexAttribArray method.
       * 
       * @param {number} index - The attribute index
       */
      enableVertexAttribArray: jest.fn((index) => {
        logCall(global.__WEBGL_CALLS__, 'enableVertexAttribArray', [index]);
      }),
      
      /**
       * Mock WebGL disableVertexAttribArray method.
       * 
       * @param {number} index - The attribute index
       */
      disableVertexAttribArray: jest.fn((index) => {
        logCall(global.__WEBGL_CALLS__, 'disableVertexAttribArray', [index]);
      }),
      
      /**
       * Mock WebGL vertexAttribPointer method.
       * 
       * @param {number} index - The attribute index
       * @param {number} size - The number of components per attribute
       * @param {number} type - The data type
       * @param {boolean} normalized - Whether to normalize the data
       * @param {number} stride - The stride in bytes
       * @param {number} offset - The offset in bytes
       */
      vertexAttribPointer: jest.fn((index, size, type, normalized, stride, offset) => {
        logCall(global.__WEBGL_CALLS__, 'vertexAttribPointer', [index, size, type, normalized, stride, offset]);
      }),
      
      // Buffer management methods
      /**
       * Mock WebGL createBuffer method.
       * 
       * @returns {string} Mock buffer ID
       */
      createBuffer: jest.fn(() => {
        logCall(global.__WEBGL_CALLS__, 'createBuffer', []);
        const bufferId = `buffer_${Object.keys(gl._buffers).length}`;
        gl._buffers[bufferId] = { data: null, usage: null };
        return bufferId;
      }),
      
      /**
       * Mock WebGL bindBuffer method.
       * 
       * @param {number} target - The buffer target (ARRAY_BUFFER or ELEMENT_ARRAY_BUFFER)
       * @param {string} buffer - The buffer ID
       */
      bindBuffer: jest.fn((target, buffer) => {
        logCall(global.__WEBGL_CALLS__, 'bindBuffer', [target, buffer]);
        gl._currentBuffer = { target, buffer };
      }),
      
      /**
       * Mock WebGL bufferData method.
       * 
       * @param {number} target - The buffer target
       * @param {any} data - The buffer data
       * @param {number} usage - The usage pattern
       */
      bufferData: jest.fn((target, data, usage) => {
        logCall(global.__WEBGL_CALLS__, 'bufferData', [target, data, usage]);
        if (gl._currentBuffer && gl._buffers[gl._currentBuffer.buffer]) {
          gl._buffers[gl._currentBuffer.buffer].data = data;
          gl._buffers[gl._currentBuffer.buffer].usage = usage;
        }
      }),
      
      // Texture management methods
      /**
       * Mock WebGL createTexture method.
       * 
       * @returns {string} Mock texture ID
       */
      createTexture: jest.fn(() => {
        logCall(global.__WEBGL_CALLS__, 'createTexture', []);
        const textureId = `texture_${Object.keys(gl._textures).length}`;
        gl._textures[textureId] = { image: null, params: {} };
        return textureId;
      }),
      
      /**
       * Mock WebGL bindTexture method.
       * 
       * @param {number} target - The texture target (usually TEXTURE_2D)
       * @param {string} texture - The texture ID
       */
      bindTexture: jest.fn((target, texture) => {
        logCall(global.__WEBGL_CALLS__, 'bindTexture', [target, texture]);
        gl._currentTexture = { target, texture };
      }),
      
      /**
       * Mock WebGL texImage2D method.
       * 
       * @param {...any} args - Texture image parameters
       */
      texImage2D: jest.fn((...args) => {
        logCall(global.__WEBGL_CALLS__, 'texImage2D', args);
        if (gl._currentTexture && gl._textures[gl._currentTexture.texture]) {
          gl._textures[gl._currentTexture.texture].image = args[args.length - 1];
        }
      }),
      
      /**
       * Mock WebGL texParameteri method.
       * 
       * @param {number} target - The texture target
       * @param {number} pname - The parameter name
       * @param {number} param - The parameter value
       */
      texParameteri: jest.fn((target, pname, param) => {
        logCall(global.__WEBGL_CALLS__, 'texParameteri', [target, pname, param]);
        if (gl._currentTexture && gl._textures[gl._currentTexture.texture]) {
          gl._textures[gl._currentTexture.texture].params[pname] = param;
        }
      }),
      
      /**
       * Mock WebGL generateMipmap method.
       * 
       * @param {number} target - The texture target
       */
      generateMipmap: jest.fn((target) => {
        logCall(global.__WEBGL_CALLS__, 'generateMipmap', [target]);
      }),
      
      /**
       * Mock WebGL activeTexture method.
       * 
       * @param {number} texture - The texture unit
       */
      activeTexture: jest.fn((texture) => {
        logCall(global.__WEBGL_CALLS__, 'activeTexture', [texture]);
      }),
      
      // Drawing and rendering methods
      /**
       * Mock WebGL clear method.
       * 
       * @param {number} mask - The clear mask (COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT, etc.)
       */
      clear: jest.fn((mask) => {
        logCall(global.__WEBGL_CALLS__, 'clear', [mask]);
      }),
      
      /**
       * Mock WebGL clearColor method.
       * 
       * @param {number} r - Red component (0-1)
       * @param {number} g - Green component (0-1)
       * @param {number} b - Blue component (0-1)
       * @param {number} a - Alpha component (0-1)
       */
      clearColor: jest.fn((r, g, b, a) => {
        logCall(global.__WEBGL_CALLS__, 'clearColor', [r, g, b, a]);
        gl._clearColor = [r, g, b, a];
      }),
      
      /**
       * Mock WebGL drawArrays method.
       * 
       * @param {number} mode - The drawing mode (TRIANGLES, etc.)
       * @param {number} first - The starting index
       * @param {number} count - The number of indices to draw
       */
      drawArrays: jest.fn((mode, first, count) => {
        logCall(global.__WEBGL_CALLS__, 'drawArrays', [mode, first, count]);
      }),
      
      /**
       * Mock WebGL drawElements method.
       * 
       * @param {number} mode - The drawing mode
       * @param {number} count - The number of indices to draw
       * @param {number} type - The index type
       * @param {number} offset - The starting offset
       */
      drawElements: jest.fn((mode, count, type, offset) => {
        logCall(global.__WEBGL_CALLS__, 'drawElements', [mode, count, type, offset]);
      }),
      
      // State management methods
      /**
       * Mock WebGL enable method.
       * 
       * @param {number} cap - The capability to enable
       */
      enable: jest.fn((cap) => {
        logCall(global.__WEBGL_CALLS__, 'enable', [cap]);
      }),
      
      /**
       * Mock WebGL disable method.
       * 
       * @param {number} cap - The capability to disable
       */
      disable: jest.fn((cap) => {
        logCall(global.__WEBGL_CALLS__, 'disable', [cap]);
      }),
      
      /**
       * Mock WebGL viewport method.
       * 
       * @param {number} x - The x coordinate
       * @param {number} y - The y coordinate
       * @param {number} width - The viewport width
       * @param {number} height - The viewport height
       */
      viewport: jest.fn((x, y, width, height) => {
        logCall(global.__WEBGL_CALLS__, 'viewport', [x, y, width, height]);
        gl._viewport = [x, y, width, height];
      }),
      
      // Canvas element methods (added to WebGL context for convenience)
      /**
       * Mock getBoundingClientRect method.
       * 
       * @returns {DOMRect} Mock bounding rectangle
       */
      getBoundingClientRect: jest.fn(() => ({
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
      })),
      
      /**
       * Mock toDataURL method.
       * 
       * @returns {string} Mock data URL
       */
      toDataURL: jest.fn(() => 'data:image/png;base64,mock'),
      
      /**
       * Mock toBlob method.
       * 
       * @param {Function} callback - The callback function
       */
      toBlob: jest.fn((callback) => {
        callback(new Blob(['mock image data'], { type: 'image/png' }));
      }),
    };
    
    return gl;
  }
  
  return originalGetContext.call(this, type, ...contextArgs);
};

/**
 * Enhanced WebGPU mock with comprehensive API support.
 * This mock provides a complete WebGPU implementation for testing,
 * including adapter/device management, resource creation, and command encoding.
 */
// ---- ENHANCED WebGPU MOCK ----
global.navigator = global.navigator || {};
global.navigator.gpu = {
  /**
   * Mock WebGPU requestAdapter method.
   * 
   * @returns {Promise<GPUAdapter>} Mock adapter promise
   */
  requestAdapter: jest.fn((...args) => {
    logCall(global.__WEBGPU_CALLS__, 'requestAdapter', args);
    return Promise.resolve({
      /**
       * Mock WebGPU requestDevice method.
       * 
       * @returns {Promise<GPUDevice>} Mock device promise
       */
      requestDevice: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'requestDevice', args);
        return Promise.resolve({
      /**
       * Mock WebGPU createBuffer method.
       * 
       * @param {GPUBufferDescriptor} descriptor - Buffer descriptor
       * @returns {GPUBuffer} Mock buffer object
       */
      createBuffer: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'createBuffer', args);
        return {
          mapAsync: jest.fn(),
          unmap: jest.fn(),
          destroy: jest.fn(),
          size: args[0]?.size || 1024,
          usage: args[0]?.usage || 0,
        };
      }),
      /**
       * Mock WebGPU createTexture method.
       * 
       * @param {GPUTextureDescriptor} descriptor - Texture descriptor
       * @returns {GPUTexture} Mock texture object
       */
      createTexture: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'createTexture', args);
        return {
          createView: jest.fn(),
          destroy: jest.fn(),
          width: args[0]?.size?.width || 256,
          height: args[0]?.size?.height || 256,
          format: args[0]?.format || 'rgba8unorm',
        };
      }),
      /**
       * Mock WebGPU createBindGroup method.
       * 
       * @param {GPUBindGroupDescriptor} descriptor - Bind group descriptor
       * @returns {GPUBindGroup} Mock bind group object
       */
      createBindGroup: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'createBindGroup', args);
        return { destroy: jest.fn() };
      }),
      
      /**
       * Mock WebGPU createBindGroupLayout method.
       * 
       * @param {GPUBindGroupLayoutDescriptor} descriptor - Bind group layout descriptor
       * @returns {GPUBindGroupLayout} Mock bind group layout object
       */
      createBindGroupLayout: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'createBindGroupLayout', args);
        return { destroy: jest.fn() };
      }),
      
      /**
       * Mock WebGPU createComputePipeline method.
       * 
       * @param {GPUComputePipelineDescriptor} descriptor - Compute pipeline descriptor
       * @returns {GPUComputePipeline} Mock compute pipeline object
       */
      createComputePipeline: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'createComputePipeline', args);
        return { destroy: jest.fn() };
      }),
      
      /**
       * Mock WebGPU createRenderPipeline method.
       * 
       * @param {GPURenderPipelineDescriptor} descriptor - Render pipeline descriptor
       * @returns {GPURenderPipeline} Mock render pipeline object
       */
      createRenderPipeline: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'createRenderPipeline', args);
        return {
          destroy: jest.fn(),
          getBindGroupLayout: jest.fn(() => ({})),
        };
      }),
      
      /**
       * Mock WebGPU createShaderModule method.
       * 
       * @param {GPUShaderModuleDescriptor} descriptor - Shader module descriptor
       * @returns {GPUShaderModule} Mock shader module object
       */
      createShaderModule: jest.fn((...args) => {
        logCall(global.__WEBGPU_CALLS__, 'createShaderModule', args);
        return { destroy: jest.fn() };
      }),
      /**
       * Mock WebGPU createCommandEncoder method.
       * 
       * @returns {GPUCommandEncoder} Mock command encoder object
       */
      createCommandEncoder: jest.fn(() => {
        logCall(global.__WEBGPU_CALLS__, 'createCommandEncoder', []);
        return {
        /**
         * Mock WebGPU finish method.
         * 
         * @returns {GPUCommandBuffer} Mock command buffer object
         */
        finish: jest.fn(() => {
          logCall(global.__WEBGPU_CALLS__, 'finish', []);
          return {};
        }),
        
        /**
         * Mock WebGPU beginComputePass method.
         * 
         * @returns {GPUComputePassEncoder} Mock compute pass encoder object
         */
        beginComputePass: jest.fn(() => {
          logCall(global.__WEBGPU_CALLS__, 'beginComputePass', []);
          return {
            setPipeline: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'setPipeline', args)),
            setBindGroup: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'setBindGroup', args)),
            dispatchWorkgroups: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'dispatchWorkgroups', args)),
            end: jest.fn(() => logCall(global.__WEBGPU_CALLS__, 'end', [])),
          };
        }),
        
        /**
         * Mock WebGPU beginRenderPass method.
         * 
         * @returns {GPURenderPassEncoder} Mock render pass encoder object
         */
        beginRenderPass: jest.fn(() => {
          logCall(global.__WEBGPU_CALLS__, 'beginRenderPass', []);
          return {
            setPipeline: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'setPipeline', args)),
            setBindGroup: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'setBindGroup', args)),
            setVertexBuffer: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'setVertexBuffer', args)),
            setIndexBuffer: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'setIndexBuffer', args)),
            draw: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'draw', args)),
            drawIndexed: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'drawIndexed', args)),
            end: jest.fn(() => logCall(global.__WEBGPU_CALLS__, 'end', [])),
          };
        }),
        
        /**
         * Mock WebGPU copyBufferToBuffer method.
         * 
         * @param {...any} args - Copy parameters
         */
        copyBufferToBuffer: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'copyBufferToBuffer', args)),
        
        /**
         * Mock WebGPU copyBufferToTexture method.
         * 
         * @param {...any} args - Copy parameters
         */
        copyBufferToTexture: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'copyBufferToTexture', args)),
        
        /**
         * Mock WebGPU copyTextureToBuffer method.
         * 
         * @param {...any} args - Copy parameters
         */
        copyTextureToBuffer: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'copyTextureToBuffer', args)),
        
        /**
         * Mock WebGPU copyTextureToTexture method.
         * 
         * @param {...any} args - Copy parameters
         */
        copyTextureToTexture: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'copyTextureToTexture', args)),
        };
      }),
      
      /**
       * Mock WebGPU queue object.
       * 
       * @type {GPUQueue}
       */
      queue: {
        /**
         * Mock WebGPU submit method.
         * 
         * @param {GPUCommandBuffer[]} commandBuffers - Command buffers to submit
         */
        submit: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'submit', args)),
        
        /**
         * Mock WebGPU writeBuffer method.
         * 
         * @param {GPUBuffer} buffer - The buffer to write to
         * @param {number} bufferOffset - The buffer offset
         * @param {ArrayBufferView|ArrayBuffer} data - The data to write
         * @param {number} [dataOffset] - The data offset
         * @param {number} [size] - The size to write
         */
        writeBuffer: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'writeBuffer', args)),

        /**
         * Mock WebGPU writeTexture method.
         *
         * @param {...any} args - Texture write arguments
         */
        writeTexture: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'writeTexture', args)),

        /**
         * Mock WebGPU copyExternalImageToTexture method.
         *
         * @param {...any} args - Copy arguments
         */
        copyExternalImageToTexture: jest.fn((...args) =>
          logCall(global.__WEBGPU_CALLS__, 'copyExternalImageToTexture', args)),

        /**
         * Mock WebGPU onSubmittedWorkDone method.
         * 
         * @returns {Promise<void>} Promise that resolves when work is done
         */
        onSubmittedWorkDone: jest.fn().mockResolvedValue(),
      },
      /**
       * Mock WebGPU createSampler method.
       * 
       * @param {GPUSamplerDescriptor} descriptor - Sampler descriptor
       * @returns {GPUSampler} Mock sampler object
       */
      createSampler: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'createSampler', args)),
      
      /**
       * Mock WebGPU createPipelineLayout method.
       * 
       * @param {GPUPipelineLayoutDescriptor} descriptor - Pipeline layout descriptor
       * @returns {GPUPipelineLayout} Mock pipeline layout object
       */
      createPipelineLayout: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'createPipelineLayout', args)),
      
      /**
       * Mock WebGPU createQuerySet method.
       * 
       * @param {GPUQuerySetDescriptor} descriptor - Query set descriptor
       * @returns {GPUQuerySet} Mock query set object
       */
      createQuerySet: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'createQuerySet', args)),
      
      /**
       * Mock WebGPU importExternalTexture method.
       * 
       * @param {GPUExternalTextureDescriptor} descriptor - External texture descriptor
       * @returns {GPUExternalTexture} Mock external texture object
       */
      importExternalTexture: jest.fn((...args) => logCall(global.__WEBGPU_CALLS__, 'importExternalTexture', args)),
      
      /**
       * Mock WebGPU destroy method.
       */
      destroy: jest.fn(() => logCall(global.__WEBGPU_CALLS__, 'destroy', [])),
      
      /**
       * Mock WebGPU lost promise.
       * 
       * @type {Promise<{reason: string}>}
       */
      lost: Promise.resolve({ reason: 'destroyed' }),
        });
      }),
    });
  }),
  
  /**
   * Mock WebGPU getPreferredCanvasFormat method.
   * 
   * @returns {GPUTextureFormat} The preferred canvas format
   */
  getPreferredCanvasFormat: jest.fn(() => 'bgra8unorm'),
};

/**
 * Helper functions for testing canvas operations.
 * These functions provide convenient ways to assert that specific canvas calls were made
 * during test execution.
 */
// ---- HELPER FUNCTIONS FOR TESTING ----

/**
 * Helper function to check if a specific WebGL call was made.
 * Throws an error if the call was not found.
 * 
 * @global
 * @function expectWebGLCall
 * @param {string} callName - The name of the WebGL method call to check
 * @param {Array<any>|null} [args=null] - Optional expected arguments to match
 * @returns {Object} The call object if found
 * @throws {Error} If the call was not made or arguments don't match
 * 
 * @example
 * expectWebGLCall('drawArrays', [gl.TRIANGLES, 0, 3]);
 * expectWebGLCall('clearColor');
 */
// Helper to check if a WebGL call was made
global.expectWebGLCall = (callName, args = null) => {
  const call = global.__WEBGL_CALLS__.find(c => c.name === callName);
  if (!call) {
    throw new Error(`WebGL call '${callName}' was not made`);
  }
  if (args) {
    expect(call.args).toEqual(args);
  }
  return call;
};

/**
 * Helper function to check if a specific WebGPU call was made.
 * Throws an error if the call was not found.
 * 
 * @global
 * @function expectWebGPUCall
 * @param {string} callName - The name of the WebGPU method call to check
 * @param {Array<any>|null} [args=null] - Optional expected arguments to match
 * @returns {Object} The call object if found
 * @throws {Error} If the call was not made or arguments don't match
 * 
 * @example
 * expectWebGPUCall('createBuffer', [{size: 1024, usage: GPUBufferUsage.VERTEX}]);
 * expectWebGPUCall('writeBuffer');
 */
// Helper to check if a WebGPU call was made
global.expectWebGPUCall = (callName, args = null) => {
  const call = global.__WEBGPU_CALLS__.find(c => c.name === callName);
  if (!call) {
    throw new Error(`WebGPU call '${callName}' was not made`);
  }
  if (args) {
    expect(call.args).toEqual(args);
  }
  return call;
};

/**
 * Helper function to check if a specific canvas context type was requested.
 * Throws an error if the context was not requested.
 * 
 * @global
 * @function expectCanvasContext
 * @param {string} contextType - The context type to check ('2d', 'webgl', 'webgl2')
 * @returns {Object} The context call object if found
 * @throws {Error} If the context was not requested
 * 
 * @example
 * expectCanvasContext('webgl2');
 * expectCanvasContext('2d');
 */
// Helper to check if canvas context was requested
global.expectCanvasContext = (contextType) => {
  const call = global.__CANVAS_CALLS__.find(c => c.name === 'getContext' && c.args[0] === contextType);
  if (!call) {
    throw new Error(`Canvas context '${contextType}' was not requested`);
  }
  return call;
};

global.expectCanvasCall = (callName, args = null) => {
  const call = global.__CANVAS_CALLS__.find(c => c.name === callName);
  if (!call) {
    throw new Error(`Canvas call '${callName}' was not made`);
  }
  if (args) {
    expect(call.args).toEqual(args);
  }
  return call;
};

/**
 * Helper function to count how many times a specific WebGL method was called.
 * 
 * @global
 * @function countWebGLCalls
 * @param {string} callName - The name of the WebGL method to count
 * @returns {number} The number of times the method was called
 * 
 * @example
 * expect(countWebGLCalls('drawArrays')).toBe(3);
 */
// Helper to count calls
global.countWebGLCalls = (callName) => {
  return global.__WEBGL_CALLS__.filter(c => c.name === callName).length;
};

/**
 * Helper function to count how many times a specific WebGPU method was called.
 * 
 * @global
 * @function countWebGPUCalls
 * @param {string} callName - The name of the WebGPU method to count
 * @returns {number} The number of times the method was called
 * 
 * @example
 * expect(countWebGPUCalls('createBuffer')).toBe(2);
 */
global.countWebGPUCalls = (callName) => {
  return global.__WEBGPU_CALLS__.filter(c => c.name === callName).length;
};

global.countCanvasCalls = (callName) => {
  return global.__CANVAS_CALLS__.filter(c => c.name === callName).length;
};

/**
 * Helper function to get all calls to a specific WebGL method.
 * 
 * @global
 * @function getWebGLCalls
 * @param {string} callName - The name of the WebGL method to retrieve
 * @returns {Array<Object>} Array of call objects with name and args
 * 
 * @example
 * const drawCalls = getWebGLCalls('drawArrays');
 * expect(drawCalls).toHaveLength(3);
 */
// Helper to get all calls of a certain type
global.getWebGLCalls = (callName) => {
  return global.__WEBGL_CALLS__.filter(c => c.name === callName);
};

/**
 * Helper function to get all calls to a specific WebGPU method.
 * 
 * @global
 * @function getWebGPUCalls
 * @param {string} callName - The name of the WebGPU method to retrieve
 * @returns {Array<Object>} Array of call objects with name and args
 * 
 * @example
 * const bufferCalls = getWebGPUCalls('createBuffer');
 * expect(bufferCalls).toHaveLength(2);
 */
global.getWebGPUCalls = (callName) => {
  return global.__WEBGPU_CALLS__.filter(c => c.name === callName);
};

global.getCanvasCalls = (callName) => {
  return global.__CANVAS_CALLS__.filter(c => c.name === callName);
};

/**
 * Jest beforeEach hook for test isolation.
 * Clears canvas call logs and resets Jest mocks before each test.
 * Includes a workaround for tests that need to track calls across test setup.
 * 
 * Set global.__DISABLE_CALL_CLEARING__ to true in tests that need to preserve call logs
 * across the beforeEach hook (e.g., for WebGPU tests with async operations).
 */
// ---- RESET FUNCTION FOR TEST ISOLATION ----
beforeEach(() => {
  // Only clear calls if we're not in a WebGPU test that needs to track calls
  // This is a workaround for tests that need to track calls across the test setup
  if (global.clearCanvasCalls && !global.__DISABLE_CALL_CLEARING__) {
    global.clearCanvasCalls();
  }
  
  // Reset jest mocks
  jest.clearAllMocks();
});

/**
 * Mock WebGPU constants for testing.
 * These constants match the official WebGPU specification values
 * and can be used in tests to configure buffer and texture usage.
 */
// ---- MOCK GPU CONSTANTS ----

/**
 * WebGPU buffer usage flags.
 * These flags determine how a buffer can be used in the pipeline.
 * 
 * @global
 * @type {Object}
 * @property {number} INDEX - Buffer can be used as an index buffer
 * @property {number} VERTEX - Buffer can be used as a vertex buffer
 * @property {number} UNIFORM - Buffer can be used as a uniform buffer
 * @property {number} STORAGE - Buffer can be used as a storage buffer
 * @property {number} INDIRECT - Buffer can be used for indirect drawing
 * @property {number} QUERY_RESOLVE - Buffer can be used for query results
 * @property {number} COPY_SRC - Buffer can be used as a copy source
 * @property {number} COPY_DST - Buffer can be used as a copy destination
 */
global.GPUBufferUsage = {
  INDEX: 0x00000001,
  VERTEX: 0x00000002,
  UNIFORM: 0x00000004,
  STORAGE: 0x00000008,
  INDIRECT: 0x00000010,
  QUERY_RESOLVE: 0x00000020,
  COPY_SRC: 0x00000001,
  COPY_DST: 0x00000002,
};

/**
 * WebGPU texture usage flags.
 * These flags determine how a texture can be used in the pipeline.
 * 
 * @global
 * @type {Object}
 * @property {number} COPY_SRC - Texture can be used as a copy source
 * @property {number} COPY_DST - Texture can be used as a copy destination
 * @property {number} TEXTURE_BINDING - Texture can be bound for sampling
 * @property {number} STORAGE_BINDING - Texture can be bound for storage operations
 * @property {number} RENDER_ATTACHMENT - Texture can be used as a render target
 */
global.GPUTextureUsage = {
  COPY_SRC: 0x00000001,
  COPY_DST: 0x00000002,
  TEXTURE_BINDING: 0x00000004,
  STORAGE_BINDING: 0x00000008,
  RENDER_ATTACHMENT: 0x00000010,
};
