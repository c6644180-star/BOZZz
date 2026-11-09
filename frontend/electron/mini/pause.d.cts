export interface PauseInput {
  wanderEnabled?: boolean
  manualPause?: boolean
  approvalPending?: boolean
  fullscreen?: boolean
  onBattery?: boolean
  pauseOnBattery?: boolean
  busy?: boolean
  idleSeconds?: number
  idleLimitSeconds?: number
}

export type PauseReason = 'wander-off' | 'manual-pause' | 'approval' | 'fullscreen' | 'battery' | 'idle'

export declare const IDLE_LIMIT_SECONDS: number
export declare function computePauseReasons(input: PauseInput | unknown): PauseReason[]
export declare function shouldPauseAnimation(reasons: PauseReason[] | unknown): boolean
export declare function shouldPauseWander(reasons: PauseReason[] | unknown): boolean
