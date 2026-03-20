# Spectrum Visualizer - N-APT Signal Analysis

## Overview

The Spectrum Visualizer provides real-time FFT analysis of N-APT neuro-biological radio signals in the LF/HF frequency ranges. This interface captures, processes, and displays signals that modulate the brain and nervous system through heterodyning and phase shifting techniques.

## Capabilities

- **Live SDR Capture**: Real-time signal acquisition from RTL-SDR devices
- **File Processing**: Analysis of previously captured I/Q data files
- **FFT Visualization**: Real-time spectrum waterfall and frequency analysis
- **Signal Classification**: ML-based identification of N-APT patterns
- **Frequency Range Control**: Adjustable analysis windows (0-30MHz)
- **Multi-area Analysis**: Simultaneous monitoring of signal areas A and B

## Available Controls

### Source Management

- **Source Mode**: Switch between live SDR device and file input
- **Device Connection**: Connect/disconnect RTL-SDR hardware
- **File Selection**: Load and process captured signal files

### I/Q Capture Controls

- **Capture Duration**: Set recording length (1-60 seconds)
- **Capture Areas**: Select onscreen, area A (0-4.47MHz), area B (24.72-29.88MHz)
- **File Format**: Choose between .napt (encrypted) and raw formats
- **Encryption**: Toggle payload encryption for captured data

### Signal Analysis

- **FFT Size**: Adjust frequency resolution (512-8192 points)
- **FFT Window**: Select windowing function (Hann, Hamming, Blackman)
- **Frame Rate**: Control update speed (1-60 FPS)
- **Temporal Resolution**: Balance between responsiveness and accuracy

### Frequency Areas of Interest

- **Area A**: 0.0-4.47MHz range monitoring
- **Area B**: 24.72-29.88MHz range monitoring
- **Dynamic Range Adjustment**: Real-time frequency window modification
- **Area Switching**: Quick toggle between signal areas

### Signal Features

- **N-APT Classification**: Automatic detection of neuro-biological signals
- **Signal Metadata**: Extract and display technical parameters
- **Pattern Recognition**: Identify characteristic modulation patterns

### Source Settings (SDR Configuration)

- **Gain Control**: Adjust receiver gain (-10 to +50 dB)
- **PPM Correction**: Frequency offset calibration (-100 to +100 ppm)
- **AGC Modes**: Configure tuner and RTL AGC settings
- **Device Settings**: Hardware-specific optimization parameters

### Snapshot Controls

- **Visual Export**: Capture spectrum displays as PNG/SVG
- **Data Export**: Save frequency analysis data
- **Annotation**: Add markers and comments to captures

## Data Formats

- **Input**: .napt (encrypted), .wav, .c64, .npy I/Q files
- **Output**: PNG/SVG images, JSON metadata, CSV analysis data
- **Real-time**: WebSocket streaming of FFT data

## API Endpoints

- `GET /status` - Connection and device status
- `POST /capture` - Initiate signal capture
- `WebSocket /ws` - Real-time data streaming
- `GET /spectrum-frames` - Available frequency ranges

## Example Workflows

1. **Live Analysis**: Connect RTL-SDR → Set frequency range → Start capture → Classify signals
2. **File Processing**: Load .napt file → Decrypt metadata → Analyze spectrum → Export results
3. **Multi-area Monitoring**: Configure areas A and B → Simultaneous capture → Comparative analysis

## Related Routes

- `/analysis` - Advanced ML signal processing
- `/draw-signal` - Generate synthetic N-APT signals
- `/3d-model` - Biological target visualization

## Technical Specifications

- **Frequency Range**: 0.5-31.0 MHz (RTL-SDR Blog V4)
- **Sample Rate**: Up to 3.2 MS/s
- **FFT Resolution**: 512-8192 points
- **Update Rate**: 1-60 FPS
- **Latency**: <100ms for live processing

## Agent Integration

This interface supports WebMCP tools for automated signal analysis workflows. AI agents can control all aspects of signal capture, processing, and classification through structured tool calls.
