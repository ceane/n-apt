import React, { createContext, useContext, useState, useRef, ReactNode } from 'react';

type Area = {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  meshName: string;
};

interface Model3DContextType {
  selectedArea: Area | null;
  setSelectedArea: (area: Area | null) => void;
  controlsRef: React.RefObject<any>;
}

const Model3DContext = createContext<Model3DContextType | undefined>(undefined);

interface Model3DProviderProps {
  children: ReactNode;
}

export const Model3DProvider: React.FC<Model3DProviderProps> = ({ children }) => {
  const [selectedArea, setSelectedArea] = useState<Area | null>(null);
  const controlsRef = useRef<any>(null);

  const contextValue: Model3DContextType = {
    selectedArea,
    setSelectedArea,
    controlsRef,
  };

  return React.createElement(
    Model3DContext.Provider,
    { value: contextValue },
    children
  );
};

export const useModel3D = (): Model3DContextType => {
  const context = useContext(Model3DContext);
  if (context === undefined) {
    throw new Error('useModel3D must be used within a Model3DProvider');
  }
  return context;
};

export type { Area };
