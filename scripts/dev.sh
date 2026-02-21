#!/bin/bash

# Development launcher for N-APT with enhanced visual build output
# This script uses the new build orchestrator for professional output

set -e

# Change to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"

# Check if mock_signals.yaml exists, create if not
if [ ! -f "mock_signals.yaml" ]; then
    echo -e "\033[33m⚠ mock_signals.yaml not found. Creating default configuration...\033[0m"
    cat > mock_signals.yaml << 'EOF'
# Mock Signal Configuration for N-APT
# This file can be edited while the server is running to test different signal patterns

global_settings:
  noise_floor_base: -70.0
  noise_floor_variation: 5.0
  signal_drift_rate: 0.1
  signal_modulation_rate: 0.05
  signal_appearance_chance: 0.02
  signal_disappearance_chance: 0.01
  signal_strength_variation: 2.0

bandwidths:
  narrow: 15
  medium: 45
  wide: 120

strength_ranges:
  weak:
    min: -80.0
    max: -60.0
  medium:
    min: -60.0
    max: -40.0
  strong:
    min: -40.0
    max: -20.0

signals:
  - id: "fm_radio"
    type: "wide"
    center_freq_mhz: 101.5
    strength: -35.0
    active: true
    description: "FM radio station"
    
  - id: "aircraft_transponder"
    type: "narrow"
    center_freq_mhz: 1090.0
    strength: -45.0
    active: true
    description: "ADS-B aircraft transponder"

training_areas:
  area_a:
    freq_range_mhz: [88.0, 108.0]
    description: "FM broadcast band"
  area_b:
    freq_range_mhz: [108.0, 137.0]
    description: "Aircraft band"
EOF
    echo -e "\033[32m✓ Created mock_signals.yaml\033[0m"
fi

echo -e "\033[36m📋 Development Features:\033[0m"
echo "  • Enhanced visual build output"
echo "  • Hot reload for mock_signals.yaml"
echo "  • WebSocket reload command: {\"type\":\"reload_config\"}"
echo "  • Incremental compilation enabled"
echo ""

# Start the enhanced development server
echo -e "\033[32mStarting enhanced development server...\033[0m"
echo "Press Ctrl+C to stop"
echo ""

# Use the new build orchestrator
exec ./scripts/build_orchestrator.sh
