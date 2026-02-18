import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface Hotspot {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  meshName: string;
  size: "small" | "large";
  selected?: boolean;
}

interface HotspotEditorContextType {
  hotspots: Hotspot[];
  setHotspots: (hotspots: Hotspot[]) => void;
  selectedHotspot: string | null;
  setSelectedHotspot: (id: string | null) => void;
  newHotspotName: string;
  setNewHotspotName: (name: string) => void;
  symmetryMode: "none" | "x" | "y";
  setSymmetryMode: (mode: "none" | "x" | "y") => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  hotspotSize: "small" | "large";
  setHotspotSize: (size: "small" | "large") => void;
  isMultiSelectMode: boolean;
  setIsMultiSelectMode: (mode: boolean) => void;
  multiSelectedHotspots: string[];
  setMultiSelectedHotspots: (ids: string[]) => void;
  handleAddHotspot: (point: { x: number; y: number; z: number }) => void;
  handleDeleteHotspot: (id: string) => void;
  handleDeleteSelected: () => void;
  handleToggleSelect: (id: string) => void;
  handleHotspotClick: (id: string) => void;
  handleRename: (id: string, newName: string) => void;
  handleExport: () => void;
  handleImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleClear: () => void;
}

const HotspotEditorContext = createContext<HotspotEditorContextType | undefined>(undefined);

interface HotspotEditorProviderProps {
  children: ReactNode;
  onHotspotsChange?: (hotspots: Hotspot[]) => void;
}

export const HotspotEditorProvider: React.FC<HotspotEditorProviderProps> = ({ 
  children, 
  onHotspotsChange 
}) => {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [selectedHotspot, setSelectedHotspot] = useState<string | null>(null);
  const [newHotspotName, setNewHotspotName] = useState("");
  const [symmetryMode, setSymmetryMode] = useState<"none" | "x" | "y">("none");
  const [showGrid, setShowGrid] = useState(true);
  const [hotspotSize, setHotspotSize] = useState<"small" | "large">("small");
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [multiSelectedHotspots, setMultiSelectedHotspots] = useState<string[]>([]);

  const handleAddHotspot = useCallback(
    (point: { x: number; y: number; z: number }) => {
      const id = Date.now().toString();
      const name = newHotspotName || `Point ${hotspots.length + 1}`;

      const newHotspot: Hotspot = {
        id,
        name,
        position: [point.x, point.y, point.z],
        target: [point.x, point.y, point.z],
        meshName: "o_ADBody",
        size: hotspotSize,
      };

      let updatedHotspots = [...hotspots, newHotspot];

      // Add symmetrical points if enabled
      if (symmetryMode === "x") {
        const symmetricalHotspot: Hotspot = {
          id: `${id}_sym_x`,
          name: `${name} (Left)`,
          position: [-point.x, point.y, point.z],
          target: [-point.x, point.y, point.z],
          meshName: "o_ADBody",
          size: hotspotSize,
        };
        newHotspot.name = `${name} (Right)`;
        updatedHotspots = [...updatedHotspots, symmetricalHotspot];
      } else if (symmetryMode === "y") {
        const symmetricalHotspot: Hotspot = {
          id: `${id}_sym_y`,
          name: `${name} (Bottom)`,
          position: [point.x, -point.y, point.z],
          target: [point.x, -point.y, point.z],
          meshName: "o_ADBody",
          size: hotspotSize,
        };
        newHotspot.name = `${name} (Top)`;
        updatedHotspots = [...updatedHotspots, symmetricalHotspot];
      }

      setHotspots(updatedHotspots);
      onHotspotsChange?.(updatedHotspots);
      setNewHotspotName("");
    },
    [hotspots, newHotspotName, symmetryMode, onHotspotsChange],
  );

  const handleDeleteHotspot = useCallback(
    (id: string) => {
      const updatedHotspots = hotspots.filter((h) => h.id !== id);
      setHotspots(updatedHotspots);
      onHotspotsChange?.(updatedHotspots);
    },
    [hotspots, onHotspotsChange],
  );

  const handleDeleteSelected = useCallback(() => {
    const updatedHotspots = hotspots.filter((h) => !multiSelectedHotspots.includes(h.id));
    setHotspots(updatedHotspots);
    onHotspotsChange?.(updatedHotspots);
    setMultiSelectedHotspots([]);
  }, [hotspots, multiSelectedHotspots, onHotspotsChange]);

  const handleToggleSelect = useCallback(
    (id: string) => {
      if (isMultiSelectMode) {
        setMultiSelectedHotspots((prev) =>
          prev.includes(id) ? prev.filter((hid) => hid !== id) : [...prev, id],
        );
      } else {
        setSelectedHotspot(id);
      }
    },
    [isMultiSelectMode],
  );

  const handleHotspotClick = useCallback(
    (id: string) => {
      if (isMultiSelectMode) {
        handleToggleSelect(id);
      } else {
        setSelectedHotspot(id);
      }
    },
    [isMultiSelectMode, handleToggleSelect],
  );

  const handleRename = useCallback((id: string, newName: string) => {
    const updatedHotspots = hotspots.map((h) =>
      h.id === id ? { ...h, name: newName } : h,
    );
    setHotspots(updatedHotspots);
    onHotspotsChange?.(updatedHotspots);
  }, [hotspots, onHotspotsChange]);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(hotspots, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hotspots.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [hotspots]);

  const handleImport = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const imported = JSON.parse(e.target?.result as string);
            setHotspots(imported);
            onHotspotsChange?.(imported);
          } catch (error) {
            console.error("Failed to import hotspots:", error);
          }
        };
        reader.readAsText(file);
      }
    },
    [onHotspotsChange],
  );

  const handleClear = useCallback(() => {
    setHotspots([]);
    onHotspotsChange?.([]);
  }, [onHotspotsChange]);

  const contextValue: HotspotEditorContextType = {
    hotspots,
    setHotspots,
    selectedHotspot,
    setSelectedHotspot,
    newHotspotName,
    setNewHotspotName,
    symmetryMode,
    setSymmetryMode,
    showGrid,
    setShowGrid,
    hotspotSize,
    setHotspotSize,
    isMultiSelectMode,
    setIsMultiSelectMode,
    multiSelectedHotspots,
    setMultiSelectedHotspots,
    handleAddHotspot,
    handleDeleteHotspot,
    handleDeleteSelected,
    handleToggleSelect,
    handleHotspotClick,
    handleRename,
    handleExport,
    handleImport,
    handleClear,
  };

  return React.createElement(
    HotspotEditorContext.Provider,
    { value: contextValue },
    children
  );
};

export const useHotspotEditor = (): HotspotEditorContextType => {
  const context = useContext(HotspotEditorContext);
  if (context === undefined) {
    throw new Error('useHotspotEditor must be used within a HotspotEditorProvider');
  }
  return context;
};

export type { Hotspot };
