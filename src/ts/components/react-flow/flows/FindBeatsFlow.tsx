import { BarChart3 } from "lucide-react";
import type { FlowTemplate } from "@n-apt/components/react-flow/flows/templates";

export const FindBeatsFlow: FlowTemplate = {
  id: "find-beats",
  label: "Find Beats",
  description: "Detect low-frequency beat interference in waterfall history",
  icon: <BarChart3 size={16} />,
  nodes: [
    {
      id: "source",
      type: "custom",
      position: { x: 250, y: 50 },
      data: {
        label: "Source",
        description: "Signal source",
        sourceNode: true,
      },
    },
    {
      id: "channel",
      type: "custom",
      position: { x: 250, y: 450 },
      data: {
        label: "Channel",
        description: "Channel configuration",
        channelNode: true,
      },
    },
    {
      id: "waterfall",
      type: "custom",
      position: { x: 250, y: 850 },
      data: {
        label: "Waterfall",
        description: "High-resolution beat interference history",
        waterfallOptions: true,
        showMiniVfo: true,
        miniVfoPosition: "top",
      },
    },
    {
      id: "beat",
      type: "custom",
      position: { x: 250, y: 1250 },
      data: {
        label: "Beat Detection",
        description: "Detect beat frequencies and heterodyning",
        beatOptions: true,
      },
    },
  ],
  edges: [
    {
      id: "e1",
      source: "source",
      target: "channel",
      animated: true,
      style: { stroke: "#666" },
    },
    {
      id: "e2",
      source: "channel",
      target: "waterfall",
      animated: true,
      style: { stroke: "#666" },
    },
    {
      id: "e3",
      source: "waterfall",
      target: "beat",
      animated: true,
      style: { stroke: "#666" },
    },
  ],
};
