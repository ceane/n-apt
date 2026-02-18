# Hotspot Editor - 3D Annotation System

## Overview
The Hotspot Editor provides comprehensive tools for creating, managing, and organizing 3D spatial annotations on the human body model. This interface enables precise marking of biological targets, signal interaction points, and research areas for N-APT neuro-biological signal studies.

## Capabilities
- **3D Hotspot Creation**: Place precise markers on anatomical surfaces
- **Spatial Organization**: Systematic arrangement of research points
- **Batch Operations**: Multi-select and bulk editing capabilities
- **Import/Export**: Share hotspot configurations across sessions
- **Symmetry Tools**: Automated bilateral hotspot creation
- **Grid System**: Precision alignment and spatial reference

## Available Controls

### Hotspot Creation Tools
- **Point Name**: Custom labeling for each hotspot
- **Hotspot Size**: Small or large marker options
- **Symmetry Mode**: None, left/right, or top/bottom duplication
- **Multi-Select Mode**: Enable multiple hotspot selection
- **Grid Display**: Toggle reference grid overlay

### Creation Parameters
- **Name Assignment**: Custom or automatic naming
- **Size Selection**: Visual marker size options
- **Position Precision**: 3D coordinate placement
- **Symmetry Options**: Automatic bilateral creation
- **Grid Snapping**: Optional grid alignment

### Management Operations
- **Selection System**: Single or multi-select modes
- **Batch Actions**: Apply changes to multiple hotspots
- **Delete Operations**: Individual or bulk deletion
- **Rename Functions**: Edit hotspot labels
- **Position Editing**: Modify 3D coordinates

### Data Management
- **Export JSON**: Save hotspot configurations
- **Import JSON**: Load existing hotspot sets
- **Clear All**: Remove all hotspots
- **Backup System**: Automatic session saving
- **Version Control**: Track configuration changes

## Symmetry Modes
- **None**: Independent hotspot creation
- **X-Axis**: Left/right bilateral symmetry
- **Y-Axis**: Top/bottom vertical symmetry
- **Combined**: Multi-axis symmetry options

## Grid System
- **Reference Grid**: 3D spatial alignment grid
- **Snap Options**: Optional grid snapping
- **Grid Size**: Adjustable grid resolution
- **Coordinate Display**: Real-time position feedback
- **Visibility Toggle**: Show/hide grid overlay

## Multi-Select Features
- **Selection Modes**: Click, drag, and area selection
- **Selection Feedback**: Visual selection indicators
- **Batch Operations**: Apply to all selected items
- **Selection Count**: Real-time selection status
- **Selection Memory**: Maintain selection across operations

## Data Formats
- **Export Format**: JSON with positions and metadata
- **Import Support**: Compatible JSON configurations
- **Position Data**: 3D coordinate arrays
- **Metadata**: Names, sizes, and properties
- **Session Data**: Complete editor state

## Creation Workflows
1. **Single Point**: Name → Place → Size → Save
2. **Symmetrical Pair**: Enable symmetry → Place → Auto-duplicate
3. **Batch Creation**: Multi-select → Batch operations → Export
4. **Import Session**: Load JSON → Modify → Export

## API Endpoints
- `POST /hotspots/create` - Create new hotspot
- `GET /hotspots/list` - List all hotspots
- `POST /hotspots/select` - Select hotspot(s)
- `POST /hotspots/delete` - Delete hotspot(s)
- `POST /hotspots/export` - Export configuration
- `POST /hotspots/import` - Import configuration

## Performance Specifications
- **Creation Speed**: <50ms per hotspot
- **Selection Response**: <20ms for multi-select
- **Export Time**: <100ms for typical configurations
- **Memory Usage**: <50MB for large hotspot sets

## Integration Features
- **Real-time Updates**: Live 3D visualization
- **Undo/Redo**: Full operation history
- **Auto-save**: Automatic session persistence
- **Validation**: Position and name validation
- **Collision Detection**: Prevent overlapping hotspots

## Advanced Features
- **Area Templates**: Pre-defined hotspot patterns
- **Search Function**: Find hotspots by name
- **Categorization**: Group hotspots by type
- **Annotation Layers**: Multiple overlay systems
- **Measurement Tools**: Distance and angle calculations

## Related Routes
- `/3d-model` - Base 3D model for hotspot placement
- `/` - Correlate hotspots with signal data
- `/analysis` - Study hotspot-signal relationships

## Technical Specifications
- **3D Engine**: Three.js/WebGL integration
- **Data Structure**: JSON-based configuration
- **Precision**: Sub-millimeter positioning accuracy
- **Performance**: Optimized for 1000+ hotspots
- **Storage**: Efficient spatial indexing

## Agent Integration
AI agents can automate the entire hotspot management workflow through WebMCP tools, enabling systematic anatomical marking, batch processing of research areas, and integration with signal analysis data for comprehensive N-APT studies.
