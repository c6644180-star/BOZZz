import { useEffect, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { gestureBus } from '../hgi/bus/GestureBus'
import { mapCameraToViewport } from '../hgi/geometry'
import { layoutTree, type HoloNode } from './layout'
import { TapRecognizer } from './taps'

export interface HoloCameraView {
  position: [number, number, number]
  target: [number, number, number]
}

export interface HoloSceneApi {
  zoom: (factor: number) => void
  resetView: () => void
  getCamera: () => HoloCameraView | null
  setCamera: (view: HoloCameraView) => boolean
}

export interface HoloGestureStatus {
  gesture: string | null
  node: string | null
}

export type HoloQuality = 'low' | 'medium' | 'high'

interface HoloSceneProps {
  nodes: HoloNode[]
  selected: string | null
  quality: HoloQuality
  gesturesEnabled: boolean
  minConfidence: number
  apiRef: MutableRefObject<HoloSceneApi | null>
  onTap: (key: string, count: 1 | 2) => void
  onHover: (key: string | null) => void
  onGesture: (status: HoloGestureStatus) => void
}

const QUALITY = {
  low: { pixelRatio: 1, glow: false, labelDepth: 2 },
  medium: { pixelRatio: 1.25, glow: true, labelDepth: 99 },
  high: { pixelRatio: 1.5, glow: true, labelDepth: 99 },
} as const

const KIND_COLORS: Record<string, number> = {
  folder: 0xffd34d,
  image: 0xfff6dc,
  markdown: 0xf5b800,
  text: 0xffe6b0,
  pdf: 0xffb347,
  video: 0xff8c42,
  '3d': 0xfff0c0,
  other: 0xd9c28a,
}

function makeGlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,246,220,0.9)')
    gradient.addColorStop(0.35, 'rgba(245,184,0,0.35)')
    gradient.addColorStop(1, 'rgba(245,184,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  }
  return new THREE.CanvasTexture(canvas)
}

const KIND_KEYS = ['folder', 'image', 'markdown', 'text', 'pdf', 'video', '3d', 'other'] as const

export function HoloScene(props: HoloSceneProps) {
  const { nodes, selected, quality, gesturesEnabled, minConfidence, apiRef, onTap, onHover, onGesture } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const labelLayerRef = useRef<HTMLDivElement>(null)
  const nodeGroupRef = useRef<THREE.Group | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const labelRendererRef = useRef<CSS2DRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const homeRef = useRef<HoloCameraView | null>(null)
  const rootKeyRef = useRef<string | null>(null)
  const meshesRef = useRef<THREE.Mesh[]>([])
  const nodeMapRef = useRef<Map<string, HoloNode>>(new Map())
  const groupMapRef = useRef<Map<string, THREE.Group>>(new Map())
  const labelMapRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const glowMapRef = useRef<Map<string, THREE.Sprite>>(new Map())
  const hoverKeyRef = useRef<string | null>(null)
  const selectedKeyRef = useRef<string | null>(null)
  const selectedRef = useRef(selected)
  const applySelectionRef = useRef<(key: string | null) => void>(() => {})
  const selectionRingRef = useRef<THREE.Mesh | null>(null)
  const hoverRingRef = useRef<THREE.Mesh | null>(null)
  const linkRef = useRef<THREE.LineSegments | null>(null)
  const sharedRef = useRef<{
    geometries: Map<string, THREE.BufferGeometry>
    edges: Map<string, THREE.BufferGeometry>
    materials: Map<string, THREE.MeshBasicMaterial>
    edgeMaterial: THREE.LineBasicMaterial
    glowTexture: THREE.Texture
    glowMaterials: Map<string, THREE.SpriteMaterial>
    whiteGlow: THREE.SpriteMaterial
    linkMaterial: THREE.LineBasicMaterial
    rings: THREE.MeshBasicMaterial[]
  } | null>(null)
  const tapsRef = useRef(new TapRecognizer())
  const timerRef = useRef<number | null>(null)
  const callbacksRef = useRef({
    onTap,
    onHover,
    onGesture,
  })
  const enabledRef = useRef(gesturesEnabled)
  const minConfidenceRef = useRef(minConfidence)
  const qualityRef = useRef(quality)
  const gesturePointRef = useRef<{ x: number; y: number; nx: number; ny: number } | null>(null)
  const pinchingRef = useRef(false)
  const wristUntilRef = useRef(0)

  // The scene is imperative, so handlers read the newest props through refs.
  useEffect(() => {
    callbacksRef.current = { onTap, onHover, onGesture }
    enabledRef.current = gesturesEnabled
    minConfidenceRef.current = minConfidence
    qualityRef.current = quality
  }, [onTap, onHover, onGesture, gesturesEnabled, minConfidence, quality])

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    const container = containerRef.current
    const labelLayer = labelLayerRef.current
    if (!container || !labelLayer) return
    const labels = labelMapRef.current
    const groups = groupMapRef.current
    const glows = glowMapRef.current

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      const fallback = document.createElement('p')
      fallback.className = 'holo-scene-error'
      fallback.textContent = 'WebGL could not start in this browser, so the 3D scene is unavailable.'
      container.appendChild(fallback)
      return
    }
    const profile = QUALITY[qualityRef.current]
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio))
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    renderer.domElement.setAttribute('aria-label', 'Holographic folder scene')
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      45,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.1,
      6000,
    )
    camera.position.set(0, 4, 18)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.minDistance = 1.5
    controls.maxDistance = 400
    controls.target.set(0, 0, 0)
    controls.update()
    controlsRef.current = controls

    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    labelRenderer.domElement.className = 'holo-label-layer'
    labelLayer.appendChild(labelRenderer.domElement)
    labelRendererRef.current = labelRenderer

    const nodeGroup = new THREE.Group()
    nodeGroup.name = 'Holo nodes'
    scene.add(nodeGroup)
    nodeGroupRef.current = nodeGroup

    const addRing = (color: number, opacity: number, inner: number, outer: number) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      ring.visible = false
      ring.renderOrder = 20
      scene.add(ring)
      return ring
    }
    const selectionRing = addRing(0xffffff, 0.95, 0.62, 0.72)
    const hoverRing = addRing(0xffd34d, 0.65, 0.55, 0.62)
    selectionRingRef.current = selectionRing
    hoverRingRef.current = hoverRing

    const glowTexture = makeGlowTexture()
    const sharedGeometries = new Map<string, THREE.BufferGeometry>()
    const sharedEdges = new Map<string, THREE.BufferGeometry>()
    const sharedMaterials = new Map<string, THREE.MeshBasicMaterial>()
    const glowMaterials = new Map<string, THREE.SpriteMaterial>()

    const geometryFor = (kind: string, depth: number): THREE.BufferGeometry => {
      const key = depth === 0 ? 'root' : kind
      const cached = sharedGeometries.get(key)
      if (cached) return cached
      let geometry: THREE.BufferGeometry
      if (depth === 0) geometry = new THREE.IcosahedronGeometry(0.95, 0)
      else if (kind === 'folder') geometry = new THREE.BoxGeometry(1, 0.68, 0.16)
      else if (kind === 'image') geometry = new THREE.PlaneGeometry(0.9, 0.7)
      else if (kind === 'video') geometry = new THREE.ConeGeometry(0.42, 0.72, 4)
      else if (kind === '3d') geometry = new THREE.OctahedronGeometry(0.48, 0)
      else if (kind === 'other') geometry = new THREE.SphereGeometry(0.38, 16, 12)
      else geometry = new THREE.BoxGeometry(0.62, 0.84, 0.07)
      sharedGeometries.set(key, geometry)
      return geometry
    }
    const edgesFor = (kind: string, depth: number): THREE.BufferGeometry => {
      const key = depth === 0 ? 'root' : kind
      const cached = sharedEdges.get(key)
      if (cached) return cached
      const edges = new THREE.EdgesGeometry(geometryFor(kind, depth))
      sharedEdges.set(key, edges)
      return edges
    }
    const materialFor = (kind: string, depth: number): THREE.MeshBasicMaterial => {
      const key = depth === 0 ? 'root' : kind
      const cached = sharedMaterials.get(key)
      if (cached) return cached
      const material = new THREE.MeshBasicMaterial({
        color: depth === 0 ? 0xfff6dc : (KIND_COLORS[kind] ?? KIND_COLORS.other),
        transparent: true,
        opacity: depth === 0 ? 0.94 : 0.82,
        side: THREE.DoubleSide,
      })
      sharedMaterials.set(key, material)
      return material
    }
    const glowFor = (kind: string): THREE.SpriteMaterial => {
      const cached = glowMaterials.get(kind)
      if (cached) return cached
      const material = new THREE.SpriteMaterial({
        map: glowTexture,
        color: KIND_COLORS[kind] ?? KIND_COLORS.other,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      glowMaterials.set(kind, material)
      return material
    }
    const whiteGlow = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.5 })
    const linkMaterial = new THREE.LineBasicMaterial({ color: 0xf5b800, transparent: true, opacity: 0.28 })

    geometryFor('root', 0)
    edgesFor('root', 0)
    materialFor('root', 0)
    for (const kind of KIND_KEYS) {
      geometryFor(kind, 1)
      edgesFor(kind, 1)
      materialFor(kind, 1)
      glowFor(kind)
    }

    sharedRef.current = {
      geometries: sharedGeometries,
      edges: sharedEdges,
      materials: sharedMaterials,
      edgeMaterial,
      glowTexture,
      glowMaterials,
      whiteGlow,
      linkMaterial,
      rings: [selectionRing.material as THREE.MeshBasicMaterial, hoverRing.material as THREE.MeshBasicMaterial],
    }

    const pickAt = (clientX: number, clientY: number): HoloNode | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const point = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(point, camera)
      const hits = raycaster.intersectObjects(meshesRef.current, false)
      for (const hit of hits) {
        const key = (hit.object.userData as { holoKey?: unknown }).holoKey
        if (typeof key === 'string') return nodeMapRef.current.get(key) ?? null
      }
      return null
    }

    const setHover = (key: string | null) => {
      if (hoverKeyRef.current === key) return
      const previous = hoverKeyRef.current
      hoverKeyRef.current = key
      const previousGroup = previous ? groupMapRef.current.get(previous) : null
      if (previousGroup) previousGroup.scale.setScalar(1)
      const group = key ? groupMapRef.current.get(key) : null
      if (group) group.scale.setScalar(1.12)
      const ring = hoverRingRef.current
      if (ring) {
        ring.visible = Boolean(group)
        if (group) ring.position.copy(group.position).setZ(0.02)
      }
      const node = key ? nodeMapRef.current.get(key) : null
      callbacksRef.current.onHover(key)
      callbacksRef.current.onGesture({
        gesture: null,
        node: node?.name ?? null,
      })
      renderer.domElement.style.cursor = group ? 'pointer' : 'grab'
    }

    const applySelection = (key: string | null) => {
      const previous = selectedKeyRef.current
      if (previous && previous !== key) {
        const oldGroup = groupMapRef.current.get(previous)
        if (oldGroup) oldGroup.scale.setScalar(1)
        labelMapRef.current.get(previous)?.classList.remove('is-selected')
      }
      selectedKeyRef.current = key
      const group = key ? groupMapRef.current.get(key) : null
      const ring = selectionRingRef.current
      for (const [labelKey, element] of labelMapRef.current) {
        if (labelKey !== key) element.classList.remove('is-selected')
      }
      if (group) {
        group.scale.setScalar(1.22)
        labelMapRef.current.get(key ?? '')?.classList.add('is-selected')
        if (ring) {
          ring.visible = true
          ring.position.copy(group.position).setZ(0.03)
        }
      } else if (ring) {
        ring.visible = false
      }
    }
    applySelectionRef.current = applySelection

    const emitTap = (key: string, count: 1 | 2) => {
      callbacksRef.current.onTap(key, count)
    }
    const scheduleSingle = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        const key = tapsRef.current.pendingSingle(performance.now())
        if (key) emitTap(key, 1)
      }, tapsRef.current.config.doubleWindowMs + 30)
    }
    const handleTap = (key: string, durationMs: number, at: number) => {
      const result = tapsRef.current.end(key, durationMs, at)
      if (result?.kind === 'double') {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        timerRef.current = null
        emitTap(result.key, 2)
        return
      }
      if (result?.kind === 'single') emitTap(result.key, 1)
      scheduleSingle()
    }

    const orbit = (thetaDelta: number, phiDelta: number) => {
      const offset = camera.position.clone().sub(controls.target)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      spherical.theta += thetaDelta
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + phiDelta, 0.15, Math.PI - 0.15)
      offset.setFromSpherical(spherical)
      camera.position.copy(controls.target).add(offset)
      controls.update()
    }
    const zoomBy = (factor: number) => {
      if (!Number.isFinite(factor) || factor <= 0) return
      const offset = camera.position.clone().sub(controls.target)
      const distance = THREE.MathUtils.clamp(
        offset.length() / factor,
        controls.minDistance,
        controls.maxDistance,
      )
      offset.setLength(distance)
      camera.position.copy(controls.target).add(offset)
      controls.update()
    }

    apiRef.current = {
      zoom: zoomBy,
      resetView: () => {
        if (!homeRef.current) return
        camera.position.set(...homeRef.current.position)
        controls.target.set(...homeRef.current.target)
        controls.update()
      },
      getCamera: () => ({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      }),
      setCamera: (view) => {
        if (!Array.isArray(view.position) || !Array.isArray(view.target)) return false
        camera.position.set(view.position[0], view.position[1], view.position[2])
        controls.target.set(view.target[0], view.target[1], view.target[2])
        controls.update()
        return true
      },
    }

    let pointerDown: { x: number; y: number; time: number } | null = null
    let hoverFrame: number | null = null
    let pendingHover: { x: number; y: number } | null = null
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) {
        setHover(null)
        return
      }
      pendingHover = { x: event.clientX, y: event.clientY }
      if (hoverFrame !== null) return
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = null
        if (!pendingHover) return
        const node = pickAt(pendingHover.x, pendingHover.y)
        setHover(node?.key ?? null)
      })
    }
    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown) return
      const down = pointerDown
      pointerDown = null
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
      if (moved > 6) return
      const node = pickAt(event.clientX, event.clientY)
      if (!node || node.isMore) return
      handleTap(node.key, performance.now() - down.time, performance.now())
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const unsubscribers = [
      gestureBus.on('gesture.move', (payload) => {
        if (!enabledRef.current || payload.confidence < minConfidenceRef.current) return
        const rect = renderer.domElement.getBoundingClientRect()
        const point = mapCameraToViewport(payload.x, payload.y, rect.width, rect.height, true, 0.02)
        const previous = gesturePointRef.current
        gesturePointRef.current = { x: rect.left + point.x, y: rect.top + point.y, nx: payload.x, ny: payload.y }
        const node = pickAt(rect.left + point.x, rect.top + point.y)
        setHover(node?.key ?? null)
        if (previous) {
          const dx = payload.x - previous.nx
          const dy = payload.y - previous.ny
          if (pinchingRef.current) orbit(dx * 4, dy * 3)
          else if (performance.now() < wristUntilRef.current) orbit(dx * 9, 0)
        }
      }),
      gestureBus.on('gesture.pinch_start', (payload) => {
        if (!enabledRef.current || payload.confidence < minConfidenceRef.current) return
        pinchingRef.current = true
        callbacksRef.current.onGesture({ gesture: 'pinch', node: null })
      }),
      gestureBus.on('gesture.pinch_hold', () => {
        if (!enabledRef.current) return
        pinchingRef.current = true
      }),
      gestureBus.on('gesture.pinch_end', (payload) => {
        pinchingRef.current = false
        if (!enabledRef.current || payload.confidence < minConfidenceRef.current) return
        callbacksRef.current.onGesture({ gesture: 'pinch', node: null })
        if (payload.heldMs > 350) return
        const node = hoverKeyRef.current ? nodeMapRef.current.get(hoverKeyRef.current) : null
        if (!node || node.isMore) return
        handleTap(node.key, payload.heldMs, performance.now())
      }),
      gestureBus.on('gesture.zoom', (payload) => {
        if (!enabledRef.current || payload.confidence < minConfidenceRef.current) return
        zoomBy(payload.scale)
        callbacksRef.current.onGesture({ gesture: 'two-hand zoom', node: null })
      }),
      gestureBus.on('gesture.rotate', (payload) => {
        if (!enabledRef.current || payload.confidence < minConfidenceRef.current) return
        orbit(-payload.delta * 2, 0)
        callbacksRef.current.onGesture({ gesture: 'rotate', node: null })
      }),
      gestureBus.on('gesture.recognized', (payload) => {
        if (!enabledRef.current || payload.confidence < minConfidenceRef.current) return
        if (payload.name === 'wrist_rotation') {
          wristUntilRef.current = performance.now() + 900
        }
        callbacksRef.current.onGesture({ gesture: String(payload.name), node: null })
      }),
    ]

    const resize = () => {
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[qualityRef.current].pixelRatio))
      renderer.setSize(width, height, false)
      labelRenderer.setSize(width, height)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    let frameId = 0
    let running = !document.hidden
    const render = () => {
      if (!running) return
      controls.update()
      renderer.render(scene, camera)
      labelRenderer.render(scene, camera)
      frameId = window.requestAnimationFrame(render)
    }
    const onVisibility = () => {
      if (document.hidden) {
        running = false
        window.cancelAnimationFrame(frameId)
      } else if (!running) {
        running = true
        render()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    render()

    return () => {
      running = false
      window.cancelAnimationFrame(frameId)
      if (hoverFrame !== null) window.cancelAnimationFrame(hoverFrame)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      controls.dispose()
      for (const element of labels.values()) element.remove()
      labels.clear()
      groups.clear()
      glows.clear()
      meshesRef.current = []
      nodeGroup.clear()
      if (linkRef.current) {
        scene.remove(linkRef.current)
        linkRef.current.geometry.dispose()
        linkRef.current = null
      }
      const shared = sharedRef.current
      if (shared) {
        shared.geometries.forEach((geometry) => geometry.dispose())
        shared.edges.forEach((geometry) => geometry.dispose())
        shared.materials.forEach((material) => material.dispose())
        shared.glowMaterials.forEach((material) => material.dispose())
        shared.glowTexture.dispose()
        shared.whiteGlow.dispose()
        shared.edgeMaterial.dispose()
        shared.linkMaterial.dispose()
        shared.rings.forEach((material) => material.dispose())
        selectionRing.geometry.dispose()
        hoverRing.geometry.dispose()
        scene.remove(selectionRing)
        scene.remove(hoverRing)
        sharedRef.current = null
      }
      labelRenderer.domElement.remove()
      renderer.dispose()
      renderer.domElement.remove()
      rendererRef.current = null
      labelRendererRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      nodeGroupRef.current = null
      selectionRingRef.current = null
      hoverRingRef.current = null
      homeRef.current = null
      apiRef.current = null
    }
  }, [apiRef])

  useEffect(() => {
    const nodeGroup = nodeGroupRef.current
    const shared = sharedRef.current
    const scene = nodeGroup?.parent
    if (!nodeGroup || !shared || !scene) return

    nodeMapRef.current = new Map(nodes.map((node) => [node.key, node]))
    meshesRef.current = []
    groupMapRef.current.clear()
    glowMapRef.current.clear()
    for (const element of labelMapRef.current.values()) element.remove()
    labelMapRef.current.clear()
    nodeGroup.clear()

    const layout = layoutTree(nodes)
    const profile = QUALITY[quality]
    const radius = layout.reduce((max, item) => Math.max(max, item.radius), 0)
    const rootKey = nodes[0]?.key ?? null

    for (const item of layout) {
      const node = nodeMapRef.current.get(item.key)
      if (!node) continue
      const group = new THREE.Group()
      group.position.set(item.x, item.y, 0)
      group.userData.holoKey = node.key
      const mesh = new THREE.Mesh(
        shared.geometries.get(node.depth === 0 ? 'root' : node.kind)
          ?? makeNodeGeometry(node),
        shared.materials.get(node.depth === 0 ? 'root' : node.kind)
          ?? new THREE.MeshBasicMaterial({ color: 0xffd34d }),
      )
      mesh.userData.holoKey = node.key
      group.add(mesh)
      meshesRef.current.push(mesh)
      const edges = new THREE.LineSegments(
        shared.edges.get(node.depth === 0 ? 'root' : node.kind)
          ?? new THREE.EdgesGeometry(mesh.geometry),
        shared.edgeMaterial,
      )
      edges.userData.holoKey = node.key
      group.add(edges)
      if (profile.glow) {
        const glow = new THREE.Sprite(shared.glowMaterials.get(node.kind) ?? shared.whiteGlow)
        glow.scale.setScalar(node.depth === 0 ? 3.2 : 2.2)
        glow.position.set(0, 0, -0.02)
        glow.raycast = () => {}
        group.add(glow)
        glowMapRef.current.set(node.key, glow)
      }
      if (node.isMore) group.scale.setScalar(0.7)
      nodeGroup.add(group)
      groupMapRef.current.set(node.key, group)

      if (item.depth <= profile.labelDepth) {
        const element = document.createElement('div')
        element.className = `holo-label${node.type === 'folder' ? ' is-folder' : ''}${node.isMore ? ' is-more' : ''}`
        const name = document.createElement('span')
        name.textContent = node.name
        name.title = node.name
        const kind = document.createElement('small')
        kind.textContent = node.isMore ? `${node.hiddenCount} hidden` : node.kind
        element.append(name, kind)
        const label = new CSS2DObject(element)
        label.position.set(0, node.depth === 0 ? -1.35 : -0.78, 0)
        group.add(label)
        labelMapRef.current.set(node.key, element)
      }
    }

    if (linkRef.current) {
      scene.remove(linkRef.current)
      linkRef.current.geometry.dispose()
      linkRef.current = null
    }
    const linkPoints: number[] = []
    for (const node of nodes) {
      if (!node.parentKey) continue
      const parent = layout.find((item) => item.key === node.parentKey)
      const child = layout.find((item) => item.key === node.key)
      if (!parent || !child) continue
      linkPoints.push(parent.x, parent.y, 0, child.x, child.y, 0)
    }
    const linkGeometry = new THREE.BufferGeometry()
    linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linkPoints, 3))
    const links = new THREE.LineSegments(linkGeometry, shared.linkMaterial)
    links.renderOrder = -1
    scene.add(links)
    linkRef.current = links

    const distance = Math.max(14, radius * 1.55)
    const home: HoloCameraView = {
      position: [0, distance * 0.36, distance],
      target: [0, 0, 0],
    }
    if (rootKey !== rootKeyRef.current) {
      rootKeyRef.current = rootKey
      homeRef.current = home
      const camera = cameraRef.current
      const controls = controlsRef.current
      if (camera && controls) {
        camera.position.set(...home.position)
        controls.target.set(...home.target)
        controls.update()
      }
    } else if (!homeRef.current) {
      homeRef.current = home
    }

    selectedKeyRef.current = null
    applySelectionRef.current(
      selectedRef.current && groupMapRef.current.has(selectedRef.current) ? selectedRef.current : null,
    )
    if (hoverKeyRef.current && !groupMapRef.current.has(hoverKeyRef.current)) {
      hoverKeyRef.current = null
      const hoverRing = hoverRingRef.current
      if (hoverRing) hoverRing.visible = false
    }
  }, [nodes, quality, apiRef])

  useEffect(() => {
    applySelectionRef.current(selected)
  }, [selected])

  useEffect(() => {
    const renderer = rendererRef.current
    if (renderer) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality].pixelRatio))
    }
  }, [quality])

  return (
    <div className="holo-scene">
      <div className="holo-scanlines" aria-hidden="true" data-quality={quality} />
      <div className="holo-canvas" ref={containerRef} />
      <div className="holo-labels" ref={labelLayerRef} aria-hidden="true" />
    </div>
  )
}

function makeNodeGeometry(node: HoloNode): THREE.BufferGeometry {
  if (node.depth === 0) return new THREE.IcosahedronGeometry(0.95, 0)
  if (node.kind === 'folder') return new THREE.BoxGeometry(1, 0.68, 0.16)
  if (node.kind === 'image') return new THREE.PlaneGeometry(0.9, 0.7)
  if (node.kind === 'video') return new THREE.ConeGeometry(0.42, 0.72, 4)
  if (node.kind === '3d') return new THREE.OctahedronGeometry(0.48, 0)
  if (node.kind === 'other') return new THREE.SphereGeometry(0.38, 16, 12)
  return new THREE.BoxGeometry(0.62, 0.84, 0.07)
}
