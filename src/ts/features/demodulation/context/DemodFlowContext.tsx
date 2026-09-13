import React, { createContext, useContext } from "react";
import type {
  Edge,
  Node,
  OnEdgesChange,
  OnNodesChange,
} from "@xyflow/react";

export interface DemodFlowContextValue {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  clearFlow: () => void;
  setFlow: (flowId: string, customNodes?: Node[], customEdges?: Edge[]) => void;
  flowVersion: number;
}

export const DemodFlowContext = createContext<DemodFlowContextValue | null>(
  null,
);

export const useDemodFlow = (): DemodFlowContextValue => {
  const context = useContext(DemodFlowContext);
  if (!context) {
    throw new Error("useDemodFlow must be used within a DemodFlowContext");
  }
  return context;
};
