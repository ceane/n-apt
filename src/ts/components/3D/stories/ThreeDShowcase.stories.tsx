import type { Story } from "@ladle/react";

export default {
  title: "ThreeD/Components Showcase",
};

export const All3DComponents: Story = () => (
  <div style={{ padding: "24px", background: "#0a0a0c", minHeight: "100vh" }}>
    <h2 style={{ color: "#ac77ff", marginBottom: "24px" }}>3D Components Gallery</h2>
    <p style={{ color: "rgba(255, 255, 255, 0.7)" }}>
      All 3D components have been organized in the components/3D directory.
      Check the individual story files for each component:
    </p>
    <ul style={{ color: "rgba(255, 255, 255, 0.7)" }}>
      <li>Human Model Canvas - Interactive human model with physiology areas</li>
      <li>Polar Radio Wave WebGPU - Real-time 3D polar emission patterns</li>
      <li>Radiation Lobe 3D - 3D radiation lobe visualization</li>
      <li>Brain Model - 3D brain anatomical model</li>
      <li>Horizon Focus Globe - Holographic focus globe with shader effects</li>
      <li>Cell Towers - Interactive 3D models for all cell tower variants</li>
    </ul>
  </div>
);
