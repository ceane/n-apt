# Cellular Triangulation Demo

`/game` opens a self-contained, real-time 3D city simulation. The player moves
through generated streets while a minimap shows the player, buildings, and
cell towers. A local simulation marks nearby towers as warming up or active
and visualizes their spotlight beams; the on-screen **Tracked!** panel
describes the six-nearest-tower hexagon behavior.

## Controls

- Move with **WASD** or the **arrow keys**.
- Hold the left mouse button and drag to orbit the camera.
- Scroll to zoom.
- Use **Pause** in the upper-left, or press **P** or **Escape**, to pause or
  resume.
- While paused, the full-screen tower carousel shows four simulated tower
  types: Roof Tower, Monopole Tower, Hexagonal Tower, and Diamond Panel Tower.
  Use the left/right arrows or keyboard arrows to browse their live simulation
  counts, active status, and nearest active tower. Press **P** or **Escape** to
  close the pause view.

## Simulation scope

This is a visual demonstration with procedurally placed buildings and tower
models. Its player position, active towers, distances, and tracking display
come from in-memory simulation state. It does not connect to cellular-network
infrastructure, locate a real device, or demonstrate real-world tower
triangulation or tracking.

## Agent access

The game is a demo route and exposes no registered WebMCP tools. Its controls
are interactive app UI; the agent route guide does not imply permission to
operate the simulation or represent its output as real-world measurements.
