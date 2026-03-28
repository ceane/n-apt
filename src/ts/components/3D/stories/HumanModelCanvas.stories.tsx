import type { Story } from "@ladle/react";
import { Model3DCanvas } from "@n-apt/components/3D/Model3DCanvas";

export default {
  title: "ThreeD/Human Model Canvas",
  component: Model3DCanvas,
};

export const Default: Story = () => <Model3DCanvas width="800px" height="600px" />;
