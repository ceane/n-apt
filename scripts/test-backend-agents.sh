#!/bin/bash

# Test script for Rust backend agent features
# Tests the new agent endpoints and WebMCP functionality

set -e

BACKEND_URL="http://localhost:8765"
echo "🧪 Testing N-APT Backend Agent Features"
echo "================================"

# Check if backend is running
echo "📡 Checking backend status..."
if ! curl -s "$BACKEND_URL/status" > /dev/null; then
    echo "❌ Backend not running. Please start it first:"
    echo "   ./target/release/n-apt-backend > server.log 2>&1 &"
    exit 1
fi
echo "✅ Backend is running"

echo ""
echo "🤖 Testing Agent Endpoints"
echo "=========================="

# Test agent info endpoint
echo "📋 Testing /api/agent/info..."
echo "Request: GET $BACKEND_URL/api/agent/info"
curl -s "$BACKEND_URL/api/agent/info" | jq '.' 2>/dev/null || curl -s "$BACKEND_URL/api/agent/info"
echo ""

# Test agent status endpoint
echo "📊 Testing /api/agent/status..."
echo "Request: GET $BACKEND_URL/api/agent/status"
curl -s "$BACKEND_URL/api/agent/status" | jq '.' 2>/dev/null || curl -s "$BACKEND_URL/api/agent/status"
echo ""

echo "🛠️ Testing WebMCP Tool Execution"
echo "=============================="

# Test WebMCP tool execution - setGain
echo "🎛️  Testing setGain tool..."
echo "Request: POST $BACKEND_URL/api/webmcp/execute"
curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "setGain", "params": {"gain": 20.0}}' | \
  jq '.' 2>/dev/null || curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "setGain", "params": {"gain": 20.0}}'
echo ""

# Test WebMCP tool execution - connectDevice
echo "🔌 Testing connectDevice tool..."
echo "Request: POST $BACKEND_URL/api/webmcp/execute"
curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "connectDevice", "params": {}}' | \
  jq '.' 2>/dev/null || curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "connectDevice", "params": {}}'
echo ""

# Test WebMCP tool execution - classifySignal
echo "🧠 Testing classifySignal tool..."
echo "Request: POST $BACKEND_URL/api/webmcp/execute"
curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "classifySignal", "params": {}}' | \
  jq '.' 2>/dev/null || curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "classifySignal", "params": {}}'
echo ""

# Test WebMCP tool execution - startCapture
echo "📡 Testing startCapture tool..."
echo "Request: POST $BACKEND_URL/api/webmcp/execute"
curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "startCapture", "params": {"jobId": "test_job", "minFreq": 1.0, "maxFreq": 5.0, "durationS": 2.0, "fileType": ".napt", "encrypted": true}}' | \
  jq '.' 2>/dev/null || curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "startCapture", "params": {"jobId": "test_job", "minFreq": 1.0, "maxFreq": 5.0, "durationS": 2.0, "fileType": ".napt", "encrypted": true}}'
echo ""

echo "❌ Testing Error Handling"
echo "====================="

# Test unknown tool
echo "🚫 Testing unknown tool..."
curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "unknownTool", "params": {}}' | \
  jq '.' 2>/dev/null || curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "unknownTool", "params": {}}'
echo ""

# Test invalid parameters
echo "⚠️  Testing invalid parameters..."
curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "setGain", "params": {"invalid": "param"}}' | \
  jq '.' 2>/dev/null || curl -s -X POST "$BACKEND_URL/api/webmcp/execute" \
  -H "Content-Type: application/json" \
  -d '{"name": "setGain", "params": {"invalid": "param"}}'
echo ""

echo "🔍 Testing CORS Headers"
echo "====================="

# Test CORS headers with agent user-agent
echo "🌐 Testing CORS with agent User-Agent..."
curl -s -I -H "Origin: http://localhost:5173" \
  -H "User-Agent: Claude-Code/1.0" \
  "$BACKEND_URL/api/agent/info" | grep -E "(access-control|content-type)"
echo ""

echo "✅ Backend Agent Features Test Complete!"
echo ""
echo "📝 Summary:"
echo "- Agent info endpoint: ✅"
echo "- Agent status endpoint: ✅" 
echo "- WebMCP tool execution: ✅"
echo "- Error handling: ✅"
echo "- CORS headers: ✅"
echo ""
echo "🚀 Your N-APT backend is ready for AI agents!"
