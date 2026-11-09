import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type Ref,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyExplodePlan, buildExplodePlan, clampExplode, type ExplodePlanItem } from './explode'
import { collectSceneParts } from './analysis/sceneParts'
import { hashModelFile } from './analysis/hash'
import type { BoundsInput, ModelPartInput } from './analysis/intelligence'
import {
  registerModelControl,
  type ModelControlApi,
  type ModelControlResult,
  type ModelMode,
  type ModelViewerState,
} from './modelControl'

const MAX_PIXEL_RATIO = 1.5
const LARGE_FILE_BYTES = 50 * 1024 * 1024
const MAX_PARTS = 60

export interface ModelFileInfo {
  name: string
  sizeLabel: string
  sizeBytes: number
  large: boolean
  kind: 'sample' | 'file'
  /** SHA-256 of the exact bytes, or a fixed key for the generated sample. */
  hash: string
}

export interface ModelScenePayload {
  hash: string
  fileName: string
  sizeBytes: number
  parts: ModelPartInput[]
  bounds: BoundsInput
  center: [number, number, number]
  warning: string | null
}

export interface ModelViewerApi extends ModelControlApi {
  loadFiles(files: File[]): Promise<void>
  loadSample(): void
  /** View-only visibility; the file is never changed. */
  setPartVisible(name: string, visible: boolean): boolean
}

export interface ModelViewerProps {
  onStateChange: (state: ModelViewerState) => void
  onLoading: (loading: boolean) => void
  onError: (message: string | null) => void
  onFileInfo: (info: ModelFileInfo) => void
  onSceneParts?: (payload: ModelScenePayload) => void
}

type MeshRecord = { mesh: THREE.Mesh; label: string }

const INITIAL_STATE: ModelViewerState = {
  loaded: false,
  source: 'No model',
  mode: 'solid',
  explode: 0,
  selectedPart: null,
  parts: [],
  cameraAzimuth: 0,
  cameraDistance: 0,
  revision: 0,
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function meshRecords(root: THREE.Object3D): MeshRecord[] {
  const records: MeshRecord[] = []
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return
    const mesh = object as THREE.Mesh
    const index = records.length + 1
    records.push({ mesh, label: mesh.name.trim() || `Unnamed mesh ${index}` })
  })
  return records
}

function disposeObject(root: THREE.Object3D | null): void {
  if (!root) return
  root.parent?.remove(root)
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (!mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) {
          (value as THREE.Texture).dispose()
        }
      }
      material.dispose()
    }
  })
}

function materialLooksLike(mode: ModelMode, material: THREE.Material): boolean {
  const base = material.userData.bozzBase as {
    wireframe: boolean
    transparent: boolean
    opacity: number
  } | undefined
  if (!base) return false
  if (mode === 'wireframe') return (material as THREE.MeshBasicMaterial).wireframe === true
  if (mode === 'transparent') return material.transparent && material.opacity <= 0.5
  return (
    (material as THREE.MeshBasicMaterial).wireframe === base.wireframe &&
    material.opacity === base.opacity
  )
}

export const ModelViewer = forwardRef(function ModelViewer(
  props: ModelViewerProps,
  ref: Ref<ModelViewerApi | null>,
) {
  const { onStateChange, onLoading, onError, onFileInfo, onSceneParts } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelRef = useRef<THREE.Object3D | null>(null)
  const selectionRef = useRef<THREE.Box3Helper | null>(null)
  const selectedMeshRef = useRef<THREE.Mesh | null>(null)
  const explodePlanRef = useRef<ExplodePlanItem[]>([])
  const homeRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const objectUrlsRef = useRef<string[]>([])
  const loadTokenRef = useRef(0)
  const stateRef = useRef<ModelViewerState>(INITIAL_STATE)
  const onStateChangeRef = useRef(onStateChange)
  const onLoadingRef = useRef(onLoading)
  const onErrorRef = useRef(onError)
  const onFileInfoRef = useRef(onFileInfo)
  const onScenePartsRef = useRef(onSceneParts)

  onStateChangeRef.current = onStateChange
  onLoadingRef.current = onLoading
  onErrorRef.current = onError
  onFileInfoRef.current = onFileInfo
  onScenePartsRef.current = onSceneParts

  const publish = useCallback((patch: Partial<ModelViewerState>) => {
    const next = { ...stateRef.current, ...patch, revision: stateRef.current.revision + 1 }
    stateRef.current = next
    onStateChangeRef.current(next)
  }, [])

  const reportLoading = useCallback((loading: boolean) => {
    onLoadingRef.current(loading)
  }, [])

  const reportError = useCallback((message: string | null) => {
    onErrorRef.current(message)
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

  const clearSelectionHelper = useCallback(() => {
    selectedMeshRef.current = null
    if (selectionRef.current) selectionRef.current.visible = false
  }, [])

  const selectionHelperFor = useCallback((mesh: THREE.Mesh): boolean => {
    const helper = selectionRef.current
    if (!helper) return false
    helper.box.setFromObject(mesh)
    helper.visible = !helper.box.isEmpty()
    selectedMeshRef.current = mesh
    return helper.visible
  }, [])

  const refreshSelectionHelper = useCallback(() => {
    const mesh = selectedMeshRef.current
    const helper = selectionRef.current
    if (!mesh || !helper || !helper.visible) return
    helper.box.setFromObject(mesh)
  }, [])

  const applyMode = useCallback((mode: ModelMode): number => {
    const root = modelRef.current
    if (!root) return 0
    let meshes = 0
    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        const base = material.userData.bozzBase as {
          wireframe: boolean
          transparent: boolean
          opacity: number
          depthWrite: boolean
        } | undefined
        if (!base) continue
        if (mode === 'wireframe') {
          ;(material as THREE.MeshBasicMaterial).wireframe = true
          material.transparent = base.transparent
          material.opacity = base.opacity
          material.depthWrite = base.depthWrite
        } else if (mode === 'transparent') {
          ;(material as THREE.MeshBasicMaterial).wireframe = base.wireframe
          material.transparent = true
          material.opacity = Math.min(base.opacity, 0.32)
          material.depthWrite = false
        } else {
          ;(material as THREE.MeshBasicMaterial).wireframe = base.wireframe
          material.transparent = base.transparent
          material.opacity = base.opacity
          material.depthWrite = base.depthWrite
        }
        material.needsUpdate = true
      }
      meshes += 1
    })
    return meshes
  }, [])

  const selectObject = useCallback((mesh: THREE.Mesh, label: string): ModelControlResult => {
    const visible = selectionHelperFor(mesh)
    publish({ selectedPart: visible ? label : null })
    return {
      ok: visible,
      detail: visible
        ? `Selected "${label}" (${mesh.type}).`
        : `The mesh "${label}" has empty bounds and could not be highlighted.`,
      verified: visible,
      evidence: visible ? `Highlight box drawn around mesh "${label}".` : '',
      state: getState(),
    }
  }, [getState, publish, selectionHelperFor])

  const selectPart = useCallback((name: string): ModelControlResult => {
    const root = modelRef.current
    if (!root) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    const records = meshRecords(root)
    const wanted = name.trim().toLowerCase()
    const match =
      records.find((item) => item.label === name.trim() || item.mesh.name === name.trim()) ??
      records.find((item) => item.label.toLowerCase() === wanted)
    if (!match) {
      return {
        ok: false,
        detail: `No part named "${name}" exists. The model has ${records.length} mesh(es).`,
        verified: false,
        evidence: '',
        state: getState(),
      }
    }
    return selectObject(match.mesh, match.label)
  }, [getState, selectObject])

  const setPartVisible = useCallback((name: string, visible: boolean): boolean => {
    const root = modelRef.current
    if (!root) return false
    const wanted = name.trim().toLowerCase()
    const record = meshRecords(root).find(
      (item) => item.label === name.trim() || item.mesh.name === name.trim() || item.label.toLowerCase() === wanted,
    )
    if (!record) return false
    // View-only visibility; the geometry and the file are untouched.
    // eslint-disable-next-line react-hooks/immutability
    record.mesh.visible = visible
    if (!visible && selectedMeshRef.current === record.mesh) {
      clearSelectionHelper()
      publish({ selectedPart: null })
    }
    return record.mesh.visible === visible
  }, [clearSelectionHelper, publish])

  const setMode = useCallback((mode: ModelMode): ModelControlResult => {
    if (!modelRef.current) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    const count = applyMode(mode)
    let matches = 0
    modelRef.current.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.every((material) => materialLooksLike(mode, material))) matches += 1
    })
    publish({ mode })
    const verified = count > 0 && matches === count
    return {
      ok: count > 0,
      detail: count > 0
        ? `Set ${mode} mode on ${count} mesh(es).`
        : 'The model contains no renderable meshes.',
      verified,
      evidence: verified ? `${matches} of ${count} mesh(es) report ${mode} material state.` : '',
      state: getState(),
    }
  }, [applyMode, getState, publish])

  const explode = useCallback((value: number): ModelControlResult => {
    const root = modelRef.current
    if (!root || explodePlanRef.current.length === 0) {
      return { ok: false, detail: 'No model with top-level parts is loaded.', verified: false, evidence: '', state: getState() }
    }
    const amount = clampExplode(value)
    const positions = applyExplodePlan(explodePlanRef.current, amount)
    let moved = 0
    for (const item of positions) {
      const child = root.children[Number(item.key)]
      if (!child) continue
      const plan = explodePlanRef.current.find((entry) => entry.key === item.key)
      child.position.set(item.position.x, item.position.y, item.position.z)
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
    refreshSelectionHelper()
    publish({ explode: amount })
    const verified = amount === 0 || moved > 1e-4
    return {
      ok: true,
      detail: amount === 0
        ? 'Exploded view restored to the original positions.'
        : `Exploded view set to ${Math.round(amount * 100)}%.`,
      verified,
      evidence: verified
        ? `Largest top-level part offset is ${moved.toFixed(3)} units at ${Math.round(amount * 100)}%.`
        : 'No top-level part has an offset from the model centre, so nothing could separate.',
      state: getState(),
    }
  }, [getState, publish, refreshSelectionHelper])

  const reset = useCallback((): ModelControlResult => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!modelRef.current || !camera || !controls || !homeRef.current) {
      return { ok: false, detail: 'No model is loaded.', verified: false, evidence: '', state: getState() }
    }
    clearSelectionHelper()
    applyMode('solid')
    const root = modelRef.current
    for (const plan of explodePlanRef.current) {
      const child = root.children[Number(plan.key)]
      if (child) child.position.set(plan.base.x, plan.base.y, plan.base.z)
    }
    camera.position.copy(homeRef.current.position)
    controls.target.copy(homeRef.current.target)
    controls.update()
    const distance = camera.position.distanceTo(controls.target)
    publish({ mode: 'solid', explode: 0, selectedPart: null })
    const verified =
      stateRef.current.mode === 'solid' &&
      stateRef.current.explode === 0 &&
      stateRef.current.selectedPart === null
    return {
      ok: true,
      detail: 'Reset the view, solid mode, exploded view and selection.',
      verified,
      evidence: `Camera restored to the home distance of ${distance.toFixed(2)} units; materials report solid mode.`,
      state: getState(),
    }
  }, [applyMode, clearSelectionHelper, getState, publish])

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
    publish({
      cameraAzimuth: after,
      cameraDistance: camera.position.distanceTo(controls.target),
    })
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
    const requested = before / Math.max(0.05, factor)
    const nextDistance = THREE.MathUtils.clamp(requested, controls.minDistance, controls.maxDistance)
    offset.setLength(nextDistance)
    camera.position.copy(controls.target).add(offset)
    controls.update()
    const after = camera.position.distanceTo(controls.target)
    publish({ cameraDistance: after })
    const verified = Math.abs(after - before) > 1e-4
    return {
      ok: true,
      detail: factor > 1 ? 'Zoomed in.' : 'Zoomed out.',
      verified,
      evidence: `Camera distance changed from ${before.toFixed(2)} to ${after.toFixed(2)} units.`,
      state: getState(),
    }
  }, [getState, publish])

  const stageModel = useCallback((root: THREE.Object3D, source: string, info: ModelFileInfo) => {
    const scene = sceneRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!scene || !camera || !controls) {
      disposeObject(root)
      return
    }

    if (modelRef.current) {
      disposeObject(modelRef.current)
      modelRef.current = null
    }
    clearSelectionHelper()
    explodePlanRef.current = []
    homeRef.current = null

    scene.add(root)
    modelRef.current = root
    root.updateMatrixWorld(true)

    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (!material.userData.bozzBase) {
          material.userData.bozzBase = {
            wireframe: (material as THREE.MeshBasicMaterial).wireframe === true,
            transparent: material.transparent,
            opacity: material.opacity,
            depthWrite: material.depthWrite,
          }
        }
      }
    })

    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const worldCenter = box.getCenter(new THREE.Vector3())
    const maxDimension = Math.max(size.x, size.y, size.z) || 1
    const distance = (maxDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.35
    const direction = new THREE.Vector3(1, 0.72, 1).normalize()
    camera.position.copy(worldCenter).add(direction.multiplyScalar(distance))
    camera.near = Math.max(0.001, maxDimension / 500)
    camera.far = Math.max(100, maxDimension * 100)
    camera.updateProjectionMatrix()
    controls.target.copy(worldCenter)
    controls.minDistance = Math.max(0.02, maxDimension * 0.03)
    controls.maxDistance = Math.max(5, maxDimension * 25)
    controls.update()
    homeRef.current = {
      position: camera.position.clone(),
      target: controls.target.clone(),
    }

    const localCenter = root.worldToLocal(worldCenter.clone())
    const parts = root.children.map((child, index) => ({
      key: String(index),
      base: { x: child.position.x, y: child.position.y, z: child.position.z },
    }))
    explodePlanRef.current = buildExplodePlan(parts, localCenter, Math.max(0.25, maxDimension * 0.45))

    const labels = meshRecords(root).slice(0, MAX_PARTS).map((record) => record.label)
    publish({
      loaded: true,
      source,
      mode: 'solid',
      explode: 0,
      selectedPart: null,
      parts: labels,
      cameraAzimuth: THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()),
      cameraDistance: camera.position.distanceTo(controls.target),
    })

    if (onScenePartsRef.current) {
      try {
        const collected = collectSceneParts(root)
        onScenePartsRef.current({
          hash: info.hash,
          fileName: info.name,
          sizeBytes: info.sizeBytes,
          parts: collected.parts,
          bounds: collected.bounds,
          center: collected.center,
          warning: collected.warning,
        })
      } catch {
        // Geometry collection is diagnostic only; it never blocks the viewer.
      }
    }
  }, [clearSelectionHelper, publish])

  const loadModelFromUrl = useCallback(async (
    url: string,
    info: ModelFileInfo,
    manager: THREE.LoadingManager,
  ) => {
    const token = ++loadTokenRef.current
    reportLoading(true)
    reportError(null)
    try {
      const loader = new GLTFLoader(manager)
      const gltf = await loader.loadAsync(url)
      if (token !== loadTokenRef.current) {
        disposeObject(gltf.scene)
        return
      }
      stageModel(gltf.scene, `${info.name} · ${info.sizeLabel}`, info)
      onFileInfoRef.current(info)
    } catch (caught) {
      if (token !== loadTokenRef.current) return
      const reason = caught instanceof Error ? caught.message : 'Unknown loader error.'
      reportError(
        `Could not load "${info.name}". The file may be corrupt or a .gltf may be missing its .bin or texture files. ${reason}`,
      )
    } finally {
      if (token === loadTokenRef.current) reportLoading(false)
    }
  }, [reportError, reportLoading, stageModel])

  const loadSample = useCallback(() => {
    const token = ++loadTokenRef.current
    reportLoading(false)
    reportError(null)
    const group = new THREE.Group()
    group.name = 'Built-in sample'

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xf5b800, metalness: 0.28, roughness: 0.38 }),
    )
    cube.name = 'Cube'
    cube.position.set(-0.85, 0.15, 0)
    cube.rotation.set(0.28, 0.5, 0.12)

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xfff6dc, metalness: 0.35, roughness: 0.3 }),
    )
    sphere.name = 'Sphere'
    sphere.position.set(0.85, -0.1, 0)

    group.add(cube, sphere)
    if (token !== loadTokenRef.current) {
      disposeObject(group)
      return
    }
    stageModel(group, 'Built-in sample (Cube + Sphere) · generated locally', {
      name: 'Built-in sample (Cube + Sphere)',
      sizeLabel: 'generated locally',
      sizeBytes: 0,
      large: false,
      kind: 'sample',
      hash: 'sample:cube-sphere:v1',
    })
    onFileInfoRef.current({
      name: 'Built-in sample (Cube + Sphere)',
      sizeLabel: 'generated locally',
      sizeBytes: 0,
      large: false,
      kind: 'sample',
      hash: 'sample:cube-sphere:v1',
    })
  }, [reportError, reportLoading, stageModel])

  const loadFiles = useCallback(async (files: File[]) => {
    const modelFile = files.find((file) => /\.(glb|gltf)$/i.test(file.name))
    if (!modelFile) {
      reportError('Choose one .glb or .gltf file. Other files may be selected alongside it as resources.')
      return
    }
    const info: ModelFileInfo = {
      name: modelFile.name,
      sizeLabel: formatBytes(modelFile.size),
      sizeBytes: modelFile.size,
      large: modelFile.size > LARGE_FILE_BYTES,
      kind: 'file',
      hash: `pending:${modelFile.name}:${modelFile.size}`,
    }
    onFileInfoRef.current(info)

    try {
      info.hash = await hashModelFile(await modelFile.arrayBuffer())
      onFileInfoRef.current({ ...info })
    } catch {
      // The pending hash is deterministic for this name/size pair; the panel
      // labels persistence as unverified only when crypto is unavailable.
    }

    const token = ++loadTokenRef.current
    const urls = files.map((file) => URL.createObjectURL(file))
    objectUrlsRef.current = urls
    const byName = new Map<string, string>()
    files.forEach((file, index) => {
      byName.set(file.name.toLowerCase(), urls[index])
      byName.set(file.name.split('/').pop()!.toLowerCase(), urls[index])
    })
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((url) => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url
      let decoded: string
      try {
        decoded = decodeURIComponent(url.split('?')[0])
      } catch {
        decoded = url.split('?')[0]
      }
      const fileName = decoded.split('/').pop()?.toLowerCase() ?? decoded.toLowerCase()
      return byName.get(decoded.toLowerCase()) ?? byName.get(fileName) ?? url
    })

    try {
      await loadModelFromUrl(urls[files.indexOf(modelFile)], info, manager)
    } finally {
      if (token === loadTokenRef.current) {
        urls.forEach((url) => URL.revokeObjectURL(url))
        objectUrlsRef.current = []
      }
    }
  }, [loadModelFromUrl, reportError])

  const api = useMemo<ModelViewerApi>(() => ({
    rotate,
    zoom,
    setMode,
    selectPart,
    explode,
    reset,
    getState,
    loadFiles,
    loadSample,
    setPartVisible,
  }), [explode, getState, loadFiles, loadSample, reset, rotate, selectPart, setMode, setPartVisible, zoom])

  useImperativeHandle(ref, () => api, [api])

  useEffect(() => registerModelControl(api), [api])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      reportError('WebGL could not start in this browser. The 3D viewer is unavailable.')
      reportLoading(false)
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D model viewport')
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#07060a')
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      45,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.01,
      1000,
    )
    camera.position.set(3.2, 2.2, 4.2)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.minDistance = 0.1
    controls.maxDistance = 80
    controls.target.set(0, 0, 0)
    controls.update()
    controlsRef.current = controls

    scene.add(new THREE.HemisphereLight(0xffe6b0, 0x0e0d13, 1.7))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(4, 6, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xffc94d, 1.5)
    rim.position.set(-5, 2, -4)
    scene.add(rim)

    const grid = new THREE.GridHelper(20, 20, 0x4a3608, 0x1a1408)
    const gridMaterial = grid.material as THREE.Material
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.45
    scene.add(grid)

    const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffd34d))
    helper.visible = false
    helper.renderOrder = 20
    const helperMaterial = helper.material as THREE.LineBasicMaterial
    helperMaterial.depthTest = false
    helperMaterial.transparent = true
    scene.add(helper)
    selectionRef.current = helper

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY }
    }
    let pointerDown: { x: number; y: number } | null = null
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown) return
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
      pointerDown = null
      if (moved > 5 || !modelRef.current) return
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const point = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(point, camera)
      const hits = raycaster.intersectObject(modelRef.current, true)
      const hit = hits.find((item) => (item.object as THREE.Mesh).isMesh)
      if (!hit) {
        clearSelectionHelper()
        publish({ selectedPart: null })
        return
      }
      const mesh = hit.object as THREE.Mesh
      const index = meshRecords(modelRef.current).findIndex((record) => record.mesh === mesh)
      const label = mesh.name.trim() || `Unnamed mesh ${index + 1}`
      selectObject(mesh, label)
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const onContextLost = (event: Event) => {
      event.preventDefault()
      reportError('The graphics context was lost. Reload the page to restore the 3D viewer.')
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
    loadSample()

    return () => {
      loadTokenRef.current += 1
      running = false
      window.cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      controls.dispose()
      clearSelectionHelper()
      disposeObject(modelRef.current)
      modelRef.current = null
      scene.remove(grid)
      grid.geometry.dispose()
      gridMaterial.dispose()
      if (helper.material instanceof THREE.Material) helper.material.dispose()
      helper.geometry.dispose()
      scene.remove(helper)
      renderer.dispose()
      renderer.domElement.remove()
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      objectUrlsRef.current = []
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      selectionRef.current = null
      homeRef.current = null
      explodePlanRef.current = []
    }
  }, [clearSelectionHelper, loadSample, publish, reportError, reportLoading, selectObject])

  return <div className="model-viewer" ref={containerRef} />
})
