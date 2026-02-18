# Rust Backend Integration for Agent Features

## Recommended Approach

### Frontend (Vercel) - Markdown for Agents ✅
- **Keep current implementation**
- Static markdown files work perfectly on Vercel
- Content negotiation handled by frontend
- No backend changes needed for markdown

### Backend (Rust) - Add Agent API Endpoints
Add these endpoints to `src/server/http_endpoints.rs`:

```rust
// Agent detection and metadata
pub async fn agent_info(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let agent_info = json!({
        "name": "N-APT SDR Analysis System",
        "version": "0.2.5",
        "capabilities": [
            "sdr_capture",
            "signal_analysis", 
            "ml_classification",
            "3d_visualization",
            "hotspot_annotation"
        ],
        "endpoints": {
            "capture": "/api/capture",
            "analysis": "/api/analysis", 
            "status": "/api/status",
            "websocket": "/ws"
        },
        "webmcp_tools": 27,
        "routes": 5
    });
    
    Json(agent_info)
}

// WebMCP tool execution endpoint
pub async fn execute_webmcp_tool(
    State(state): State<Arc<AppState>>,
    Json(tool_request): Json<WebMCPToolRequest>,
) -> impl IntoResponse {
    // Handle tool execution based on tool name
    match tool_request.name.as_str() {
        "startCapture" => handle_capture_request(state, tool_request.params).await,
        "setGain" => handle_gain_request(state, tool_request.params).await,
        "classifySignal" => handle_classification_request(state, tool_request.params).await,
        // ... other tools
        _ => (StatusCode::BAD_REQUEST, Json(json!({"error": "Unknown tool"})))
    }
}

// Enhanced status endpoint for agents
pub async fn agent_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let shared = &state.shared;
    
    let status = json!({
        "device": {
            "connected": shared.device_connected.load(Ordering::Relaxed),
            "type": shared.backend_type.load(Ordering::Relaxed).to_string(),
            "info": shared.device_info.load(Ordering::Relaxed)
        },
        "capture": {
            "is_capturing": shared.is_capturing.load(Ordering::Relaxed),
            "active_clients": shared.client_count.load(Ordering::Relaxed)
        },
        "signals": {
            "sample_rate": shared.max_sample_rate_hz.load(Ordering::Relaxed),
            "center_frequency": shared.center_frequency_mhz.load(Ordering::Relaxed),
            "gain": shared.gain_db.load(Ordering::Relaxed)
        },
        "agent_features": {
            "webmcp_enabled": true,
            "markdown_negotiation": true,
            "real_time_streaming": true
        }
    });
    
    Json(status)
}
```

### Add to Router in `main.rs`

```rust
// In create_app() function, add these routes:
.route("/api/agent/info", get(agent_info))
.route("/api/agent/status", get(agent_status))
.route("/api/webmcp/execute", post(execute_webmcp_tool))
```

### Update CORS for Agent Origins

```rust
// Add agent-friendly origins to CORS configuration
let cors = CorsLayer::new()
    .allow_origin([
        "http://localhost:5173".parse::<HeaderValue>().unwrap(),
        "http://127.0.0.1:5173".parse::<HeaderValue>().unwrap(),
        "http://localhost:3000".parse::<HeaderValue>().unwrap(),
        "http://127.0.0.1:3000".parse::<HeaderValue>().unwrap(),
        // Add agent origins if needed
        "https://claude.ai".parse::<HeaderValue>().unwrap(),
        "https://chat.openai.com".parse::<HeaderValue>().unwrap(),
    ])
    .allow_methods([
        Method::GET,
        Method::POST, 
        Method::OPTIONS,
    ])
    .allow_headers([
        axum::http::header::ACCEPT,
        axum::http::header::CONTENT_TYPE,
        axum::http::header::AUTHORIZATION,
        axum::http::header::HeaderName::from_static("user-agent"),
    ]);
```

## Benefits of This Approach

### ✅ **Vercel Optimized**
- Static markdown files served efficiently
- No server-side rendering needed
- Leverages Vercel's CDN

### ✅ **Rust Backend Power**
- Real SDR hardware control
- WebSocket streaming for live data
- Authentication and security
- Performance-critical signal processing

### ✅ **Agent Friendly**
- Structured API endpoints for tool execution
- Real-time data via WebSockets
- Authentication integration
- Comprehensive status information

## Implementation Order

1. **Frontend**: Current implementation already works
2. **Backend**: Add agent API endpoints (1-2 hours)
3. **Integration**: Connect WebMCP tools to Rust endpoints (2-3 hours)
4. **Testing**: Verify agent workflows (1 hour)

## Total Effort: ~4-6 hours

This gives you the best of both worlds:
- **Vercel**: Static content delivery and frontend hosting
- **Rust**: Powerful backend for SDR control and real-time data
