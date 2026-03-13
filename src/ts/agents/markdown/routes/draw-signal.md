# N-APT Signal Generator - Mathematical/ML Synthesis

## Overview

The Draw Signal interface provides sophisticated tools for generating synthetic N-APT neuro-biological radio signals using mathematical models and machine learning techniques. This route enables the creation of test signals, research patterns, and experimental waveforms for studying N-APT modulation effects.

## Capabilities

- **Mathematical Signal Synthesis**: Generate signals using parametric equations
- **ML-Based Generation**: Create signals using trained neural networks
- **Real-time Preview**: Instant visualization of generated waveforms
- **Parameter Control**: Fine-tune signal characteristics through intuitive sliders
- **Export Capabilities**: Save generated signals in multiple formats
- **Pattern Library**: Pre-defined N-APT signal templates

## Available Controls

### Signal Generation Parameters

- **Spike Count**: Number of signal spikes (1-20)
- **Spike Width**: Width of individual spikes (0.1-2.0)
- **Center Spike Boost**: Amplification factor for central spike (0.5-5.0)
- **Floor Amplitude**: Base signal amplitude (0.0-1.0)
- **Decay Rate**: Signal decay over time (0.1-2.0)
- **Envelope Width**: Overall signal envelope width (0.5-5.0)

### Generation Modes

- **Mathematical Mode**: Pure mathematical synthesis
- **ML Mode**: Neural network-based generation
- **Hybrid Mode**: Combined mathematical and ML approaches
- **Template Mode**: Use pre-defined signal patterns

### Advanced Parameters

- **Frequency Modulation**: FM modulation depth and rate
- **Phase Modulation**: PM modulation characteristics
- **Amplitude Modulation**: AM modulation envelope
- **Noise Addition**: Controlled noise injection
- **Harmonic Content**: Harmonic series configuration

### Visualization Controls

- **Time Domain**: Signal amplitude over time
- **Frequency Domain**: FFT spectrum analysis
- **Phase Plot**: Signal phase relationships
- **Constellation Diagram**: Complex signal representation
- **Spectrogram**: Time-frequency analysis

## Signal Templates

- **Standard N-APT**: Classic neuro-biological pattern
- **High-Frequency**: HF-range optimized signals
- **Low-Frequency**: LF-range penetration signals
- **Burst Mode**: Pulsed signal patterns
- **Continuous Wave**: Steady-state signals
- **Experimental**: Research-grade patterns

## Mathematical Models

- **Exponential Decay**: Natural signal attenuation
- **Gaussian Envelope**: Smooth signal shaping
- **Sinusoidal Modulation**: Periodic signal components
- **Chaotic Systems**: Non-linear dynamics
- **Fractal Patterns**: Self-similar signal structures

## ML Generation Features

- **GAN-Based**: Generative Adversarial Networks
- **VAE-Based**: Variational Autoencoders
- **Transformer-Based**: Attention-based synthesis
- **Diffusion Models**: Progressive signal generation
- **Hybrid Architectures**: Combined model approaches

## Export Formats

- **NAPT Format**: Encrypted native format with metadata
- **CSV**: Comma-separated values for analysis
- **WAV**: Audio format for acoustic analysis
- **JSON**: Structured data with parameters
- **MATLAB**: MATLAB-compatible data files

## Generation Workflows

1. **Manual Synthesis**: Set parameters → Preview → Adjust → Export
2. **Template Customization**: Load template → Modify → Export
3. **ML Generation**: Select model → Generate → Refine → Export
4. **Batch Generation**: Parameter sweep → Multiple outputs → Analysis

## API Endpoints

- `POST /generate` - Generate signal with parameters
- `GET /templates` - List available signal templates
- `POST /preview` - Real-time parameter preview
- `GET /models` - List available ML models
- `POST /export` - Export generated signal

## Performance Specifications

- **Generation Speed**: <100ms for standard signals
- **Preview Latency**: <50ms for parameter changes
- **ML Inference**: <500ms for complex models
- **Export Time**: <1s for standard formats

## Integration Features

- **Real-time Updates**: Instant parameter feedback
- **Undo/Redo**: Full parameter history
- **Save/Load**: Store and retrieve parameter sets
- **Batch Processing**: Generate multiple signals

## Related Routes

- `/` - Test generated signals with spectrum analysis
- `/demodulate` - Analyze generated signal properties
- `/3d-model` - Correlate with biological targets

## Technical Specifications

- **Sample Rate**: Up to 10 MS/s
- **Bit Depth**: 16-bit precision
- **Duration**: 0.1-60 seconds
- **Frequency Range**: 0.1-100 MHz
- **Memory Usage**: <500MB for complex signals

## Agent Integration

AI agents can automate the entire signal generation pipeline through WebMCP tools, from parameter selection through mathematical/ML synthesis to export. The interface supports complex generation workflows and can create custom signal patterns for research purposes.
