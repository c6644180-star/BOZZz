import { HgiSourceError, QUALITY_PROFILES } from './LandmarkSource'
import { isMiniModeActive } from '../../services/desktopMode'
import type { LandmarkSource, QualityProfile } from './LandmarkSource'
import type { HandLandmarks, Handedness, HgiQuality, LandmarkFrame } from '../types'

type HandLandmarkerInstance = import('@mediapipe/tasks-vision').HandLandmarker

function handednessLabel(value: string | undefined): Handedness {
  if (value === 'Left' || value === 'Right') return value
  return 'Unknown'
}

interface VideoFrameCallbackMetadataLike {
  presentationTime?: number
}

export class MediaPipeSource implements LandmarkSource {
  readonly kind = 'mediapipe' as const
  quality: HgiQuality

  private listeners = new Set<(frame: LandmarkFrame) => void>()
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private detector: HandLandmarkerInstance | null = null
  private running = false
  private pending = false
  private rafId = 0
  private frameCallbackId = 0
  private lastProcessed = 0
  private lastVideoTime = -1
  private frameStartedAt = 0
  private stopVisibility: (() => void) | null = null

  constructor(quality: HgiQuality) {
    this.quality = quality
  }

  private get profile(): QualityProfile {
    return QUALITY_PROFILES[this.quality]
  }

  onFrame(listener: (frame: LandmarkFrame) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStream(): MediaStream | null {
    return this.stream
  }

  getVideo(): HTMLVideoElement | null {
    return this.video
  }

  async start(): Promise<void> {
    if (this.running) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new HgiSourceError('unavailable', 'This browser does not expose a camera API.')
    }
    const profile = this.profile
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: profile.width },
          height: { ideal: profile.height },
          frameRate: { ideal: profile.fps, max: profile.fps },
          facingMode: 'user',
        },
      })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new HgiSourceError('permission', 'Camera permission was denied. Allow the camera in your browser settings and try again.')
      }
      throw new HgiSourceError('unavailable', 'No camera stream is available. Check that no other app is using the camera.')
    }

    try {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.autoplay = true
      video.srcObject = this.stream
      await video.play()
      this.video = video

      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      const baseOptions = {
        modelAssetPath: '/mediapipe/hand_landmarker.task',
        delegate: 'GPU' as const,
      }
      const options = {
        baseOptions,
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }
      try {
        this.detector = await HandLandmarker.createFromOptions(fileset, options)
      } catch {
        this.detector = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...baseOptions, delegate: 'CPU' as const },
        })
      }

      this.running = true
      this.lastVideoTime = -1
      const onVisibility = () => {
        if (document.hidden) return
        this.lastVideoTime = -1
        if (!this.pending) this.schedule()
      }
      document.addEventListener('visibilitychange', onVisibility)
      this.stopVisibility = () => document.removeEventListener('visibilitychange', onVisibility)
      this.schedule()
    } catch (error) {
      this.stop()
      if (error instanceof HgiSourceError) throw error
      throw new HgiSourceError(
        'model',
        'The local MediaPipe hand model could not start. Check that /mediapipe/hand_landmarker.task and the wasm files exist.',
      )
    }
  }

  private schedule(): void {
    const video = this.video
    if (!this.running || !video || this.pending) return
    this.pending = true
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.frameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
        this.pending = false
        this.handleFrame(metadata as VideoFrameCallbackMetadataLike)
        this.schedule()
      })
    } else {
      this.rafId = requestAnimationFrame((now) => {
        this.pending = false
        this.handleFrame({ presentationTime: now })
        this.schedule()
      })
    }
  }

  private handleFrame(metadata: VideoFrameCallbackMetadataLike): void {
    if (!this.running || !this.video || !this.detector) return
    // In mini mode the main window is deliberately hidden while the user keeps
    // gesturing, so a hidden document is not by itself a reason to stop.
    if (document.hidden && !isMiniModeActive()) return
    const now = performance.now()
    const interval = 1000 / this.profile.fps
    if (now - this.lastProcessed < interval) return
    if (this.video.readyState < 2 || this.video.videoWidth === 0) return
    if (this.video.currentTime === this.lastVideoTime) return
    this.lastVideoTime = this.video.currentTime
    this.lastProcessed = now
    this.frameStartedAt = now

    try {
      const timestamp = now
      const result = this.detector.detectForVideo(this.video, timestamp)
      const rawLatency =
        typeof metadata.presentationTime === 'number' ? performance.now() - metadata.presentationTime : now - this.frameStartedAt
      const latencyMs = Math.max(0, Math.round(rawLatency))

      const hands: HandLandmarks[] = result.landmarks.map((points, index) => {
        const world = result.worldLandmarks[index] ?? points
        const category = result.handedness[index]?.[0]
        return {
          landmarks: points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
          world: world.map((point) => ({ x: point.x, y: point.y, z: point.z })),
          handedness: handednessLabel(category?.categoryName),
          score: category?.score ?? 0.5,
        }
      })

      const frame: LandmarkFrame = {
        hands,
        timestamp: performance.now(),
        source: 'mediapipe',
        latencyMs,
      }
      for (const listener of this.listeners) listener(frame)
    } catch {
      // A dropped inference frame must not stop the camera or crash the app.
    }
  }

  stop(): void {
    this.running = false
    this.pending = false
    if (this.video) {
      if (typeof this.video.cancelVideoFrameCallback === 'function' && this.frameCallbackId) {
        this.video.cancelVideoFrameCallback(this.frameCallbackId)
      }
      if (this.rafId) cancelAnimationFrame(this.rafId)
      this.video.pause()
      this.video.srcObject = null
    }
    this.frameCallbackId = 0
    this.rafId = 0
    this.stopVisibility?.()
    this.stopVisibility = null
    try {
      this.detector?.close()
    } catch {
      // detector may already be closed
    }
    this.detector = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.video = null
    this.listeners.clear()
  }
}
