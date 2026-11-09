import * as THREE from 'three'
import type { OrbState } from '../../types/bozz'

export interface OrbScene {
  setState: (state: OrbState) => void
  orbit: { theta: number; phi: number; radius: number }
  resetView: () => void
  dispose: () => void
}

export interface OrbRenderOptions {
  shellParticles: number
  innerParticles: number
  connectionsPerParticle: number
}

// This is intentionally modest for integrated graphics while still producing a dense field.
export const DEFAULT_ORB_RENDER_OPTIONS: OrbRenderOptions = {
  shellParticles: 1180,
  innerParticles: 540,
  connectionsPerParticle: 2,
}

const DEFAULT_VIEW = { theta: 0.35, phi: 1.32, radius: 8.4 }
const GOLD = new THREE.Color(0xffbd28)

type ParticleField = {
  geometry: THREE.BufferGeometry
  points: THREE.Vector3[]
}

type FacetedCore = {
  group: THREE.Group
  surfaces: THREE.MeshBasicMaterial[]
  wires: THREE.LineBasicMaterial[]
}

function createGlowSprite(color: string, size: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64)
  gradient.addColorStop(0, color)
  gradient.addColorStop(0.18, 'rgba(255,235,160,.7)')
  gradient.addColorStop(0.5, 'rgba(255,178,20,.22)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const sprite = new THREE.Sprite(material)
  sprite.scale.setScalar(size)
  return sprite
}

function createParticleField(count: number, radius: number, variation: number): ParticleField {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const points: THREE.Vector3[] = []
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const color = new THREE.Color()

  for (let index = 0; index < count; index++) {
    const y = 1 - (index / (count - 1)) * 2
    const radial = Math.sqrt(1 - y * y)
    const theta = goldenAngle * index + (Math.random() - .5) * .22
    const ripple = Math.sin(index * 1.71) * variation + (Math.random() - .5) * variation
    const distance = radius + ripple
    const point = new THREE.Vector3(Math.cos(theta) * radial * distance, y * distance, Math.sin(theta) * radial * distance)
    points.push(point)

    positions[index * 3] = point.x
    positions[index * 3 + 1] = point.y
    positions[index * 3 + 2] = point.z
    color.setHSL(.105 + Math.random() * .04, .88, .54 + Math.random() * .22)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return { geometry, points }
}

function createConnectionLines(points: THREE.Vector3[], maxLinks: number, maxDistance: number): THREE.LineSegments {
  const linePositions: number[] = []
  const threshold = maxDistance * maxDistance

  for (let index = 0; index < points.length; index++) {
    const nearest: Array<{ index: number; distance: number }> = []
    for (let other = index + 1; other < points.length; other++) {
      const distance = points[index].distanceToSquared(points[other])
      if (distance > threshold) continue
      const candidate = { index: other, distance }
      const insertion = nearest.findIndex((item) => item.distance > distance)
      if (insertion === -1) nearest.push(candidate)
      else nearest.splice(insertion, 0, candidate)
      if (nearest.length > maxLinks) nearest.pop()
    }
    for (const link of nearest) {
      linePositions.push(points[index].x, points[index].y, points[index].z)
      linePositions.push(points[link.index].x, points[link.index].y, points[link.index].z)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
  const material = new THREE.LineBasicMaterial({ color: 0xffd970, transparent: true, opacity: .26, blending: THREE.AdditiveBlending, depthWrite: false })
  return new THREE.LineSegments(geometry, material)
}

function createEnergyTrace(radius: number, latitude: number, phase: number): THREE.LineLoop {
  const positions: number[] = []
  const steps = 156
  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * Math.PI * 2
    const flutter = Math.sin(angle * 7 + phase) * .07 + Math.sin(angle * 13 - phase) * .028
    const r = radius + flutter
    positions.push(
      Math.cos(angle) * Math.cos(latitude) * r,
      Math.sin(latitude + Math.sin(angle * 3 + phase) * .025) * r,
      Math.sin(angle) * Math.cos(latitude) * r,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: 0xffc04c, transparent: true, opacity: .42, blending: THREE.AdditiveBlending, depthWrite: false }))
}

function createFacetGeometry(radius: number, detail: number, surfacePalette: number[]): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail).toNonIndexed()
  const colors = new Float32Array(geometry.attributes.position.count * 3)
  const color = new THREE.Color()

  // Each triangle receives one restrained warm or silver tone, keeping the core visibly faceted.
  for (let index = 0; index < geometry.attributes.position.count; index += 3) {
    color.setHex(surfacePalette[Math.floor(Math.random() * surfacePalette.length)])
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = (index + vertex) * 3
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function createFacetedCore(): FacetedCore {
  const group = new THREE.Group()
  const surfaces: THREE.MeshBasicMaterial[] = []
  const wires: THREE.LineBasicMaterial[] = []
  const palette = [0xffd65a, 0xffae15, 0xfff0b1, 0xe7efff, 0x9aa9c5]

  const shardDefinitions: Array<{
    position: [number, number, number]
    rotation: [number, number, number]
    scale: [number, number, number]
    radius: number
    detail: number
  }> = [
    { position: [0, .12, 0], rotation: [.18, .45, -.1], scale: [1.08, 1.25, .78], radius: 1.15, detail: 2 },
    { position: [-.22, 1.38, .04], rotation: [.6, -.22, .48], scale: [.48, 1.36, .42], radius: .62, detail: 1 },
    { position: [.12, -1.34, .08], rotation: [-.45, .2, -.26], scale: [.48, 1.55, .45], radius: .58, detail: 1 },
    { position: [-1.2, .02, .18], rotation: [.25, -.1, -1.1], scale: [1.48, .43, .36], radius: .66, detail: 1 },
    { position: [1.14, .18, -.08], rotation: [-.15, .22, 1.03], scale: [1.32, .42, .38], radius: .64, detail: 1 },
    { position: [.73, -.72, .34], rotation: [.72, .65, .18], scale: [.45, 1.06, .36], radius: .48, detail: 1 },
  ]

  for (const shard of shardDefinitions) {
    const geometry = createFacetGeometry(shard.radius, shard.detail, palette)
    const surface = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: .34,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const wire = new THREE.LineBasicMaterial({
      color: 0xffedbd,
      transparent: true,
      opacity: .72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, surface)
    const frame = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wire)
    mesh.position.set(...shard.position)
    mesh.rotation.set(...shard.rotation)
    mesh.scale.set(...shard.scale)
    frame.position.copy(mesh.position)
    frame.rotation.copy(mesh.rotation)
    frame.scale.copy(mesh.scale)
    group.add(mesh, frame)
    surfaces.push(surface)
    wires.push(wire)
  }

  group.position.y = .1
  return { group, surfaces, wires }
}

function createPlatform(): { group: THREE.Group; glow: THREE.Sprite } {
  const group = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: 0xffc52b, transparent: true, opacity: .7, blending: THREE.AdditiveBlending, depthWrite: false })
  for (const [radius, opacity] of [[2.55, .34], [2.04, .42], [1.46, .54], [.86, .72]] as Array<[number, number]>) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .018, 5, 96), material.clone())
    ;(ring.material as THREE.MeshBasicMaterial).opacity = opacity
    ring.rotation.x = Math.PI / 2
    group.add(ring)
  }
  const glow = createGlowSprite('rgba(255,204,60,1)', 5.8)
  glow.position.y = -.12
  group.add(glow)
  group.position.y = -2.68
  return { group, glow }
}

function disposeMaterial(material: THREE.Material) {
  for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
  material.dispose()
}

export function createOrbScene(container: HTMLElement, reducedMotion: boolean, options: Partial<OrbRenderOptions> = {}): OrbScene | null {
  const renderOptions = { ...DEFAULT_ORB_RENDER_OPTIONS, ...options }
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(43, container.clientWidth / container.clientHeight, .1, 100)
  const orbit = { ...DEFAULT_VIEW }
  const current = { ...DEFAULT_VIEW }

  const intelligence = new THREE.Group()
  scene.add(intelligence)

  const facetedCore = createFacetedCore()
  intelligence.add(facetedCore.group)

  const shell = createParticleField(renderOptions.shellParticles, 1.66, .075)
  const inner = createParticleField(renderOptions.innerParticles, 1.13, .14)
  const shellMaterial = new THREE.PointsMaterial({ size: .037, vertexColors: true, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
  const innerMaterial = new THREE.PointsMaterial({ size: .05, vertexColors: true, transparent: true, opacity: .74, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })
  const shellPoints = new THREE.Points(shell.geometry, shellMaterial)
  const innerPoints = new THREE.Points(inner.geometry, innerMaterial)
  const shellLines = createConnectionLines(shell.points, renderOptions.connectionsPerParticle, .31)
  const innerLines = createConnectionLines(inner.points, 2, .4)
  const shellLineMaterial = shellLines.material as THREE.LineBasicMaterial
  const innerLineMaterial = innerLines.material as THREE.LineBasicMaterial
  innerLineMaterial.opacity = .34
  intelligence.add(shellPoints, shellLines, innerPoints, innerLines)

  const veilMaterial = new THREE.MeshBasicMaterial({ color: 0xffbd28, transparent: true, opacity: .032, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
  const veil = new THREE.Mesh(
    new THREE.SphereGeometry(1.71, 32, 20),
    veilMaterial,
  )
  intelligence.add(veil)

  const traces = new THREE.Group()
  const traceLatitudes = [-.92, -.48, -.16, .23, .58, .96]
  traceLatitudes.forEach((latitude, index) => traces.add(createEnergyTrace(1.42 + (index % 2) * .12, latitude, index * .8)))
  intelligence.add(traces)
  intelligence.add(createGlowSprite('rgba(255,218,112,.95)', 4.65))

  const orbitalSystem = new THREE.Group()
  const ringMaterial = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: .82, blending: THREE.AdditiveBlending, depthWrite: false })
  const ringDefinitions: Array<[number, number, number, number]> = [
    [2.55, -.42, .34, .9],
    [3.06, .52, -.25, -.66],
    [2.2, 1.18, .47, 1.25],
    [3.48, -.88, -.15, -.42],
  ]
  const rings = ringDefinitions.map(([radius, tilt, speed, brightness]) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .012, 5, 112), ringMaterial.clone())
    ;(ring.material as THREE.MeshBasicMaterial).opacity = Math.max(.25, brightness)
    ring.rotation.x = Math.PI / 2 + tilt
    ring.userData.speed = speed
    const node = new THREE.Mesh(new THREE.SphereGeometry(.055, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b1 }))
    node.position.x = radius
    const nodeGlow = createGlowSprite('rgba(255,200,60,.95)', .58)
    nodeGlow.position.copy(node.position)
    ring.add(node, nodeGlow)
    orbitalSystem.add(ring)
    return ring
  })
  const traceMaterials = traces.children.map((trace) => (trace as THREE.LineLoop).material as THREE.LineBasicMaterial)
  scene.add(orbitalSystem)

  const { group: platform, glow: platformGlow } = createPlatform()
  scene.add(platform)
  const ambient = new THREE.AmbientLight(0xfff0d0, .45)
  const underlight = new THREE.PointLight(0xffb400, 19, 16)
  underlight.position.set(0, -2.9, 1)
  scene.add(ambient, underlight)

  let state: OrbState = 'idle'
  let frame = 0
  let last = performance.now()
  let visible = !document.hidden
  const motion = reducedMotion ? .15 : 1
  const stateMultiplier = () => {
    if (state === 'offline') return .22
    if (state === 'error') return .68
    if (state === 'thinking') return 2.4
    if (state === 'listening') return 1.35
    if (state === 'speaking') return 1.65
    return 1
  }

  const applyVisualState = () => {
    const offline = state === 'offline'
    const error = state === 'error'
    const listening = state === 'listening'
    const thinking = state === 'thinking'
    const speaking = state === 'speaking'
    const pointTint = error ? 0xff6d3c : offline ? 0x806943 : listening || speaking ? 0xffefab : 0xffffff
    const lineTint = error ? 0xff7041 : offline ? 0x7e6339 : thinking ? 0xffc34a : 0xffd970
    const ringTint = error ? 0xff6537 : offline ? 0x806231 : listening ? 0xffe297 : 0xffbd28

    shellMaterial.color.setHex(pointTint)
    innerMaterial.color.setHex(error ? 0xff8755 : pointTint)
    shellMaterial.opacity = offline ? .28 : error ? .72 : thinking ? .98 : listening ? .96 : .9
    innerMaterial.opacity = offline ? .16 : error ? .6 : thinking ? .94 : .74
    shellLineMaterial.color.setHex(lineTint)
    innerLineMaterial.color.setHex(lineTint)
    shellLineMaterial.opacity = offline ? .07 : error ? .25 : .26
    innerLineMaterial.opacity = offline ? .08 : error ? .28 : .34
    veilMaterial.color.setHex(error ? 0xff5934 : offline ? 0x5f4d30 : 0xffbd28)
    veilMaterial.opacity = offline ? .008 : error ? .045 : .032
    traceMaterials.forEach((material) => {
      material.color.setHex(lineTint)
      material.opacity = offline ? .1 : error ? .3 : .42
    })
    rings.forEach((ring) => {
      const material = ring.material as THREE.MeshBasicMaterial
      material.color.setHex(ringTint)
      material.opacity = offline ? .22 : error ? .48 : .82
    })
    facetedCore.surfaces.forEach((material) => {
      material.color.setHex(error ? 0xff8a5a : offline ? 0x806943 : listening || speaking ? 0xffe9b2 : 0xffffff)
      material.opacity = offline ? .1 : error ? .26 : thinking ? .5 : .34
    })
    facetedCore.wires.forEach((material) => {
      material.color.setHex(error ? 0xff7041 : offline ? 0x806231 : listening ? 0xfff0bb : 0xffedbd)
      material.opacity = offline ? .15 : error ? .42 : thinking ? .9 : .72
    })
    underlight.color.setHex(error ? 0xff4b26 : offline ? 0x6d552b : 0xffb400)
    underlight.intensity = offline ? 3.4 : error ? 9 : speaking ? 25 : 19
  }

  applyVisualState()

  const animate = (now: number) => {
    if (!visible) { frame = 0; return }
    const delta = Math.min((now - last) / 1000, .05)
    last = now
    const time = now / 1000
    const speed = stateMultiplier() * motion

    current.theta += (orbit.theta - current.theta) * Math.min(1, delta * 5.5)
    current.phi += (orbit.phi - current.phi) * Math.min(1, delta * 5.5)
    current.radius += (orbit.radius - current.radius) * Math.min(1, delta * 5.5)
    camera.position.setFromSphericalCoords(current.radius, current.phi, current.theta)
    camera.lookAt(0, 0, 0)

    intelligence.rotation.y += delta * .18 * speed
    intelligence.rotation.x = Math.sin(time * .28) * .08
    innerPoints.rotation.y -= delta * .43 * speed
    innerPoints.rotation.z += delta * .13 * speed
    innerLines.rotation.copy(innerPoints.rotation)
    shellLines.rotation.copy(shellPoints.rotation)
    traces.rotation.y -= delta * .22 * speed
    traces.rotation.z = Math.sin(time * .4) * .08
    facetedCore.group.rotation.y -= delta * .16 * speed
    facetedCore.group.rotation.z = Math.sin(time * .63) * .055
    intelligence.position.y = Math.sin(time * .8) * .075 * motion

    const listeningPulse = state === 'listening' ? .08 * (1 + Math.sin(time * 4.8)) : 0
    const speakingPulse = state === 'speaking' ? Math.abs(Math.sin(time * 7.5)) * .085 : 0
    const thinkingPulse = state === 'thinking' ? Math.sin(time * 3.5) * .035 : 0
    const errorPulse = state === 'error' ? Math.sin(time * 2.8) * .018 : 0
    const pulse = (state === 'offline' ? .975 : 1) + listeningPulse + speakingPulse + thinkingPulse + errorPulse
    intelligence.scale.setScalar(pulse)
    facetedCore.group.scale.setScalar(1 + speakingPulse * .45 + listeningPulse * .28 + thinkingPulse * .45)

    orbitalSystem.rotation.y += delta * .06 * speed
    rings.forEach((ring, index) => {
      ring.rotation.z += delta * ring.userData.speed * .38 * speed
      const ringPulse = state === 'listening' ? 1 + Math.sin(time * 4.8 + index) * .055 : 1
      ring.scale.setScalar(ringPulse)
    })
    platformGlow.scale.setScalar(5.75 + Math.sin(time * 2.2) * .28 + speakingPulse * 4)
    platform.rotation.y += delta * .08 * speed

    renderer.render(scene, camera)
    frame = requestAnimationFrame(animate)
  }

  const onVisibilityChange = () => {
    visible = !document.hidden
    if (visible && frame === 0) {
      last = performance.now()
      frame = requestAnimationFrame(animate)
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  frame = requestAnimationFrame(animate)

  const onResize = () => {
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(onResize)
  observer.observe(container)

  return {
    setState: (next) => {
      state = next
      applyVisualState()
    },
    orbit,
    resetView: () => Object.assign(orbit, DEFAULT_VIEW),
    dispose: () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      scene.traverse((object) => {
        const renderable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
        renderable.geometry?.dispose()
        const materials = renderable.material ? (Array.isArray(renderable.material) ? renderable.material : [renderable.material]) : []
        materials.forEach(disposeMaterial)
      })
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
