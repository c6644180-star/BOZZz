// Adapted from ultron-by-sagar-builds-main (lib/orbScene.ts).
// Copyright (c) 2026 Sagar Tamang. MIT License — see THIRD_PARTY_LICENSES.md.
// Changes: crystalline gold/white core, faceted derivative shading, counter-rotating
// cages, ring shards, quality profiles, real state visuals and full React disposal.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { OrbState } from '../../types/bozz'
import { ORB_QUALITY, type OrbPalette, type OrbRenderQuality } from '../../theme/orbTheme'

export interface OrbSceneApi {
  setState(state: OrbState): void
  setLevel(level: number): void
  setPalette(palette: OrbPalette): void
  setPaused(paused: boolean): void
  setFps(fps: number): void
  dispose(): void
}

interface OrbSceneOptions {
  palette: OrbPalette
  quality: OrbRenderQuality
  state: OrbState
  reducedMotion?: boolean
  /** Frame cap override; the mini orb drops to ~12 fps while idle. */
  fps?: number
  /** Floating mini window: no scene background so the desktop shows through. */
  transparent?: boolean
  /** Skip the floor plane and camera controls for the 120 px mini orb. */
  minimal?: boolean
  /** Camera drag/zoom is only useful on the full-screen orb. */
  interactive?: boolean
}

type TintKey = keyof OrbPalette

interface ColorEntry {
  mat: THREE.Material & { color: THREE.Color }
  key: TintKey
  hot: boolean
}

interface StateTarget {
  activity: number
  glow: number
  spin: number
  bloom: number
}

const HOME_POSITION = new THREE.Vector3(0, 0.24, 5.9)
const MIN_DISTANCE = 3.2
const MAX_DISTANCE = 8.5
const CORE_RADIUS = 1.12
const RING_RADIUS = 1.94
const FOG_DENSITY = 0.065

const STATE_TARGET: Record<OrbState, StateTarget> = {
  idle: { activity: 0.18, glow: 0.35, spin: 0.35, bloom: 0.5 },
  listening: { activity: 0.5, glow: 0.58, spin: 0.85, bloom: 0.68 },
  thinking: { activity: 0.9, glow: 0.72, spin: 2.0, bloom: 0.82 },
  speaking: { activity: 0.6, glow: 0.85, spin: 1.15, bloom: 0.76 },
  error: { activity: 0.55, glow: 1.0, spin: 1.4, bloom: 0.68 },
  offline: { activity: 0.05, glow: 0.12, spin: 0.12, bloom: 0.15 },
}

const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate)

export function createOrbScene(container: HTMLElement, options: OrbSceneOptions): OrbSceneApi {
  const profile = ORB_QUALITY[options.quality]
  const reducedMotion = options.reducedMotion === true
  const transparent = options.transparent === true
  const minimal = options.minimal === true
  let palette = options.palette
  let currentState: OrbState = options.state
  let disposed = false
  let userPaused = false

  const width = Math.max(1, container.clientWidth)
  const height = Math.max(1, container.clientHeight)

  const scene = new THREE.Scene()
  const background = new THREE.Color(palette.background)
  scene.background = transparent ? null : background
  if (!transparent) scene.fog = new THREE.FogExp2(palette.background, FOG_DENSITY)

  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 60)
  camera.position.copy(HOME_POSITION)

  const initialRatio = Math.min(window.devicePixelRatio || 1, profile.pixelRatio)
  const renderer = new THREE.WebGLRenderer({
    antialias: profile.antialias,
    alpha: transparent,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(initialRatio)
  renderer.setSize(width, height, false)
  renderer.setClearColor(palette.background, transparent ? 0 : 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02
  renderer.domElement.className = 'orb-canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  container.appendChild(renderer.domElement)

  const textures: THREE.Texture[] = []
  const baseColors = {} as Record<TintKey, THREE.Color>
  for (const key of Object.keys(palette) as TintKey[]) baseColors[key] = new THREE.Color(palette[key])
  const errorColor = new THREE.Color(palette.error)
  const errorHotColor = new THREE.Color(palette.errorHot)

  const colored: ColorEntry[] = []
  function track<T extends THREE.Material & { color: THREE.Color }>(mat: T, key: TintKey, hot = false): T {
    colored.push({ mat, key, hot })
    return mat
  }

  const staticMats: Array<{ mat: THREE.Material & { opacity: number }; base: number }> = []

  // ── Crystalline core ────────────────────────────────────────────────────
  const orbGroup = new THREE.Group()
  scene.add(orbGroup)

  const coreUniforms = {
    uTime: { value: 0 },
    uActivity: { value: 0 },
    uGlow: { value: 0 },
    uDim: { value: 0 },
    uColor: { value: baseColors.core.clone() },
    uColorDeep: { value: baseColors.coreDeep.clone() },
    uColorWhite: { value: baseColors.coreWhite.clone() },
  }

  const coreMaterial = new THREE.ShaderMaterial({
    uniforms: coreUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uActivity;
      varying vec3 vViewPos;
      void main() {
        vec3 p = position;
        float wobble = sin(p.x * 3.1 + uTime * 0.9) * sin(p.y * 2.7 - uTime * 0.7) * sin(p.z * 3.3 + uTime * 0.5);
        p += normal * wobble * (0.012 + uActivity * 0.02);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uColorDeep;
      uniform vec3 uColorWhite;
      uniform float uTime;
      uniform float uActivity;
      uniform float uGlow;
      uniform float uDim;
      varying vec3 vViewPos;

      void main() {
        vec3 viewDir = normalize(-vViewPos);
        vec3 flatNormal = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
        if (dot(flatNormal, viewDir) < 0.0) flatNormal = -flatNormal;

        float facing = clamp(dot(flatNormal, viewDir), 0.0, 1.0);
        vec3 keyDir = normalize(vec3(-0.35, 0.65, 0.68));
        float key = clamp(dot(flatNormal, keyDir), 0.0, 1.0);
        float rim = pow(1.0 - facing, 2.4);
        vec3 reflectDir = reflect(-keyDir, flatNormal);
        float sparkle = pow(clamp(dot(reflectDir, viewDir), 0.0, 1.0), 26.0);
        float facetShift = 0.5 + 0.5 * sin(uTime * 1.6 + dot(flatNormal, vec3(9.0, 5.0, 7.0)));

        vec3 color = mix(uColorDeep, uColor, 0.16 + 0.84 * key);
        color = mix(color, uColorWhite, pow(facing, 5.0) * 0.34);
        color += uColorWhite * sparkle * (0.3 + uActivity * 0.55) * (0.6 + facetShift * 0.4);
        color += uColor * rim * (0.24 + uActivity * 0.34);
        color *= 0.62 + uGlow * 0.32;
        color *= 1.0 - uDim * 0.6;

        float alpha = (0.18 + facing * 0.22 + rim * 0.2) * (1.0 - uDim * 0.55);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })

  const coreGroup = new THREE.Group()
  orbGroup.add(coreGroup)

  const coreSource = new THREE.IcosahedronGeometry(CORE_RADIUS, profile.coreDetail)
  const coreMesh = new THREE.Mesh(coreSource, coreMaterial)
  coreGroup.add(coreMesh)

  const coreEdgeMat = new THREE.LineBasicMaterial({
    color: palette.coreWhite,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(coreEdgeMat, 'coreWhite', true)
  staticMats.push({ mat: coreEdgeMat, base: 0.3 })
  const coreEdgeSource = new THREE.IcosahedronGeometry(CORE_RADIUS * 1.002, profile.coreDetail)
  const coreEdgeGeometry = new THREE.EdgesGeometry(coreEdgeSource, 8)
  coreEdgeSource.dispose()
  coreGroup.add(new THREE.LineSegments(coreEdgeGeometry, coreEdgeMat))

  const rayMat = new THREE.LineBasicMaterial({
    color: palette.ray,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(rayMat, 'ray', true)
  const rayPositions: number[] = []
  for (let i = 0; i < profile.rays; i += 1) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
    const inner = dir.clone().multiplyScalar(CORE_RADIUS * 0.12)
    const outer = dir.clone().multiplyScalar(CORE_RADIUS * (0.55 + Math.random() * 0.42))
    rayPositions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z)
  }
  const rayGeometry = new THREE.BufferGeometry()
  rayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rayPositions, 3))
  coreGroup.add(new THREE.LineSegments(rayGeometry, rayMat))

  const hotCoreMat = new THREE.MeshBasicMaterial({
    color: palette.coreWhite,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(hotCoreMat, 'coreWhite', true)
  const hotCore = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 24), hotCoreMat)
  coreGroup.add(hotCore)

  const coreGlowMat = new THREE.MeshBasicMaterial({
    color: palette.flare,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(coreGlowMat, 'flare', true)
  const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.86, 20, 20), coreGlowMat)
  coreGroup.add(coreGlow)

  // ── Counter-rotating low-poly cages ─────────────────────────────────────
  const cageGroup = new THREE.Group()
  orbGroup.add(cageGroup)

  function cage(geometry: THREE.BufferGeometry, material: THREE.LineBasicMaterial): THREE.LineSegments {
    const edges = new THREE.EdgesGeometry(geometry, 8)
    geometry.dispose()
    const mesh = new THREE.LineSegments(edges, material)
    cageGroup.add(mesh)
    return mesh
  }

  const cageAMat = new THREE.LineBasicMaterial({
    color: palette.cage,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(cageAMat, 'cage')
  staticMats.push({ mat: cageAMat, base: 0.46 })
  const cageA = cage(new THREE.IcosahedronGeometry(1.46, profile.cageDetail), cageAMat)
  cageA.rotation.set(0.4, 0.7, 0.15)

  const cageBMat = new THREE.LineBasicMaterial({
    color: palette.cageDim,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(cageBMat, 'cageDim')
  staticMats.push({ mat: cageBMat, base: 0.3 })
  const cageB = cage(new THREE.DodecahedronGeometry(1.72, 0), cageBMat)
  cageB.rotation.set(-0.5, 0.2, 0.6)

  let cageC: THREE.LineSegments | null = null
  if (profile.cageDetail > 0) {
    const cageCMat = new THREE.LineBasicMaterial({
      color: palette.cageDim,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    track(cageCMat, 'cageDim')
    staticMats.push({ mat: cageCMat, base: 0.18 })
    cageC = cage(new THREE.OctahedronGeometry(2.02, 0), cageCMat)
    cageC.rotation.set(1.1, 0.4, -0.3)
  }

  // ── Tilted ring with shards + listening pulses ──────────────────────────
  const ringGroup = new THREE.Group()
  ringGroup.rotation.set(1.12, 0, 0.16)
  orbGroup.add(ringGroup)

  const ringMat = new THREE.LineBasicMaterial({
    color: palette.ring,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(ringMat, 'ring')
  staticMats.push({ mat: ringMat, base: 0.55 })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.008, 6, profile.ringSegments), ringMat)
  ring.rotation.x = Math.PI / 2
  ringGroup.add(ring)

  const ringFarMat = new THREE.LineBasicMaterial({
    color: palette.ring,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(ringFarMat, 'ring')
  staticMats.push({ mat: ringFarMat, base: 0.3 })
  const ringFar = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS + 0.2, 0.0045, 4, profile.ringSegments), ringFarMat)
  ringFar.rotation.x = Math.PI / 2
  ringGroup.add(ringFar)

  const shardMat = new THREE.MeshBasicMaterial({
    color: palette.shard,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(shardMat, 'shard')
  staticMats.push({ mat: shardMat, base: 0.8 })
  const shardGeometry = new THREE.OctahedronGeometry(0.032, 0)
  const shards: Array<{ mesh: THREE.Mesh; speed: number }> = []
  for (let i = 0; i < profile.shards; i += 1) {
    const mesh = new THREE.Mesh(shardGeometry, shardMat)
    const angle = Math.random() * Math.PI * 2
    const radius = RING_RADIUS + (Math.random() - 0.5) * 0.12
    mesh.position.set(Math.cos(angle) * radius, (Math.random() - 0.5) * 0.12, Math.sin(angle) * radius)
    mesh.scale.setScalar(0.6 + Math.random() * 1.1)
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    ringGroup.add(mesh)
    shards.push({ mesh, speed: 0.5 + Math.random() * 1.4 })
  }

  const pulseRings: THREE.LineLoop[] = []
  const pulseMats: THREE.LineBasicMaterial[] = []
  const pulseGeometry = (() => {
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= 128; i += 1) {
      const angle = (i / 128) * Math.PI * 2
      points.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)))
    }
    return new THREE.BufferGeometry().setFromPoints(points)
  })()
  for (let i = 0; i < 3; i += 1) {
    const mat = new THREE.LineBasicMaterial({
      color: palette.ring,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    track(mat, 'ring')
    pulseMats.push(mat)
    const loop = new THREE.LineLoop(pulseGeometry, mat)
    loop.visible = false
    ringGroup.add(loop)
    pulseRings.push(loop)
  }

  // ── Restrained gold dust ────────────────────────────────────────────────
  const dustPositions = new Float32Array(profile.dust * 3)
  for (let i = 0; i < profile.dust; i += 1) {
    const phi = Math.acos(2 * Math.random() - 1)
    const theta = Math.random() * Math.PI * 2
    const radius = 2.3 + Math.random() * 2.1
    dustPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
    dustPositions[i * 3 + 1] = radius * Math.cos(phi) * 0.78
    dustPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta)
  }
  const dustGeometry = new THREE.BufferGeometry()
  dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dustPositions, 3))
  const dustMat = new THREE.PointsMaterial({
    color: palette.dust,
    size: profile.dustSize,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  track(dustMat, 'dust')
  const dust = new THREE.Points(dustGeometry, dustMat)
  orbGroup.add(dust)

  // ── Warm halo, flare and floor glow ─────────────────────────────────────
  function radialTexture(inner: string, mid: string): THREE.CanvasTexture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is unavailable.')
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, inner)
    gradient.addColorStop(0.4, mid)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    textures.push(texture)
    return texture
  }

  const haloMat = new THREE.SpriteMaterial({
    map: radialTexture('rgba(255,255,255,1)', 'rgba(255,196,64,.45)'),
    color: palette.bloomTint,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(haloMat, 'bloomTint')
  const halo = new THREE.Sprite(haloMat)
  halo.scale.set(3.9, 3.9, 1)
  halo.position.z = -0.6
  orbGroup.add(halo)

  const flareMat = new THREE.SpriteMaterial({
    map: radialTexture('rgba(255,255,255,1)', 'rgba(255,238,190,.4)'),
    color: palette.flare,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  track(flareMat, 'flare')
  const flare = new THREE.Sprite(flareMat)
  flare.scale.set(1.5, 1.5, 1)
  flare.position.set(1.35, 1.05, -1.1)
  orbGroup.add(flare)

  const floorUniforms = {
    uColor: { value: new THREE.Color(palette.floor) },
    uOpacity: { value: 0.4 },
  }
  if (!minimal) {
    const floorMat = new THREE.ShaderMaterial({
      uniforms: floorUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * vec2(2.0, 1.1);
          float d = length(p);
          float a = smoothstep(1.0, 0.05, d);
          gl_FragColor = vec4(uColor, a * a * uOpacity);
        }
      `,
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.4), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -2.08
    orbGroup.add(floor)
  }

  // ── Post-processing ─────────────────────────────────────────────────────
  let composer: EffectComposer | null = null
  let bloom: UnrealBloomPass | null = null
  const gradeUniforms = {
    tDiffuse: { value: null },
    uWarm: { value: new THREE.Color(palette.bloomTint) },
    uAmount: { value: 0.16 },
    uVignette: { value: 0.5 },
  }

  if (profile.bloom) {
    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.52, 0.34, 0.52)
    composer.addPass(bloom)
    composer.addPass(new ShaderPass({
      uniforms: gradeUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec3 uWarm;
        uniform float uAmount;
        uniform float uVignette;
        varying vec2 vUv;
        void main() {
          vec4 color = texture2D(tDiffuse, vUv);
          color.rgb = mix(color.rgb, color.rgb * uWarm, uAmount);
          float d = length(vUv - vec2(0.5));
          float vig = smoothstep(0.9, 0.25, d);
          color.rgb *= mix(1.0, vig, uVignette * 0.55);
          gl_FragColor = color;
        }
      `,
    }))
    composer.addPass(new OutputPass())
    composer.setPixelRatio(initialRatio)
    composer.setSize(width, height)
  }

  const interactive = options.interactive !== false
  const controls = interactive ? new OrbitControls(camera, renderer.domElement) : null
  if (controls) {
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.enablePan = false
    controls.minDistance = MIN_DISTANCE
    controls.maxDistance = MAX_DISTANCE
    controls.rotateSpeed = 0.6
    controls.zoomSpeed = 0.7
    controls.target.set(0, 0, 0)
  }

  // ── State animation ─────────────────────────────────────────────────────
  const initialTarget = STATE_TARGET[currentState]
  let activity = initialTarget.activity
  let glow = initialTarget.glow
  let spinSpeed = initialTarget.spin
  let errorMix = currentState === 'error' ? 1 : 0
  let offlineMix = currentState === 'offline' ? 1 : 0
  let listenMix = currentState === 'listening' ? 1 : 0
  let rawLevel = 0
  let smoothedLevel = 0
  let time = 0

  function applyPalette(next: OrbPalette) {
    palette = next
    background.setHex(next.background)
    if (!transparent && scene.fog instanceof THREE.FogExp2) scene.fog.color.setHex(next.background)
    renderer.setClearColor(next.background, transparent ? 0 : 1)
    for (const key of Object.keys(next) as TintKey[]) baseColors[key].setHex(next[key])
    errorColor.setHex(next.error)
    errorHotColor.setHex(next.errorHot)
    coreUniforms.uColor.value.copy(baseColors.core)
    coreUniforms.uColorDeep.value.copy(baseColors.coreDeep)
    coreUniforms.uColorWhite.value.copy(baseColors.coreWhite)
    floorUniforms.uColor.value.copy(baseColors.floor)
    gradeUniforms.uWarm.value.copy(baseColors.bloomTint)
  }

  function update(dt: number) {
    const target = STATE_TARGET[currentState]
    const motion = reducedMotion ? 0 : 1
    const level = smoothedLevel

    smoothedLevel += (((currentState === 'speaking') ? rawLevel : 0) - smoothedLevel) * Math.min(1, dt * 9)
    activity += (target.activity + level * 0.8 - activity) * ease(dt, 3.2)
    glow += (target.glow + level * 0.25 - glow) * ease(dt, 3.2)
    spinSpeed += (target.spin - spinSpeed) * ease(dt, 2.6)
    errorMix += (((currentState === 'error') ? 1 : 0) - errorMix) * ease(dt, 7)
    offlineMix += (((currentState === 'offline') ? 1 : 0) - offlineMix) * ease(dt, 4)
    listenMix += (((currentState === 'listening') ? 1 : 0) - listenMix) * ease(dt, 5)

    time += dt * (0.6 + activity * 1.5) * motion

    const breathe = 1 + Math.sin(time * 0.9) * 0.02 * motion
    const liveScale = 1 + level * 0.09 * motion
    const errorPulse = 1 + Math.sin(time * 6) * 0.02 * errorMix * motion
    coreGroup.scale.setScalar(breathe * liveScale * errorPulse)
    cageGroup.scale.setScalar(1 + level * 0.05 * motion)

    orbGroup.rotation.y += dt * 0.018 * motion
    coreGroup.rotation.y += dt * spinSpeed * 0.07 * motion
    cageA.rotation.y += dt * spinSpeed * 0.18 * motion
    cageA.rotation.x += dt * spinSpeed * 0.04 * motion
    cageB.rotation.y -= dt * spinSpeed * 0.13 * motion
    cageB.rotation.z += dt * spinSpeed * 0.04 * motion
    if (cageC) {
      cageC.rotation.x += dt * spinSpeed * 0.08 * motion
      cageC.rotation.z -= dt * spinSpeed * 0.06 * motion
    }
    ringGroup.rotation.y += dt * spinSpeed * 0.35 * motion
    dust.rotation.y += dt * 0.012 * motion
    dust.rotation.x = Math.sin(time * 0.05) * 0.06 * motion
    for (const shard of shards) {
      shard.mesh.rotation.y += dt * shard.speed * motion
      shard.mesh.rotation.x += dt * shard.speed * 0.6 * motion
    }

    coreUniforms.uTime.value = time
    coreUniforms.uActivity.value = activity
    coreUniforms.uGlow.value = glow
    coreUniforms.uDim.value = offlineMix

    for (const entry of colored) {
      entry.mat.color.copy(baseColors[entry.key]).lerp(entry.hot ? errorHotColor : errorColor, errorMix)
    }
    const dim = 1 - offlineMix * 0.55
    for (const entry of staticMats) entry.mat.opacity = entry.base * dim

    coreUniforms.uColor.value.copy(baseColors.core).lerp(errorColor, errorMix)
    coreUniforms.uColorDeep.value.copy(baseColors.coreDeep).lerp(errorColor, errorMix * 0.85)
    coreUniforms.uColorWhite.value.copy(baseColors.coreWhite).lerp(errorHotColor, errorMix)
    floorUniforms.uColor.value.copy(baseColors.floor).lerp(errorColor, errorMix)
    gradeUniforms.uWarm.value.copy(baseColors.bloomTint).lerp(errorColor, errorMix)

    rayMat.opacity = (0.16 + activity * 0.34) * dim
    coreEdgeMat.opacity = (0.18 + activity * 0.2) * dim
    hotCoreMat.opacity = (0.32 + glow * 0.26 + level * 0.2) * dim
    coreGlowMat.opacity = (0.05 + glow * 0.07) * dim
    dustMat.opacity = (0.18 + activity * 0.3) * dim
    haloMat.opacity = (0.1 + glow * 0.14 + level * 0.1) * dim
    flareMat.opacity = (0.05 + glow * 0.09) * dim
    floorUniforms.uOpacity.value = (0.28 + glow * 0.2) * (1 - offlineMix * 0.7)

    for (let i = 0; i < pulseRings.length; i += 1) {
      const pulse = pulseRings[i]
      const phase = (time * 0.5 + i * 0.333) % 1
      pulse.scale.setScalar(1.22 + phase * 0.85)
      pulse.visible = listenMix > 0.01 && motion > 0
      pulseMats[i].opacity = listenMix * (1 - phase) * 0.4 * motion
    }

    if (bloom) {
      const targetBloom = target.bloom + level * 0.35
      bloom.strength += (targetBloom - bloom.strength) * ease(dt, 4)
    }
  }

  function renderOnce() {
    controls?.update()
    if (composer) composer.render()
    else renderer.render(scene, camera)
  }

  function setState(next: OrbState) {
    if (next === currentState) return
    currentState = next
    if (next !== 'speaking') rawLevel = 0
    if (userPaused) {
      update(0.016)
      renderOnce()
    }
  }

  function setLevel(level: number) {
    rawLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  }

  function setPaused(paused: boolean) {
    const next = paused === true
    if (next === userPaused) return
    userPaused = next
    last = performance.now()
    if (!userPaused) {
      update(0.016)
      renderOnce()
    }
  }

  // ── Render loop ─────────────────────────────────────────────────────────
  let frameId = 0
  let last = performance.now()
  const clampFps = (fps: number) => Math.min(60, Math.max(5, fps))
  let frameGap = 1000 / clampFps(options.fps ?? profile.fps)

  function setFps(fps: number) {
    if (!Number.isFinite(fps)) return
    frameGap = 1000 / clampFps(fps)
  }

  function frame(now: number) {
    if (disposed) return
    frameId = requestAnimationFrame(frame)
    if (document.hidden || userPaused) {
      last = now
      return
    }
    const elapsed = now - last
    if (elapsed < frameGap) return
    last = now
    update(Math.min(elapsed / 1000, 0.05))
    controls?.update()
    if (composer) composer.render()
    else renderer.render(scene, camera)
  }

  const resizeObserver = new ResizeObserver(() => {
    if (disposed) return
    const nextWidth = Math.max(1, container.clientWidth)
    const nextHeight = Math.max(1, container.clientHeight)
    camera.aspect = nextWidth / nextHeight
    camera.updateProjectionMatrix()
    const ratio = Math.min(window.devicePixelRatio || 1, profile.pixelRatio)
    renderer.setPixelRatio(ratio)
    renderer.setSize(nextWidth, nextHeight, false)
    if (composer) {
      composer.setPixelRatio(ratio)
      composer.setSize(nextWidth, nextHeight)
    }
  })
  resizeObserver.observe(container)

  applyPalette(palette)
  update(0)
  renderOnce()
  frameId = requestAnimationFrame(frame)

  function dispose() {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(frameId)
    resizeObserver.disconnect()
    controls?.dispose()
    scene.traverse((object) => {
      const holder = object as THREE.Mesh
      holder.geometry?.dispose()
      const material = holder.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material?.dispose()
    })
    for (const texture of textures) texture.dispose()
    composer?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
    renderer.domElement.remove()
  }

  return { setState, setLevel, setPalette: applyPalette, setPaused, setFps, dispose }
}
