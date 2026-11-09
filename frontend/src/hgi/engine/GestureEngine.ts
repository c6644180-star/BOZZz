import { gestureBus } from '../bus/GestureBus'
import { FeatureExtractor } from '../features/features'
import { HandFilterSet } from '../filter/HandFilter'
import { GestureClassifier } from '../classification/classifier'
import { PinchStateMachine } from '../state/PinchStateMachine'
import type { PinchOutput } from '../state/PinchStateMachine'
import { QUALITY_PROFILES } from '../landmarks/LandmarkSource'
import { MediaPipeSource } from '../landmarks/MediaPipeSource'
import { ReplaySource } from '../landmarks/ReplaySource'
import type { LandmarkSource } from '../landmarks/LandmarkSource'
import { clamp } from '../geometry'
import type { MicLevelGate } from '../audio/micLevelGate'
import { GestureStabilizer } from '../../adaptive/gestureStability'
import { combineConfidence } from '../../adaptive/confidence'
import { DEFAULT_ADAPTIVE_SETTINGS, handSettingsFor } from '../../adaptive/settings'
import type { GestureTransitionSettings } from '../../adaptive/types'
import type {
  CalibrationProfile,
  FeatureFrame,
  GestureName,
  HgiMetrics,
  HgiSettings,
  HandFeatures,
  HandLandmarks,
  LandmarkFrame,
  RecordedFrame,
  RecordedSession,
  ReplayResult,
  TaughtGesture,
} from '../types'

export interface RecognitionHand {
  hand: HandFeatures['hand']
  name: GestureName
  confidence: number
  x: number
  y: number
  vector: number[]
}

export interface RecognitionFrame {
  timestamp: number
  latencyMs: number
  hands: RecognitionHand[]
  handsCount: number
  twoHandDistance: number | null
}

interface EngineCallbacks {
  onMetrics?: (metrics: HgiMetrics) => void
  onRecognition?: (frame: RecognitionFrame) => void
  onPreview?: (hands: HandLandmarks[], timestamp: number) => void
  onFeatures?: (frame: FeatureFrame) => void
}

interface HandState {
  key: string
  machine: PinchStateMachine
  lastSeen: number
  lastGoodAt: number
  prevTip: { x: number; y: number } | null
  recognizedName: GestureName | null
  recognizedSince: number
  recognizedLastEmit: number
  lastScrollAt: number
  lastFlickAt: number
  palmPauseEmitted: boolean
  pausedPalmSince: number
  pausedPalmEmitted: boolean
  stabilizer: GestureStabilizer
  rejectedAt: number
}

export class GestureEngine {
  settings: HgiSettings
  private callbacks: EngineCallbacks
  private mic: MicLevelGate | null
  private emitCommands: boolean
  private adaptive: GestureTransitionSettings

  private source: LandmarkSource | null = null
  private filters = new HandFilterSet()
  private extractor = new FeatureExtractor()
  private classifier = new GestureClassifier()
  private states = new Map<string, HandState>()

  private running = false
  private paused = false
  private frameCount = 0
  private pinchEvents = 0
  private shortPinches = 0
  private lastLatency = 0
  private latencyAverage = 0
  private lastFps = 0
  private fpsStart = 0
  private fpsFrames = 0
  private lastMetricsAt = 0
  private lastZoomDistance: number | null = null
  private latestGesture: GestureName | null = null
  private latestConfidence = 0
  private latestHands = 0
  private latestTracking = 0
  private scrollGestures = new Set<GestureName>()
  private recording: RecordedFrame[] | null = null
  private recordingDropped = false
  private replayEvents: Record<string, number> = {}
  private replayLatencies: number[] = []
  private replayLastNames = new Map<string, { name: GestureName; at: number }>()
  private replayStartedAt = 0
  private replayFrames = 0

  constructor(
    settings: HgiSettings,
    calibration: CalibrationProfile | null,
    customGestures: TaughtGesture[],
    mic: MicLevelGate | null = null,
    emitCommands = true,
    callbacks: EngineCallbacks = {},
    adaptive: GestureTransitionSettings = DEFAULT_ADAPTIVE_SETTINGS.gestures,
  ) {
    this.settings = settings
    this.mic = mic
    this.emitCommands = emitCommands
    this.callbacks = callbacks
    this.adaptive = adaptive
    this.classifier.setCalibration(calibration)
    this.classifier.setCustomGestures(customGestures)
    this.updateScrollGestures()
  }

  get isRunning(): boolean {
    return this.running
  }

  get isPaused(): boolean {
    return this.paused
  }

  get isRecording(): boolean {
    return this.recording !== null
  }

  get recordingFrames(): number {
    return this.recording?.length ?? 0
  }

  get recordingDroppedFrames(): boolean {
    return this.recordingDropped
  }

  get stream(): MediaStream | null {
    return this.source?.getStream() ?? null
  }

  get video(): HTMLVideoElement | null {
    return this.source?.getVideo?.() ?? null
  }

  setCallbacks(callbacks: EngineCallbacks): void {
    this.callbacks = callbacks
  }

  setSettings(settings: HgiSettings): void {
    this.settings = settings
    for (const state of this.states.values()) {
      state.machine.config = this.machineConfigFor(state.key)
    }
    this.updateScrollGestures()
  }

  setAdaptive(adaptive: GestureTransitionSettings): void {
    this.adaptive = adaptive
    for (const state of this.states.values()) {
      state.machine.config = this.machineConfigFor(state.key)
      state.stabilizer.config = this.stabilizerConfig()
    }
  }

  private stabilizerConfig() {
    return {
      requiredFrames: this.adaptive.stableFrames,
      maxJump: this.adaptive.maxJump,
      edgeMargin: this.adaptive.edgeMargin,
      minScore: 0.5,
    }
  }

  private machineConfigFor(key: string) {
    const hand = handSettingsFor(key, this.adaptive)
    const scale = hand?.thresholdScale ?? 1
    const onThreshold = clamp(this.settings.pinchOn * scale, 0.06, 0.6)
    const offThreshold = clamp(Math.max(onThreshold + 0.06, this.settings.pinchOff * scale), 0.12, 0.92)
    return {
      onThreshold,
      offThreshold,
      enterMs: hand?.enterMs ?? this.adaptive.enterMs,
      holdMs: this.adaptive.holdMs,
      tapMaxMs: this.adaptive.tapMaxMs,
      cooldownMs: this.adaptive.cooldownMs,
      lostMs: this.adaptive.lostMs,
      minConfidence: Math.max(0.45, this.settings.minConfidence - 0.05),
    }
  }

  setCalibration(profile: CalibrationProfile | null): void {
    this.classifier.setCalibration(profile)
    if (profile) {
      this.settings = { ...this.settings, pinchOn: profile.pinchOn, pinchOff: profile.pinchOff }
      for (const state of this.states.values()) {
        state.machine.config = this.machineConfigFor(state.key)
      }
    }
  }

  setCustomGestures(gestures: TaughtGesture[]): void {
    this.classifier.setCustomGestures(gestures)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.emitMetrics(true)
  }

  async start(): Promise<void> {
    if (this.running) return
    const source = new MediaPipeSource(this.settings.quality)
    this.source = source
    this.emitCommands = true
    try {
      await this.attach(source)
    } catch (error) {
      this.source = null
      this.running = false
      this.emitMetrics(true)
      throw error
    }
    this.emitMetrics(true)
  }

  private async attach(source: LandmarkSource): Promise<void> {
    this.resetPipeline()
    this.fpsStart = performance.now()
    this.fpsFrames = 0
    this.lastFps = 0
    this.frameCount = 0
    this.pinchEvents = 0
    this.shortPinches = 0
    this.latencyAverage = 0
    this.lastLatency = 0
    this.latestGesture = null
    this.latestConfidence = 0
    const unsubscribe = source.onFrame((frame) => this.handleFrame(frame))
    try {
      await source.start()
      this.running = true
    } catch (error) {
      unsubscribe()
      throw error
    }
  }

  stop(): void {
    const wasRunning = this.running
    this.running = false
    this.paused = false
    this.source?.stop()
    this.source = null
    this.resetPipeline()
    if (wasRunning) {
      this.emitMetrics(false)
    }
  }

  private resetPipeline(): void {
    this.filters.reset()
    this.extractor.reset()
    for (const state of this.states.values()) state.machine.reset()
    this.states.clear()
    this.lastZoomDistance = null
    this.latestHands = 0
    this.latestTracking = 0
    this.recording = null
    this.recordingDropped = false
  }

  private updateScrollGestures(): void {
    this.scrollGestures = new Set<GestureName>([
      'two_finger_scroll',
      this.settings.bindings.cursorScroll,
      this.settings.bindings.desktopScroll,
    ])
  }

  private stateFor(key: string): HandState {
    let state = this.states.get(key)
    if (!state) {
      state = {
        key,
        machine: new PinchStateMachine(this.machineConfigFor(key)),
        lastSeen: 0,
        lastGoodAt: 0,
        prevTip: null,
        recognizedName: null,
        recognizedSince: 0,
        recognizedLastEmit: 0,
        lastScrollAt: 0,
        lastFlickAt: 0,
        palmPauseEmitted: false,
        pausedPalmSince: 0,
        pausedPalmEmitted: false,
        stabilizer: new GestureStabilizer(this.stabilizerConfig()),
        rejectedAt: 0,
      }
      this.states.set(key, state)
    }
    return state
  }

  private handleFrame(frame: LandmarkFrame): void {
    this.frameCount += 1
    this.fpsFrames += 1
    if (this.recording && !this.recordingDropped) {
      if (this.recording.length >= 3000) {
        this.recordingDropped = true
      } else {
        this.recording.push({
          timestamp: frame.timestamp,
          hands: frame.hands.map((hand) => ({
            landmarks: hand.landmarks.map((point) => ({ ...point })),
            world: hand.world.map((point) => ({ ...point })),
            handedness: hand.handedness,
            score: hand.score,
          })),
        })
      }
    }

    const filtered = this.filters.update(frame, this.settings.minCutoff, this.settings.beta, this.profileFps)
    this.callbacks.onPreview?.(filtered.hands, filtered.timestamp)
    this.lastLatency = filtered.latencyMs
    this.latencyAverage = this.latencyAverage === 0 ? filtered.latencyMs : this.latencyAverage * 0.9 + filtered.latencyMs * 0.1

    const features = this.extractor.extract(filtered)
    this.callbacks.onFeatures?.(features)
    this.latestHands = features.hands.length
    this.latestTracking = features.hands.reduce((best, hand) => Math.max(best, hand.score), 0)
    this.updateFps(filtered.timestamp)

    const micSpike = this.mic?.consumeSpike(filtered.timestamp) ?? false
    const classifications: RecognitionHand[] = []
    const seenKeys = new Set<string>()
    let bestGesture: GestureName | null = null
    let bestConfidence = 0

    features.hands.forEach((hand, index) => {
      let key = hand.hand === 'Unknown' ? `hand-${index}` : hand.hand
      if (seenKeys.has(key)) key = `${key}-${index}`
      seenKeys.add(key)
      const state = this.stateFor(key)
      state.lastSeen = filtered.timestamp
      const handConfig = handSettingsFor(key, this.adaptive)
      if (handConfig && !handConfig.enabled) {
        state.machine.reset()
        state.stabilizer.reset()
        return
      }
      const stability = state.stabilizer.update({
        x: hand.indexTip.x,
        y: hand.indexTip.y,
        score: hand.score,
        timestamp: filtered.timestamp,
      })

      const otherHand = features.hands.length > 1 ? features.hands[index === 0 ? 1 : 0] : null
      const classification = this.classifier.classify(hand, {
        hands: features.hands.length,
        twoHandDistance: features.twoHandDistance,
        twoHandClosing: features.twoHandClosing,
        micSpike,
        otherHand,
        minConfidence: this.settings.minConfidence,
      })
      classification.timestamp = filtered.timestamp
      classifications.push({
        hand: hand.hand,
        name: classification.name,
        confidence: classification.confidence,
        x: hand.indexTip.x,
        y: hand.indexTip.y,
        vector: hand.vector,
      })
      if (classification.confidence > bestConfidence) {
        bestConfidence = classification.confidence
        bestGesture = classification.name
      }

      if (classification.confidence >= this.settings.minConfidence && hand.score >= 0.5) {
        state.lastGoodAt = filtered.timestamp
      }

      const pinch = state.machine.update(
        hand.pinchRatio,
        state.machine.isPressed || stability.stable ? hand.score : 0,
        filtered.timestamp,
      )
      this.handlePinch(pinch, hand, filtered.timestamp, stability.confidence.value)
      if (
        this.emitCommands &&
        !this.paused &&
        !state.machine.isPressed &&
        hand.score >= 0.5 &&
        hand.pinchRatio <= state.machine.config.onThreshold + 0.03 &&
        !stability.stable &&
        filtered.timestamp - state.rejectedAt > 1000
      ) {
        state.rejectedAt = filtered.timestamp
        gestureBus.emit('gesture.rejected', {
          hand: hand.hand,
          reason: stability.reasons[0] ?? 'Uncertain gesture rejected.',
          confidence: hand.score,
          timestamp: filtered.timestamp,
        })
      }

      const commandsAllowed = this.emitCommands && !this.paused
      if (commandsAllowed) {
        gestureBus.emit('gesture.move', {
          hand: hand.hand,
          x: hand.indexTip.x,
          y: hand.indexTip.y,
          z: hand.indexTip.z,
          confidence: hand.score,
          timestamp: filtered.timestamp,
          hands: features.hands.length,
          twoHandDistance: features.twoHandDistance,
        })
      }

      if (state.prevTip && state.machine.isPressed && commandsAllowed) {
        const delta = hand.indexTip.x - state.prevTip.x
        if (Math.abs(delta) > 0.0015) {
          gestureBus.emit('gesture.rotate', {
            hand: hand.hand,
            delta,
            confidence: hand.score,
            timestamp: filtered.timestamp,
          })
        }
      }
      state.prevTip = { x: hand.indexTip.x, y: hand.indexTip.y }

      const confident = stability.stable && classification.confidence >= this.settings.minConfidence && hand.score >= 0.5
      if (confident && commandsAllowed) {
        this.handleRecognition(state, hand, classification.name, classification.confidence, filtered.timestamp, features.hands.length, features.twoHandDistance)
        state.pausedPalmSince = 0
        state.pausedPalmEmitted = false
      } else if (confident && this.paused) {
        // While paused only the safety gesture is watched, so a palm can
        // resume output and nothing else can fire a command.
        if (classification.name === 'open_palm') {
          if (state.pausedPalmSince === 0) state.pausedPalmSince = filtered.timestamp
          if (!state.pausedPalmEmitted && filtered.timestamp - state.pausedPalmSince >= 1000) {
            state.pausedPalmEmitted = true
            gestureBus.emit('gesture.palm_pause', {
              hand: hand.hand,
              confidence: classification.confidence,
              timestamp: filtered.timestamp,
              heldMs: filtered.timestamp - state.pausedPalmSince,
            })
          }
        } else {
          state.pausedPalmSince = 0
          state.pausedPalmEmitted = false
        }
      } else if (filtered.timestamp - state.lastGoodAt > 500) {
        state.recognizedName = null
        state.palmPauseEmitted = false
        state.pausedPalmSince = 0
        state.pausedPalmEmitted = false
      }

      if (commandsAllowed && confident && this.scrollGestures.has(classification.name)) {
        if (Math.abs(hand.velocity.y) > 0.4 && filtered.timestamp - state.lastScrollAt > 140) {
          state.lastScrollAt = filtered.timestamp
          gestureBus.emit('gesture.scroll', {
            hand: hand.hand,
            delta: clamp(hand.velocity.y * 14, -36, 36),
            confidence: classification.confidence,
            timestamp: filtered.timestamp,
            gesture: classification.name,
          })
        }
      }

      if (commandsAllowed && confident && classification.name === 'flick' && filtered.timestamp - state.lastFlickAt > 500) {
        state.lastFlickAt = filtered.timestamp
        const direction =
          Math.abs(hand.velocity.x) > Math.abs(hand.velocity.y)
            ? hand.velocity.x > 0
              ? 'right'
              : 'left'
            : hand.velocity.y > 0
              ? 'down'
              : 'up'
        gestureBus.emit('gesture.flick', {
          hand: hand.hand,
          direction,
          confidence: classification.confidence,
          timestamp: filtered.timestamp,
        })
      }

      if (commandsAllowed && classification.name.startsWith('custom:') && confident) {
        gestureBus.emit('gesture.custom', {
          name: classification.name.slice('custom:'.length),
          confidence: classification.confidence,
          timestamp: filtered.timestamp,
          hand: hand.hand,
        })
      }

      if (!this.emitCommands) this.collectReplay(key, classification.name, classification.confidence, filtered)
    })

    this.handleZoom(features, filtered.timestamp)
    this.handleLostHands(filtered.timestamp, seenKeys)

    this.latestGesture = bestGesture
    this.latestConfidence = bestConfidence
    this.callbacks.onRecognition?.({
      timestamp: filtered.timestamp,
      latencyMs: Math.round(filtered.latencyMs + (performance.now() - filtered.timestamp)),
      hands: classifications,
      handsCount: features.hands.length,
      twoHandDistance: features.twoHandDistance,
    })

    if (filtered.timestamp - this.lastMetricsAt >= 250) {
      this.emitMetrics(this.running)
    }
  }

  private get profileFps(): number {
    return QUALITY_PROFILES[this.settings.quality].fps
  }

  private handlePinch(output: PinchOutput, hand: HandFeatures, timestamp: number, stabilityConfidence: number): void {
    const commandsAllowed = this.emitCommands && !this.paused
    const scores = [
      { value: hand.score, weight: 2, reason: `Landmark confidence ${(hand.score * 100).toFixed(0)}%.` },
    ]
    if (output.justStarted) {
      scores.push({
        value: stabilityConfidence,
        weight: 1.5,
        reason: `Pose held steady for ${this.adaptive.enterMs} ms with ${this.adaptive.stableFrames} stable frames.`,
      })
    }
    const pinchConfidence = combineConfidence(scores, 'landmark').value
    if (output.justStarted) {
      this.pinchEvents += 1
      if (commandsAllowed) {
        gestureBus.emit('gesture.pinch_start', {
          hand: hand.hand,
          x: hand.indexTip.x,
          y: hand.indexTip.y,
          confidence: pinchConfidence,
          timestamp,
          heldMs: 0,
          clickAllowed: false,
          tap: false,
        })
      }
    }
    if (output.justHeld) {
      const heldConfidence = combineConfidence(
        [
          ...scores,
          {
            value: Math.min(1, output.heldMs / Math.max(1, this.adaptive.holdMs)),
            weight: 0.8,
            reason: `Held ${Math.round(output.heldMs)} ms (minimum ${this.adaptive.holdMs} ms).`,
          },
        ],
        'landmark',
      ).value
      if (commandsAllowed) {
        gestureBus.emit('gesture.pinch_hold', {
          hand: hand.hand,
          x: hand.indexTip.x,
          y: hand.indexTip.y,
          confidence: heldConfidence,
          timestamp,
          heldMs: output.heldMs,
          clickAllowed: false,
          tap: false,
        })
      }
    }
    if (output.justEnded) {
      if (output.shortPinch) this.shortPinches += 1
      const endedConfidence = combineConfidence(
        [
          ...scores,
          {
            value: Math.min(1, output.heldMs / Math.max(1, this.adaptive.holdMs)),
            weight: 0.8,
            reason: `Released after ${Math.round(output.heldMs)} ms.`,
          },
        ],
        'landmark',
      ).value
      if (commandsAllowed) {
        gestureBus.emit('gesture.pinch_end', {
          hand: hand.hand,
          x: hand.indexTip.x,
          y: hand.indexTip.y,
          confidence: endedConfidence,
          timestamp,
          heldMs: output.heldMs,
          clickAllowed: output.clickAllowed,
          tap: output.tap,
        })
        if (output.tap) {
          gestureBus.emit('gesture.tap', {
            hand: hand.hand,
            x: hand.indexTip.x,
            y: hand.indexTip.y,
            confidence: endedConfidence,
            timestamp,
            heldMs: output.heldMs,
            target: null,
          })
        }
      }
    }
  }

  private handleRecognition(
    state: HandState,
    hand: HandFeatures,
    name: GestureName,
    confidence: number,
    timestamp: number,
    hands: number,
    twoHandDistance: number | null,
  ): void {
    if (state.recognizedName !== name) {
      state.recognizedName = name
      state.recognizedSince = timestamp
      state.recognizedLastEmit = 0
      state.palmPauseEmitted = false
    }
    const heldMs = timestamp - state.recognizedSince
    if (state.recognizedLastEmit === 0 || timestamp - state.recognizedLastEmit >= 250) {
      state.recognizedLastEmit = timestamp
      gestureBus.emit('gesture.recognized', {
        hand: hand.hand,
        name,
        confidence,
        timestamp,
        x: hand.indexTip.x,
        y: hand.indexTip.y,
        hands,
        heldMs,
        twoHandDistance,
      })
    }
    if (name === 'open_palm' && heldMs >= 1000 && !state.palmPauseEmitted) {
      state.palmPauseEmitted = true
      gestureBus.emit('gesture.palm_pause', {
        hand: hand.hand,
        confidence,
        timestamp,
        heldMs,
      })
    }
  }

  private handleZoom(features: FeatureFrame, timestamp: number): void {
    if (!this.emitCommands || this.paused) {
      this.lastZoomDistance = null
      return
    }
    const pressed = Array.from(this.states.values()).filter((state) => state.machine.isPressed).length
    if (pressed >= 2 && features.twoHandDistance !== null) {
      if (this.lastZoomDistance === null) {
        this.lastZoomDistance = features.twoHandDistance
      } else if (Math.abs(this.lastZoomDistance) > 0.05) {
        const scale = clamp(features.twoHandDistance / this.lastZoomDistance, 0.85, 1.18)
        const confidence = features.hands.reduce((low, hand) => Math.min(low, hand.score), 1)
        gestureBus.emit('gesture.zoom', { scale, confidence, timestamp, twoHandDistance: features.twoHandDistance })
        this.lastZoomDistance = features.twoHandDistance
      }
    } else {
      this.lastZoomDistance = null
    }
  }

  private handleLostHands(timestamp: number, seenKeys: Set<string>): void {
    for (const [key, state] of this.states) {
      if (seenKeys.has(key)) continue
      const lost = state.machine.lost(timestamp)
      if (lost?.justEnded) {
        if (lost.shortPinch) this.shortPinches += 1
        if (this.emitCommands && !this.paused) {
          gestureBus.emit('gesture.pinch_end', {
            hand: 'Unknown',
            x: 0,
            y: 0,
            confidence: 0,
            timestamp,
            heldMs: lost.heldMs,
            clickAllowed: false,
          })
        }
      }
      if (timestamp - state.lastSeen > 1000) {
        state.machine.reset()
        this.states.delete(key)
      }
    }
  }

  private updateFps(timestamp: number): void {
    const elapsed = timestamp - this.fpsStart
    if (elapsed >= 1000) {
      this.lastFps = Math.round((this.fpsFrames * 1000) / elapsed)
      this.fpsFrames = 0
      this.fpsStart = timestamp
    }
  }

  private collectReplay(key: string, name: GestureName, confidence: number, frame: LandmarkFrame): void {
    if (confidence < this.settings.minConfidence || frame.hands.length === 0) return
    const previous = this.replayLastNames.get(key)
    const count = previous && previous.name === name && frame.timestamp - previous.at < 500
    this.replayLastNames.set(key, { name, at: frame.timestamp })
    if (!count) this.replayEvents[name] = (this.replayEvents[name] ?? 0) + 1
    this.replayFrames += 1
    this.replayLatencies.push(performance.now() - frame.timestamp)
  }

  private buildMetrics(enabled: boolean): HgiMetrics {
    const profile = QUALITY_PROFILES[this.settings.quality]
    let note = `${profile.fps} fps cap · ${this.settings.quality} quality`
    if (enabled) {
      note += this.lastFps >= profile.fps - 2 ? ' · target met' : ' · below target — close other apps'
    }
    if (this.paused) note = 'Paused by palm — hold it again for 1 s to resume'
    if (!this.emitCommands) note = 'Replay mode — desktop and cursor commands are disabled'
    return {
      enabled,
      starting: false,
      modelReady: enabled,
      cameraActive: enabled && this.source?.kind === 'mediapipe',
      permission: enabled ? 'granted' : 'idle',
      fps: this.lastFps,
      latencyMs: Math.round(this.latencyAverage || this.lastLatency),
      trackingConfidence: Number(this.latestTracking.toFixed(2)),
      hands: this.latestHands,
      currentGesture: this.latestGesture,
      gestureConfidence: Number(this.latestConfidence.toFixed(2)),
      shortPinches: this.shortPinches,
      pinchEvents: this.pinchEvents,
      frameCount: this.frameCount,
      source: enabled ? (this.source?.kind ?? null) : null,
      paused: this.paused,
      quality: this.settings.quality,
      micAvailable: this.mic?.available ?? false,
      note,
    }
  }

  private emitMetrics(enabled: boolean): void {
    this.lastMetricsAt = performance.now()
    const metrics = this.buildMetrics(enabled)
    this.callbacks.onMetrics?.(metrics)
    gestureBus.emit('hgi.diagnostics', metrics)
  }

  startRecording(): void {
    this.recording = []
    this.recordingDropped = false
  }

  stopRecording(): RecordedSession | null {
    if (!this.recording) return null
    const frames = this.recording
    this.recording = null
    return {
      version: 1,
      createdAt: Date.now(),
      quality: this.settings.quality,
      frames,
    }
  }

  async replay(frames: RecordedFrame[], speed = 1): Promise<ReplayResult> {
    if (this.running) throw new Error('Stop live gestures before replaying a session.')
    this.replayEvents = {}
    this.replayLatencies = []
    this.replayLastNames.clear()
    this.replayFrames = 0
    this.replayStartedAt = performance.now()
    this.frameCount = 0
    this.fpsFrames = 0
    this.fpsStart = performance.now()
    this.lastFps = 0
    this.latencyAverage = 0
    this.shortPinches = 0
    this.pinchEvents = 0
    this.latestGesture = null
    this.latestConfidence = 0
    const source = new ReplaySource(frames, speed)
    this.source = source
    this.emitCommands = false
    this.resetPipeline()
    const ended = new Promise<void>((resolve) => {
      source.onEnd(() => resolve())
    })
    const unsubscribe = source.onFrame((frame) => this.handleFrame(frame))
    try {
      await source.start()
      this.running = true
      await ended
    } finally {
      unsubscribe()
      this.running = false
      source.stop()
      this.source = null
      this.resetPipeline()
      this.emitMetrics(false)
    }
    return {
      frames: this.frameCount,
      durationMs: Math.round(performance.now() - this.replayStartedAt),
      latencies: this.replayLatencies,
      events: this.replayEvents,
      settings: {
        minCutoff: this.settings.minCutoff,
        beta: this.settings.beta,
        quality: this.settings.quality,
      },
    }
  }
}
