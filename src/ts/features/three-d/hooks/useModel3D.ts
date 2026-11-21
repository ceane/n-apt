import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useMemo,
  useCallback,
  ReactNode,
} from "react";

type Area = {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  markerPosition?: [number, number, number];
  markerPositions?: [number, number, number][];
  markerPaths?: [number, number, number][][];
  muscleRibbons?: {
    points: [number, number, number][];
    halfWidth: number;
    closed?: boolean;
    surfaceNormal?: [number, number, number];
    surfaceAnchored?: boolean;
    surfaceEdges?: { left: [number, number, number][]; right: [number, number, number][] };
    glowSurfaceEdges?: { left: [number, number, number][]; right: [number, number, number][] };
  }[];
  musclePatches?: [number, number, number][][];
  muscleVolumes?: { position: [number, number, number]; scale: [number, number, number]; color?: string }[];
  anatomyTubes?: { points: [number, number, number][]; radius: number; closed?: boolean; color?: string; opacity?: number }[];
  regionPatch?: [number, number, number][];
  regionPatches?: [number, number, number][][];
  surfaceAnchored?: boolean;
  markerRadius?: number;
  markerStyle?: "rotation";
  surfaceNormal?: [number, number, number];
  highlightType?: "nerve" | "region";
  meshName: string;
};

interface Model3DContextType {
  selectedArea: Area | null;
  setSelectedArea: (area: Area | null) => void;
  selectionRequest: number;
  controlsRef: React.RefObject<any>;
  modelVariant: "human" | "brain" | "anatomy";
  setModelVariant: (variant: "human" | "brain" | "anatomy") => void;
  physiologyOpen: boolean;
  setPhysiologyOpen: (isOpen: boolean) => void;
}

const Model3DContext = createContext<Model3DContextType | undefined>(undefined);

interface Model3DProviderProps {
  children: ReactNode;
}

export const Model3DProvider: React.FC<Model3DProviderProps> = ({
  children,
}) => {
  const [selectedArea, setSelectedAreaState] = useState<Area | null>(null);
  const [selectionRequest, setSelectionRequest] = useState(0);
  const [modelVariant, setModelVariant] = useState<"human" | "brain" | "anatomy">("human");
  const [physiologyOpen, setPhysiologyOpen] = useState(true);
  const controlsRef = useRef<any>(null);
  const setSelectedArea = useCallback((area: Area | null) => {
    setSelectedAreaState(area);
    setSelectionRequest((request) => request + 1);
  }, []);

  const contextValue = useMemo<Model3DContextType>(
    () => ({
      selectedArea,
      setSelectedArea,
      selectionRequest,
      controlsRef,
      modelVariant,
      setModelVariant,
      physiologyOpen,
      setPhysiologyOpen,
    }),
    [selectedArea, selectionRequest, modelVariant, physiologyOpen, setSelectedArea],
  );

  return React.createElement(
    Model3DContext.Provider,
    { value: contextValue },
    children,
  );
};

export const useModel3D = (): Model3DContextType => {
  const context = useContext(Model3DContext);
  if (context === undefined) {
    throw new Error("useModel3D must be used within a Model3DProvider");
  }
  return context;
};

export type { Area };
