import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useStore, BuildingData } from '../store'
import { CellTower, TowerType } from './CellTower'

export function City() {
  const setBuildings = useStore((state) => state.setBuildings)

  const blocks = useMemo(() => {
    const items: any[] = []
    const buildingsData: BuildingData[] = []
    const blockSize = 80 // Increased from 40 for wider streets
    const numBlocks = 5
    const offset = (numBlocks * blockSize) / 2

    for (let x = 0; x < numBlocks; x++) {
      for (let z = 0; z < numBlocks; z++) {
        const blockX = x * blockSize - offset + blockSize / 2
        const blockZ = z * blockSize - offset + blockSize / 2

        // 4 quadrants per block to create a central alley
        const quadrants = [
          { cx: -18, cz: -18 },
          { cx: 18, cz: -18 },
          { cx: -18, cz: 18 },
          { cx: 18, cz: 18 },
        ]

        quadrants.forEach((quad, i) => {
          // Building size between 15 and 25
          const bWidth = 15 + Math.random() * 10
          const bDepth = 15 + Math.random() * 10
          // Height at least 6 (1.5x character height of ~3)
          const bHeight = 6 + Math.random() * 34

          // Position within the quadrant
          const bx = blockX + quad.cx + (Math.random() * 4 - 2)
          const bz = blockZ + quad.cz + (Math.random() * 4 - 2)
          const color = `hsl(${Math.random() * 360}, 10%, ${20 + Math.random() * 30}%)`

          const hasTower = Math.random() > 0.7
          let towerType: TowerType = 'roof'
          if (hasTower) {
            const rand = Math.random()
            if (rand > 0.66) towerType = 'diamond'
            else if (rand > 0.33) towerType = 'hexagon'
            else towerType = 'roof'
          }

          items.push({
            type: 'building',
            position: [bx, bHeight / 2, bz],
            args: [bWidth, bHeight, bDepth],
            color,
            hasTower,
            towerType,
            towerPos: [bx, bHeight, bz]
          })

          buildingsData.push({
            position: [bx, bHeight / 2, bz],
            size: [bWidth, bHeight, bDepth],
            color
          })
        })

        // Add a street pole cell tower at the corner of the block
        if (Math.random() > 0.3) {
          const poleType: TowerType = Math.random() > 0.5 ? 'hexagon' : 'pole'
          items.push({
            type: 'pole',
            poleType,
            position: [blockX + blockSize / 2 - 5, 0, blockZ + blockSize / 2 - 5]
          })
        }
      }
    }

    // Add boundary towers to ensure triangulation is always possible at the edges
    const boundary = 250
    items.push({ type: 'pole', poleType: 'pole', position: [-boundary, 0, -boundary] })
    items.push({ type: 'pole', poleType: 'pole', position: [boundary, 0, -boundary] })
    items.push({ type: 'pole', poleType: 'pole', position: [-boundary, 0, boundary] })
    items.push({ type: 'pole', poleType: 'pole', position: [boundary, 0, boundary] })

    return { items, buildingsData }
  }, [])

  useEffect(() => {
    setBuildings(blocks.buildingsData)
  }, [blocks, setBuildings])

  return (
    <group>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#222222" />
      </mesh>

      {/* Buildings and Towers */}
      {blocks.items.map((item, i) => {
        if (item.type === 'building') {
          return (
            <group key={i}>
              <mesh
                position={item.position as [number, number, number]}
                castShadow
                receiveShadow
                userData={{ isBuilding: true }}
              >
                <boxGeometry args={item.args as [number, number, number]} />
                <meshStandardMaterial color={item.color as string} transparent opacity={1} />
              </mesh>
              {item.hasTower && (
                <CellTower position={item.towerPos as [number, number, number]} type={item.towerType as TowerType} />
              )}
            </group>
          )
        } else if (item.type === 'pole') {
          return <CellTower key={i} position={item.position as [number, number, number]} type={item.poleType as TowerType} />
        }
        return null
      })}
    </group>
  )
}
