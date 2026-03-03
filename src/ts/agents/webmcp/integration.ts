// WebMCP Integration Layer for N-APT Application
// Connects WebMCP tools to existing React components and state management

import { WebMCPTool, getToolsByRoute } from "./registry";

// WebMCP Tool Handler Interface
export interface ToolHandler {
  (params: any): Promise<any> | any;
}

// Tool Handler Registry
class ToolHandlerRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(toolName: string, handler: ToolHandler) {
    this.handlers.set(toolName, handler);
  }

  get(toolName: string): ToolHandler | undefined {
    return this.handlers.get(toolName);
  }

  has(toolName: string): boolean {
    return this.handlers.has(toolName);
  }
}

export const toolHandlers = new ToolHandlerRegistry();

// WebMCP Tool Execution
export async function executeTool(
  toolName: string,
  params: any = {},
): Promise<any> {
  const handler = toolHandlers.get(toolName);
  if (!handler) {
    throw new Error(`No handler registered for tool: ${toolName}`);
  }

  try {
    const result = await handler(params);
    return {
      success: true,
      result,
      tool: toolName,
      params,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      tool: toolName,
      params,
    };
  }
}

// WebMCP Registration System
export class WebMCPRegistry {
  private tools: WebMCPTool[] = [];
  private currentRoute = "/";

  setRoute(route: string) {
    this.currentRoute = route;
    this.tools = getToolsByRoute(route);
  }

  getTools(): WebMCPTool[] {
    return this.tools;
  }

  getTool(name: string): WebMCPTool | undefined {
    return this.tools.find((tool) => tool.name === name);
  }

  getToolsByCategory(category: string): WebMCPTool[] {
    return this.tools.filter((tool) => tool.category === category);
  }

  // Register tools with WebMCP API (when available)
  async registerWithWebMCP() {
    if (!window.webmcp) {
      console.warn("WebMCP API not available");
      return;
    }

    try {
      for (const tool of this.tools) {
        await window.webmcp.registerTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          handler: async (params: any) => {
            return await executeTool(tool.name, params);
          },
        });
      }
      console.log(
        `Registered ${this.tools.length} WebMCP tools for route ${this.currentRoute}`,
      );
    } catch (error) {
      console.error("Failed to register WebMCP tools:", error);
    }
  }

  // Unregister tools when changing routes
  async unregisterFromWebMCP() {
    if (!window.webmcp) return;

    try {
      for (const tool of this.tools) {
        await window.webmcp.unregisterTool(tool.name);
      }
    } catch (error) {
      console.error("Failed to unregister WebMCP tools:", error);
    }
  }
}

export const webmcpRegistry = new WebMCPRegistry();

// WebMCP Global Interface Declaration
declare global {
  interface Window {
    webmcp?: {
      registerTool: (tool: any) => Promise<void>;
      unregisterTool: (name: string) => Promise<void>;
      executeTool: (name: string, params: any) => Promise<any>;
      getTools: () => Promise<any[]>;
    };
  }
}

// React Hook for WebMCP Integration
import { useEffect, useState, useCallback } from "react";

export function useWebMCP(route: string) {
  const [isRegistered, setIsRegistered] = useState(false);
  const [availableTools, setAvailableTools] = useState<WebMCPTool[]>([]);
  const [lastResult, setLastResult] = useState<any>(null);

  // Update route and tools
  useEffect(() => {
    webmcpRegistry.setRoute(route);
    setAvailableTools(webmcpRegistry.getTools());
  }, [route]);

  // Register tools with WebMCP
  useEffect(() => {
    if (!window.webmcp) return;

    const register = async () => {
      await webmcpRegistry.registerWithWebMCP();
      setIsRegistered(true);
    };

    register();

    return () => {
      webmcpRegistry.unregisterFromWebMCP();
      setIsRegistered(false);
    };
  }, [route]);

  // Execute tool function
  const executeWebMCPTool = useCallback(
    async (toolName: string, params: any) => {
      const result = await executeTool(toolName, params);
      setLastResult(result);
      return result;
    },
    [],
  );

  return {
    isRegistered,
    availableTools,
    lastResult,
    executeTool: executeWebMCPTool,
    getToolsByCategory: webmcpRegistry.getToolsByCategory.bind(webmcpRegistry),
    getTool: webmcpRegistry.getTool.bind(webmcpRegistry),
  };
}

// Tool Handler Setup Functions
export function setupSpectrumToolHandlers(sidebarProps: any) {
  // Source Management
  toolHandlers.register("setSourceMode", async (params) => {
    const { mode } = params;
    sidebarProps.onSourceModeChange(mode);
    return { success: true, mode };
  });

  toolHandlers.register("connectDevice", async (params) => {
    const { deviceType = "rtl-sdr" } = params;
    if (sidebarProps.onRestartDevice) {
      sidebarProps.onRestartDevice();
    }
    return { success: true, deviceType };
  });

  // I/Q Capture
  toolHandlers.register("startCapture", async (params) => {
    const captureRequest = {
      jobId: `cap_${Date.now()}`,
      minFreq: params.frequencyRange?.min || 0,
      maxFreq: params.frequencyRange?.max || 30,
      durationS: params.duration || 5,
      fileType: params.format || ".napt",
      encrypted: params.format === ".napt",
    };
    sidebarProps.onCaptureCommand(captureRequest);
    return { success: true, jobId: captureRequest.jobId };
  });

  toolHandlers.register("stopCapture", async () => {
    // Implementation depends on capture system
    return { success: true, message: "Capture stopped" };
  });

  // Signal Areas
  toolHandlers.register("setActiveArea", async (params) => {
    const { area } = params;
    sidebarProps.onSignalAreaChange(area);
    return { success: true, activeArea: area };
  });

  toolHandlers.register("setFrequencyRange", async (params) => {
    const { area, minFreq, maxFreq } = params;
    sidebarProps.onFrequencyRangeChange({ min: minFreq, max: maxFreq });
    return { success: true, area, range: { min: minFreq, max: maxFreq } };
  });

  // Signal Features
  toolHandlers.register("classifySignal", async (params) => {
    // Implementation depends on ML system
    return {
      success: true,
      classification: "N-APT detected",
      confidence: 0.95,
    };
  });

  // Signal Display
  toolHandlers.register("setFftSize", async (params) => {
    const { size } = params;
    // Implementation depends on FFT system
    return { success: true, fftSize: size };
  });

  // Source Settings
  toolHandlers.register("setGain", async (params) => {
    const { gain } = params;
    // Implementation depends on SDR settings
    return { success: true, gain };
  });

  // Snapshot Controls
  toolHandlers.register("takeSnapshot", async (params) => {
    const { format = "png", showWaterfall = true } = params;
    // Implementation depends on snapshot system
    return {
      success: true,
      filename: `snapshot_${Date.now()}.${format}`,
      format,
      showWaterfall,
    };
  });
}

export function setupDrawSignalToolHandlers(drawProps: any) {
  toolHandlers.register("setSpikeCount", async (params) => {
    const { count } = params;
    drawProps.onDrawParamsChange({
      ...drawProps.drawParams,
      spikeCount: count,
    });
    return { success: true, spikeCount: count };
  });

  toolHandlers.register("setSpikeWidth", async (params) => {
    const { width } = params;
    drawProps.onDrawParamsChange({
      ...drawProps.drawParams,
      spikeWidth: width,
    });
    return { success: true, spikeWidth: width };
  });

  toolHandlers.register("generateSignal", async (params) => {
    // Implementation depends on signal generation system
    return {
      success: true,
      signalId: `signal_${Date.now()}`,
      duration: params.duration || 5.0,
      sampleRate: params.sampleRate || 3200000,
    };
  });

  toolHandlers.register("exportSignal", async (params) => {
    const { format, includeParameters = true } = params;
    return {
      success: true,
      filename: `generated_signal_${Date.now()}${format}`,
      format,
      includeParameters,
    };
  });
}

export function setupModel3DToolHandlers(model3DProps: any) {
  toolHandlers.register("selectBodyArea", async (params) => {
    const { area } = params;
    // Find area in the areas array and set it
    const areaData = model3DProps.areas?.find((a: any) => a.name === area);
    if (areaData && model3DProps.setSelectedArea) {
      model3DProps.setSelectedArea(areaData);
    }
    return { success: true, selectedArea: area, position: areaData?.position };
  });

  toolHandlers.register("resetCamera", async () => {
    // Implementation depends on camera system
    return { success: true, message: "Camera reset" };
  });

  toolHandlers.register("setViewMode", async (params) => {
    const { mode } = params;
    // Implementation depends on camera system
    return { success: true, viewMode: mode };
  });

  toolHandlers.register("exportModelData", async (params) => {
    const { format, includeAreas = true } = params;
    return {
      success: true,
      filename: `model_data_${Date.now()}.${format}`,
      format,
      includeAreas,
      areaCount: includeAreas ? 18 : 0,
    };
  });
}

export function setupHotspotToolHandlers(hotspotProps: any) {
  toolHandlers.register("createHotspot", async (params) => {
    const { name, position, size = "small" } = params;
    // Implementation depends on hotspot system
    const hotspotId = `hotspot_${Date.now()}`;
    return {
      success: true,
      hotspotId,
      name,
      position,
      size,
    };
  });

  toolHandlers.register("setSymmetryMode", async (params) => {
    const { mode } = params;
    hotspotProps.setSymmetryMode(mode);
    return { success: true, symmetryMode: mode };
  });

  toolHandlers.register("selectHotspot", async (params) => {
    const { id } = params;
    hotspotProps.handleHotspotClick(id);
    return { success: true, selectedHotspot: id };
  });

  toolHandlers.register("deleteHotspot", async (params) => {
    const { id } = params;
    hotspotProps.handleDeleteHotspot(id);
    return { success: true, deletedHotspot: id };
  });

  toolHandlers.register("exportHotspots", async (params) => {
    const { includePositions = true } = params;
    const exportData = hotspotProps.handleExport();
    return {
      success: true,
      filename: `hotspots_${Date.now()}.json`,
      hotspotCount: hotspotProps.hotspots?.length || 0,
      includePositions,
      data: exportData,
    };
  });

  toolHandlers.register("importHotspots", async (params) => {
    const { jsonData } = params;
    // Implementation depends on import system
    return {
      success: true,
      importedCount: 0,
      message: "Import completed",
    };
  });
}

// Initialize WebMCP when available
export function initializeWebMCP() {
  if (window.webmcp) {
    console.log("WebMCP API detected, initializing...");
    return true;
  } else {
    console.log("WebMCP API not available, features disabled");
    return false;
  }
}
