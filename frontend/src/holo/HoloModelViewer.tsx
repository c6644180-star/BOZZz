import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Eye, EyeOff, Loader2, RotateCcw, X } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyExplodePlan, buildExplodePlan, clampExplode, type ExplodePlanItem } from '../l3dme/explode'
import type { ModelControlResult, ModelMode, ModelViewerState } from '../l3dme/modelControl'
import { registerModelControl } from '../l3dme/modelControl'
import { gestureBus } from '../hgi/bus/GestureBus'
import { mapCameraToViewport } from '../hgi/geometry'
import type { HoloQuality } from './HoloScene'
import {
  registerHoloModel,
  type HoloModelApi,
  type HoloPartDetails,
  type HoloVisualMode,
} from './modelControl'
import { findSidecars, modelUrl, rawUrl } from './modelSource'

const MAX_PIXEL_RATIO = 1.5
const LARGE_FILE_BYTES = 50 * 1024 * 1024
const MAX_LISTED_PARTS = 60
const GESTURE_COOLDOWN_MS = 260

export interface HoloModelViewerProps {
  path: string
  name: string
  size: number
  quality: HoloQuality
  gesturesEnabled: boolean
  minConfidence: number
  onClose: () => void
  onStatus: (message: string) => void
}

interface PartRecord {
  key: string
  object: THREE.Object3D
  name: string
}

const INITIAL_STATE: ModelViewerState = {
  loaded: false,
  source: 'No model',
  mode: 'hologram',
  explode: 0,
  selectedPart: null,
  parts: [],
  cameraAzimuth: 0,
  cameraDistance: 0,
  revision: 0,
}

const VISUAL_MODES: Array<{ id: HoloVisualMode; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'hologram', label: 'Hologram' },
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'transparent', label: 'Transparent' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function partRecordName(object: THREE.Object3D, index: number): string {
  if (object.name.trim()) return object.name.trim()
  let meshName = ''
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!meshName && mesh.isMesh && mesh.name.trim()) meshName = mesh.name.trim()
  })
  return meshName || `Unnamed part ${index + 1}`
}

function triangleCount(object: THREE.Object3D): number {
  let total = 0
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const geometry = mesh.geometry
    if (geometry.index) total += geometry.index.count / 3
    else if (geometry.getAttribute('position')) total += geometry.getAttribute('position').count / 3
  })
  return Math.floor(total)
}

function disposeObject(root: THREE.Object3D | null): void {
  if (!root) return
  root.parent?.remove(root)
  const seen = new Set<THREE.Material | THREE.BufferGeometry>()
  const disposeMaterialOnce = (material: THREE.Material) => {
    if (seen.has(material)) return
    seen.add(material)
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
        (value as THREE.Texture).dispose()
      }
    }
    material.dispose()
  }
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry && !seen.has(mesh.geometry)) {
      seen.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const base = mesh.userData?.__bozzBase as { material?: THREE.Material | THREE.Material[] } | undefined
    const sets = [mesh.material, base?.material]
    for (const value of sets) {
      if (!value) continue
      const materials = Array.isArray(value) ? value : [value]
      for (const material of materials) {
        if ((material as THREE.ShaderMaterial).isShaderMaterial) continue
        disposeMaterialOnce(material)
      }
    }
    const edges = mesh.userData?.__bozzHoloEdges as THREE.LineSegments | undefined
    if (edges) {
      edges.geometry.dispose()
      disposeMaterialOnce(edges.material as THREE.Material)
    }
  })
}

function readDetail(response: Response): Promise<string> {
  return response
    .json()
    .then((body: { detail?: unknown }) => (typeof body.detail === 'string' ? body.detail : ''))
    .catch(() => '')
}

export function HoloModelViewer(props: HoloModelViewerProps) {
  const { path, name, size, quality, gesturesEnabled, minConfidence, onClose, onStatus } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelRef = useRef<THREE.Group | null>(null)
  const partsRef = useRef<PartRecord[]>([])
  const planRef = useRef<ExplodePlanItem[]>([])
  const homeRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const helperRef = useRef<THREE.Box3Helper | null>(null)
  const selectedRef = useRef<PartRecord | null>(null)
  const holoMaterialRef = useRef<THREE.ShaderMaterial | null>(null)
  const scanRef = useRef<THREE.Mesh | null>(null)
  const floorRef = useRef<THREE.Mesh | null>(null)
  const clockRef = useRef<THREE.Clock | null>(null)
  const explodeCurrentRef = useRef(0)
  const explodeTargetRef = useRef(0)
  const explodeBoundsRef = useRef<{ minY: number; maxY: number }>({ minY: 0, maxY: 1 })
  const blobUrlsRef = useRef<string[]>([])
  const loadTokenRef = useRef(0)
  const stateRef = useRef<ModelViewerState>(INITIAL_STATE)
  const modeRef = useRef<HoloVisualMode>('hologram')
  const qualityRef = useRef<HoloQuality>(quality)
  const gesturesEnabledRef = useRef(gesturesEnabled)
  const minConfidenceRef = useRef(minConfidence)
  const onStatusRef = useRef(onStatus)
  const selectRecordRef = useRef<(record: PartRecord | null) => void>(() => {})

  const [mode, setModeState] = useState<HoloVisualMode>('hologram')
  const [explodeUi, setExplodeUi] = useState(0)
  const [parts, setParts] = useState<HoloPartDetails[]>([])
  const [selected, setSelected] = useState<HoloPartDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modelStats, setModelStats] = useState<{ parts: number; triangles: number } | null>(null)

  // The scene is imperative, so handlers read the newest props through refs.
  useEffect(() => {
    qualityRef.current = quality
    gesturesEnabledRef.current = gesturesEnabled
    minConfidenceRef.current = minConfidence
    onStatusRef.current = onStatus
  }, [quality, gesturesEnabled, minConfidence, onStatus])

  const publish = useCallback((patch: Partial<ModelViewerState>) => {
    stateRef.current = { ...stateRef.current, ...patch, revision: stateRef.current.revision + 1 }
  }, [])

  const getState = useCallback((): ModelViewerState => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return stateRef.current
    return {
      ...stateRef.current,
      cameraAzimuth: THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()),
      cameraDistance: camera.position.distanceTo(controls.target),
    }
  }, [])

  const detailsFor = useCallback((record: PartRecord): HoloPartDetails => {
    const box = new THREE.Box3().setFromObject(record.object)
    const bounds = box.getSize(new THREE.Vector3())
    return {
      name: record.name,
      type: record.object.type,
      size: [bounds.x, bounds.y, bounds.z],
      triangles: triangleCount(record.object),
    }
  }, [])

  const listDetails = useCallback((): HoloPartDetails[] => {
    return partsRef.current.slice(0, MAX_LISTED_PARTS).map(detailsFor)
  }, [detailsFor])

  const selectRecord = useCallback((record: PartRecord | null) => {
    selectedRef.current = record
    const helper = helperRef.current
    if (record && helper) {
      helper.box.setFromObject(record.object)
      helper.visible = !helper.box.isEmpty()
    } else if (helper) {
      helper.visible = false
    }
    const detail = record ? detailsFor(record) : null
    setSelected(detail)
    publish({ selectedPart: record ? record.name : null })
    if (record) onStatusRef.current(`Selected part: ${record.name}`)
  }, [detailsFor, publish])
  useEffect(() => {
    selectRecordRef.current = selectRecord
  }, [selectRecord])

  const findRecord = useCallback((name: string): PartRecord | null => {
    const wanted = name.trim().toLowerCase()
    return (
      partsRef.current.find((record) => record.name === name.trim())
      ?? partsRef.current.find((record) => record.name.toLowerCase() === wanted)
      ?? null
    )
  }, [])

  const applyExplode = useCallback((amount: number) => {
    const root = modelRef.current
    if (!root || planRef.current.length === 0) return 0
    let moved = 0
    for (const item of applyExplodePlan(planRef.current, amount)) {
      const child = root.children[Number(item.key)]
      if (!child) continue
      child.position.set(item.position.x, item.position.y, item.position.z)
      const plan = planRef.current.find((entry) => entry.key === item.key)
      if (plan) {
        moved = Math.max(
          moved,
          Math.hypot(
            item.position.x - plan.base.x,
            item.position.y - plan.base.y,
            item.position.z - plan.base.z,
          ),
        )
      }
    }
    return moved
  }, [])

  const ensureEdges = useCallback((root: THREE.Group, enabled: boolean) => {
    if (!enabled) {
      root.traverse((object) => {
        const edges = (object as THREE.Mesh).userData?.__bozzHoloEdges as THREE.LineSegments | undefined
        if (edges) edges.visible = false
      })
      return
    }
    const material = new THREE.LineBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.4 })
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      if (mesh.userData.__bozzHoloEdges) return
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), material)
      edges.visible = false
      edges.raycast = () => {}
      mesh.add(edges)
      mesh.userData.__bozzHoloEdges = edges
    })
  }, [])

  const applyVisual = useCallback((visual: HoloVisualMode): number => {
    const root = modelRef.current
    const holo = holoMaterialRef.current
    if (!root || !holo) return 0
    let count = 0
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const base = mesh.userData.__bozzBase as {
        material: THREE.Material | THREE.Material[]
        wireframe: boolean
        transparent: boolean
        opacity: number
        depthWrite: boolean
      } | undefined
      if (!base) return
      const materials = Array.isArray(base.material) ? base.material : [base.material]
      const edges = mesh.userData.__bozzHoloEdges as THREE.LineSegments | undefined
      if (visual === 'hologram') {
        mesh.material = holo
        if (edges) edges.visible = true
      } else {
        if (edges) edges.visible = false
        for (const material of materials) {
          const writable = material as THREE.MeshBasicMaterial
          if (visual === 'wireframe') {
            writable.wireframe = true
            material.transparent = base.transparent
            material.opacity = base.opacity
            material.depthWrite = base.depthWrite
          } else if (visual === 'transparent') {
            writable.wireframe = base.wireframe
            material.transparent = true
            material.opacity = Math.min(base.opacity, 0.3)
            material.depthWrite = false
          } else {
            writable.wireframe = base.wireframe
            material.transparent = base.transparent
            material.opacity = base.opacity
            material.depthWrite = base.depthWrite
          }
          material.needsUpdate = true
        }
        mesh.material = base.material
      }
      count += 1
    })
    modeRef.current = visual
    setModeState(visual)
    publish({ mode: visual })
    return count
  }, [publish])

  const setVisual = useCallback((visual: HoloVisualMode): ModelControlResult => {
    if (!modelRef.current) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    if (visual === 'hologram') ensureEdges(modelRef.current, qualityRef.current !== 'low')
    const count = applyVisual(visual)
    let matches = 0
    modelRef.current.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      if (visual === 'hologram') {
        if (mesh.material === holoMaterialRef.current) matches += 1
        return
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (visual === 'wireframe' && materials.every((item) => (item as THREE.MeshBasicMaterial).wireframe === true)) matches += 1
      else if (visual === 'transparent' && materials.every((item) => item.transparent && item.opacity <= 0.5)) matches += 1
      else if (visual === 'solid' && materials.every((item) => {
        const base = mesh.userData.__bozzBase as { opacity: number; transparent: boolean }
        return item.opacity === base.opacity && item.transparent === base.transparent
      })) matches += 1
    })
    const verified = count > 0 && matches === count
    return {
      ok: count > 0,
      detail: count > 0 ? `${visual} view applied to ${count} mesh(es).` : 'The model contains no renderable meshes.',
      verified,
      evidence: verified ? `${matches} of ${count} mesh(es) report ${visual} state.` : '',
      state: getState(),
    }
  }, [applyVisual, ensureEdges, getState])

  const setMode = useCallback((next: ModelMode) => setVisual(next), [setVisual])
  const setHoloMode = useCallback((next: HoloVisualMode) => setVisual(next), [setVisual])

  const explode = useCallback((value: number): ModelControlResult => {
    if (!modelRef.current || planRef.current.length === 0) {
      return { ok: false, detail: 'No model with top-level parts is loaded.', verified: false, evidence: '', state: getState() }
    }
    const amount = clampExplode(value)
    explodeCurrentRef.current = amount
    explodeTargetRef.current = amount
    const moved = applyExplode(amount)
    setExplodeUi(amount)
    publish({ explode: amount })
    const verified = amount === 0 || moved > 1e-4
    return {
      ok: true,
      detail: amount === 0
        ? 'Reassembled every part to its stored original position.'
        : `Exploded view set to ${Math.round(amount * 100)}%.`,
      verified,
      evidence: verified
        ? amount === 0
          ? `All ${planRef.current.length} top-level part(s) were set to their recorded base transforms.`
          : `Largest part offset is ${moved.toFixed(3)} units at ${Math.round(amount * 100)}%.`
        : 'No part has an offset from the model centre, so nothing could separate.',
      state: getState(),
    }
  }, [applyExplode, getState, publish])

  const previewExplode = useCallback((value: number) => {
    const amount = clampExplode(value)
    explodeTargetRef.current = amount
    setExplodeUi(amount)
  }, [])

  const selectPart = useCallback((partName: string): ModelControlResult => {
    if (!modelRef.current) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    const record = findRecord(partName)
    if (!record) {
      return {
        ok: false,
        detail: `No part named "${partName}" exists. The model has ${partsRef.current.length} top-level part(s).`,
        verified: false,
        evidence: '',
        state: getState(),
      }
    }
    selectRecord(record)
    const helper = helperRef.current
    const visible = Boolean(helper?.visible)
    return {
      ok: visible,
      detail: visible ? `Selected "${record.name}".` : `"${record.name}" has empty bounds and could not be highlighted.`,
      verified: visible,
      evidence: visible ? `Selection box drawn around the real mesh bounds of "${record.name}".` : '',
      state: getState(),
    }
  }, [findRecord, getState, selectRecord])

  const hidePart = useCallback((partName: string): ModelControlResult => {
    const record = findRecord(partName)
    if (!record) {
      return { ok: false, detail: `No part named "${partName}" exists.`, verified: false, evidence: '', state: getState() }
    }
    record.object.visible = false
    if (selectedRef.current === record) selectRecord(null)
    return {
      ok: true,
      detail: `Hid "${record.name}" in this view. The file was not changed.`,
      verified: record.object.visible === false,
      evidence: `"${record.name}" is hidden in the scene; the mesh and file still exist.`,
      state: getState(),
    }
  }, [findRecord, getState, selectRecord])

  const isolatePart = useCallback((partName: string): ModelControlResult => {
    const record = findRecord(partName)
    if (!record) {
      return { ok: false, detail: `No part named "${partName}" exists.`, verified: false, evidence: '', state: getState() }
    }
    let hidden = 0
    for (const item of partsRef.current) {
      // View-only visibility on the Three.js scene graph; the file is untouched.
      // eslint-disable-next-line react-hooks/immutability
      item.object.visible = item.object === record.object
      if (!item.object.visible) hidden += 1
    }
    selectRecord(record)
    return {
      ok: true,
      detail: `Isolated "${record.name}". ${hidden} other part(s) hidden in this view only.`,
      verified: record.object.visible === true,
      evidence: `Only "${record.name}" is visible; the file was not changed.`,
      state: getState(),
    }
  }, [findRecord, getState, selectRecord])

  const showAllParts = useCallback((): ModelControlResult => {
    // View-only visibility on the Three.js scene graph; the file is untouched.
    // eslint-disable-next-line react-hooks/immutability
    for (const item of partsRef.current) item.object.visible = true
    return {
      ok: true,
      detail: 'Showing every part again. This only changed the view.',
      verified: partsRef.current.every((item) => item.object.visible),
      evidence: `${partsRef.current.length} top-level part(s) are visible.`,
      state: getState(),
    }
  }, [getState])

  const rotate = useCallback((degrees = -15): ModelControlResult => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls || !modelRef.current) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    const before = THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())
    const offset = camera.position.clone().sub(controls.target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    spherical.theta += THREE.MathUtils.degToRad(degrees)
    offset.setFromSpherical(spherical)
    camera.position.copy(controls.target).add(offset)
    controls.update()
    const after = THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())
    const actual = Math.abs(after - before)
    publish({ cameraAzimuth: after, cameraDistance: camera.position.distanceTo(controls.target) })
    return {
      ok: true,
      detail: `Rotated the view ${Math.abs(degrees)}° ${degrees < 0 ? 'left' : 'right'}.`,
      verified: actual > 0.05,
      evidence: `Camera azimuth changed from ${before.toFixed(1)}° to ${after.toFixed(1)}°.`,
      state: getState(),
    }
  }, [getState, publish])

  const zoom = useCallback((factor = 1.2): ModelControlResult => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls || !modelRef.current) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    const before = camera.position.distanceTo(controls.target)
    const offset = camera.position.clone().sub(controls.target)
    const nextDistance = THREE.MathUtils.clamp(before / Math.max(0.05, factor), controls.minDistance, controls.maxDistance)
    offset.setLength(nextDistance)
    camera.position.copy(controls.target).add(offset)
    controls.update()
    const after = camera.position.distanceTo(controls.target)
    publish({ cameraDistance: after })
    return {
      ok: true,
      detail: factor > 1 ? 'Zoomed in.' : 'Zoomed out.',
      verified: Math.abs(after - before) > 1e-4,
      evidence: `Camera distance changed from ${before.toFixed(2)} to ${after.toFixed(2)} units.`,
      state: getState(),
    }
  }, [getState, publish])

  const reset = useCallback((): ModelControlResult => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const root = modelRef.current
    if (!root || !camera || !controls || !homeRef.current) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    selectRecord(null)
    showAllParts()
    explodeCurrentRef.current = 0
    explodeTargetRef.current = 0
    applyExplode(0)
    setExplodeUi(0)
    ensureEdges(root, qualityRef.current !== 'low')
    applyVisual('hologram')
    camera.position.copy(homeRef.current.position)
    controls.target.copy(homeRef.current.target)
    controls.update()
    const distance = camera.position.distanceTo(controls.target)
    publish({ mode: 'hologram', explode: 0, selectedPart: null })
    return {
      ok: true,
      detail: 'Reset the view, hologram mode, exploded view and selection.',
      verified: modeRef.current === 'hologram' && explodeCurrentRef.current === 0 && selectedRef.current === null,
      evidence: `Camera restored to the home distance of ${distance.toFixed(2)} units; every part is at its recorded base position.`,
      state: getState(),
    }
  }, [applyExplode, applyVisual, ensureEdges, getState, publish, selectRecord, showAllParts])

  const getPartDetails = useCallback((): HoloPartDetails | null => {
    return selectedRef.current ? detailsFor(selectedRef.current) : null
  }, [detailsFor])

  const api = useMemo<HoloModelApi>(
    () => ({
      rotate,
      zoom,
      setMode,
      selectPart,
      explode,
      reset,
      getState,
      setHoloMode,
      hidePart,
      isolatePart,
      showAllParts,
      previewExplode,
      listParts: listDetails,
      getPartDetails,
    }),
    [
      rotate,
      zoom,
      setMode,
      selectPart,
      explode,
      reset,
      getState,
      setHoloMode,
      hidePart,
      isolatePart,
      showAllParts,
      previewExplode,
      listDetails,
      getPartDetails,
    ],
  )

  useEffect(() => {
    const stopModel = registerModelControl(api)
    const stopHolo = registerHoloModel(api)
    return () => {
      stopModel()
      stopHolo()
    }
  }, [api])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      // WebGL failing is reported in the UI, not thrown to the router.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('WebGL could not start in this browser, so the hologram model view is unavailable.')
      setLoading(false)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.setAttribute('aria-label', 'Hologram model viewport')
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene
    const camera = new THREE.PerspectiveCamera(
      45,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.01,
      4000,
    )
    camera.position.set(3, 2, 5)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.minDistance = 0.1
    controls.maxDistance = 200
    controls.target.set(0, 0, 0)
    controls.update()
    controlsRef.current = controls

    scene.add(new THREE.HemisphereLight(0xffe6b0, 0x0e0d13, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(4, 6, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xffc94d, 1.3)
    rim.position.set(-5, 2, -4)
    scene.add(rim)

    const holoMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xf5b800) },
        uTime: { value: 0 },
        uScan: { value: qualityRef.current === 'low' ? 0 : 1 },
        uOpacity: { value: 1 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uScan;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldPos;
        void main() {
          float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.2);
          float band = 0.5 + 0.5 * sin(vWorldPos.y * 16.0 - uTime * 2.2);
          float scan = uScan * smoothstep(0.72, 1.0, band) * 0.4;
          vec3 color = uColor * (0.4 + fresnel * 1.5 + scan);
          float alpha = (0.2 + fresnel * 0.78) * uOpacity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    holoMaterialRef.current = holoMaterial

    const floor = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0xf5b800,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.visible = false
    scene.add(floor)
    floorRef.current = floor

    const scan = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.02),
      new THREE.MeshBasicMaterial({
        color: 0xfff6dc,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    scan.rotation.x = -Math.PI / 2
    scan.visible = false
    scan.raycast = () => {}
    scene.add(scan)
    scanRef.current = scan

    const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffffff))
    helper.visible = false
    helper.renderOrder = 20
    const helperMaterial = helper.material as THREE.LineBasicMaterial
    helperMaterial.depthTest = false
    helperMaterial.transparent = true
    scene.add(helper)
    helperRef.current = helper

    clockRef.current = new THREE.Clock()

    let pointerDown: { x: number; y: number } | null = null
    let lastGestureAt = 0
    let gesturePoint: { x: number; y: number } | null = null

    const pickAt = (clientX: number, clientY: number): PartRecord | null => {
      const root = modelRef.current
      if (!root) return null
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const point = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(point, camera)
      const hits = raycaster.intersectObject(root, true)
      const hit = hits.find((item) => (item.object as THREE.Mesh).isMesh)
      if (!hit) return null
      let object: THREE.Object3D | null = hit.object
      while (object.parent && object.parent !== root) object = object.parent
      return partsRef.current.find((record) => record.object === object) ?? null
    }

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown) return
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
      pointerDown = null
      if (moved > 5) return
      selectRecordRef.current(pickAt(event.clientX, event.clientY))
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const unsubscribe = [
      gestureBus.on('gesture.move', (payload) => {
        if (!gesturesEnabledRef.current || payload.confidence < minConfidenceRef.current) return
        const rect = renderer.domElement.getBoundingClientRect()
        const point = mapCameraToViewport(payload.x, payload.y, rect.width, rect.height, true, 0.02)
        gesturePoint = { x: rect.left + point.x, y: rect.top + point.y }
      }),
      gestureBus.on('gesture.zoom', (payload) => {
        if (!gesturesEnabledRef.current || payload.confidence < minConfidenceRef.current) return
        const next = clampExplode(explodeTargetRef.current + (payload.scale - 1) * 2.4)
        explodeTargetRef.current = next
        setExplodeUi(next)
        onStatusRef.current(`Two-hand spread · exploded view ${Math.round(next * 100)}%`)
      }),
      gestureBus.on('gesture.rotate', (payload) => {
        if (!gesturesEnabledRef.current || payload.confidence < minConfidenceRef.current) return
        const offset = camera.position.clone().sub(controls.target)
        const spherical = new THREE.Spherical().setFromVector3(offset)
        spherical.theta -= payload.delta * 2
        offset.setFromSpherical(spherical)
        camera.position.copy(controls.target).add(offset)
        controls.update()
        onStatusRef.current('Wrist rotation · orbiting the model')
      }),
      gestureBus.on('gesture.pinch_end', (payload) => {
        if (!gesturesEnabledRef.current || payload.confidence < minConfidenceRef.current) return
        if (payload.heldMs > 350) return
        const now = performance.now()
        if (now - lastGestureAt < GESTURE_COOLDOWN_MS) return
        lastGestureAt = now
        if (!gesturePoint) return
        selectRecordRef.current(pickAt(gesturePoint.x, gesturePoint.y))
        onStatusRef.current('Quick pinch · selected the part under your hand')
      }),
    ]

    const onContextLost = (event: Event) => {
      event.preventDefault()
      setError('The graphics context was lost. Reload the page to restore the hologram viewer.')
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)

    const resize = () => {
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
      renderer.setSize(width, height, false)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    let frame = 0
    let running = !document.hidden
    const render = () => {
      if (!running) return
      const time = clockRef.current?.getElapsedTime() ?? 0
      holoMaterial.uniforms.uTime.value = time

      const current = explodeCurrentRef.current
      const target = explodeTargetRef.current
      if (Math.abs(target - current) > 1e-4) {
        const next = Math.abs(target - current) < 0.01 ? target : current + (target - current) * 0.18
        explodeCurrentRef.current = next
        if (modelRef.current && planRef.current.length > 0) {
          for (const item of applyExplodePlan(planRef.current, next)) {
            const child = modelRef.current.children[Number(item.key)]
            if (child) child.position.set(item.position.x, item.position.y, item.position.z)
          }
          if (next === 0) {
            // Snap to the recorded transforms exactly when the tween finishes.
            for (const plan of planRef.current) {
              const child = modelRef.current.children[Number(plan.key)]
              if (child) child.position.set(plan.base.x, plan.base.y, plan.base.z)
            }
          }
        }
      }

      if (selectedRef.current && helper.visible) helper.box.setFromObject(selectedRef.current.object)

      const bounds = explodeBoundsRef.current
      if (scan.visible) {
        const span = Math.max(0.001, bounds.maxY - bounds.minY)
        scan.position.y = bounds.minY + ((Math.sin(time * 0.7) + 1) / 2) * span
      }
      if (floor.visible) floor.rotation.z = time * 0.08

      controls.update()
      renderer.render(scene, camera)
      frame = window.requestAnimationFrame(render)
    }
    const onVisibility = () => {
      if (document.hidden) {
        running = false
        window.cancelAnimationFrame(frame)
      } else if (!running) {
        running = true
        render()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    render()

    return () => {
      running = false
      window.cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      unsubscribe.forEach((stop) => stop())
      controls.dispose()
      selectedRef.current = null
      disposeObject(modelRef.current)
      modelRef.current = null
      partsRef.current = []
      planRef.current = []
      scene.remove(floor)
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      scene.remove(scan)
      scan.geometry.dispose()
      ;(scan.material as THREE.Material).dispose()
      if (helper.material instanceof THREE.Material) helper.material.dispose()
      helper.geometry.dispose()
      scene.remove(helper)
      holoMaterial.dispose()
      holoMaterialRef.current = null
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      blobUrlsRef.current = []
      renderer.dispose()
      renderer.domElement.remove()
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      helperRef.current = null
      scanRef.current = null
      floorRef.current = null
      homeRef.current = null
      clockRef.current = null
    }
    // The viewer is created once; model loading is handled by the path effect below.
  }, [])

  useEffect(() => {
    const root = modelRef.current
    if (!root) return
    if (mode === 'hologram') ensureEdges(root, quality !== 'low')
    applyVisual(mode)
    const holo = holoMaterialRef.current
    if (holo) holo.uniforms.uScan.value = quality === 'low' ? 0 : 1
    const scan = scanRef.current
    if (scan) scan.visible = mode === 'hologram' && quality !== 'low'
    const floor = floorRef.current
    if (floor) floor.visible = mode === 'hologram'
  }, [mode, quality, applyVisual, ensureEdges])

  useEffect(() => {
    const renderer = rendererRef.current
    if (renderer) renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  }, [quality])

  useEffect(() => {
    const token = ++loadTokenRef.current
    const controller = new AbortController()
    // A new file replaces the view state before its bytes arrive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    setParts([])
    setSelected(null)
    setModelStats(null)
    selectedRef.current = null
    explodeCurrentRef.current = 0
    explodeTargetRef.current = 0
    setExplodeUi(0)

    const finish = () => {
      if (token === loadTokenRef.current) setLoading(false)
    }

    const stage = (root: THREE.Group) => {
      const scene = sceneRef.current
      const camera = cameraRef.current
      const controls = controlsRef.current
      if (!scene || !camera || !controls) {
        disposeObject(root)
        return
      }
      if (modelRef.current) disposeObject(modelRef.current)
      modelRef.current = root
      scene.add(root)
      root.updateMatrixWorld(true)

      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh || !mesh.material) return
        if (mesh.geometry && !mesh.geometry.getAttribute('normal')) {
          mesh.geometry.computeVertexNormals()
        }
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mesh.userData.__bozzBase = {
          material: mesh.material,
          wireframe: (materials[0] as THREE.MeshBasicMaterial).wireframe === true,
          transparent: materials[0].transparent,
          opacity: materials[0].opacity,
          depthWrite: materials[0].depthWrite,
        }
      })

      const records: PartRecord[] = root.children.map((child, index) => ({
        key: String(index),
        object: child,
        name: partRecordName(child, index),
      }))
      partsRef.current = records

      const box = new THREE.Box3().setFromObject(root)
      const size3 = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDimension = Math.max(size3.x, size3.y, size3.z) || 1
      const distance = (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.4
      const direction = new THREE.Vector3(1, 0.72, 1).normalize()
      camera.position.copy(center).add(direction.multiplyScalar(distance))
      camera.near = Math.max(0.001, maxDimension / 500)
      camera.far = Math.max(100, maxDimension * 100)
      camera.updateProjectionMatrix()
      controls.target.copy(center)
      controls.minDistance = Math.max(0.02, maxDimension * 0.03)
      controls.maxDistance = Math.max(5, maxDimension * 25)
      controls.update()
      homeRef.current = { position: camera.position.clone(), target: controls.target.clone() }

      explodeBoundsRef.current = { minY: box.min.y, maxY: box.max.y }
      const localCenter = root.worldToLocal(center.clone())
      planRef.current = buildExplodePlan(
        records.map((record) => ({
          key: record.key,
          base: { x: record.object.position.x, y: record.object.position.y, z: record.object.position.z },
        })),
        localCenter,
        Math.max(0.25, maxDimension * 0.45),
      )

      const floor = floorRef.current
      if (floor) {
        const radius = Math.max(maxDimension * 0.72, 0.5)
        floor.geometry.dispose()
        floor.geometry = new THREE.RingGeometry(radius * 0.82, radius, 64)
        floor.position.set(center.x, box.min.y - maxDimension * 0.02, center.z)
      }
      const scan = scanRef.current
      if (scan) {
        scan.geometry.dispose()
        scan.geometry = new THREE.PlaneGeometry(maxDimension * 1.35, Math.max(0.01, maxDimension * 0.015))
        scan.position.set(center.x, center.y, center.z)
      }
      applyVisual(modeRef.current)
      const holo = holoMaterialRef.current
      if (holo) holo.uniforms.uScan.value = qualityRef.current === 'low' ? 0 : 1
      if (scan) scan.visible = modeRef.current === 'hologram' && qualityRef.current !== 'low'
      if (floor) floor.visible = modeRef.current === 'hologram'

      const detailList = records.slice(0, MAX_LISTED_PARTS).map((record) => {
        const partBox = new THREE.Box3().setFromObject(record.object)
        const partSize = partBox.getSize(new THREE.Vector3())
        return {
          name: record.name,
          type: record.object.type,
          size: [partSize.x, partSize.y, partSize.z] as [number, number, number],
          triangles: triangleCount(record.object),
        }
      })
      const triangles = records.reduce((sum, record) => sum + triangleCount(record.object), 0)
      setParts(detailList)
      setModelStats({ parts: records.length, triangles })

      explodeCurrentRef.current = 0
      explodeTargetRef.current = 0
      setExplodeUi(0)
      publish({
        loaded: true,
        source: `${name} · ${formatBytes(size)}`,
        mode: modeRef.current,
        explode: 0,
        selectedPart: null,
        parts: detailList.map((item) => item.name),
        cameraAzimuth: THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()),
        cameraDistance: camera.position.distanceTo(controls.target),
      })
    }

    const load = async () => {
      try {
        const response = await fetch(modelUrl(path), { signal: controller.signal })
        if (!response.ok) {
          const detail = await readDetail(response)
          throw new Error(detail || `The backend could not read this model (${response.status}).`)
        }
        const loader = new GLTFLoader()
        let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>
        if (path.toLowerCase().endsWith('.gltf')) {
          const text = await response.text()
          let document: {
            buffers?: Array<{ uri?: string }>
            images?: Array<{ uri?: string }>
          }
          try {
            document = JSON.parse(text) as typeof document
          } catch {
            throw new Error('This .gltf file is not valid JSON.')
          }
          const sidecars = findSidecars(document, path)
          for (const item of [...sidecars.buffers, ...sidecars.images]) {
            const sidecar = await fetch(rawUrl(item.resolved), { signal: controller.signal })
            if (!sidecar.ok) {
              throw new Error(`The .gltf references "${item.uri}", which could not be read from the allowed folder.`)
            }
            const blob = await sidecar.blob()
            const url = URL.createObjectURL(blob)
            blobUrlsRef.current.push(url)
            if (document.buffers) {
              for (const buffer of document.buffers) if (buffer.uri === item.uri) buffer.uri = url
            }
            if (document.images) {
              for (const image of document.images) if (image.uri === item.uri) image.uri = url
            }
          }
          const jsonBlob = new Blob([JSON.stringify(document)], { type: 'model/gltf+json' })
          const jsonUrl = URL.createObjectURL(jsonBlob)
          blobUrlsRef.current.push(jsonUrl)
          gltf = await loader.loadAsync(jsonUrl)
        } else {
          const buffer = await response.arrayBuffer()
          gltf = await loader.parseAsync(buffer, '')
        }
        if (token !== loadTokenRef.current) {
          disposeObject(gltf.scene)
          return
        }
        stage(gltf.scene)
      } catch (caught) {
        if (token !== loadTokenRef.current) return
        const message = caught instanceof Error ? caught.message : 'Unknown loader error.'
        setError(`Could not load "${name}". ${message}`)
      } finally {
        finish()
      }
    }
    void load()

    return () => {
      controller.abort()
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      blobUrlsRef.current = []
    }
  }, [path, name, size, applyVisual, publish])

  const large = size > LARGE_FILE_BYTES
  const selectedRecord = selected

  return (
    <div className="holo-model" role="region" aria-label={`Hologram model viewer: ${name}`}>
      <header className="holo-model__head">
        <div>
          <h2>
            <Box aria-hidden="true" /> {name}
          </h2>
          <p>
            {modelStats
              ? `${modelStats.parts} top-level part(s) · ${modelStats.triangles.toLocaleString()} triangles · ${formatBytes(size)}`
              : `Real file · ${formatBytes(size)}`}
            {' '}· read-only scene on the monitor, not a real hologram
          </p>
        </div>
        <button type="button" className="icon-action" onClick={onClose} aria-label="Close the model viewer">
          <X />
        </button>
      </header>

      {large && (
        <p className="holo-model__warning" role="status">
          This model is {formatBytes(size)}. It is above 50 MB, so it may be slow on this computer. BOZZ keeps the pixel
          ratio at 1.5× and pauses rendering while this tab is hidden.
        </p>
      )}
      {error && <p className="holo-model__error" role="alert">{error}</p>}
      {loading && (
        <p className="holo-model__loading" role="status">
          <Loader2 className="spin" /> Reading the model through the read-only allowed-folder API…
        </p>
      )}

      <div className="holo-model__toolbar">
        <div className="holo-model__modes" role="group" aria-label="Model display mode">
          {VISUAL_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={mode === item.id ? 'is-active' : ''}
              aria-pressed={mode === item.id}
              onClick={() => { api.setHoloMode(item.id) }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="holo-model__explode">
          <span>Explode <strong>{Math.round(explodeUi * 100)}%</strong></span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(explodeUi * 100)}
            aria-label="Explode the model parts"
            onChange={(event) => api.previewExplode(Number(event.target.value) / 100)}
          />
        </label>
        <button type="button" className="ghost-action" onClick={() => { api.explode(0) }}>
          <RotateCcw /> Reassemble
        </button>
      </div>

      <div className="holo-model__body">
        <div className="holo-model__stage">
          <div className="holo-scanlines" aria-hidden="true" data-quality={quality} />
          <div className="holo-model__canvas" ref={containerRef} />
        </div>
        <aside className="holo-model__parts" aria-label="Model parts">
          <h3>Parts from the file</h3>
          {parts.length === 0 ? (
            <p className="holo-model__muted">No top-level parts are loaded yet.</p>
          ) : (
            <ul>
              {parts.map((part) => (
                <li key={part.name} className={selected?.name === part.name ? 'is-selected' : ''}>
                  <button type="button" onClick={() => { api.selectPart(part.name) }}>
                    <strong>{part.name}</strong>
                    <small>
                      {part.size.map((value) => value.toFixed(2)).join(' × ')} units · {part.triangles.toLocaleString()} triangles
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedRecord && (
            <div className="holo-model__selected">
              <h4>Selected part</h4>
              <dl>
                <div><dt>Name</dt><dd>{selectedRecord.name}</dd></div>
                <div><dt>Type</dt><dd>{selectedRecord.type}</dd></div>
                <div><dt>Bounds</dt><dd>{selectedRecord.size.map((value) => value.toFixed(2)).join(' × ')}</dd></div>
                <div><dt>Triangles</dt><dd>{selectedRecord.triangles.toLocaleString()}</dd></div>
              </dl>
              <p className="holo-model__muted">
                Names and sizes come from the file. BOZZ does not invent part descriptions.
              </p>
            </div>
          )}

          <div className="holo-model__part-actions">
            <button
              type="button"
              className="ghost-action"
              disabled={!selectedRecord}
              onClick={() => { if (selectedRecord) api.hidePart(selectedRecord.name) }}
            >
              <EyeOff /> Hide part
            </button>
            <button
              type="button"
              className="ghost-action"
              disabled={!selectedRecord}
              onClick={() => { if (selectedRecord) api.isolatePart(selectedRecord.name) }}
            >
              <Eye /> Isolate part
            </button>
            <button type="button" className="ghost-action" onClick={() => { api.showAllParts() }}>
              Show all
            </button>
          </div>
          <p className="panel-note">
            Hiding or isolating changes only this view. The file is never modified.
          </p>
        </aside>
      </div>
    </div>
  )
}
