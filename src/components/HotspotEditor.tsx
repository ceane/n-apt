import React, { useState, useRef, useCallback, useMemo } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Mesh, Vector3, Vector2, Material, MeshStandardMaterial, Raycaster } from 'three'

interface Hotspot {
  id: string
  name: string
  position: [number, number, number]
  target: [number, number, number]
  meshName: string
  size: 'small' | 'large'
  selected?: boolean
}

interface HotspotEditorProps {
  onHotspotsChange: (hotspots: Hotspot[]) => void
}

function ClickHandler({ onAddHotspot }: { onAddHotspot: (point: Vector3) => void }) {
  const { camera, gl, scene } = useThree()
  const raycaster = useRef(new Raycaster())
  
  const handleClick = useCallback((event: any) => {
    try {
      const rect = gl.domElement.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      
      raycaster.current.setFromCamera(new Vector2(x, y), camera)
      
      const intersects = raycaster.current.intersectObjects(scene.children, true)
      
      if (intersects.length > 0) {
        const point = intersects[0].point
        if (point && typeof point.x === 'number') {
          onAddHotspot(new Vector3(point.x, point.y, point.z))
        }
      }
    } catch (error) {
      console.error('Error handling click:', error)
    }
  }, [camera, gl, scene, onAddHotspot])
  
  useFrame(() => {
    gl.domElement.addEventListener('click', handleClick)
    return () => {
      gl.domElement.removeEventListener('click', handleClick)
    }
  })
  
  return null
}

function Model({ hotspots, onAddHotspot }: { hotspots: Hotspot[], onAddHotspot: (point: Vector3) => void }) {
  const { scene } = useGLTF('/glb_models/androgynous_body.glb')
  
  return (
    <>
      <primitive 
        object={scene} 
      />
      <ClickHandler onAddHotspot={onAddHotspot} />
    </>
  )
}

function HotspotMarker({ hotspot, onClick, onDelete, onRename, isSelected, isMultiSelected, onToggleSelect }: { 
  hotspot: Hotspot, 
  onClick: () => void, 
  onDelete: () => void, 
  onRename: (id: string, newName: string) => void,
  isSelected: boolean,
  isMultiSelected: boolean,
  onToggleSelect: (id: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(hotspot.name)

  const handleRename = () => {
    if (editName.trim()) {
      onRename(hotspot.id, editName.trim())
    }
    setIsEditing(false)
  }

  const size = hotspot.size === 'large' ? 0.08 : 0.02
  const baseColor = hotspot.size === 'large' ? '#00d4ff' : '#ffaa00'
  const color = isMultiSelected ? '#ff6b6b' : (isSelected ? '#ffffff' : baseColor)
  

  return (
    <group position={hotspot.position}>
      <mesh onClick={onClick}>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      {isSelected && (
        <group position={[0, size + 0.05, 0]}>
          <mesh>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshStandardMaterial color="#ffaa00" emissive="#ffaa00" emissiveIntensity={0.8} />
          </mesh>
          <mesh position={[0, 0.05, 0]} onClick={(e) => { e.stopPropagation(); setIsEditing(true) }}>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.8} />
          </mesh>
        </group>
      )}
      {isEditing && (
        <group position={[0, size + 0.15, 0]}>
          <mesh>
            <planeGeometry args={[0.3, 0.1, 0.01]} />
            <meshStandardMaterial color="#1a1a1a" />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename()
                } else if (e.key === 'Escape') {
                  setIsEditing(false)
                  setEditName(hotspot.name)
                }
              }}
              onBlur={handleRename}
              style={{
                position: 'absolute',
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: '10px',
                textAlign: 'center',
                width: '100%',
                outline: 'none'
              }}
              autoFocus
            />
          </mesh>
        </group>
      )}
    </group>
  )
}

const HotspotEditor: React.FC<HotspotEditorProps> = ({ onHotspotsChange }) => {
  const [hotspots, setHotspots] = useState<Hotspot[]>([])
  const [selectedHotspot, setSelectedHotspot] = useState<string | null>(null)
  const [newHotspotName, setNewHotspotName] = useState('')
  const [symmetryMode, setSymmetryMode] = useState<'none' | 'x' | 'y'>('none')
  const [showGrid, setShowGrid] = useState(true)
  const [hotspotSize, setHotspotSize] = useState<'small' | 'large'>('small')
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [multiSelectedHotspots, setMultiSelectedHotspots] = useState<string[]>([])

  const handleAddHotspot = useCallback((point: Vector3) => {
    const id = Date.now().toString()
    const name = newHotspotName || `Point ${hotspots.length + 1}`
    
    const newHotspot: Hotspot = {
      id,
      name,
      position: [point.x, point.y, point.z],
      target: [point.x, point.y, point.z],
      meshName: "o_ADBody",
      size: hotspotSize
    }

    let updatedHotspots = [...hotspots, newHotspot]

    // Add symmetrical points if enabled
    if (symmetryMode === 'x') {
      const symmetricalHotspot: Hotspot = {
        id: `${id}_sym_x`,
        name: `${name} (Left)`,
        position: [-point.x, point.y, point.z],
        target: [-point.x, point.y, point.z],
        meshName: "o_ADBody",
        size: hotspotSize
      }
      newHotspot.name = `${name} (Right)`
      updatedHotspots = [...updatedHotspots, symmetricalHotspot]
    } else if (symmetryMode === 'y') {
      const symmetricalHotspot: Hotspot = {
        id: `${id}_sym_y`,
        name: `${name} (Bottom)`,
        position: [point.x, -point.y, point.z],
        target: [point.x, -point.y, point.z],
        meshName: "o_ADBody",
        size: hotspotSize
      }
      newHotspot.name = `${name} (Top)`
      updatedHotspots = [...updatedHotspots, symmetricalHotspot]
    }

    setHotspots(updatedHotspots)
    onHotspotsChange(updatedHotspots)
    setNewHotspotName('')
  }, [hotspots, newHotspotName, symmetryMode, onHotspotsChange])

  const handleDeleteHotspot = useCallback((id: string) => {
    const updatedHotspots = hotspots.filter(h => h.id !== id)
    setHotspots(updatedHotspots)
    onHotspotsChange(updatedHotspots)
  }, [hotspots, onHotspotsChange])

  const handleDeleteSelected = useCallback(() => {
    const updatedHotspots = hotspots.filter(h => !multiSelectedHotspots.includes(h.id))
    setHotspots(updatedHotspots)
    onHotspotsChange(updatedHotspots)
    setMultiSelectedHotspots([])
  }, [hotspots, multiSelectedHotspots, onHotspotsChange])

  const handleToggleSelect = useCallback((id: string) => {
    if (isMultiSelectMode) {
      setMultiSelectedHotspots(prev => 
        prev.includes(id) 
          ? prev.filter(hid => hid !== id)
          : [...prev, id]
      )
    } else {
      setSelectedHotspot(id)
    }
  }, [isMultiSelectMode])

  const handleHotspotClick = useCallback((id: string) => {
    if (isMultiSelectMode) {
      handleToggleSelect(id)
    } else {
      setSelectedHotspot(id)
    }
  }, [isMultiSelectMode, handleToggleSelect])

  const handleExport = useCallback(() => {
    const json = JSON.stringify(hotspots, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'hotspots.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [hotspots])

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target?.result as string)
          setHotspots(imported)
          onHotspotsChange(imported)
        } catch (error) {
          console.error('Failed to import hotspots:', error)
        }
      }
      reader.readAsText(file)
    }
  }, [onHotspotsChange])

  const handleClear = useCallback(() => {
    setHotspots([])
    onHotspotsChange([])
  }, [onHotspotsChange])

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Control Panel */}
      <div style={{ 
        width: '300px', 
        background: '#1a1a1a', 
        padding: '20px', 
        overflowY: 'auto',
        borderRight: '1px solid #333'
      }}>
        <h3 style={{ color: '#00d4ff', marginBottom: '20px' }}>Hotspot Editor</h3>
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Point Name:</label>
          <input
            type="text"
            value={newHotspotName}
            onChange={(e) => setNewHotspotName(e.target.value)}
            placeholder="Enter name..."
            style={{ 
              width: '100%', 
              padding: '8px', 
              background: '#2a2a2a', 
              border: '1px solid #444', 
              color: '#fff',
              borderRadius: '4px'
            }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Hotspot Size:</label>
          <select
            value={hotspotSize}
            onChange={(e) => setHotspotSize(e.target.value as any)}
            style={{ 
              width: '100%', 
              padding: '8px', 
              background: '#2a2a2a', 
              border: '1px solid #444', 
              color: '#fff',
              borderRadius: '4px',
              marginBottom: '10px'
            }}
          >
            <option value="small">Small (Eyes, Ears)</option>
            <option value="large">Large (Joints, Organs)</option>
          </select>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>Symmetry Mode:</label>
          <select
            value={symmetryMode}
            onChange={(e) => setSymmetryMode(e.target.value as any)}
            style={{ 
              width: '100%', 
              padding: '8px', 
              background: '#2a2a2a', 
              border: '1px solid #444', 
              color: '#fff',
              borderRadius: '4px'
            }}
          >
            <option value="none">None</option>
            <option value="x">Left/Right (X-axis)</option>
            <option value="y">Top/Bottom (Y-axis)</option>
          </select>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#ccc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={isMultiSelectMode}
              onChange={(e) => {
                setIsMultiSelectMode(e.target.checked)
                if (!e.target.checked) {
                  setMultiSelectedHotspots([])
                }
              }}
            />
            Multi-Select Mode
          </label>
          {isMultiSelectMode && (
            <div style={{ marginTop: '8px', color: '#666', fontSize: '12px' }}>
              Selected: {multiSelectedHotspots.length} hotspots
            </div>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ color: '#ccc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
            />
            Show Grid
          </label>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={handleExport}
            style={{ 
              width: '100%', 
              padding: '8px', 
              background: '#00d4ff', 
              border: 'none', 
              color: '#000',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '8px'
            }}
          >
            Export JSON
          </button>
          
          <label style={{ color: '#ccc', display: 'block', marginBottom: '5px' }}>
            Import JSON:
          </label>
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            style={{ 
              width: '100%', 
              padding: '8px', 
              background: '#2a2a2a', 
              border: '1px solid #444', 
              color: '#fff',
              borderRadius: '4px'
            }}
          />
        </div>

        {isMultiSelectMode && multiSelectedHotspots.length > 0 && (
          <button
            onClick={handleDeleteSelected}
            style={{ 
              width: '100%', 
              padding: '8px', 
              background: '#ff6b6b', 
              border: 'none', 
              color: '#fff',
              borderRadius: '4px',
              cursor: 'pointer',
              marginBottom: '10px'
            }}
          >
            Delete Selected ({multiSelectedHotspots.length})
          </button>
        )}
        
        <button
          onClick={handleClear}
          style={{ 
            width: '100%', 
            padding: '8px', 
            background: '#ff4444', 
            border: 'none', 
            color: '#fff',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '20px'
          }}
        >
          Clear All
        </button>

        <div>
          <h4 style={{ color: '#00d4ff', marginBottom: '10px' }}>Hotspots ({hotspots.length})</h4>
          {hotspots.map(hotspot => (
            <div
              key={hotspot.id}
              style={{
                background: selectedHotspot === hotspot.id ? '#2a2a2a' : '#1a1a1a',
                border: selectedHotspot === hotspot.id ? '1px solid #00d4ff' : '1px solid #333',
                borderRadius: '4px',
                padding: '8px',
                marginBottom: '8px',
                cursor: 'pointer'
              }}
              onClick={() => setSelectedHotspot(hotspot.id)}
            >
              <div style={{ color: '#ccc', fontWeight: 'bold' }}>{hotspot.name}</div>
              <div style={{ color: '#666', fontSize: '12px' }}>
                [{hotspot.position.map(v => v.toFixed(2)).join(', ')}]
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteHotspot(hotspot.id)
                }}
                style={{
                  marginTop: '4px',
                  padding: '4px 8px',
                  background: '#ff4444',
                  border: 'none',
                  color: '#fff',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 3D Canvas */}
      <div style={{ flex: 1, position: 'relative', paddingBottom: '50px' }}>
        <Canvas
          camera={{ position: [2, 1, 2], fov: 75 }}
          style={{ background: '#0a0a0a' }}
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          
          {showGrid && (
            <gridHelper args={[10, 10, '#333', '#222']} position={[0, -1, 0]} />
          )}
          
          <Model hotspots={hotspots} onAddHotspot={handleAddHotspot} />
          
          {hotspots.map(hotspot => (
            <HotspotMarker
              key={hotspot.id}
              hotspot={hotspot}
              onClick={() => handleHotspotClick(hotspot.id)}
              onDelete={() => handleDeleteHotspot(hotspot.id)}
              onRename={(id: string, newName: string) => {
                const updatedHotspots = hotspots.map((h: Hotspot) => 
                  h.id === id ? { ...h, name: newName } : h
                )
                setHotspots(updatedHotspots)
                onHotspotsChange(updatedHotspots)
              }}
              isSelected={selectedHotspot === hotspot.id}
              isMultiSelected={multiSelectedHotspots.includes(hotspot.id)}
              onToggleSelect={handleToggleSelect}
            />
          ))}
          
          <OrbitControls />
        </Canvas>
        
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          background: 'rgba(0, 0, 0, 0.8)',
          color: '#fff',
          padding: '10px',
          borderRadius: '4px',
          fontSize: '14px'
        }}>
          Click on the model to add hotspots
        </div>
      </div>
    </div>
  )
}

export default HotspotEditor
