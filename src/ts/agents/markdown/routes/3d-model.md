# 3D Model

`/3d-model` displays the interactive 3D model with its control sidebar. The
**Physiology** section opens by default and selects the human model; opening
**Psychology** switches the scene to the brain view. **Anatomy** and **Effects**
are currently explanatory sections. Use **Reset Camera** to return to the
default camera position and clear the selected area.

## Explore the model

Select a body area in the Physiology section or click a selectable part of the
model to focus the camera. Drag to orbit and use the viewer controls to change
the view. The model can also display hotspots maintained through **Make
Hotspots**. Hotspots are editable visual markers; they do not represent a
measured biological effect.

## Make Hotspots

Open **Make Hotspots** in the sidebar and use the editor controls to create,
select, modify, import, export, or remove hotspot markers. In the 3D scene, the
hint indicates that clicking the model adds a hotspot. Use this feature for
annotations and visualization only.

## Agent and WebMCP access

The registered tools are `selectBodyArea`, `resetCamera`, `setViewMode`,
`exportModelData`, `createHotspot`, `setSymmetryMode`, `selectHotspot`,
`deleteHotspot`, `exportHotspots`, and `importHotspots`. These cover selected
model and hotspot operations, not every camera gesture or every editor field.
Check the capability manifest for schemas and execution classifications. Model
visualization is not evidence that a signal affects a body area.
