# Markdown for Agents & WebMCP Integration

This implementation adds AI agent accessibility to the N-APT application through two complementary features:

## Features

### 📝 Markdown for Agents

- **Content Negotiation**: AI agents can request `Accept: text/markdown` to receive structured documentation
- **Token Optimization**: ~80% reduction in token usage compared to HTML
- **Route-Specific Documentation**: Each route has detailed markdown describing its capabilities
- **Agent Detection**: Automatic detection of AI agents via user-agent patterns
- **Structured Metadata**: Includes token counts and content-signal headers

### 🛠️ WebMCP Tools

- **Structured Interactions**: All sidebar controls exposed as WebMCP tools
- **Route-Specific Tools**: Different tools available based on current route
- **Parameter Validation**: Type-safe parameter handling
- **Real-time Updates**: Tools integrate with existing React state management
- **Error Handling**: Comprehensive error reporting and validation

## File Structure

```
src/agents/
├── markdown/
│   ├── middleware.ts          # Content negotiation middleware
│   └── routes/
│       ├── visualizer.md       # Spectrum visualizer documentation
│       ├── analysis.md         # ML analysis documentation
│       ├── draw-signal.md      # Signal generation documentation
│       ├── 3d-model.md         # 3D model documentation
│       └── hotspot-editor.md   # Hotspot editor documentation
├── webmcp/
│   ├── registry.ts             # WebMCP tool definitions
│   └── integration.ts          # Tool handlers and React integration
├── AgentIntegrationProvider.tsx # Main React component
└── README.md                   # This file
```

## Usage

### For AI Agents

#### Markdown Content Negotiation

AI agents can request markdown documentation by including the appropriate headers:

```bash
curl -H "Accept: text/markdown" \
     -H "User-Agent: Claude-Code/1.0" \
     http://localhost:5173/
```

Response headers include:

- `Content-Type: text/markdown`
- `x-markdown-tokens: 725` (estimated token count)
- `content-signal: ai-train=yes, search=yes, ai-input=yes`

#### WebMCP Tool Execution

When WebMCP is available (Chrome Canary 146+ with experimental features), agents can execute tools:

```javascript
// List available tools
const tools = await window.webmcp.getTools();

// Execute a tool
const result = await window.webmcp.executeTool("setSourceMode", {
  mode: "live",
});
```

### For Developers

#### Adding to Existing Routes

1. **Wrap your route component** with the AgentIntegrationProvider:

```tsx
import { AgentIntegrationProvider } from "@n-apt/agents";

// In your route component
export const SpectrumRoute: React.FC<SpectrumRouteProps> = (props) => {
  return (
    <AgentIntegrationProvider spectrumProps={props}>
      {/* Your existing component content */}
    </AgentIntegrationProvider>
  );
};
```

2. **Add markdown documentation** for new routes in `src/agents/markdown/routes/`

3. **Define WebMCP tools** in `src/agents/webmcp/registry.ts`

4. **Implement tool handlers** in `src/agents/webmcp/integration.ts`

#### Adding New WebMCP Tools

1. **Define the tool** in the appropriate tool array in `registry.ts`:

```typescript
export const spectrumTools: WebMCPTool[] = [
  {
    name: "myNewTool",
    description: "Description of what the tool does",
    parameters: [
      {
        name: "param1",
        type: "string",
        description: "Parameter description",
        required: true,
      },
    ],
    returns: { type: "boolean", description: "Success status" },
    category: "My Category",
    route: "/",
  },
];
```

2. **Implement the handler** in `integration.ts`:

```typescript
export function setupSpectrumToolHandlers(sidebarProps: any) {
  toolHandlers.register("myNewTool", async (params) => {
    const { param1 } = params;
    // Your implementation here
    return { success: true, result: "Tool executed" };
  });
}
```

## Available Tools by Route

### Spectrum Visualizer (`/`, `/visualizer`)

- **Source Management**: `setSourceMode`, `connectDevice`
- **I/Q Capture**: `startCapture`, `stopCapture`
- **Signal Areas**: `setActiveArea`, `setFrequencyRange`
- **Signal Features**: `classifySignal`
- **Signal Display**: `setFftSize`
- **Source Settings**: `setGain`
- **Snapshot Controls**: `takeSnapshot`

### Analysis (`/analysis`)

- All Spectrum Visualizer tools
- **ML Analysis**: `startAnalysis`, `getAnalysisResults`, `exportAnalysisResults`

### Draw Signal (`/draw-signal`)

- **Signal Generation**: `setSpikeCount`, `setSpikeWidth`, `generateSignal`, `exportSignal`

### 3D Model (`/3d-model`)

- **Body Areas**: `selectBodyArea`
- **Camera Controls**: `resetCamera`, `setViewMode`
- **Data Export**: `exportModelData`

### Hotspot Editor (`/hotspot-editor`)

- **Hotspot Creation**: `createHotspot`
- **Creation Settings**: `setSymmetryMode`
- **Hotspot Management**: `selectHotspot`, `deleteHotspot`
- **Data Management**: `exportHotspots`, `importHotspots`

## Testing

Use the provided test file to verify functionality:

```bash
# Open the test page
open test-markdown-negotiation.html
```

The test page provides:

- Markdown content negotiation testing
- WebMCP API detection
- Agent detection simulation
- Header inspection tools

## Browser Requirements

### WebMCP Support

- **Chrome Canary 146+** with `chrome://flags/#enable-experimental-web-platform-features`
- **Chrome 146+** (when WebMCP ships in stable)

### Markdown for Agents

- Works in any modern browser
- No special requirements
- Benefits AI agents regardless of WebMCP support

## Agent Detection

The system detects AI agents using:

- User-Agent patterns (claude-, gpt-, openai, anthropic, etc.)
- Accept header negotiation (`text/markdown`)
- Combined detection for maximum compatibility

## Performance Impact

- **Minimal overhead** for human users
- **No impact** on existing functionality
- **Efficient token usage** for AI agents
- **Lazy loading** of WebMCP features

## Security Considerations

- **Same-origin policy** maintained
- **Parameter validation** on all tool inputs
- **No additional attack surface** for human users
- **Scoped tool access** by route

## Future Enhancements

- **Advanced tool composition** for complex workflows
- **Real-time collaboration** between multiple agents
- **Custom tool registration** by third-party extensions
- **Performance analytics** for agent interactions

## Troubleshooting

### WebMCP Not Available

- Ensure Chrome Canary 146+
- Enable experimental web platform features
- Restart browser after enabling flags

### Markdown Not Serving

- Check server middleware configuration
- Verify Accept header includes `text/markdown`
- Confirm markdown files exist in routes directory

### Tools Not Registering

- Verify AgentIntegrationProvider is wrapping components
- Check tool handler registration in integration.ts
- Ensure route-specific props are passed correctly

## Contributing

When adding new agent features:

1. Update documentation in corresponding markdown files
2. Add appropriate WebMCP tools with clear descriptions
3. Implement comprehensive error handling
4. Add tests for new functionality
5. Update this README with new capabilities
