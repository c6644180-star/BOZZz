export interface Landmark {
  x: number
  y: number
  z: number
}

export type Handedness = 'Left' | 'Right' | 'Unknown'

export interface HandLandmarks {
  landmarks: Landmark[]
  world: Landmark[]
  handedness: Handedness
  score: number
}

export interface LandmarkFrame {
  hands: HandLandmarks[]
  timestamp: number
  source: 'mediapipe' | 'replay'
  latencyMs: number
}

export const BUILTIN_GESTURES = [
  'point',
  'pinch',
  'two_hand_pinch',
  'open_palm',
  'fist',
  'two_finger_scroll',
  'wrist_rotation',
  'flick',
  'claw',
  'clap',
  'thumbs_up',
] as const

export type BuiltinGesture = (typeof BUILTIN_GESTURES)[number]
export type GestureName = BuiltinGesture | `custom:${string}`

export const CALIBRATION_PHASES = ['open_palm', 'pinch', 'fist', 'relaxed'] as const
export type CalibrationPhase = (typeof CALIBRATION_PHASES)[number]

export interface HandFeatures {
  hand: Handedness
  extension: number[]
  pinchRatio: number
  openness: number
  palmFacing: number
  palmRoll: number
  rollRate: number
  speed: number
  handSize: number
  indexTip: Landmark
  velocity: Landmark
  palmCenter: Landmark
  worldCenter: Landmark
  twoFinger: boolean
  claw: boolean
  score: number
  vector: number[]
}

export interface FeatureFrame {
  timestamp: number
  hands: HandFeatures[]
  twoHandDistance: number | null
  twoHandClosing: number
}

export interface Classification {
  hand: Handedness
  name: GestureName
  confidence: number
  timestamp: number
}

export interface GestureMovePayload {
  hand: Handedness
  x: number
  y: number
  z: number
  confidence: number
  timestamp: number
  hands: number
  twoHandDistance: number | null
}

export interface GesturePinchPayload {
  hand: Handedness
  x: number
  y: number
  confidence: number
  timestamp: number
  heldMs: number
  clickAllowed: boolean
  tap?: boolean
}

export interface GestureTapPayload {
  hand: Handedness
  x: number
  y: number
  confidence: number
  timestamp: number
  heldMs: number
  target: string | null
}

export interface GestureDoubleTapPayload extends GestureTapPayload {
  previousHeldMs: number
}

export interface GestureRejectedPayload {
  hand: Handedness
  reason: string
  confidence: number
  timestamp: number
}

export interface GestureScrollPayload {
  hand: Handedness
  delta: number
  confidence: number
  timestamp: number
  gesture: GestureName
}

export interface GestureZoomPayload {
  scale: number
  confidence: number
  timestamp: number
  twoHandDistance: number
}

export interface GestureRotatePayload {
  hand: Handedness
  delta: number
  confidence: number
  timestamp: number
}

export interface GestureFlickPayload {
  hand: Handedness
  direction: 'left' | 'right' | 'up' | 'down'
  confidence: number
  timestamp: number
}

export interface GesturePalmPausePayload {
  hand: Handedness
  confidence: number
  timestamp: number
  heldMs: number
}

export interface GestureRecognizedPayload {
  hand: Handedness
  name: GestureName
  confidence: number
  timestamp: number
  x: number
  y: number
  hands: number
  heldMs: number
  twoHandDistance: number | null
}

export interface GestureCustomPayload {
  name: string
  confidence: number
  timestamp: number
  hand: Handedness
}

export interface HgiMetrics {
  enabled: boolean
  starting: boolean
  modelReady: boolean
  cameraActive: boolean
  permission: 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'
  fps: number
  latencyMs: number
  trackingConfidence: number
  hands: number
  currentGesture: GestureName | null
  gestureConfidence: number
  shortPinches: number
  pinchEvents: number
  frameCount: number
  source: 'mediapipe' | 'replay' | null
  paused: boolean
  quality: HgiQuality
  micAvailable: boolean
  note: string
}

export interface GestureEventMap {
  'gesture.move': GestureMovePayload
  'gesture.pinch_start': GesturePinchPayload
  'gesture.pinch_hold': GesturePinchPayload
  'gesture.pinch_end': GesturePinchPayload
  'gesture.scroll': GestureScrollPayload
  'gesture.palm_pause': GesturePalmPausePayload
  'gesture.zoom': GestureZoomPayload
  'gesture.rotate': GestureRotatePayload
  'gesture.flick': GestureFlickPayload
  'gesture.tap': GestureTapPayload
  'gesture.double_tap': GestureDoubleTapPayload
  'gesture.rejected': GestureRejectedPayload
  'gesture.recognized': GestureRecognizedPayload
  'gesture.custom': GestureCustomPayload
  'hgi.diagnostics': HgiMetrics
}

export type HgiMode = 'orb' | 'cursor' | 'desktop'
export type HgiQuality = 'low' | 'medium' | 'high'

export interface HgiBindings {
  orbSpin: GestureName
  orbZoom: GestureName
  orbPause: GestureName
  orbReset: GestureName
  cursorClick: GestureName
  cursorScroll: GestureName
  cursorPause: GestureName
  desktopClick: GestureName
  desktopDrag: GestureName
  desktopScroll: GestureName
  desktopApprove: GestureName
  desktopWindow: GestureName
  desktopZoom: GestureName
  desktopPushToTalk: GestureName
}

export interface DesktopSettings {
  sensitivity: number
  smoothing: number
  area: number
  positionX: number
  positionY: number
  edgeMargin: number
  clickDelayMs: number
  idleSeconds: number
}

export interface HgiSettings {
  quality: HgiQuality
  minCutoff: number
  beta: number
  minConfidence: number
  pinchOn: number
  pinchOff: number
  micConfirmClap: boolean
  desktop: DesktopSettings
  bindings: HgiBindings
}

export interface CalibrationProfile {
  version: 1
  createdAt: number
  pinchOn: number
  pinchOff: number
  centroids: Record<CalibrationPhase, number[]>
  sampleCounts: Record<CalibrationPhase, number>
}

export interface TaughtGesture {
  name: string
  samples: number[][]
  createdAt: number
}

export interface RecordedFrame {
  timestamp: number
  hands: HandLandmarks[]
}

export interface RecordedSession {
  version: 1
  createdAt: number
  quality: HgiQuality
  frames: RecordedFrame[]
}

export interface ReplayResult {
  frames: number
  durationMs: number
  latencies: number[]
  events: Record<string, number>
  settings: { minCutoff: number; beta: number; quality: HgiQuality }
}

export interface GestureTestTrial {
  target: GestureName
  hit: boolean
  latencyMs: number | null
  falseTrigger: boolean
}

export interface GestureTestResult {
  id: string
  createdAt: number
  quality: HgiQuality
  minCutoff: number
  beta: number
  perGesture: Record<string, {
    trials: number
    hits: number
    hitRate: number
    falseTriggers: number
    restWindows: number
    falseTriggerRate: number
    avgLatencyMs: number | null
  }>
  trials: GestureTestTrial[]
}

export const FEATURE_VECTOR_SIZE = 12

export const DEFAULT_BINDINGS: HgiBindings = {
  orbSpin: 'pinch',
  orbZoom: 'two_hand_pinch',
  orbPause: 'open_palm',
  orbReset: 'flick',
  cursorClick: 'pinch',
  cursorScroll: 'two_finger_scroll',
  cursorPause: 'open_palm',
  desktopClick: 'pinch',
  desktopDrag: 'pinch',
  desktopScroll: 'two_finger_scroll',
  desktopApprove: 'thumbs_up',
  desktopWindow: 'flick',
  desktopZoom: 'two_hand_pinch',
  desktopPushToTalk: 'fist',
}

export const DEFAULT_HGI_SETTINGS: HgiSettings = {
  quality: 'medium',
  minCutoff: 1.2,
  beta: 0.35,
  minConfidence: 0.62,
  pinchOn: 0.3,
  pinchOff: 0.48,
  micConfirmClap: true,
  desktop: {
    sensitivity: 1,
    smoothing: 0.35,
    area: 0.8,
    positionX: 0,
    positionY: 0,
    edgeMargin: 12,
    clickDelayMs: 0,
    idleSeconds: 300,
  },
  bindings: { ...DEFAULT_BINDINGS },
}
