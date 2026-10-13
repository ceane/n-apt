# Map Endpoints

`/map-endpoints` combines an interactive map with a sidebar for saved places,
route paths, nearby cellular endpoints, and reference links. The sidebar also
filters the displayed tower records by radio technology and carrier/network.
The map can show a current-location marker, a searched-place preview, and
cellular tower markers; select a tower to inspect its radio/network identifiers.

## Places and route paths

In **Locations**, search for a place, select a result to preview it, then use
**Add to Saved** to keep it as a named map location. Select a saved location to
recenter the map. The built-in current location is shown separately; other
saved locations can be removed after confirmation.

In **Route Paths**, search an address/intersection or enter start and end
coordinates, then add a segment. Segments appear on the map and in the list;
remove individual segments or clear the list. The route panel reports nearby
endpoints associated with the paths. **Nearest Endpoints** provides its own
endpoint view, and **Useful Links** links to radio, tower, and FCC references.

## Data and limits

Cell tower records are supplied by OpenCelliD (attribution appears in the
sidebar). Map routes are coordinate paths and nearby-endpoint comparisons;
they are not RF propagation estimates, proof of a transmission, or evidence of
signal effects. Location searches and current-location access may send or use
precise location data; handle it according to the user's request and app
permissions.

## Agent and WebMCP access

The registered tools are `searchLocation`, `selectLocation`, `addLocation`,
and `removeLocation`. They cover saved-location search and management, not map
gestures, tower filters, route segments, or nearest-endpoint analysis. Check
the capability manifest for schemas and execution policy before using a tool.
