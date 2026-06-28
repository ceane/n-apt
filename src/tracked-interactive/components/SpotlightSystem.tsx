import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore, CellTowerData } from '../store'
import { CONE_INTERSECTION_HEIGHT } from '../constants'

// Frequency state definitions with physical accuracy
interface FrequencyState {
  id: number
  name: string
  frequency: number
  geometryType: 'thinCone' | 'wideCone' | 'teardrop' | 'donut' | 'sphere'
  verticalFanAngle: number
  directionalProjection: boolean
  shapeParams: {
    topRadius?: number
    bottomRadius?: number
    height?: number
    scale?: THREE.Vector3
    torusRadius?: number
    tubeRadius?: number
  }
}

const FREQUENCY_STATES: FrequencyState[] = [
  {
    id: 1,
    name: 'Thin Cone',
    frequency: 30000000, // 30 MHz
    geometryType: 'thinCone',
    verticalFanAngle: 10, // 6-15° range, using 10° as average
    directionalProjection: true,
    shapeParams: { topRadius: 0.1, bottomRadius: 8, height: 20 }
  },
  {
    id: 2,
    name: 'Wide Cone',
    frequency: 10000000, // 10 MHz
    geometryType: 'wideCone',
    verticalFanAngle: 25, // 20-30° range, using 25° as average
    directionalProjection: true,
    shapeParams: { topRadius: 0.5, bottomRadius: 12, height: 20 }
  },
  {
    id: 3,
    name: 'Teardrop/Bulb',
    frequency: 5000000, // 5 MHz
    geometryType: 'teardrop',
    verticalFanAngle: 50, // 40-60° range, using 50° as average
    directionalProjection: true,
    shapeParams: { scale: new THREE.Vector3(1, 2.5, 1) }
  },
  {
    id: 4,
    name: 'Donut/Torus',
    frequency: 1000000, // 1 MHz
    geometryType: 'donut',
    verticalFanAngle: 55, // 40-70° range, using 55° as average
    directionalProjection: true,
    shapeParams: { torusRadius: 6, tubeRadius: 3 }
  },
  {
    id: 5,
    name: 'Sphere',
    frequency: 18000, // 18 kHz
    geometryType: 'sphere',
    verticalFanAngle: 180, // Full 180° coverage
    directionalProjection: false,
    shapeParams: { scale: new THREE.Vector3(1, 1, 1) }
  }
]

// Logical sets for beam assignment - updated for hexagon shape pairing
const LOGICAL_SETS = {
  hexagonPairs: [1, 1, 2, 2, 3, 3, 5, 5], // 4 shape pairs: thin cone x2, wide cone x2, teardrop x2, sphere x2
  alternativePairs: [4, 4, 5, 5, 1, 1] // alternative: donut x2, sphere x2, thin cone x2
}

// Physics constants and helper functions
const SPEED_OF_LIGHT = 3e8; // meters per second

// Calculate wavelength from frequency: λ = c/f
function calculateWavelength(frequency: number): number {
  return SPEED_OF_LIGHT / frequency;
}

// Get wavelength for frequency state
function getWavelengthForState(state: FrequencyState): number {
  return calculateWavelength(state.frequency);
}

// Geometry creation functions — all unit-sized so useFrame scaling works correctly
function createThinConeGeometry(): THREE.BufferGeometry {
  // Unit cone: radius=1, height=1, tip at origin, extends along +Z
  const geo = new THREE.ConeGeometry(1, 1, 32, 64, true)
  geo.translate(0, -0.5, 0)  // Move tip to origin
  geo.rotateX(-Math.PI / 2)  // Point along +Z
  return geo
}

function createWideConeGeometry(): THREE.BufferGeometry {
  // Same unit cone, visual width comes from scaling
  const geo = new THREE.ConeGeometry(1, 1, 32, 64, true)
  geo.translate(0, -0.5, 0)
  geo.rotateX(-Math.PI / 2)
  return geo
}

function createTeardropGeometry(): THREE.BufferGeometry {
  // Teardrop: use a sphere with the bottom half stretched into a cone shape
  // Use a standard sphere and let scaling make it teardrop-like
  const geo = new THREE.SphereGeometry(1, 32, 32, 0, Math.PI * 2, 0, Math.PI)
  return geo
}

function createDonutGeometry(): THREE.BufferGeometry {
  // Unit torus: major radius=1, tube radius=0.3
  const geo = new THREE.TorusGeometry(1, 0.3, 16, 32)
  geo.rotateX(Math.PI / 2) // Face along Z
  return geo
}

function createSphereGeometry(): THREE.BufferGeometry {
  // Unit sphere: radius=1 (higher segments for smoother silhouette)
  const geo = new THREE.SphereGeometry(1, 64, 64)
  geo.computeVertexNormals()
  return geo
}

// Get geometry for frequency state
function getGeometryForState(state: FrequencyState): THREE.BufferGeometry {
  switch (state.geometryType) {
    case 'thinCone':
      return createThinConeGeometry()
    case 'wideCone':
      return createWideConeGeometry()
    case 'teardrop':
      return createTeardropGeometry()
    case 'donut':
      return createDonutGeometry()
    case 'sphere':
      return createSphereGeometry()
    default:
      return createThinConeGeometry()
  }
}

// Beam state tracking for morphing
interface BeamState {
  currentState: FrequencyState
  targetState: FrequencyState
  morphProgress: number
  directionVector: THREE.Vector3
}

// Hexagon coordinate system for stable 6-point triangulation
interface HexCoords {
  coords: number[] // 6 barycentric-like coordinates for hexagon vertices
  quality: number // quality score for stability
}

// Hexagon containment test with enhanced stability
function getHexagonCoords(p: THREE.Vector3, vertices: THREE.Vector3[]): HexCoords {
  // For now, use simplified distance-based approach
  // TODO: Implement proper hexagonal coordinate system
  const distances = vertices.map(v => p.distanceTo(v))
  const totalDist = distances.reduce((sum, d) => sum + d, 0)
  const coords = distances.map(d => totalDist > 0 ? d / totalDist : 0)

  // Quality score based on distance variance (lower variance = higher quality)
  const avgDist = totalDist / vertices.length
  const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDist, 2), 0) / vertices.length
  const quality = 1 / (1 + variance) // Higher quality for lower variance

  return { coords, quality }
}

// Enhanced stability check with fuzzy boundaries and caching
function isHexagonStable(hexCoords: HexCoords, threshold: number = 0.4): boolean {
  return hexCoords.coords.every(coord => coord >= -threshold)
}

// Cache for hexagon calculations to avoid recomputation
const hexagonCache = new Map<string, HexCoords>()

function getCachedHexagonCoords(playerPos: THREE.Vector3, vertices: THREE.Vector3[]): HexCoords {
  const key = vertices.map(v => `${v.x.toFixed(1)},${v.z.toFixed(1)}`).join('|') + `|${playerPos.x.toFixed(1)},${playerPos.z.toFixed(1)}`

  if (hexagonCache.has(key)) {
    return hexagonCache.get(key)!
  }

  const result = getHexagonCoords(playerPos, vertices)
  hexagonCache.set(key, result)

  // Limit cache size to prevent memory leaks
  if (hexagonCache.size > 100) {
    const firstKey = hexagonCache.keys().next().value
    if (typeof firstKey === 'string') {
      hexagonCache.delete(firstKey)
    }
  }

  return result
}

export function SpotlightSystem() {
  const cellTowers = useStore((state) => state.cellTowers)
  const playerPosition = useStore((state) => state.playerPosition)
  const setActiveTowers = useStore((state) => state.setActiveTowers)
  const setWarmUpTowers = useStore((state) => state.setWarmUpTowers)
  const isPaused = useStore((state) => state.isPaused)
  const { camera } = useThree()

  // Create 9 spotlight refs, 9 target refs, and 9 beam refs
  const lightRefs = [
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
  ]
  const targetRefs = [
    useRef<THREE.Object3D>(null), useRef<THREE.Object3D>(null), useRef<THREE.Object3D>(null),
    useRef<THREE.Object3D>(null), useRef<THREE.Object3D>(null), useRef<THREE.Object3D>(null),
    useRef<THREE.Object3D>(null), useRef<THREE.Object3D>(null), useRef<THREE.Object3D>(null),
  ]
  const beamGroupRefs = [
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
  ]
  const beamMeshRefs = [
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
  ]
  const wave1Refs = [
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
    useRef<any>(null), useRef<any>(null), useRef<any>(null),
  ]

  // Beam state tracking for morphing and frequency assignment
  const beamStates = useRef<BeamState[]>(
    Array(9).fill(null).map(() => ({
      currentState: FREQUENCY_STATES[0],
      targetState: FREQUENCY_STATES[0],
      morphProgress: 1.0,
      directionVector: new THREE.Vector3(0, 0, 1)
    }))
  )

  // Initialize beam states with frequency assignment
  useEffect(() => {
    beamStates.current.forEach((state, i) => {
      const assignedState = assignFrequencyStates(i)
      state.currentState = assignedState
      state.targetState = assignedState
      state.morphProgress = 1.0
    })
  }, [])

  // Frequency assignment logic for hexagon shape pairing
  const assignFrequencyStates = (beamIndex: number) => {
    const pairs = LOGICAL_SETS.hexagonPairs
    const stateId = pairs[beamIndex % pairs.length]
    return FREQUENCY_STATES.find(state => state.id === stateId) || FREQUENCY_STATES[0]
  }

  const colors = useMemo(() => [
    '#00ffff', '#ff00ff', '#ffff00',
    '#00ffff', '#ff00ff', '#ffff00',
    '#00ffff', '#ff00ff', '#ffff00'
  ], [])

  const currentHexagon = useRef<CellTowerData[] | null>(null)

  // Create one geometry per shape type — each is unit-sized
  const thinConeGeo = useMemo(() => createThinConeGeometry(), [])
  const wideConeGeo = useMemo(() => createWideConeGeometry(), [])
  const teardropGeo = useMemo(() => createTeardropGeometry(), [])
  const donutGeo = useMemo(() => {
    const geo = createDonutGeometry()
    geo.computeBoundingBox()
    return geo
  }, [])
  const sphereGeo = useMemo(() => {
    const geo = createSphereGeometry()
    geo.computeBoundingBox()
    return geo
  }, [])
  const donutHalfZ = useMemo(() => {
    if (!donutGeo.boundingBox) return 1
    return (donutGeo.boundingBox.max.z - donutGeo.boundingBox.min.z) / 2
  }, [donutGeo])
  const sphereHalfZ = useMemo(() => {
    if (!sphereGeo.boundingBox) return 1
    return (sphereGeo.boundingBox.max.z - sphereGeo.boundingBox.min.z) / 2
  }, [sphereGeo])
  const geoByType: Record<string, THREE.BufferGeometry> = { thinCone: thinConeGeo, wideCone: wideConeGeo, teardrop: teardropGeo, donut: donutGeo, sphere: sphereGeo }

  const beamMaterials = useMemo(() => {
    return colors.map((color, i) => {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.time = { value: 0 }
        shader.uniforms.morphProgress = { value: 1.0 }
        shader.uniforms.verticalFanAngle = { value: 10.0 }
        shader.vertexShader = `
          uniform float time;
          uniform float morphProgress;
          uniform float verticalFanAngle;
          varying float vRipple;
          varying vec3 vPosition;
          ${shader.vertexShader}
        `.replace(
          `#include <begin_vertex>`,
          `
          #include <begin_vertex>
          vPosition = position;
          
          // Apply vertical fan angle based on frequency state
          float fanRadians = radians(verticalFanAngle);
          float heightFactor = abs(position.y) / 20.0; // Normalize height
          float fanScale = 1.0 + heightFactor * tan(fanRadians * 0.5);
          
          // Ripple effect
          float ripple = sin(position.z * 30.0 - time * 8.0) * 0.05 + sin(position.z * 15.0 - time * 3.0) * 0.05;
          vRipple = ripple;
          
          // Apply fan scaling and ripple
          transformed.x *= fanScale * (1.0 + ripple);
          transformed.y *= (1.0 + ripple);
          transformed.z *= (1.0 + ripple);
          `
        ).replace(
          `#include <clipping_planes_vertex>`,
          `
          #include <clipping_planes_vertex>
          vPosition = mvPosition.xyz;
          `
        )
        shader.fragmentShader = `
          uniform float time;
          uniform float verticalFanAngle;
          varying float vRipple;
          varying vec3 vPosition;
          ${shader.fragmentShader}
        `.replace(
          `#include <color_fragment>`,
          `
          #include <color_fragment>
          diffuseColor.a *= (1.0 + vRipple * 5.0);
          
          // Add subtle side lobes for teardrop and donut shapes
          float sideLobeFactor = 1.0;
          if (verticalFanAngle > 40.0) {
            float sideDistance = length(vPosition.xz);
            sideLobeFactor = 1.0 + 0.3 * sin(sideDistance * 2.0 - time * 4.0);
          }
          diffuseColor.rgb *= sideLobeFactor;
          `
        ).replace(
          `#include <clipping_planes_fragment>`,
          `
          #include <clipping_planes_fragment>
          `
        )
        mat.userData.shader = shader
      }
      return mat
    })
  }, [colors])

  const wavePoints = 120
  const initialPositions = useMemo(() => {
    return Array(9).fill(0).map(() => new Float32Array(wavePoints * 3))
  }, [])

  useEffect(() => {
    lightRefs.forEach((ref, i) => {
      if (ref.current && targetRefs[i].current) {
        ref.current.target = targetRefs[i].current
      }
    })
  }, [])

  // Performance optimization: reduce frame update frequency
  const frameSkip = useRef(0)
  const UPDATE_INTERVAL = 2 // Update every 2 frames for better performance

  useFrame((state) => {
    if (isPaused) return

    // Skip frames to improve performance
    frameSkip.current++
    if (frameSkip.current % UPDATE_INTERVAL !== 0) return

    const time = state.clock.elapsedTime
    if (cellTowers.length === 0) return
    const camDist = camera.position.distanceTo(playerPosition)
    const zoomT = THREE.MathUtils.clamp((camDist - 6) / 14, 0, 1)
    const intensityScale = THREE.MathUtils.lerp(0.35, 1.0, zoomT)
    const opacityScale = THREE.MathUtils.lerp(0.35, 1.0, zoomT)

    // Update shader uniforms for all materials
    beamMaterials.forEach((mat, i) => {
      if (mat.userData.shader) {
        mat.userData.shader.uniforms.time.value = time

        // Update beam state uniforms
        const beamState = beamStates.current[i]
        if (beamState) {
          mat.userData.shader.uniforms.verticalFanAngle.value = beamState.currentState.verticalFanAngle
          mat.userData.shader.uniforms.morphProgress.value = beamState.morphProgress
        }
      }
    })

    // Update ALL targets to follow player always
    for (let i = 0; i < 9; i++) {
      const target = targetRefs[i].current
      if (target) {
        target.position.lerp(
          new THREE.Vector3(playerPosition.x, playerPosition.y + CONE_INTERSECTION_HEIGHT, playerPosition.z),
          0.2
        )
      }
    }

    // Calculate distances from player to all towers
    const towersWithDist = cellTowers.map(tower => ({
      ...tower,
      dist: tower.position.distanceTo(playerPosition)
    }))

    // Sort by distance
    towersWithDist.sort((a, b) => a.dist - b.dist)

    let best6: CellTowerData[] = currentHexagon.current ?? []
    let bestHexCoords = best6 ? getHexagonCoords(playerPosition, best6.map(t => t.position)) : null

    // Enhanced Hysteresis: Keep current hexagon if player is still mostly inside it
    const isCurrentValid = best6 && bestHexCoords && isHexagonStable(bestHexCoords, 0.4)

    if (!isCurrentValid) {
      // Optimized hexagon search - use spatial clustering instead of brute force
      const searchLimit = Math.min(12, towersWithDist.length) // Reduced search limit

      // Simple heuristic: take 6 closest towers that form a reasonable spread
      const candidateTowers = towersWithDist.slice(0, searchLimit)

      // Try different combinations of 6 from the closest 12 (much faster than brute force)
      let bestHexagon: { towers: CellTowerData[], hexCoords: HexCoords, perimeter: number } | null = null

      // Sample a few promising combinations instead of checking all
      for (let sample = 0; sample < Math.min(20, candidateTowers.length); sample++) {
        // Create a spread selection: closest + some from further out
        const selected = [candidateTowers[0]] // Always include closest

        // Add 5 more with some spacing to ensure good coverage
        for (let i = 1; i < 6; i++) {
          const index = Math.min(sample + i, candidateTowers.length - 1)
          if (!selected.includes(candidateTowers[index])) {
            selected.push(candidateTowers[index])
          }
        }

        if (selected.length === 6) {
          const hexCoords = getCachedHexagonCoords(playerPosition, selected.map(t => t.position))

          if (isHexagonStable(hexCoords, 0)) {
            const perimeter = selected.reduce((sum, t, idx) => {
              const nextT = selected[(idx + 1) % 6]
              return sum + t.position.distanceTo(nextT.position)
            }, 0)

            if (!bestHexagon || hexCoords.quality > bestHexagon.hexCoords.quality) {
              bestHexagon = { towers: selected, hexCoords, perimeter }
            }
          }
        }
      }

      if (bestHexagon) {
        best6 = bestHexagon.towers
        bestHexCoords = bestHexagon.hexCoords
      } else {
        // Fast fallback - just take 6 closest with minimal processing
        best6 = towersWithDist.slice(0, 6)
        bestHexCoords = getHexagonCoords(playerPosition, best6.map(t => t.position))
      }

      currentHexagon.current = best6
    }

    // Update store for minimap
    setActiveTowers(best6.map(t => t.id))
    setWarmUpTowers([])

    const activeLights = [...best6]
    const primaryIds = new Set(best6.map(t => t.id))
    const warmUpIds = new Set<string>()
    const activeIds = new Set(activeLights.map(t => t.id))
    const displayLights = activeLights

    // Update spotlights with frequency-based shapes
    displayLights.forEach((tower, i) => {
      if (i >= 9) return // Safety check
      const light = lightRefs[i].current
      const target = targetRefs[i].current
      const beamGroup = beamGroupRefs[i].current
      const beamMesh = beamMeshRefs[i].current
      const wave1 = wave1Refs[i].current

      if (light && target && beamGroup && beamMesh) {
        const isPrimary = primaryIds.has(tower.id)
        const isWarmUp = warmUpIds.has(tower.id)
        const isActive = activeIds.has(tower.id)
        const fadeSpeed = isActive ? 0.1 : 0.35

        // Assign frequency state based on logical sets
        const targetState = assignFrequencyStates(i)
        const beamState = beamStates.current[i]

        // Update beam state for morphing
        if (beamState.currentState.id !== targetState.id) {
          beamState.targetState = targetState
          beamState.morphProgress = 0.0
        }

        // Smooth morphing transition
        if (beamState.morphProgress < 1.0) {
          beamState.morphProgress = Math.min(beamState.morphProgress + 0.02, 1.0)
          if (beamState.morphProgress >= 1.0) {
            beamState.currentState = beamState.targetState
          }
        }

        // Calculate direction vector from antenna to target
        const directionVector = new THREE.Vector3()
        directionVector.subVectors(target.position, tower.position)
        directionVector.normalize()
        beamState.directionVector = directionVector

        // Snap light to tower position instantly
        light.position.copy(tower.position)
        beamGroup.position.copy(tower.position)

        // Calculate distance and beam parameters based on frequency state
        const dist = light.position.distanceTo(target.position)
        const currentState = beamState.currentState

        // Make the beam stop exactly at the player
        light.distance = dist + 2

        // Set spotlight angle based on vertical fan angle
        const spotlightAngle = THREE.MathUtils.degToRad(currentState.verticalFanAngle)
        light.angle = THREE.MathUtils.lerp(light.angle || spotlightAngle, spotlightAngle, 0.1)

        // Primary towers are ~5.0 intensity, warm-ups are ~1.0
        const targetIntensity = (isPrimary ? 5.0 : isWarmUp ? 1.0 : 0.0) * intensityScale
        light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, fadeSpeed)

        // Update physical beam mesh with directional projection
        beamGroup.visible = true

        const beamDirection = new THREE.Vector3().subVectors(target.position, tower.position).normalize()
        beamGroup.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          beamDirection,
        )

        // Calculate opacity
        const targetOpacity = (isPrimary ? 0.2 : isWarmUp ? 0.08 : 0.0) * opacityScale
        // Use beamMesh (first shape mesh) to track current opacity for lerp
        const prevOpacity = beamMesh.material?.opacity ?? 0
        const currentOpacity = THREE.MathUtils.lerp(prevOpacity, targetOpacity, fadeSpeed)

        // Toggle shape meshes: show only the active shape type
        const activeType = currentState.geometryType
        const halfDist = dist * 0.5
        beamGroup.children.forEach((child: any) => {
          if (child.userData?.shapeType) {
            const isActiveShape = child.userData.shapeType === activeType
            child.visible = isActiveShape

            // Reset position for donut and sphere when not active
            if (!isActiveShape && (child.userData.shapeType === 'donut' || child.userData.shapeType === 'sphere')) {
              child.position.set(0, 0, 0)
            }

            if (isActiveShape) {
              // Scale based on shape type — geometries are unit-sized
              if (activeType === 'thinCone') {
                child.scale.set(dist * 0.06, dist * 0.06, dist)
              } else if (activeType === 'wideCone') {
                child.scale.set(dist * 0.35, dist * 0.35, dist)
              } else if (activeType === 'teardrop') {
                child.scale.set(halfDist * 0.4, halfDist * 0.6, halfDist * 0.4)
              } else if (activeType === 'donut') {
                // Donut: stretch so it starts at tower and ends at the player
                const donutScaleZ = dist / (2 * donutHalfZ)
                child.scale.set(dist * 0.3, dist * 0.1, donutScaleZ)
                child.position.set(0, 0, dist / 2)
              } else if (activeType === 'sphere') {
                // Sphere: uniform scale so it spans tower -> player
                const sphereScale = dist / (2 * sphereHalfZ)
                child.scale.set(sphereScale, sphereScale, sphereScale)
                child.position.set(0, 0, dist / 2)
              }
              child.material.opacity = currentOpacity
            }
          }
        })

        // Update sine waves with accurate wavelength-based animation
        if (wave1) {
          const waveTargetOpacity = isActive ? currentOpacity * 4.0 : 0.0
          wave1.material.opacity = THREE.MathUtils.lerp(wave1.material.opacity, waveTargetOpacity, fadeSpeed)

          if (isActive) {
            const pos1 = wave1.geometry.attributes.position.array as Float32Array
            const wavelength = getWavelengthForState(beamState.currentState) // Get accurate wavelength

            // Scale wavelength for visualization (1 unit = 1 meter)
            const scaledWavelength = wavelength // Direct scale since map units = meters
            const frequency = SPEED_OF_LIGHT / wavelength

            // Wave animation with accurate wavelength characteristics
            for (let j = 0; j < wavePoints; j++) {
              const t = j / (wavePoints - 1)
              const z = t * dist
              const envelope = Math.sin(Math.PI * t)

              // Amplitude based on wavelength (longer wavelength = larger amplitude)
              const amp = (0.6 + t * 3.5) * envelope * Math.min(scaledWavelength / 30, 2.0)

              // Oscillation frequency based on actual wavelength
              const waveFrequency = (2 * Math.PI) / scaledWavelength
              const animationSpeed = frequency / 1e6 // Scale down for visualization

              // Waves oscillate in local XY plane, extend along Z toward target
              const x = Math.sin(z * waveFrequency - time * animationSpeed) * amp
              const y = Math.cos(z * waveFrequency - time * animationSpeed) * amp * 0.3

              pos1[j * 3] = x
              pos1[j * 3 + 1] = y
              pos1[j * 3 + 2] = z
            }
            wave1.geometry.attributes.position.needsUpdate = true
          }
        }
      }
    })

    // Hide unused lights
    for (let i = displayLights.length; i < 9; i++) {
      const light = lightRefs[i].current
      const beamGroup = beamGroupRefs[i].current
      const beamMesh = beamMeshRefs[i].current
      const wave1 = wave1Refs[i].current

      if (light && beamGroup) {
        light.intensity = THREE.MathUtils.lerp(light.intensity, 0, 0.35)

        // Fade all shape meshes
        let maxOpacity = 0
        beamGroup.children.forEach((child: any) => {
          if (child.userData?.shapeType && child.material) {
            child.material.opacity = THREE.MathUtils.lerp(child.material.opacity, 0, 0.35)
            maxOpacity = Math.max(maxOpacity, child.material.opacity)
          }
        })

        if (wave1) {
          wave1.material.opacity = THREE.MathUtils.lerp(wave1.material.opacity, 0, 0.35)
        }

        if (maxOpacity < 0.01) {
          beamGroup.visible = false
        }
      }
    }
  })

  return (
    <group>
      {lightRefs.map((ref, i) => (
        <group key={i}>
          <spotLight
            ref={ref}
            color={colors[i]}
            angle={0.6}
            penumbra={0.5}
            distance={800}
            decay={0}
            intensity={0}
          />
          <object3D ref={targetRefs[i]} />
          <group ref={beamGroupRefs[i]} visible={false}>
            <mesh
              ref={beamMeshRefs[i]}
              geometry={thinConeGeo}
              material={beamMaterials[i]}
              userData={{ isSpotlightBeam: true, shapeType: 'thinCone' }}
              visible={false}
            />
            <mesh
              geometry={wideConeGeo}
              material={beamMaterials[i]}
              userData={{ isSpotlightBeam: true, shapeType: 'wideCone' }}
              visible={false}
            />
            <mesh
              geometry={teardropGeo}
              material={beamMaterials[i]}
              userData={{ isSpotlightBeam: true, shapeType: 'teardrop' }}
              visible={false}
            />
            <mesh
              geometry={donutGeo}
              material={beamMaterials[i]}
              userData={{ isSpotlightBeam: true, shapeType: 'donut' }}
              visible={false}
            />
            <mesh
              geometry={sphereGeo}
              material={beamMaterials[i]}
              userData={{ isSpotlightBeam: true, shapeType: 'sphere' }}
              visible={false}
            />
            <line ref={wave1Refs[i]}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[initialPositions[i], 3]}
                  count={wavePoints}
                  array={initialPositions[i]}
                  itemSize={3}
                  usage={THREE.DynamicDrawUsage}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color={colors[i]}
                transparent
                opacity={0}
                blending={THREE.AdditiveBlending}
                linewidth={2}
              />
            </line>
          </group>
        </group>
      ))}
    </group>
  )
}
