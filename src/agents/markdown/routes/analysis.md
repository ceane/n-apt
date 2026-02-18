# N-APT Analysis - Machine Learning Signal Decoding

## Overview
The Analysis interface provides advanced machine learning tools for decoding and interpreting N-APT neuro-biological radio signals. This route leverages sophisticated ML models to identify patterns, extract meaningful data, and classify signal types that affect brain and nervous system function.

## Capabilities
- **ML Signal Classification**: Automated identification of N-APT signal types
- **Pattern Recognition**: Detection of characteristic modulation patterns
- **Neural Decoding**: Extraction of potential neural information from radio signals
- **Statistical Analysis**: Comprehensive signal metrics and correlations
- **Real-time Processing**: Live ML inference on incoming signal data
- **Batch Analysis**: Process multiple signal files for comparative studies

## Available Controls

### Core SDR Controls (Inherited)
All controls from the Spectrum Visualizer are available:
- Source management (live/file)
- I/Q capture controls
- Signal display settings
- Frequency area configuration
- Source settings (gain, PPM, AGC)

### ML Analysis Controls
- **Model Selection**: Choose between different ML architectures
- **Analysis Mode**: Real-time vs batch processing
- **Confidence Threshold**: Set minimum confidence for classifications
- **Feature Extraction**: Configure which signal features to analyze
- **Output Format**: JSON, CSV, or binary result formats

### Processing Parameters
- **Window Size**: Analysis window duration (0.1-10 seconds)
- **Overlap**: Sliding window overlap percentage (0-90%)
- **Sampling Rate**: Input resampling for optimal ML performance
- **Frequency Bands**: Select specific frequency ranges for analysis

### Visualization Tools
- **Classification Timeline**: Real-time classification results over time
- **Confidence Meters**: Visual confidence indicators for predictions
- **Feature Plots**: Extracted feature visualization
- **Correlation Matrices**: Signal relationship analysis

## Data Formats
- **Input**: Same as visualizer (.napt, .c64, .npy, live streams)
- **Output**: 
  - JSON classifications with confidence scores
  - CSV feature extraction data
  - Binary ML model outputs
  - Visual analysis reports

## ML Models Available
- **Neural Network Classifier**: Deep learning for signal pattern recognition
- **Random Forest**: Ensemble method for feature-based classification
- **SVM Classifier**: Support vector machine for binary classification
- **Autoencoder**: Unsupervised anomaly detection
- **Ensemble Model**: Combined predictions from multiple models

## Analysis Workflows
1. **Live Classification**: Connect device → Start capture → Enable ML analysis → Monitor classifications
2. **Batch Processing**: Load files → Select model → Run analysis → Export results
3. **Comparative Study**: Multiple files → Cross-model analysis → Statistical comparison
4. **Feature Research**: Extract features → Analyze patterns → Generate insights

## API Endpoints
- `POST /analysis/start` - Begin ML analysis session
- `POST /analysis/stop` - Stop current analysis
- `GET /analysis/models` - List available ML models
- `POST /analysis/predict` - Single prediction request
- `GET /analysis/results` - Retrieve analysis results
- `POST /analysis/export` - Export analysis data

## Performance Metrics
- **Latency**: <50ms for real-time predictions
- **Accuracy**: 95%+ on trained signal types
- **Throughput**: Up to 1000 predictions/second
- **Memory**: <2GB for model loading

## Integration Features
- **WebMCP Tools**: Full automation support for ML workflows
- **Real-time Updates**: WebSocket streaming of predictions
- **Model Management**: Dynamic model loading and unloading
- **Result Caching**: Store and retrieve previous analyses

## Related Routes
- `/` - Spectrum visualization and capture
- `/draw-signal` - Generate training signals
- `/3d-model` - Biological target correlation

## Technical Specifications
- **Framework**: TensorFlow.js for browser-based inference
- **Model Size**: 10-100MB per model
- **Input Shape**: Variable, auto-resized to model requirements
- **Output Classes**: Up to 50 signal categories
- **Update Rate**: Real-time (up to 60 FPS)

## Agent Integration
AI agents can automate the entire analysis pipeline through WebMCP tools, from signal capture through ML classification to result export. The interface supports complex analytical workflows and can process multiple signals simultaneously.
