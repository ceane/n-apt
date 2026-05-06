# Map Endpoints - Geographic Location Monitoring

## Overview

The Map Endpoints interface provides geographic visualization and monitoring of signal transmission and reception points. It allows for the mapping of N-APT signal sources, biological targets, and monitoring stations on a world map, facilitating spatial analysis of signal propagation and impact.

## Capabilities

- **Interactive Geographic Map**: Real-time visualization of locations across the globe
- **Location Search**: Search for specific coordinates or named geographic locations
- **Endpoint Management**: Add, modify, and remove signal transmission and reception points
- **Real-time Geolocation**: Track and map current monitor location
- **Spatial Clustering**: Visualize density of signal activity in specific regions
- **Location Presets**: Save and quickly switch between frequently monitored areas

## Available Controls

### Map Interaction

- **Navigation**: Pan, zoom, and rotate the geographic display
- **Search**: Enter names or coordinates to find specific locations
- **View Modes**: Switch between satellite, terrain, and street views
- **Scale Control**: Measure distances between transmission and reception points

### Location Management

- **Add Location**: Mark new signal sources or reception endpoints on the map
- **Select Location**: Focus the map view on a specific saved or searched location
- **Remove Location**: Delete endpoints that are no longer active or relevant
- **Current Location**: Instantly snap the map view to the current monitor's geolocation

### Monitoring Parameters

- **Signal Range**: Visualize the theoretical propagation range of transmitters
- **Impact Zones**: Map geographic areas affected by specific N-APT frequencies
- **Network Topology**: Visualize connections between multiple transmission nodes
- **Station Metadata**: View and edit technical details for each mapped endpoint

## Data Formats

- **Input**: Geographic coordinates (Lat/Lng), GeoJSON location data
- **Output**: Location manifests, propagation maps, geographic analysis reports
- **Real-time**: Live location tracking and signal propagation updates

## Workflows

1. **New Site Setup**: Search for location → Add endpoint marker → Define transmission range → Save as preset
2. **Propagation Analysis**: Select source location → Identify target endpoints → Map intervening terrain → Calculate impact
3. **Mobile Monitoring**: Enable geolocation → Track current position → Map local signal environment → Record snapshots

## Related Routes

- `/` - Spectrum visualization and capture
- `/demodulate` - ML-based signal analysis at specific locations
- `/3d-model` - Biological target visualization at the endpoint level

## Technical Specifications

- **Map Engine**: Leaflet with high-resolution tile support
- **Coordinate System**: WGS 84 (GPS)
- **Search API**: OpenStreetMap Nominatim integration
- **Update Rate**: Real-time panning and zooming (60 FPS)

## Agent Integration

This interface supports WebMCP tools for automated geographic monitoring. AI agents can search for locations, manage endpoint manifests, and perform spatial signal analysis through structured tool calls. Agents can correlate geographic data with signal captures to build comprehensive transmission maps.
