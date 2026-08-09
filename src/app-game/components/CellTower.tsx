import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'

export type TowerType = 'roof' | 'pole' | 'hexagon' | 'diamond'

export function CellTower({
  position,
  type = 'roof',
  register = true
}: {
  position: [number, number, number]
  type?: TowerType
  register?: boolean
}) {
  const addCellTower = useStore((state) => state.addCellTower)
  const id = useMemo(() => Math.random().toString(36).substring(7), [])

  useEffect(() => {
    if (!register) return
    // The spotlight will originate from the top of the tower
    let towerHeight = 4
    if (type === 'roof') towerHeight = 4
    else if (type === 'pole') towerHeight = 8
    else if (type === 'hexagon') towerHeight = 9.5
    else if (type === 'diamond') towerHeight = 4

    const topPosition = new THREE.Vector3(position[0], position[1] + towerHeight, position[2])
    addCellTower({ id, position: topPosition, type })
  }, [position, type, id, addCellTower, register])

  return (
    <group position={position}>
      {type === 'roof' && (
        <>
          {/* Base structure */}
          <mesh position={[0, 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.2, 0.2, 4, 8]} />
            <meshStandardMaterial color="#555555" />
          </mesh>
          {/* Antennas */}
          <mesh position={[0, 3.5, 0]} castShadow>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#888888" />
          </mesh>
          <mesh position={[0.6, 3.5, 0]} castShadow>
            <boxGeometry args={[0.2, 1.5, 0.5]} />
            <meshStandardMaterial color="#dddddd" />
          </mesh>
          <mesh position={[-0.6, 3.5, 0]} castShadow>
            <boxGeometry args={[0.2, 1.5, 0.5]} />
            <meshStandardMaterial color="#dddddd" />
          </mesh>
          <mesh position={[0, 3.5, 0.6]} castShadow>
            <boxGeometry args={[0.5, 1.5, 0.2]} />
            <meshStandardMaterial color="#dddddd" />
          </mesh>
          {/* Red beacon light */}
          <mesh position={[0, 4.5, 0]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={2} />
          </mesh>
        </>
      )}

      {type === 'pole' && (
        <>
          {/* Tall Monopole */}
          <mesh position={[0, 4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.3, 0.5, 8, 16]} />
            <meshStandardMaterial color="#666666" />
          </mesh>
          {/* Antenna Ring */}
          <mesh position={[0, 7.5, 0]} castShadow>
            <cylinderGeometry args={[1, 1, 0.2, 16]} />
            <meshStandardMaterial color="#444444" />
          </mesh>
          {/* Antennas */}
          {[0, Math.PI * 2 / 3, Math.PI * 4 / 3].map((angle, i) => (
            <mesh key={i} position={[Math.cos(angle) * 1.2, 7.5, Math.sin(angle) * 1.2]} rotation={[0, -angle, 0]} castShadow>
              <boxGeometry args={[0.2, 2, 0.6]} />
              <meshStandardMaterial color="#dddddd" />
            </mesh>
          ))}
          {/* Red beacon light */}
          <mesh position={[0, 8.5, 0]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={2} />
          </mesh>
        </>
      )}

      {type === 'hexagon' && (
        <>
          {/* Base square pole */}
          <mesh position={[0, 4, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.4, 8, 0.4]} />
            <meshStandardMaterial color="#666666" />
          </mesh>
          {/* Hexagon block */}
          <mesh position={[0, 7, 0]} rotation={[0, Math.PI / 6, 0]} castShadow>
            <cylinderGeometry args={[1.2, 1.2, 2.5, 6]} />
            <meshStandardMaterial color="#dddddd" />
          </mesh>
          {/* Top square pole */}
          <mesh position={[0, 8.75, 0]} castShadow>
            <boxGeometry args={[0.3, 1.5, 0.3]} />
            <meshStandardMaterial color="#666666" />
          </mesh>
          {/* Red beacon light */}
          <mesh position={[0, 9.6, 0]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={2} />
          </mesh>
        </>
      )}

      {type === 'diamond' && (
        <>
          {/* Short square pole */}
          <mesh position={[0, 1, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.3, 2, 0.3]} />
            <meshStandardMaterial color="#444444" />
          </mesh>
          {/* Diamond panel */}
          <mesh position={[0, 2.5, 0]} rotation={[0, 0, Math.PI / 4]} castShadow>
            <boxGeometry args={[2, 2, 0.2]} />
            <meshStandardMaterial color="#dddddd" />
          </mesh>
          {/* Red beacon light */}
          <mesh position={[0, 4.2, 0]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={2} />
          </mesh>
        </>
      )}
    </group>
  )
}
