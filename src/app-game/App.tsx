/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { Player } from './components/Player'
import { City } from './components/City'
import { SpotlightSystem } from './components/SpotlightSystem'
import { Minimap } from './components/Minimap'
import { PauseMenu } from './components/PauseMenu'
import { useStore } from './store'
import { useEffect } from 'react'

export default function App() {
  const isPaused = useStore((state) => state.isPaused)
  const setIsPaused = useStore((state) => state.setIsPaused)

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        setIsPaused(!isPaused)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isPaused, setIsPaused])

  return (
    <div className="relative w-full h-screen bg-[#1a2035] overflow-hidden">
      <Minimap />
      {/* Pause Button */}
      {/* Pause/Unpause Button */}
      <button
        className={`absolute top-4 left-4 backdrop-blur-md px-4 py-2 rounded-lg text-white text-sm transition-colors z-[150] ${isPaused
          ? 'bg-green-600/20 hover:bg-green-600/30 border border-green-500/50'
          : 'bg-white/10 hover:bg-white/20'
          }`}
        onClick={() => setIsPaused(!isPaused)}
      >
        {isPaused ? 'Resume' : 'Pause'}
      </button>
      <PauseMenu isOpen={isPaused} onClose={() => setIsPaused(false)} />
      <Canvas
        shadows
        camera={{ position: [0, 8, 12], fov: 50 }}
        gl={{ localClippingEnabled: true }}
        frameloop={isPaused ? 'never' : 'always'}
        onPointerDown={(e) => {
          // Only capture pointer events for game interaction, not page scrolling
          if (e.button === 0) { // Left click only
            (e.target as Element).setPointerCapture(e.pointerId)
          }
        }}
        onPointerUp={(e) => {
          if (e.button === 0) {
            (e.target as Element).releasePointerCapture(e.pointerId)
          }
        }}
        onWheel={(e) => {
          // Prevent canvas from capturing wheel events unless specifically needed
          e.stopPropagation()
        }}
      >
        {/* Brighter twilight sky */}
        <color attach="background" args={['#1a2035']} />
        <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />

        {/* Brighter ambient light */}
        <ambientLight intensity={0.6} />

        {/* Brighter Moonlight/Sunlight */}
        <directionalLight
          position={[50, 50, -50]}
          intensity={1.2}
          color="#eef5ff"
          castShadow
          shadow-mapSize={[2048, 2048]}
        >
          <orthographicCamera attach="shadow-camera" args={[-100, 100, 100, -100, 1, 200]} />
        </directionalLight>

        <City />
        <Player />
        <SpotlightSystem />

        {/* Fog to hide the edges of the city */}
        <fog attach="fog" args={['#1a2035', 40, 150]} />
      </Canvas>
    </div>
  )
}
