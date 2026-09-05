import { create } from 'zustand'
import * as THREE from 'three'

export interface BuildingData {
  position: [number, number, number]
  size: [number, number, number]
  color: string
}

export interface CellTowerData {
  id: string
  position: THREE.Vector3
  type: 'roof' | 'pole' | 'hexagon' | 'diamond'
}

interface AppState {
  playerPosition: THREE.Vector3
  setPlayerPosition: (pos: THREE.Vector3) => void
  cellTowers: CellTowerData[]
  addCellTower: (tower: CellTowerData) => void
  buildings: BuildingData[]
  setBuildings: (buildings: BuildingData[]) => void
  activeTowers: string[]
  setActiveTowers: (ids: string[]) => void
  warmUpTowers: string[]
  setWarmUpTowers: (ids: string[]) => void
  isPaused: boolean
  setIsPaused: (paused: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  playerPosition: new THREE.Vector3(0, 0, 0),
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
  cellTowers: [],
  addCellTower: (tower) => set((state) => ({ cellTowers: [...state.cellTowers, tower] })),
  buildings: [],
  setBuildings: (buildings) => set({ buildings }),
  activeTowers: [],
  setActiveTowers: (ids) => set({ activeTowers: ids }),
  warmUpTowers: [],
  setWarmUpTowers: (ids) => set({ warmUpTowers: ids }),
  isPaused: false,
  setIsPaused: (paused) => set({ isPaused: paused }),
}))

