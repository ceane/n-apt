import { useState } from 'react'
import { useStore } from '../store'
import { ChevronDown, ChevronUp } from 'lucide-react'

export function Minimap() {
  const playerPosition = useStore((state) => state.playerPosition)
  const cellTowers = useStore((state) => state.cellTowers)
  const buildings = useStore((state) => state.buildings)
  const activeTowers = useStore((state) => state.activeTowers)
  const warmUpTowers = useStore((state) => state.warmUpTowers)

  const [isDescOpen, setIsDescOpen] = useState(true)
  const [isControlsOpen, setIsControlsOpen] = useState(true)

  return (
    <div className="absolute top-4 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none">
      <div className="bg-black/70 p-2 rounded-lg border border-white/20 backdrop-blur-sm w-64 pointer-events-auto">
        <svg width="100%" height="100%" viewBox="-200 -200 400 400" className="bg-gray-900 rounded aspect-square">
          {/* Buildings */}
          {buildings.map((b, i) => (
            <rect
              key={i}
              x={b.position[0] - b.size[0] / 2}
              y={b.position[2] - b.size[2] / 2}
              width={b.size[0]}
              height={b.size[2]}
              fill="#4b5563"
              opacity="0.8"
            />
          ))}

          {/* Towers */}
          {cellTowers.map((t) => {
            const activeIndex = activeTowers.indexOf(t.id)
            const isTracking = activeIndex !== -1
            const isWarmUp = warmUpTowers.includes(t.id)

            const colors = ['#00ffff', '#ff00ff', '#ffff00', '#00ffff', '#ff00ff', '#ffff00'] // 6 towers for hexagon
            let color = "#60a5fa"
            let opacity = 0.5
            let radius = 2

            if (isTracking) {
              color = colors[activeIndex]
              opacity = 1
              radius = 4
            } else if (isWarmUp) {
              color = "#f97316" // Orange for warm-up
              opacity = 0.8
              radius = 3
            }

            return (
              <circle
                key={t.id}
                cx={t.position.x}
                cy={t.position.z}
                r={radius}
                fill={color}
                opacity={opacity}
              />
            )
          })}

          {/* Player */}
          <circle
            cx={playerPosition.x}
            cy={playerPosition.z}
            r="4"
            fill="#ef4444"
          />
        </svg>
      </div>

      {/* Interactive Info Box */}
      <div className="bg-black/70 rounded-lg border border-white/20 backdrop-blur-sm w-64 overflow-hidden pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsDescOpen(prev => !prev)}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors cursor-pointer"
        >
          <h1 className="text-lg font-bold text-cyan-400">Tracked!</h1>
          {isDescOpen ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
        </button>

        {isDescOpen && (
          <div className="p-3 pt-0 text-sm">
            <p className="mb-3 text-gray-300">A 3D city block simulation where the 6 nearest cell towers form a stable hexagon triangulation tracking the player.</p>
            <div className="flex flex-col gap-1.5 text-xs text-gray-400">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span> Player</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-cyan-400 inline-block shadow-[0_0_8px_#00ffff]"></span> Active Tower (Cyan) - 2 towers</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-fuchsia-400 inline-block shadow-[0_0_8px_#ff00ff]"></span> Active Tower (Magenta) - 2 towers</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-yellow-400 inline-block shadow-[0_0_8px_#ffff00]"></span> Active Tower (Yellow) - 2 towers</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-500 inline-block shadow-[0_0_8px_#f97316]"></span> Warm-up Tower</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-400 opacity-50 inline-block"></span> Inactive Tower</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 bg-gray-600 inline-block"></span> Building</div>
            </div>
          </div>
        )}
      </div>

      {/* Controls Box */}
      <div className="bg-black/70 rounded-lg border border-white/20 backdrop-blur-sm w-64 overflow-hidden pointer-events-auto">
        <button
          type="button"
          onClick={() => setIsControlsOpen(prev => !prev)}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors cursor-pointer"
        >
          <h2 className="text-md font-bold text-white">Controls</h2>
          {isControlsOpen ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
        </button>

        {isControlsOpen && (
          <div className="p-3 pt-0 text-sm">
            <ul className="list-disc pl-4 text-gray-300 space-y-1.5">
              <li>Use <span className="font-bold text-white">Arrow Keys</span> or <span className="font-bold text-white">WASD</span> to move.</li>
              <li><span className="font-bold text-white">Left Click & Drag</span> to orbit camera.</li>
              <li>Scroll to zoom in/out.</li>
              <li>Press <span className="font-bold text-white">ESC</span> or <span className="font-bold text-white">P</span> to pause/unpause.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
