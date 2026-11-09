import type { HgiQuality, LandmarkFrame } from '../types'

export type SourceKind = 'mediapipe' | 'replay'

export interface LandmarkSource {
  readonly kind: SourceKind
  start(): Promise<void>
  stop(): void
  onFrame(listener: (frame: LandmarkFrame) => void): () => void
  getStream(): MediaStream | null
  getVideo?(): HTMLVideoElement | null
  onEnd?(listener: () => void): () => void
}

export type SourceErrorCode = 'permission' | 'unavailable' | 'model' | 'runtime'

export class HgiSourceError extends Error {
  code: SourceErrorCode

  constructor(code: SourceErrorCode, message: string) {
    super(message)
    this.name = 'HgiSourceError'
    this.code = code
  }
}

export interface QualityProfile {
  width: number
  height: number
  fps: number
}

// The i3 / integrated-GPU target caps inference instead of trying to run
// MediaPipe at display refresh rate.
export const QUALITY_PROFILES: Record<HgiQuality, QualityProfile> = {
  low: { width: 320, height: 240, fps: 12 },
  medium: { width: 480, height: 360, fps: 15 },
  high: { width: 640, height: 480, fps: 20 },
}
