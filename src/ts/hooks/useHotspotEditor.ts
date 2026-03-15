import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from "react";
import { MODEL_ROOT_POSITION } from "@n-apt/consts/components";

interface Hotspot {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  meshName: string;
  size: "small" | "large";
  selected?: boolean;
}

type SidebarTab = "select-areas" | "make-hotspots";

interface HotspotState {
  hotspots: Hotspot[];
  selectedHotspot: string | null;
  newHotspotName: string;
  symmetryMode: "none" | "x" | "y";
  showGrid: boolean;
  hotspotSize: "small" | "large";
  isMultiSelectMode: boolean;
  multiSelectedHotspots: string[];
  sidebarTab: SidebarTab;
}

type HotspotAction =
  | { type: "SET_HOTSPOTS"; hotspots: Hotspot[] }
  | { type: "SET_SELECTED"; id: string | null }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_SYMMETRY"; mode: "none" | "x" | "y" }
  | { type: "SET_GRID"; show: boolean }
  | { type: "SET_SIZE"; size: "small" | "large" }
  | { type: "SET_MULTI_SELECT"; mode: boolean }
  | { type: "SET_MULTI_SELECTED"; ids: string[] }
  | { type: "ADD_HOTSPOT"; hotspots: Hotspot[]; resetName: boolean }
  | { type: "DELETE_HOTSPOT"; hotspots: Hotspot[] }
  | { type: "DELETE_SELECTED"; hotspots: Hotspot[] }
  | { type: "RENAME"; hotspots: Hotspot[] }
  | { type: "CLEAR" }
  | { type: "TOGGLE_SELECT"; id: string }
  | { type: "SET_SIDEBAR_TAB"; tab: SidebarTab };

const STORAGE_KEY = "n-apt-hotspots";

function loadHotspotsFromStorage(): Hotspot[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed: Hotspot[] = JSON.parse(stored);
    return parsed.map((hotspot) => {
      const isLegacyWorldFrame =
        hotspot.position[1] > 1.2 || hotspot.target[1] > 1.2;

      if (!isLegacyWorldFrame) {
        return hotspot;
      }

      return {
        ...hotspot,
        position: [
          hotspot.position[0],
          hotspot.position[1] - MODEL_ROOT_POSITION[1],
          hotspot.position[2],
        ],
        target: [
          hotspot.target[0],
          hotspot.target[1] - MODEL_ROOT_POSITION[1],
          hotspot.target[2],
        ],
      };
    });
  } catch {
    return [];
  }
}

function saveHotspotsToStorage(hotspots: Hotspot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hotspots));
  } catch (error) {
    console.error("Failed to save hotspots to localStorage:", error);
  }
}

const INITIAL_HOTSPOT_STATE: HotspotState = {
  hotspots: [],
  selectedHotspot: null,
  newHotspotName: "",
  symmetryMode: "none",
  showGrid: true,
  hotspotSize: "small",
  isMultiSelectMode: false,
  multiSelectedHotspots: [],
  sidebarTab: "select-areas",
};

function hotspotReducer(
  state: HotspotState,
  action: HotspotAction,
): HotspotState {
  switch (action.type) {
    case "SET_HOTSPOTS":
      return { ...state, hotspots: action.hotspots };
    case "SET_SELECTED":
      return { ...state, selectedHotspot: action.id };
    case "SET_NAME":
      return { ...state, newHotspotName: action.name };
    case "SET_SYMMETRY":
      return { ...state, symmetryMode: action.mode };
    case "SET_GRID":
      return { ...state, showGrid: action.show };
    case "SET_SIZE":
      return { ...state, hotspotSize: action.size };
    case "SET_MULTI_SELECT":
      return { ...state, isMultiSelectMode: action.mode };
    case "SET_MULTI_SELECTED":
      return { ...state, multiSelectedHotspots: action.ids };
    case "ADD_HOTSPOT":
      return {
        ...state,
        hotspots: action.hotspots,
        ...(action.resetName && { newHotspotName: "" }),
      };
    case "DELETE_HOTSPOT":
      return { ...state, hotspots: action.hotspots };
    case "DELETE_SELECTED":
      return { ...state, hotspots: action.hotspots, multiSelectedHotspots: [] };
    case "RENAME":
      return { ...state, hotspots: action.hotspots };
    case "CLEAR":
      return { ...state, hotspots: [] };
    case "TOGGLE_SELECT":
      return {
        ...state,
        multiSelectedHotspots: state.multiSelectedHotspots.includes(action.id)
          ? state.multiSelectedHotspots.filter((hid) => hid !== action.id)
          : [...state.multiSelectedHotspots, action.id],
      };
    case "SET_SIDEBAR_TAB":
      return { ...state, sidebarTab: action.tab };
  }
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
  handleClear: () => void;
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
}

const HotspotEditorContext = createContext<
  HotspotEditorContextType | undefined
>(undefined);

interface HotspotEditorProviderProps {
  children: ReactNode;
  onHotspotsChange?: (hotspots: Hotspot[]) => void;
}

export const HotspotEditorProvider: React.FC<HotspotEditorProviderProps> = ({
  children,
  onHotspotsChange,
}) => {
  const [state, dispatch] = useReducer(hotspotReducer, {
    ...INITIAL_HOTSPOT_STATE,
    hotspots: loadHotspotsFromStorage(),
  });

  useEffect(() => {
    saveHotspotsToStorage(state.hotspots);
  }, [state.hotspots]);

  const setHotspots = useCallback(
    (hotspots: Hotspot[]) => dispatch({ type: "SET_HOTSPOTS", hotspots }),
    [],
  );

  const setSelectedHotspot = useCallback(
    (id: string | null) => dispatch({ type: "SET_SELECTED", id }),
    [],
  );

  const setNewHotspotName = useCallback(
    (name: string) => dispatch({ type: "SET_NAME", name }),
    [],
  );

  const setSymmetryMode = useCallback(
    (mode: "none" | "x" | "y") => dispatch({ type: "SET_SYMMETRY", mode }),
    [],
  );

  const setShowGrid = useCallback(
    (show: boolean) => dispatch({ type: "SET_GRID", show }),
    [],
  );

  const setHotspotSize = useCallback(
    (size: "small" | "large") => dispatch({ type: "SET_SIZE", size }),
    [],
  );

  const setIsMultiSelectMode = useCallback(
    (mode: boolean) => dispatch({ type: "SET_MULTI_SELECT", mode }),
    [],
  );

  const setMultiSelectedHotspots = useCallback(
    (ids: string[]) => dispatch({ type: "SET_MULTI_SELECTED", ids }),
    [],
  );

  const handleAddHotspot = useCallback(
    (point: { x: number; y: number; z: number }) => {
      const id = Date.now().toString();
      const name = state.newHotspotName || `Point ${state.hotspots.length + 1}`;

      const newHotspot: Hotspot = {
        id,
        name,
        position: [point.x, point.y, point.z],
        target: [point.x, point.y, point.z],
        meshName: "human_model_afro_male",
        size: state.hotspotSize,
      };

      let updatedHotspots = [...state.hotspots, newHotspot];

      if (state.symmetryMode === "x") {
        const symmetricalHotspot: Hotspot = {
          id: `${id}_sym_x`,
          name: `${name} (Left)`,
          position: [-point.x, point.y, point.z],
          target: [-point.x, point.y, point.z],
          meshName: "human_model_afro_male",
          size: state.hotspotSize,
        };
        newHotspot.name = `${name} (Right)`;
        updatedHotspots = [...updatedHotspots, symmetricalHotspot];
      } else if (state.symmetryMode === "y") {
        const symmetricalHotspot: Hotspot = {
          id: `${id}_sym_y`,
          name: `${name} (Bottom)`,
          position: [point.x, -point.y, point.z],
          target: [point.x, -point.y, point.z],
          meshName: "human_model_afro_male",
          size: state.hotspotSize,
        };
        newHotspot.name = `${name} (Top)`;
        updatedHotspots = [...updatedHotspots, symmetricalHotspot];
      }

      dispatch({
        type: "ADD_HOTSPOT",
        hotspots: updatedHotspots,
        resetName: true,
      });
      onHotspotsChange?.(updatedHotspots);
    },
    [
      state.hotspots,
      state.newHotspotName,
      state.symmetryMode,
      state.hotspotSize,
      onHotspotsChange,
    ],
  );

  const handleDeleteHotspot = useCallback(
    (id: string) => {
      const updatedHotspots = state.hotspots.filter((h) => h.id !== id);
      dispatch({ type: "DELETE_HOTSPOT", hotspots: updatedHotspots });
      onHotspotsChange?.(updatedHotspots);
    },
    [state.hotspots, onHotspotsChange],
  );

  const handleDeleteSelected = useCallback(() => {
    const updatedHotspots = state.hotspots.filter(
      (h) => !state.multiSelectedHotspots.includes(h.id),
    );
    dispatch({ type: "DELETE_SELECTED", hotspots: updatedHotspots });
    onHotspotsChange?.(updatedHotspots);
  }, [state.hotspots, state.multiSelectedHotspots, onHotspotsChange]);

  const handleToggleSelect = useCallback(
    (id: string) => {
      if (state.isMultiSelectMode) {
        dispatch({ type: "TOGGLE_SELECT", id });
      } else {
        dispatch({ type: "SET_SELECTED", id });
      }
    },
    [state.isMultiSelectMode],
  );

  const handleHotspotClick = useCallback(
    (id: string) => {
      if (state.isMultiSelectMode) {
        handleToggleSelect(id);
      } else {
        dispatch({ type: "SET_SELECTED", id });
      }
    },
    [state.isMultiSelectMode, handleToggleSelect],
  );

  const handleRename = useCallback(
    (id: string, newName: string) => {
      const updatedHotspots = state.hotspots.map((h) =>
        h.id === id ? { ...h, name: newName } : h,
      );
      dispatch({ type: "RENAME", hotspots: updatedHotspots });
      onHotspotsChange?.(updatedHotspots);
    },
    [state.hotspots, onHotspotsChange],
  );

  const setSidebarTab = useCallback(
    (tab: SidebarTab) => dispatch({ type: "SET_SIDEBAR_TAB", tab }),
    [],
  );

  const handleClear = useCallback(() => {
    dispatch({ type: "CLEAR" });
    onHotspotsChange?.([]);
  }, [onHotspotsChange]);

  const contextValue = useMemo<HotspotEditorContextType>(
    () => ({
      ...state,
      setHotspots,
      setSelectedHotspot,
      setNewHotspotName,
      setSymmetryMode,
      setShowGrid,
      setHotspotSize,
      setIsMultiSelectMode,
      setMultiSelectedHotspots,
      handleAddHotspot,
      handleDeleteHotspot,
      handleDeleteSelected,
      handleToggleSelect,
      handleHotspotClick,
      handleRename,
      handleClear,
      sidebarTab: state.sidebarTab,
      setSidebarTab,
    }),
    [
      state,
      setHotspots,
      setSelectedHotspot,
      setNewHotspotName,
      setSymmetryMode,
      setShowGrid,
      setHotspotSize,
      setIsMultiSelectMode,
      setMultiSelectedHotspots,
      handleAddHotspot,
      handleDeleteHotspot,
      handleDeleteSelected,
      handleToggleSelect,
      handleHotspotClick,
      handleRename,
      handleClear,
      setSidebarTab,
    ],
  );

  return React.createElement(
    HotspotEditorContext.Provider,
    { value: contextValue },
    children,
  );
};

export const useHotspotEditor = (): HotspotEditorContextType => {
  const context = useContext(HotspotEditorContext);
  if (context === undefined) {
    throw new Error(
      "useHotspotEditor must be used within a HotspotEditorProvider",
    );
  }
  return context;
};

export type { Hotspot, SidebarTab };
