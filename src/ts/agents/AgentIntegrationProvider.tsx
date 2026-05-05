import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useWebMCP, initializeWebMCP } from "@n-apt/webmcp/integration";
import {
  setupSpectrumToolHandlers,
  setupModel3DToolHandlers,
  setupHotspotToolHandlers,
  setupMapEndpointsToolHandlers,
} from "./webmcp/integration";
import { useMapLocations } from "@n-apt/hooks/useMapLocations";
import { useModel3D } from "@n-apt/hooks/useModel3D";
import { useHotspotEditor } from "@n-apt/hooks/useHotspotEditor";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { useAppDispatch } from "@n-apt/redux";
import {
  setSourceMode
} from "@n-apt/redux";
import {
  sendRestartDevice,
  sendCaptureCommand,
} from "@n-apt/redux/thunks/websocketThunks";

interface AgentIntegrationProviderProps {
  children: React.ReactNode;
}

export const AgentIntegrationProvider: React.FC<
  AgentIntegrationProviderProps
> = ({
  children,
}) => {
    const location = useLocation();
    const dispatch = useAppDispatch();
    const mapLocations = useMapLocations();
    const model3D = useModel3D();
    const hotspotEditor = useHotspotEditor();
    const spectrumStore = useSpectrumStore();

    const [agentStatus, setAgentStatus] = useState<
      "detecting" | "enabled" | "disabled"
    >("detecting");

    // Initialize WebMCP and set up tool handlers based on current route
    useEffect(() => {
      const initialize = async () => {
        const webmcpAvailable = initializeWebMCP();
        setAgentStatus(webmcpAvailable ? "enabled" : "disabled");

        if (!webmcpAvailable) return;

        const currentPath = location.pathname;

        // Prepare spectrum props from store and hooks
        const spectrumProps = {
          onSourceModeChange: (mode: any) => {
            dispatch(setSourceMode(mode));
            spectrumStore.dispatch({ type: "SET_SOURCE_MODE", mode });
          },
          onRestartDevice: () => dispatch(sendRestartDevice()),
          onCaptureCommand: (req: any) => dispatch(sendCaptureCommand(req)),
          onSignalAreaChange: (area: any) => {
            spectrumStore.dispatch({ type: "SET_SIGNAL_AREA", area });
          },
          onFrequencyRangeChange: (range: any) => {
            spectrumStore.dispatch({ type: "SET_FREQUENCY_RANGE", range });
          }
        };

        switch (currentPath) {
          case "/":
          case "/visualizer":
            setupSpectrumToolHandlers(spectrumProps);
            break;

          case "/demodulate":
            setupSpectrumToolHandlers(spectrumProps);
            break;

          case "/draw-signal":
            // Draw signal props might need more work if it has its own store
            break;

          case "/3d-model":
            setupModel3DToolHandlers(model3D);
            setupHotspotToolHandlers(hotspotEditor);
            break;

          case "/map-endpoints":
            setupMapEndpointsToolHandlers(mapLocations);
            break;
        }
      };

      initialize();
    }, [
      location.pathname,
      dispatch,
      mapLocations,
      model3D,
      hotspotEditor,
      spectrumStore,
    ]);

    // Get WebMCP tools for current route
    const { isRegistered, availableTools, lastResult } = useWebMCP();

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
            availableTools.map((t: { name: string }) => t.name),
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
  Component: React.ComponentType<T>
) {
  return function AgentWrappedComponent(props: T) {
    return (
      <AgentIntegrationProvider>
        <Component {...props} />
      </AgentIntegrationProvider>
    );
  };
}

// Export for use in main application
export default AgentIntegrationProvider;
