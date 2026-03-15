import type { Story } from "@ladle/react";
import { HumanModelCanvas } from "../HumanModelCanvas";

export default {
  title: "ThreeD/Human Model Canvas",
  component: HumanModelCanvas,
};

export const Default: Story = () => <HumanModelCanvas width="800px" height="600px" />;
