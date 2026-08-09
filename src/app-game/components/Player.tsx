import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'

export function Player() {
  const groupRef = useRef<THREE.Group>(null)
  const setPlayerPosition = useStore((state) => state.setPlayerPosition)
  const buildings = useStore((state) => state.buildings)
  const isPaused = useStore((state) => state.isPaused)
  const { camera, gl, scene } = useThree()

  const keys = useRef<{ [key: string]: boolean }>({})
  const velocity = useRef(new THREE.Vector3())
  const direction = useRef(new THREE.Vector3())

  const camState = useRef({
    angle: 0,
    pitch: 0.5,
    distance: 12,
    isDragging: false,
    lastX: 0,
    lastY: 0
  })

  const lookAtTarget = useRef(new THREE.Vector3())
  const buildingMeshesRef = useRef<THREE.Mesh[]>([])
  const beamMeshesRef = useRef<THREE.Mesh[]>([])
  const occlusionRaycaster = useRef(new THREE.Raycaster())
  const occlusionTarget = useRef(new THREE.Vector3())
  const occlusionDir = useRef(new THREE.Vector3())
  const waypointBeamRef = useRef<THREE.Mesh>(null)
  const waypointRaycaster = useRef(new THREE.Raycaster())
  const waypointDir = useRef(new THREE.Vector3(0, 1, 0))
  const waypointHeight = useRef(6)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true }
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false }

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // Left click only
        camState.current.isDragging = true
        camState.current.lastX = e.clientX
        camState.current.lastY = e.clientY
      }
    }
    const handleMouseMove = (e: MouseEvent) => {
      if (camState.current.isDragging) {
        const deltaX = e.clientX - camState.current.lastX
        const deltaY = e.clientY - camState.current.lastY
        camState.current.lastX = e.clientX
        camState.current.lastY = e.clientY

        camState.current.angle -= deltaX * 0.01
        camState.current.pitch -= deltaY * 0.01

        camState.current.pitch = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, camState.current.pitch))
      }
    }
    const handleMouseUp = () => {
      camState.current.isDragging = false
    }
    const handleWheel = (e: WheelEvent) => {
      camState.current.distance += e.deltaY * 0.02
      camState.current.distance = Math.max(3, Math.min(80, camState.current.distance))
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    gl.domElement.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    gl.domElement.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      gl.domElement.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      gl.domElement.removeEventListener('wheel', handleWheel)
    }
  }, [gl.domElement])

  useEffect(() => {
    buildingMeshesRef.current = []
    beamMeshesRef.current = []
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.userData?.isBuilding) {
        buildingMeshesRef.current.push(obj as THREE.Mesh)
      }
      if ((obj as THREE.Mesh).isMesh && obj.userData?.isSpotlightBeam) {
        beamMeshesRef.current.push(obj as THREE.Mesh)
      }
    })
  }, [scene, buildings.length])

  useFrame((state, delta) => {
    if (!groupRef.current) return
    if (isPaused) return

    const speed = 15 // Increased speed for wider streets
    const rotSpeed = 3

    // Forward/Backward
    if (keys.current['ArrowUp'] || keys.current['KeyW']) {
      velocity.current.z = -speed
    } else if (keys.current['ArrowDown'] || keys.current['KeyS']) {
      velocity.current.z = speed
    } else {
      velocity.current.z = 0
    }

    // Left/Right Rotation
    if (keys.current['ArrowLeft'] || keys.current['KeyA']) {
      groupRef.current.rotation.y += rotSpeed * delta
    } else if (keys.current['ArrowRight'] || keys.current['KeyD']) {
      groupRef.current.rotation.y -= rotSpeed * delta
    }

    // Apply movement relative to rotation
    direction.current.set(0, 0, velocity.current.z).applyEuler(groupRef.current.rotation)
    const deltaPos = direction.current.clone().multiplyScalar(delta)
    const nextPos = groupRef.current.position.clone().add(deltaPos)

    // Camera Reset Logic
    const isMoving = Math.abs(velocity.current.z) > 0 || keys.current['ArrowLeft'] || keys.current['KeyA'] || keys.current['ArrowRight'] || keys.current['KeyD']

    // Normalize angle to [-PI, PI] to prevent infinite spinning
    camState.current.angle = Math.atan2(Math.sin(camState.current.angle), Math.cos(camState.current.angle))

    if (isMoving && !camState.current.isDragging) {
      // Smoothly reset camera to be behind the player when moving
      camState.current.angle = THREE.MathUtils.lerp(camState.current.angle, 0, 0.05)
      // Smoothly reset pitch to a comfortable default
      camState.current.pitch = THREE.MathUtils.lerp(camState.current.pitch, 0.5, 0.05)
    }

    // Collision Detection
    const playerRadius = 0.6 // Slightly larger than visual to prevent clipping
    let canMoveX = true
    let canMoveZ = true

    for (const b of buildings) {
      const minX = b.position[0] - b.size[0] / 2 - playerRadius
      const maxX = b.position[0] + b.size[0] / 2 + playerRadius
      const minZ = b.position[2] - b.size[2] / 2 - playerRadius
      const maxZ = b.position[2] + b.size[2] / 2 + playerRadius

      // Check X
      if (nextPos.x > minX && nextPos.x < maxX && groupRef.current.position.z > minZ && groupRef.current.position.z < maxZ) {
        canMoveX = false
      }
      // Check Z
      if (groupRef.current.position.x > minX && groupRef.current.position.x < maxX && nextPos.z > minZ && nextPos.z < maxZ) {
        canMoveZ = false
      }
    }

    if (canMoveX) groupRef.current.position.x = nextPos.x
    if (canMoveZ) groupRef.current.position.z = nextPos.z

    // Update store
    setPlayerPosition(groupRef.current.position.clone())

    // Camera follow
    const totalAngle = groupRef.current.rotation.y + camState.current.angle
    const hDist = camState.current.distance * Math.cos(camState.current.pitch)
    const vDist = camState.current.distance * Math.sin(camState.current.pitch)

    const cameraOffset = new THREE.Vector3(
      Math.sin(totalAngle) * hDist,
      vDist,
      Math.cos(totalAngle) * hDist
    )

    const targetCameraPos = groupRef.current.position.clone().add(cameraOffset)

    // Prevent buildings from blocking the view of the player
    const rayOrigin = groupRef.current.position.clone()
    rayOrigin.y += 1.5
    const camRayDir = targetCameraPos.clone().sub(rayOrigin)
    const desiredDist = camRayDir.length()
    camRayDir.normalize()

    const ray = new THREE.Ray(rayOrigin, camRayDir)
    const hitPoint = new THREE.Vector3()
    const box = new THREE.Box3()
    const center = new THREE.Vector3()
    const half = new THREE.Vector3()
    let adjustedDist = desiredDist

    for (const b of buildings) {
      center.set(b.position[0], b.position[1], b.position[2])
      half.set(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2)
      box.min.copy(center).sub(half)
      box.max.copy(center).add(half)
      const hit = ray.intersectBox(box, hitPoint)
      if (hit) {
        const hitDist = hit.distanceTo(rayOrigin)
        if (hitDist < adjustedDist) adjustedDist = hitDist
      }
    }

    if (adjustedDist < desiredDist) {
      adjustedDist = Math.max(1.5, adjustedDist - 0.6)
    }

    const finalCameraPos = rayOrigin.clone().add(camRayDir.multiplyScalar(adjustedDist))
    camera.position.lerp(finalCameraPos, 0.12)

    // Smooth lookAt to prevent jittering when turning
    const idealLookAt = groupRef.current.position.clone().add(new THREE.Vector3(0, 1, 0))
    lookAtTarget.current.lerp(idealLookAt, 0.2)
    camera.lookAt(lookAtTarget.current)

    // Fade buildings that occlude the view of the player
    occlusionTarget.current.copy(idealLookAt)
    occlusionDir.current.copy(occlusionTarget.current).sub(camera.position)
    const toPlayerDist = occlusionDir.current.length()
    if (toPlayerDist > 0.001 && buildingMeshesRef.current.length > 0) {
      occlusionDir.current.normalize()
      occlusionRaycaster.current.set(camera.position, occlusionDir.current)
      occlusionRaycaster.current.far = toPlayerDist - 0.2
      const hits = occlusionRaycaster.current.intersectObjects(buildingMeshesRef.current, false)
      const occluded = new Set<THREE.Mesh>()
      for (const hit of hits) {
        occluded.add(hit.object as THREE.Mesh)
      }

      for (const mesh of buildingMeshesRef.current) {
        const targetOpacity = occluded.has(mesh) ? 0.2 : 1.0
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          if (!mat) continue
          mat.transparent = true
          mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, 0.25)
          mat.depthWrite = targetOpacity >= 0.99
        }
      }
    }

    // Waypoint highlight: from ground to the top of the cones over the player
    if (waypointBeamRef.current && beamMeshesRef.current.length > 0) {
      const rayOrigin = groupRef.current.position
      waypointRaycaster.current.set(rayOrigin, waypointDir.current)
      waypointRaycaster.current.far = 80
      const hits = waypointRaycaster.current.intersectObjects(beamMeshesRef.current, false)

      let maxY = 0
      for (const hit of hits) {
        const mesh = hit.object as THREE.Mesh
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        let opacity = 0
        for (const mat of mats) {
          if (mat && typeof mat.opacity === 'number') opacity = Math.max(opacity, mat.opacity)
        }
        if (opacity <= 0.01) continue
        if (hit.point.y > maxY) maxY = hit.point.y
      }

      const targetHeight = maxY > 0.1 ? maxY : 6
      waypointHeight.current = THREE.MathUtils.lerp(waypointHeight.current, targetHeight, 0.2)
      waypointBeamRef.current.scale.set(1, waypointHeight.current, 1)
      waypointBeamRef.current.position.set(0, waypointHeight.current / 2, 0)
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Body */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <capsuleGeometry args={[0.4, 1.6, 4, 8]} />
        <meshStandardMaterial color="#88aaff" />
      </mesh>
      {/* Head */}
      <mesh position={[0, 2.6, 0]} castShadow>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>
      {/* Direction indicator (nose) */}
      <mesh position={[0, 2.6, -0.3]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.1, 0.3, 3]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>

      {/* Soft glow on the player to ensure visibility */}
      <pointLight position={[0, 4, 0]} intensity={0.5} distance={15} color="#ffffff" />

      {/* Wayfinding highlight beam (vertical) */}
      <mesh ref={waypointBeamRef} position={[0, 0.5, 0]}>
        {/* Character radius is ~0.4, so 1.1x is ~0.44 */}
        <cylinderGeometry args={[0.44, 0.44, 1, 32, 1, true]} />
        <meshBasicMaterial
          color="#c0b0ff"
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Spotlight circle on the ground */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.3, 2.5, 32]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.3, 32]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.1} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  )
}
