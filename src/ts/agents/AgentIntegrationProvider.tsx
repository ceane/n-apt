import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useWebMCP, initializeWebMCP } from "./webmcp/integration";
import {
  setupSpectrumToolHandlers,
  setupDrawSignalToolHandlers,
  setupModel3DToolHandlers,
  setupHotspotToolHandlers,
} from "./webmcp/integration";

interface AgentIntegrationProviderProps {
  children: React.ReactNode;
  // Spectrum route props
  spectrumProps?: any;
  // Draw signal props
  drawSignalProps?: any;
  // 3D model props
  model3DProps?: any;
  // Hotspot editor props
  hotspotProps?: any;
}

export const AgentIntegrationProvider: React.FC<
  AgentIntegrationProviderProps
> = ({
  children,
  spectrumProps,
  drawSignalProps,
  model3DProps,
  hotspotProps,
}) => {
    const location = useLocation();
    const [isWebMCPEnabled, setIsWebMCPEnabled] = useState(false);
    const [agentStatus, setAgentStatus] = useState<
      "detecting" | "enabled" | "disabled"
    >("detecting");

    // Initialize WebMCP and set up tool handlers based on current route
    useEffect(() => {
      const initialize = async () => {
        // Check if WebMCP is available
        const webmcpAvailable = initializeWebMCP();
        setIsWebMCPEnabled(webmcpAvailable);
        setAgentStatus(webmcpAvailable ? "enabled" : "disabled");

        if (!webmcpAvailable) return;

        // Set up tool handlers based on current route
        const currentPath = location.pathname;

        switch (currentPath) {
          case "/":
          case "/visualizer":
            if (spectrumProps) {
              setupSpectrumToolHandlers(spectrumProps);
            }
            break;

          case "/demodulate":
            if (spectrumProps) {
              setupSpectrumToolHandlers(spectrumProps);
            }
            // Add analysis-specific handlers here when implemented
            break;

          case "/draw-signal":
            if (drawSignalProps) {
              setupDrawSignalToolHandlers(drawSignalProps);
            }
            break;

          case "/3d-model":
            if (model3DProps) {
              setupModel3DToolHandlers(model3DProps);
            }
            break;

          case "/hotspot-editor":
            if (hotspotProps) {
              setupHotspotToolHandlers(hotspotProps);
            }
            break;
        }
      };

      initialize();
    }, [
      location.pathname,
      spectrumProps,
      drawSignalProps,
      model3DProps,
      hotspotProps,
    ]);

    // Get WebMCP tools for current route
    const { isRegistered, availableTools, lastResult } = useWebMCP(
      location.pathname,
    );

    // Debug information for development
    useEffect(() => {
      if (process.env.NODE_ENV === "development") {
        console.log(`🤖 Agent Integration Status: ${agentStatus}`);
        console.log(`📍 Current Route: ${location.pathname}`);
        console.log(`🛠️ Available Tools: ${availableTools.length}`);
        console.log(`📋 Registered: ${isRegistered}`);

        if (availableTools.length > 0) {
          console.log(
            "🔧 Available WebMCP Tools:",
            availableTools.map((t) => t.name),
          );
        }
      }
    }, [agentStatus, location.pathname, availableTools.length, isRegistered]);

    // Render children with agent context
    return (
      <>
        {children}

        {/* Development overlay for agent status */}
        {process.env.NODE_ENV === "development" && (
          <div
            style={{
              position: "fixed",
              top: "10px",
              right: "10px",
              background: "rgba(0, 0, 0, 0.8)",
              color: "#00d4ff",
              padding: "8px 12px",
              borderRadius: "6px",
              fontSize: "11px",
              fontFamily: "JetBrains Mono, monospace",
              zIndex: 10000,
              opacity: agentStatus === "enabled" ? 0.8 : 0.4,
              transition: "opacity 0.3s ease",
            }}
          >
            <div>🤖 Agents: {agentStatus}</div>
            <div>📍 Route: {location.pathname}</div>
            <div>🛠️ Tools: {availableTools.length}</div>
            {lastResult && (
              <div style={{ marginTop: "4px", fontSize: "10px", color: "#ccc" }}>
                Last: {lastResult.success ? "✅" : "❌"} {lastResult.tool}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

// Hook for components to access agent integration status
export function useAgentIntegration() {
  const [isAgentDetected, setIsAgentDetected] = useState(false);
  const [agentType, setAgentType] = useState<string | null>(null);

  useEffect(() => {
    // Detect if current user is an AI agent
    const userAgent = navigator.userAgent.toLowerCase();
    const acceptHeader = ""; // Would need to get from request headers

    const agentPatterns = [
      "claude-",
      "gpt-",
      "openai",
      "anthropic",
      "copilot",
      "gemini",
      "bard",
      "perplexity",
      "cursor",
      "aider",
      "codeium",
    ];

    const detectedAgent = agentPatterns.find((pattern) =>
      userAgent.includes(pattern),
    );
    setIsAgentDetected(!!detectedAgent);
    setAgentType(detectedAgent || null);
  }, []);

  return {
    isAgentDetected,
    agentType,
    isWebMCPEnabled: window.webmcp !== undefined,
  };
}

// Higher-order component to add agent integration to existing components
export function withAgentIntegration<T extends object>(
  Component: React.ComponentType<T>,
  getProps: (props: T) => {
    spectrumProps?: any;
    drawSignalProps?: any;
    model3DProps?: any;
    hotspotProps?: any;
  },
) {
  return function AgentWrappedComponent(props: T) {
    const integrationProps = getProps(props);

    return (
      <AgentIntegrationProvider {...integrationProps}>
        <Component {...props} />
      </AgentIntegrationProvider>
    );
  };
}

// Export for use in main application
export default AgentIntegrationProvider;
