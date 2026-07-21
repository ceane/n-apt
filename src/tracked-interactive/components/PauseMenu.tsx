import { useEffect, useState, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { TowerType, CellTower } from './CellTower'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import * as THREE from 'three'

interface TowerDisplay {
  type: TowerType
  name: string
  description: string
}

interface TowerStats {
  type: TowerType
  total: number
  active: number
  nearest?: {
    distance: number
    position: THREE.Vector3
  }
}

export function PauseMenu({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const { playerPosition, cellTowers, activeTowers } = useStore()

  const towers: TowerDisplay[] = [
    {
      type: 'roof',
      name: 'Roof Tower',
      description: 'rooftop installations'
    },
    {
      type: 'pole',
      name: 'Monopole Tower',
      description: 'highway routes'
    },
    {
      type: 'hexagon',
      name: 'Hexagonal Tower',
      description: 'industrial areas'
    },
    {
      type: 'diamond',
      name: 'Diamond Panel Tower',
      description: 'urban centers'
    }
  ]

  // Calculate real-time tower stats from actual game data
  const towerStats = useMemo(() => {
    const stats: Record<TowerType, TowerStats> = {
      hexagon: { type: 'hexagon', total: 0, active: 0 },
      roof: { type: 'roof', total: 0, active: 0 },
      pole: { type: 'pole', total: 0, active: 0 },
      diamond: { type: 'diamond', total: 0, active: 0 }
    }

    // Use actual tower data from the store
    cellTowers.forEach((tower) => {
      stats[tower.type].total++

      // Check if this tower is active
      const isActive = activeTowers.includes(tower.id)
      if (isActive) {
        stats[tower.type].active++

        // Calculate distance from player
        const distance = playerPosition.distanceTo(tower.position)
        if (!stats[tower.type].nearest || distance < stats[tower.type].nearest!.distance) {
          stats[tower.type].nearest = {
            distance,
            position: tower.position
          }
        }
      }
    })

    return stats
  }, [cellTowers, activeTowers, playerPosition])

  const currentTower = towers[currentIndex]
  const currentStats = towerStats[currentTower.type]

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + towers.length) % towers.length)
  }

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % towers.length)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft') {
        handlePrevious()
      } else if (e.key === 'ArrowRight') {
        handleNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-[100]">
      {/* Full Viewport Carousel */}
      <div className="relative w-full h-full">
        <Canvas camera={{ position: [0, 15, 25], fov: 40 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[10, 10, 5]} intensity={1.5} />
          <directionalLight position={[-10, -10, -5]} intensity={0.5} />

          <group position={[0, -3, 0]} scale={0.8}>
            <CellTower position={[0, 0, 0]} type={currentTower.type} register={false} />
          </group>

          <OrbitControls
            enableZoom={true}
            enablePan={false}
            minDistance={15}
            maxDistance={40}
            autoRotate
            autoRotateSpeed={2}
            maxPolarAngle={Math.PI / 2.2}
            minPolarAngle={Math.PI / 3}
          />
        </Canvas>

        {/* Navigation Arrows */}
        <button
          onClick={handlePrevious}
          className="absolute left-8 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-4 rounded-full transition-all hover:scale-110 z-20"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
        <button
          onClick={handleNext}
          className="absolute right-8 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white p-4 rounded-full transition-all hover:scale-110 z-20"
        >
          <ChevronRight className="w-8 h-8" />
        </button>

        {/* Tower Counter */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/60 px-6 py-3 rounded-full z-20">
          <span className="text-white text-lg font-semibold">
            {currentIndex + 1} / {towers.length}
          </span>
        </div>

        {/* Overlay Tower Information */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black-60 to-transparent p-8 z-10">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-bold text-white mb-2 text-center" style={{ fontFamily: 'DynaPuff', fontWeight: 500 }}>{currentTower.name}</h2>
            <p className="text-gray-300 text-xl mb-6 text-center" style={{ fontFamily: 'Ubuntu Mono' }}>({currentTower.description})</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xl mb-6" style={{ fontFamily: 'Ubuntu Mono' }}>
              <div className="text-center">
                <div className="text-gray-400 mb-1">Total towers</div>
                <div className="text-white font-semibold">{currentStats.active} / {currentStats.total}</div>
              </div>
              <div className="text-center">
                <div className="text-gray-400 mb-1">Status</div>
                <div className={`font-semibold ${currentStats.active > 0 ? 'text-green-400' : 'text-gray-500'
                  }`}>
                  {currentStats.active > 0 ? `${currentStats.active} active` : 'Inactive'}
                </div>
              </div>
              <div className="text-center min-h-[2rem]">
                <div className="text-gray-400 mb-1">Nearest tower</div>
                {currentStats.nearest ? (
                  <div>
                    <div className="text-green-400 font-semibold">
                      {currentStats.nearest.distance.toFixed(1)}m away
                    </div>
                    <div className="text-green-400 text-sm">
                      ({currentStats.nearest.position.x.toFixed(0)}, {currentStats.nearest.position.z.toFixed(0)})
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 font-semibold">No active towers</div>
                )}
              </div>
            </div>

            {/* Close Instructions */}
            <div className="pt-4 border-t border-gray-600 text-center">
              <p className="text-gray-400 text-base" style={{ fontFamily: 'Ubuntu Mono' }}>
                Press <span className="text-white font-mono">ESC</span> or <span className="text-white font-mono">P</span> to toggle pause •
                Use <span className="text-white font-mono">← →</span> arrows to navigate
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
